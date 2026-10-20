import math
import random
import string
from typing import Any, Dict, List, Optional

from ai_prompter import Prompter
from langchain_core.output_parsers.pydantic import PydanticOutputParser
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from loguru import logger
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from open_notebook.ai.provision import provision_langchain_model
from open_notebook.exceptions import (
    ExternalServiceError,
    InvalidInputError,
    OpenNotebookError,
)
from open_notebook.quiz.models import (
    MAX_OPTIONS,
    MAX_QUESTIONS,
    MIN_OPTIONS,
    MIN_QUESTIONS,
)
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content

# Output budget per model call. Matches chat, transformations and Ask.
QUIZ_MAX_TOKENS = 8192
# Questions requested per model call. Keeps the JSON well inside the output
# budget (a 4-option question with explanation is ~150-250 tokens) and gives
# the model a smaller job, which small local models need.
QUIZ_BATCH_SIZE = 10
# Share of multiple-choice questions the prompt asks for.
MULTIPLE_CHOICE_SHARE = 0.3

LETTERS = string.ascii_uppercase


class GeneratedQuestion(BaseModel):
    question: str = Field(description="The question text")
    options: List[str] = Field(
        description="The answer options in order. Do not prefix them with letters."
    )
    correct_options: List[str] = Field(
        description='Letters of ALL correct options, e.g. ["B"] or ["A", "C"]'
    )
    explanation: str = Field(
        default="", description="Why the correct options are correct"
    )


class GeneratedQuiz(BaseModel):
    questions: List[GeneratedQuestion] = Field(default_factory=list)


class QuizState(TypedDict, total=False):
    content: str
    num_questions: int
    max_options: int
    language: Optional[str]
    questions: List[Dict[str, Any]]
    requested: int


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def normalize_questions(
    generated: List[GeneratedQuestion],
    max_options: int,
    existing_questions: Optional[List[str]] = None,
    rng: Optional[random.Random] = None,
) -> List[Dict[str, Any]]:
    """Turn model output into valid quiz questions, dropping unusable ones.

    Never trusts the model: a question is dropped (not repaired by guessing)
    when it has no usable correct option, refers to letters that don't exist,
    marks every option correct, or duplicates an earlier question. Fixable
    problems are fixed: blank and duplicate options are removed, a question
    with more options than ``max_options`` loses wrong options (never correct
    ones), and option order is shuffled because models over-use the first
    positions for correct answers. The type is derived from the number of
    correct options, so a model that mislabels single vs. multiple can't
    produce an invalid question.

    Returns dicts with ``type``, ``question``, ``options`` (``{"id", "text"}``,
    ids ``a``, ``b``, ...), ``correct_option_ids`` and ``explanation``.
    """
    rng = rng or random.Random()
    seen = {_norm(q) for q in (existing_questions or [])}
    result: List[Dict[str, Any]] = []

    for item in generated:
        text = item.question.strip()
        if not text or _norm(text) in seen:
            continue

        # (original letter, option text), skipping blank/duplicate options
        # but keeping the letters the model used so `correct_options` still
        # points at the right ones.
        options: List[tuple[str, str]] = []
        option_texts: set[str] = set()
        for index, raw in enumerate(item.options):
            option = raw.strip()
            if not option or _norm(option) in option_texts or index >= len(LETTERS):
                continue
            option_texts.add(_norm(option))
            options.append((LETTERS[index], option))

        by_letter = dict(options)
        correct = []
        for letter in item.correct_options:
            letter = letter.strip().upper().rstrip(".)")
            if letter in by_letter and letter not in correct:
                correct.append(letter)
        if not correct or len(correct) >= len(options):
            continue

        wrong = [(letter, opt) for letter, opt in options if letter not in correct]
        if len(correct) >= max_options:
            continue
        if len(options) > max_options:
            rng.shuffle(wrong)
            wrong = wrong[: max_options - len(correct)]
        kept = [(letter, by_letter[letter]) for letter in correct] + wrong
        if len(kept) < MIN_OPTIONS:
            continue
        rng.shuffle(kept)

        ids = [string.ascii_lowercase[i] for i in range(len(kept))]
        correct_ids = [
            ids[i] for i, (letter, _) in enumerate(kept) if letter in correct
        ]
        seen.add(_norm(text))
        result.append(
            {
                "type": "single" if len(correct_ids) == 1 else "multiple",
                "question": text,
                "options": [{"id": i, "text": opt} for i, (_, opt) in zip(ids, kept)],
                "correct_option_ids": correct_ids,
                "explanation": item.explanation.strip() or None,
            }
        )
    return result


