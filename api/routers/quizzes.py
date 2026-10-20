from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Query
from loguru import logger

from api.command_service import CommandService
from api.models import (
    QuizAnswerRequest,
    QuizAnswerResponse,
    QuizAttemptCreate,
    QuizAttemptResponse,
    QuizDetailResponse,
    QuizFinishResponse,
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizOptionResponse,
    QuizQuestionResponse,
    QuizResponse,
    QuizStatsResponse,
)
from api.quiz_service import QuizService
from open_notebook.ai.models import Model
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import InvalidInputError
from open_notebook.quiz.models import (
    Quiz,
    QuizAnswer,
    QuizAttempt,
    QuizQuestion,
    compute_quiz_stats,
)

router = APIRouter()


def _require_table(record_id: str, table: str) -> None:
    """ObjectModel.get() is polymorphic by ID prefix, so a wrong-table ID would
    quietly load some other kind of record. Reject it up front."""
    if not record_id or not record_id.startswith(f"{table}:"):
        raise InvalidInputError(f"'{record_id}' is not a valid {table} ID")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _stats(stats_map: Dict[str, dict], quiz_id: Optional[str]) -> QuizStatsResponse:
    return QuizStatsResponse(
        **(stats_map.get(quiz_id or "") or compute_quiz_stats(0, [], []))
    )


def _quiz_fields(quiz: Quiz, stats: QuizStatsResponse) -> dict:
    return dict(
        id=str(quiz.id),
        name=quiz.name,
        notebook_id=quiz.notebook,
        status=quiz.status,
        error=quiz.error,
        settings=quiz.settings,
        created=_iso(quiz.created),
        updated=_iso(quiz.updated),
        stats=stats,
    )


def _public_question(question: QuizQuestion) -> QuizQuestionResponse:
    """The question without its solution; that is only revealed on answering."""
    return QuizQuestionResponse(
        id=str(question.id),
        position=question.position,
        type=question.type,
        question=question.question,
        options=[QuizOptionResponse(**o) for o in question.options],
    )


async def _get_quiz(quiz_id: str) -> Quiz:
    _require_table(quiz_id, "quiz")
    return await Quiz.get(quiz_id)


async def _get_attempt(attempt_id: str) -> QuizAttempt:
    _require_table(attempt_id, "quiz_attempt")
    return await QuizAttempt.get(attempt_id)


async def _attempt_questions(attempt: QuizAttempt) -> List[QuizQuestion]:
    """The attempt's questions in the order they were drawn."""
    if not attempt.question_ids:
        return []
    rows = await repo_query(
        "SELECT * FROM quiz_question WHERE id IN $ids",
        {"ids": [ensure_record_id(q) for q in attempt.question_ids]},
    )
    by_id = {str(row["id"]): QuizQuestion(**row) for row in rows}
    return [by_id[q] for q in attempt.question_ids if q in by_id]


@router.post("/quizzes/generate", response_model=QuizGenerateResponse)
async def generate_quiz(request: QuizGenerateRequest):
    """Create a quiz and start generating its questions in the background.

    The quiz exists immediately with status ``generating``; poll
    ``GET /quizzes/{id}`` until it is ``ready`` or ``failed``.
    """
    _require_table(request.notebook_id, "notebook")
    notebook = await Notebook.get(request.notebook_id)

    if request.model_id:
        _require_table(request.model_id, "model")
        await Model.get(request.model_id)

    content = await QuizService.build_content(notebook, request.context_config)
    if not content:
        raise InvalidInputError(
            "The selected sources and notes contain no text to build a quiz from"
        )

    quiz = Quiz(
        name=request.name.strip(),
        notebook=notebook.id,
        settings={
            "num_questions": request.num_questions,
            "max_options": request.max_options,
            "model_id": request.model_id,
            "language": request.language,
        },
        status="generating",
    )
    await quiz.save()
    quiz_id = str(quiz.id)

    try:
        job_id = await CommandService.submit_command_job(
            "open_notebook",
            "generate_quiz",
            {
                "quiz_id": quiz_id,
                "content": content,
                "num_questions": request.num_questions,
                "max_options": request.max_options,
                "model_id": request.model_id,
                "language": request.language,
            },
        )
    except Exception:
        # No job will ever fill this quiz; don't leave it "generating" forever.
        logger.error(f"Could not submit generation job for quiz {quiz_id}")
        await quiz.delete()
        raise

    return QuizGenerateResponse(quiz_id=quiz_id, job_id=job_id, status="generating")


@router.get("/quizzes", response_model=List[QuizResponse])
async def list_quizzes(
    notebook_id: Optional[str] = Query(
        None, description="Only quizzes of this notebook"
    ),
):
    """All quizzes, newest first, each with its learning statistics."""
    if notebook_id:
        _require_table(notebook_id, "notebook")
    quizzes = await Quiz.get_all(order_by="created desc")
    if notebook_id:
        quizzes = [q for q in quizzes if q.notebook == notebook_id]
    stats_map = await Quiz.get_stats_map([str(q.id) for q in quizzes])
    return [QuizResponse(**_quiz_fields(q, _stats(stats_map, q.id))) for q in quizzes]


