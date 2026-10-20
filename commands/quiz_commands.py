import time
from typing import Optional

from langchain_core.runnables import RunnableConfig
from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.graphs.quiz import graph as quiz_graph
from open_notebook.quiz.models import Quiz, QuizQuestion


class QuizGenerationInput(CommandInput):
    quiz_id: str
    content: str
    num_questions: int
    max_options: int
    model_id: Optional[str] = None
    language: Optional[str] = None


class QuizGenerationOutput(CommandOutput):
    success: bool
    quiz_id: str
    question_count: int = 0
    processing_time: float
    error_message: Optional[str] = None


async def _mark_failed(quiz: Optional[Quiz], message: str) -> None:
    """Best effort: a failure here must not hide the original error."""
    if quiz is None:
        return
    try:
        quiz.status = "failed"
        quiz.error = message[:1000]
        await quiz.save()
    except Exception as e:
        logger.error(f"Could not mark quiz {quiz.id} as failed: {e}")


# max_attempts=1 on purpose: a retry would regenerate (and pay for) the whole
# quiz. The user retries explicitly by generating again.
@command("generate_quiz", app="open_notebook", retry={"max_attempts": 1})
async def generate_quiz_command(
    input_data: QuizGenerationInput,
) -> QuizGenerationOutput:
    """Generate the questions for an existing `quiz` record in the background.

    The API creates the quiz with status ``generating`` before submitting this
    job, so it shows up in the quiz list straight away. The job fills in the
    questions and flips the status to ``ready`` or ``failed``.
    """
    start_time = time.time()
    quiz: Optional[Quiz] = None

    try:
        quiz = await Quiz.get(input_data.quiz_id)
        quiz_id = str(quiz.id)
        logger.info(
            f"Generating quiz '{quiz.name}' ({input_data.num_questions} questions, "
            f"up to {input_data.max_options} options)"
        )

        state = {
            "content": input_data.content,
            "num_questions": input_data.num_questions,
            "max_options": input_data.max_options,
            "language": input_data.language,
        }
        config: RunnableConfig = {"configurable": {"model_id": input_data.model_id}}
        result = await quiz_graph.ainvoke(state, config=config)  # type: ignore[call-overload]
        generated = result["questions"]

        # Idempotent under re-delivery: never leave two sets of questions.
        await repo_query(
            "DELETE quiz_question WHERE quiz = $quiz",
            {"quiz": ensure_record_id(quiz_id)},
        )
        for position, item in enumerate(generated):
            await QuizQuestion(quiz=quiz_id, position=position, **item).save()

        quiz.settings = {
            **(quiz.settings or {}),
            "generated_questions": len(generated),
        }
        quiz.status = "ready"
        quiz.error = None
        await quiz.save()

        processing_time = time.time() - start_time
        logger.info(
            f"Quiz {quiz.id} ready with {len(generated)} questions "
            f"in {processing_time:.2f}s"
        )
        return QuizGenerationOutput(
            success=True,
            quiz_id=str(quiz.id),
            question_count=len(generated),
            processing_time=processing_time,
        )

    except Exception as e:
        logger.error(f"Quiz generation failed: {e}")
        await _mark_failed(quiz, str(e))
        raise