def _multiple_choice_count(count: int, max_options: int) -> int:
    """How many multiple-choice questions to ask for.

    A multiple-choice question needs at least two correct and one wrong
    option, so with fewer than three options there can be none.
    """
    if max_options < 3:
        return 0
    return round(count * MULTIPLE_CHOICE_SHARE)


async def _generate_batch(
    *,
    content: str,
    batch_size: int,
    max_options: int,
    language: Optional[str],
    existing_questions: List[str],
    model_id: Optional[str],
) -> List[GeneratedQuestion]:
    parser: PydanticOutputParser[GeneratedQuiz] = PydanticOutputParser(
        pydantic_object=GeneratedQuiz
    )
    system_prompt = Prompter(prompt_template="quiz/generate", parser=parser).render(  # type: ignore[arg-type]
        data={
            "content": content,
            "num_questions": batch_size,
            "max_options": max_options,
            "language": language,
            "existing_questions": existing_questions,
            "multiple_choice_count": _multiple_choice_count(batch_size, max_options),
        }
    )
    model = await provision_langchain_model(
        system_prompt,
        model_id,
        "transformation",
        max_tokens=QUIZ_MAX_TOKENS,
        structured=dict(type="json"),
    )
    ai_message = await model.ainvoke(system_prompt)
    cleaned = clean_thinking_content(extract_text_content(ai_message.content))
    return parser.parse(cleaned).questions


async def generate_questions(state: QuizState, config: RunnableConfig) -> dict:
    """Generate ``num_questions`` validated questions, in batches.

    A batch whose output can't be parsed, or that yields too few usable
    questions, is retried: the loop makes at most one more model call than
    the minimum needed. Provider errors (auth, rate limit, context length)
    abort immediately - repeating them wouldn't help. If at least one question
    survives, the quiz is kept even when it falls short of the request;
    if none do, the failure is raised.
    """
    content = (state.get("content") or "").strip()
    if not content:
        raise InvalidInputError("There is no content to build a quiz from")
    num_questions = state.get("num_questions", 10)
    max_options = state.get("max_options", 4)
    if not MIN_QUESTIONS <= num_questions <= MAX_QUESTIONS:
        raise InvalidInputError(
            f"Number of questions must be between {MIN_QUESTIONS} and {MAX_QUESTIONS}"
        )
    if not MIN_OPTIONS <= max_options <= MAX_OPTIONS:
        raise InvalidInputError(
            f"Maximum options must be between {MIN_OPTIONS} and {MAX_OPTIONS}"
        )

    model_id = config.get("configurable", {}).get("model_id")
    collected: List[Dict[str, Any]] = []
    max_calls = math.ceil(num_questions / QUIZ_BATCH_SIZE) + 1
    last_parse_error: Optional[Exception] = None

    for call in range(max_calls):
        missing = num_questions - len(collected)
        if missing <= 0:
            break
        try:
            batch = await _generate_batch(
                content=content,
                batch_size=min(missing, QUIZ_BATCH_SIZE),
                max_options=max_options,
                language=state.get("language"),
                existing_questions=[q["question"] for q in collected],
                model_id=model_id,
            )
        except OpenNotebookError:
            raise
        except ValueError as e:
            # OutputParserException and json errors are ValueErrors: the model
            # answered, but not in a usable shape. Try again.
            logger.warning(f"Quiz batch {call + 1}/{max_calls} was not parseable: {e}")
            last_parse_error = e
            continue
        except Exception as e:
            error_class, user_message = classify_error(e)
            raise error_class(user_message) from e

        collected.extend(
            normalize_questions(batch, max_options, [q["question"] for q in collected])[
                :missing
            ]
        )

    if not collected:
        detail = f" ({last_parse_error})" if last_parse_error else ""
        raise ExternalServiceError(
            "The model did not return any usable quiz questions"
            f"{detail}. Try a different model or less content."
        )
    if len(collected) < num_questions:
        logger.warning(
            f"Quiz generation produced {len(collected)} of {num_questions} questions"
        )
    return {"questions": collected, "requested": num_questions}


quiz_graph_builder = StateGraph(QuizState)
quiz_graph_builder.add_node("generate_questions", generate_questions)
quiz_graph_builder.add_edge(START, "generate_questions")
quiz_graph_builder.add_edge("generate_questions", END)
graph = quiz_graph_builder.compile()