@router.get("/quizzes/{quiz_id}", response_model=QuizDetailResponse)
async def get_quiz(quiz_id: str):
    quiz = await _get_quiz(quiz_id)
    stats_map = await Quiz.get_stats_map([quiz_id])
    questions = await quiz.get_questions()
    return QuizDetailResponse(
        **_quiz_fields(quiz, _stats(stats_map, quiz_id)),
        questions=[_public_question(q) for q in questions],
    )


@router.delete("/quizzes/{quiz_id}")
async def delete_quiz(quiz_id: str):
    """Delete a quiz with its questions, attempts and answers."""
    quiz = await _get_quiz(quiz_id)
    await quiz.delete()
    return {"message": "Quiz deleted successfully"}


@router.post("/quizzes/{quiz_id}/attempts", response_model=QuizAttemptResponse)
async def start_attempt(quiz_id: str, request: QuizAttemptCreate):
    """Start a run through the quiz, or through just the questions last answered wrong."""
    quiz = await _get_quiz(quiz_id)
    if quiz.status != "ready":
        raise InvalidInputError(f"This quiz is not ready yet (status: {quiz.status})")

    questions = await quiz.get_questions()
    if request.mode == "retry_wrong":
        wrong = set(await quiz.get_wrong_question_ids())
        questions = [q for q in questions if q.id in wrong]
        if not questions:
            raise InvalidInputError("There are no wrongly answered questions to repeat")
    if not questions:
        raise InvalidInputError("This quiz has no questions")

    attempt = QuizAttempt(
        quiz=quiz_id,
        mode=request.mode,
        question_ids=[str(q.id) for q in questions],
        total=len(questions),
    )
    await attempt.save()
    return QuizAttemptResponse(
        id=str(attempt.id),
        quiz_id=quiz_id,
        mode=attempt.mode,
        total=attempt.total,
        finished=False,
        questions=[_public_question(q) for q in questions],
    )


@router.post(
    "/quizzes/attempts/{attempt_id}/answers", response_model=QuizAnswerResponse
)
async def answer_question(attempt_id: str, request: QuizAnswerRequest):
    """Record the answer to one question and reveal the solution and explanation."""
    attempt = await _get_attempt(attempt_id)
    if attempt.finished:
        raise InvalidInputError("This attempt is already finished")
    if request.question_id not in attempt.question_ids:
        raise InvalidInputError("This question is not part of the attempt")

    answered = {a.question for a in await attempt.get_answers()}
    if request.question_id in answered:
        raise InvalidInputError("This question was already answered in this attempt")

    question = await QuizQuestion.get(request.question_id)
    selected = list(dict.fromkeys(request.selected_option_ids))
    valid_ids = {o["id"] for o in question.options}
    if not selected:
        raise InvalidInputError("Select at least one option")
    if not set(selected) <= valid_ids:
        raise InvalidInputError("Unknown answer option")
    if question.type == "single" and len(selected) != 1:
        raise InvalidInputError(
            "Select exactly one option for a single-choice question"
        )

    is_correct = question.grade(selected)
    await QuizAnswer(
        quiz=attempt.quiz,
        attempt=str(attempt.id),
        question=request.question_id,
        selected_option_ids=selected,
        is_correct=is_correct,
    ).save()
    return QuizAnswerResponse(
        question_id=request.question_id,
        is_correct=is_correct,
        correct_option_ids=question.correct_option_ids,
        explanation=question.explanation,
    )


@router.post("/quizzes/attempts/{attempt_id}/finish", response_model=QuizFinishResponse)
async def finish_attempt(attempt_id: str):
    """Close an attempt and score it.

    Questions left unanswered are recorded as wrong answers, so they count
    against the score and are repeated by "repeat wrong questions".
    Finishing an attempt twice returns the same result.
    """
    attempt = await _get_attempt(attempt_id)
    answers = await attempt.get_answers()

    if not attempt.finished:
        answered = {a.question for a in answers}
        for question_id in attempt.question_ids:
            if question_id not in answered:
                skipped = QuizAnswer(
                    quiz=attempt.quiz,
                    attempt=str(attempt.id),
                    question=question_id,
                    selected_option_ids=[],
                    is_correct=False,
                )
                await skipped.save()
                answers.append(skipped)

    correct = {a.question for a in answers if a.is_correct}

    if not attempt.finished:
        attempt.score = len(correct)
        attempt.finished = datetime.now(timezone.utc)
        await attempt.save()

    score = attempt.score or 0
    stats_map = await Quiz.get_stats_map([attempt.quiz])
    return QuizFinishResponse(
        attempt_id=str(attempt.id),
        score=score,
        total=attempt.total,
        score_pct=round(100 * score / attempt.total),
        wrong_question_ids=[q for q in attempt.question_ids if q not in correct],
        stats=_stats(stats_map, attempt.quiz),
    )
