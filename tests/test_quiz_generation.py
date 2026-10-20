"""Tests for quiz generation: normalization, the graph node and the command."""

import json
import random
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.runnables import RunnableConfig

from commands.quiz_commands import QuizGenerationInput, generate_quiz_command
from open_notebook.exceptions import (
    ExternalServiceError,
    InvalidInputError,
    RateLimitError,
)
from open_notebook.graphs.quiz import (
    QUIZ_BATCH_SIZE,
    QUIZ_MAX_TOKENS,
    GeneratedQuestion,
    QuizState,
    generate_questions,
    normalize_questions,
)
from open_notebook.quiz.models import Quiz, QuizQuestion

CONFIG = cast(RunnableConfig, {"configurable": {"model_id": "model:x"}})


def gq(question="What is X?", options=None, correct=None, explanation="Because."):
    return GeneratedQuestion(
        question=question,
        options=options if options is not None else ["one", "two", "three", "four"],
        correct_options=correct if correct is not None else ["B"],
        explanation=explanation,
    )


def model_returning(*contents: str) -> MagicMock:
    model = MagicMock()
    model.ainvoke = AsyncMock(
        side_effect=[MagicMock(content=content) for content in contents]
    )
    return model


def quiz_json(count: int, prefix: str = "Q") -> str:
    return json.dumps(
        {
            "questions": [
                {
                    "question": f"{prefix}{i}?",
                    "options": ["a1", "b2", "c3", "d4"],
                    "correct_options": ["A"],
                    "explanation": "e",
                }
                for i in range(count)
            ]
        }
    )


def provision_returning(model):
    return patch(
        "open_notebook.graphs.quiz.provision_langchain_model",
        new=AsyncMock(return_value=model),
    )


# ============================================================================
# normalize_questions
# ============================================================================


class TestNormalizeQuestions:
    def rng(self):
        return random.Random(0)

    def test_single_choice_is_valid_and_shuffled_consistently(self):
        [q] = normalize_questions([gq()], 4, rng=self.rng())
        assert q["type"] == "single"
        assert len(q["options"]) == 4
        [correct_id] = q["correct_option_ids"]
        correct_text = next(o["text"] for o in q["options"] if o["id"] == correct_id)
        assert correct_text == "two"
        assert [o["id"] for o in q["options"]] == ["a", "b", "c", "d"]
        # The result must satisfy the persisted model's own validation.
        QuizQuestion(quiz="quiz:1", position=0, **q)

    def test_type_is_derived_from_number_of_correct_options(self):
        [q] = normalize_questions([gq(correct=["A", "C"])], 4, rng=self.rng())
        assert q["type"] == "multiple"
        texts = {o["id"]: o["text"] for o in q["options"]}
        assert {texts[i] for i in q["correct_option_ids"]} == {"one", "three"}
        QuizQuestion(quiz="quiz:1", position=0, **q)

    def test_letter_formats_are_tolerated(self):
        [q] = normalize_questions([gq(correct=["b)"])], 4, rng=self.rng())
        assert q["type"] == "single"

    @pytest.mark.parametrize(
        "item",
        [
            gq(question="   "),
            gq(correct=[]),
            gq(correct=["Z"]),
            gq(correct=["A", "B", "C", "D"]),  # everything correct
            gq(options=["only one"], correct=["A"]),
            gq(options=["same", "SAME", "  same "], correct=["A"]),  # dupes collapse
        ],
    )
    def test_unusable_questions_are_dropped(self, item):
        assert normalize_questions([item], 4, rng=self.rng()) == []

    def test_blank_and_duplicate_options_are_removed_without_shifting_correct(self):
        item = gq(options=["one", "", "two", "Two", "three"], correct=["C"])
        [q] = normalize_questions([item], 4, rng=self.rng())
        texts = {o["id"]: o["text"] for o in q["options"]}
        assert sorted(texts.values()) == ["one", "three", "two"]
        assert [texts[i] for i in q["correct_option_ids"]] == ["two"]

    def test_too_many_options_drop_wrong_ones_never_correct_ones(self):
        item = gq(options=list("abcdefgh"), correct=["C", "G"])
        [q] = normalize_questions([item], 4, rng=self.rng())
        assert len(q["options"]) == 4
        texts = {o["id"]: o["text"] for o in q["options"]}
        assert {texts[i] for i in q["correct_option_ids"]} == {"c", "g"}

    def test_more_correct_options_than_allowed_drops_the_question(self):
        item = gq(correct=["A", "B", "C"])
        assert normalize_questions([item], 3, rng=self.rng()) == []

    def test_duplicate_questions_are_dropped_including_existing_ones(self):
        items = [gq("Same?"), gq("same?"), gq("Other?")]
        result = normalize_questions(items, 4, existing_questions=["OTHER?"])
        assert [q["question"] for q in result] == ["Same?"]

    def test_empty_explanation_becomes_none(self):
        [q] = normalize_questions([gq(explanation="  ")], 4)
        assert q["explanation"] is None


# ============================================================================
# generate_questions (graph node)
# ============================================================================


@pytest.mark.asyncio
class TestGenerateQuestions:
    def state(self, **overrides) -> QuizState:
        base: QuizState = {
            "content": "Some study material.",
            "num_questions": 3,
            "max_options": 4,
            "language": None,
        }
        base.update(overrides)  # type: ignore[typeddict-item]
        return base

    async def test_happy_path_uses_requested_model_and_budget(self):
        model = model_returning(quiz_json(3))
        with provision_returning(model) as provision:
            result = await generate_questions(self.state(), CONFIG)

        assert len(result["questions"]) == 3
        assert result["requested"] == 3
        args = provision.await_args
        assert args.args[1] == "model:x"
        assert args.kwargs["max_tokens"] == QUIZ_MAX_TOKENS

    async def test_prompt_contains_content_count_and_language(self):
        model = model_returning(quiz_json(2))
        with provision_returning(model):
            await generate_questions(
                self.state(num_questions=2, language="Deutsch"), CONFIG
            )
        prompt = model.ainvoke.await_args.args[0]
        assert "Some study material." in prompt
        assert "exactly 2 quiz questions" in prompt
        assert "Deutsch" in prompt
        assert "questions" in prompt  # format instructions mention the schema

    async def test_prompt_does_not_hardcode_an_english_example_phrase(self):
        """A model copies example wording, so "Select all that apply." ended up
        behind German questions. The language is the quiz's, not the prompt's."""
        model = model_returning(quiz_json(3))
        with provision_returning(model):
            await generate_questions(self.state(language="Deutsch"), CONFIG)
        prompt = model.ainvoke.await_args.args[0]
        assert "select all that apply" not in prompt.lower()
        assert "written in the language of the quiz" in prompt

    async def test_large_requests_are_split_into_batches(self):
        total = QUIZ_BATCH_SIZE + 5
        first, second = quiz_json(QUIZ_BATCH_SIZE, "A"), quiz_json(5, "B")
        model = model_returning(first, second)
        with provision_returning(model):
            result = await generate_questions(self.state(num_questions=total), CONFIG)

        assert len(result["questions"]) == total
        assert model.ainvoke.await_count == 2
        second_prompt = model.ainvoke.await_args_list[1].args[0]
        assert "exactly 5 quiz questions" in second_prompt
        assert "A0?" in second_prompt  # earlier questions are not to be repeated

    async def test_unparseable_batch_is_retried(self):
        model = model_returning("this is not json", quiz_json(3))
        with provision_returning(model):
            result = await generate_questions(self.state(), CONFIG)
        assert len(result["questions"]) == 3
        assert model.ainvoke.await_count == 2

    async def test_shortfall_is_topped_up_once_then_accepted(self):
        model = model_returning(quiz_json(1, "A"), quiz_json(1, "B"))
        with provision_returning(model):
            result = await generate_questions(self.state(), CONFIG)
        # 3 requested, 1 + 1 delivered; ceil(3/10) + 1 = 2 calls, so it stops.
        assert len(result["questions"]) == 2
        assert result["requested"] == 3
        assert model.ainvoke.await_count == 2

    async def test_extra_questions_are_cut_to_the_requested_number(self):
        model = model_returning(quiz_json(5))
        with provision_returning(model):
            result = await generate_questions(self.state(num_questions=2), CONFIG)
        assert len(result["questions"]) == 2

    async def test_nothing_usable_raises(self):
        model = model_returning("nope", "still nope")
        with provision_returning(model):
            with pytest.raises(ExternalServiceError, match="usable quiz questions"):
                await generate_questions(self.state(), CONFIG)

    async def test_provider_error_aborts_without_retry(self):
        model = MagicMock()
        model.ainvoke = AsyncMock(side_effect=Exception("rate limit exceeded (429)"))
        with provision_returning(model):
            with pytest.raises(RateLimitError):
                await generate_questions(self.state(), CONFIG)
        assert model.ainvoke.await_count == 1

    @pytest.mark.parametrize(
        "overrides",
        [
            {"content": "   "},
            {"num_questions": 0},
            {"num_questions": 51},
            {"max_options": 1},
            {"max_options": 9},
        ],
    )
    async def test_invalid_input_is_rejected_before_any_model_call(self, overrides):
        with provision_returning(model_returning()) as provision:
            with pytest.raises(InvalidInputError):
                await generate_questions(self.state(**overrides), CONFIG)
        provision.assert_not_awaited()

    async def test_thinking_output_is_stripped(self):
        model = model_returning(f"<think>hmm {{not json}}</think>{quiz_json(3)}")
        with provision_returning(model):
            result = await generate_questions(self.state(), CONFIG)
        assert len(result["questions"]) == 3

    async def test_two_option_limit_asks_for_single_choice_only(self):
        model = model_returning(quiz_json(3))
        with provision_returning(model):
            await generate_questions(self.state(max_options=2), CONFIG)
        prompt = model.ainvoke.await_args.args[0]
        assert "single-choice questions only" in prompt
        assert "multiple-choice questions" not in prompt


# ============================================================================
# generate_quiz_command
# ============================================================================


def command_input(**overrides) -> QuizGenerationInput:
    data = dict(
        quiz_id="quiz:1",
        content="material",
        num_questions=2,
        max_options=4,
        model_id="model:x",
    )
    data.update(overrides)
    return QuizGenerationInput(**data)


GENERATED = [
    {
        "type": "single",
        "question": "Q1?",
        "options": [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}],
        "correct_option_ids": ["a"],
        "explanation": None,
    },
    {
        "type": "multiple",
        "question": "Q2?",
        "options": [
            {"id": "a", "text": "x"},
            {"id": "b", "text": "y"},
            {"id": "c", "text": "z"},
        ],
        "correct_option_ids": ["a", "b"],
        "explanation": "e",
    },
]


@pytest.mark.asyncio
class TestGenerateQuizCommand:
    def make_quiz(self) -> Quiz:
        return Quiz(id="quiz:1", name="My quiz", settings={"num_questions": 2})

    async def test_success_replaces_questions_and_marks_ready(self):
        quiz = self.make_quiz()
        saved = []

        async def fake_save(self_):
            saved.append(self_)

        with (
            patch("commands.quiz_commands.Quiz.get", AsyncMock(return_value=quiz)),
            patch(
                "commands.quiz_commands.quiz_graph.ainvoke",
                AsyncMock(return_value={"questions": GENERATED}),
            ) as invoke,
            patch("commands.quiz_commands.repo_query", AsyncMock()) as query,
            patch.object(QuizQuestion, "save", fake_save),
            patch.object(Quiz, "save", new_callable=AsyncMock),
        ):
            output = await generate_quiz_command(command_input())

        assert output.success is True
        assert output.question_count == 2
        # Old questions are removed first so a re-run can't double them up.
        assert query.await_args is not None
        assert query.await_args.args[0].startswith("DELETE quiz_question")
        assert [q.position for q in saved] == [0, 1]
        assert [q.type for q in saved] == ["single", "multiple"]
        assert quiz.status == "ready"
        assert quiz.error is None
        assert quiz.settings == {"num_questions": 2, "generated_questions": 2}
        assert invoke.await_args is not None
        config = invoke.await_args.kwargs["config"]
        assert config == {"configurable": {"model_id": "model:x"}}

    async def test_failure_marks_quiz_failed_and_reraises(self):
        quiz = self.make_quiz()
        with (
            patch("commands.quiz_commands.Quiz.get", AsyncMock(return_value=quiz)),
            patch(
                "commands.quiz_commands.quiz_graph.ainvoke",
                AsyncMock(side_effect=ExternalServiceError("model exploded")),
            ),
            patch.object(Quiz, "save", new_callable=AsyncMock) as save,
        ):
            with pytest.raises(ExternalServiceError, match="model exploded"):
                await generate_quiz_command(command_input())

        assert quiz.status == "failed"
        assert quiz.error == "model exploded"
        save.assert_awaited()

    async def test_missing_quiz_just_raises(self):
        from open_notebook.exceptions import NotFoundError

        with patch(
            "commands.quiz_commands.Quiz.get",
            AsyncMock(side_effect=NotFoundError("quiz:1 not found")),
        ):
            with pytest.raises(NotFoundError):
                await generate_quiz_command(command_input())

    async def test_failure_to_record_failure_does_not_mask_the_original_error(self):
        quiz = self.make_quiz()
        with (
            patch.object(Quiz, "save", AsyncMock(side_effect=RuntimeError("db down"))),
            patch("commands.quiz_commands.Quiz.get", AsyncMock(return_value=quiz)),
            patch(
                "commands.quiz_commands.quiz_graph.ainvoke",
                AsyncMock(side_effect=ExternalServiceError("model exploded")),
            ),
        ):
            with pytest.raises(ExternalServiceError, match="model exploded"):
                await generate_quiz_command(command_input())
