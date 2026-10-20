from datetime import datetime
from typing import Any, ClassVar, Dict, List, Literal, Optional

from pydantic import Field, field_validator, model_validator

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel

QuizStatus = Literal["generating", "ready", "failed"]
QuestionType = Literal["single", "multiple"]
AttemptMode = Literal["full", "retry_wrong"]

MIN_OPTIONS = 2
MAX_OPTIONS = 8
MIN_QUESTIONS = 1
MAX_QUESTIONS = 50


def _percent(score: int, total: int) -> int:
    return round(100 * score / total) if total else 0


def compute_quiz_stats(
    question_count: int,
    attempts: List[Dict[str, Any]],
    answers: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Learning statistics for one quiz.

    ``attempts`` are the finished attempts, newest first, each with ``score``
    and ``total``. ``answers`` are every recorded answer, newest first, each
    with ``question`` and ``is_correct``.

    A question counts as *mastered* when its latest answer was correct and as
    *wrong* when its latest answer was wrong, so answering a wrong question
    correctly takes it out of the retry set. Unanswered questions are neither.
    """
    latest: Dict[str, bool] = {}
    for answer in answers:
        latest.setdefault(str(answer["question"]), bool(answer["is_correct"]))

    percents = [
        _percent(a["score"], a["total"])
        for a in attempts
        if a.get("total") and a.get("score") is not None
    ]
    return {
        "question_count": question_count,
        "attempt_count": len(attempts),
        "last_score_pct": percents[0] if percents else None,
        "best_score_pct": max(percents) if percents else None,
        "answered_count": len(latest),
        "mastered_count": sum(1 for ok in latest.values() if ok),
        "wrong_count": sum(1 for ok in latest.values() if not ok),
    }


class Quiz(ObjectModel):
    """A generated quiz. A snapshot: later edits to the sources don't change it."""

    table_name: ClassVar[str] = "quiz"
    nullable_fields: ClassVar[set[str]] = {"notebook", "settings", "error", "command"}

    name: str = Field(..., description="Quiz name")
    notebook: Optional[str] = Field(
        default=None, description="Notebook the quiz was generated from, if any"
    )
    settings: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Generation settings: num_questions, max_options, model_id, language"
        ),
    )
    status: QuizStatus = Field(default="generating")
    error: Optional[str] = Field(default=None, description="Why generation failed")
    command: Optional[str] = Field(
        default=None, description="Link to the surreal-commands generation job"
    )

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        for field in ("notebook", "command"):
            if data.get(field):
                data[field] = ensure_record_id(data[field])
        return data

    async def get_questions(self) -> List["QuizQuestion"]:
        if not self.id:
            return []
        rows = await repo_query(
            "SELECT * FROM quiz_question WHERE quiz = $quiz ORDER BY position ASC",
            {"quiz": ensure_record_id(self.id)},
        )
        return [QuizQuestion(**row) for row in rows]

    async def get_wrong_question_ids(self) -> List[str]:
        """Questions whose latest answer was wrong, in quiz order."""
        if not self.id:
            return []
        rows = await repo_query(
            "SELECT question, is_correct FROM quiz_answer "
            "WHERE quiz = $quiz ORDER BY created DESC",
            {"quiz": ensure_record_id(self.id)},
        )
        latest: Dict[str, bool] = {}
        for row in rows:
            latest.setdefault(str(row["question"]), bool(row["is_correct"]))
        wrong = {qid for qid, ok in latest.items() if not ok}
        return [q.id for q in await self.get_questions() if q.id in wrong]

    @classmethod
    async def get_stats_map(
        cls, quiz_ids: Optional[List[str]] = None
    ) -> Dict[str, Dict[str, Any]]:
        """Statistics per quiz id, using three queries however many quizzes.

        With ``quiz_ids`` only those quizzes are covered; without it, all.
        Quizzes with no questions or attempts still get an all-zero entry.
        """
        scope = ""
        params: Dict[str, Any] = {}
        if quiz_ids is not None:
            if not quiz_ids:
                return {}
            scope = " WHERE quiz IN $quiz_ids"
            params = {"quiz_ids": [ensure_record_id(i) for i in quiz_ids]}

        counts = await repo_query(
            f"SELECT quiz, count() AS n FROM quiz_question{scope} GROUP BY quiz",
            params,
        )
        attempts = await repo_query(
            "SELECT quiz, score, total FROM quiz_attempt"
            + (scope + " AND" if scope else " WHERE")
            + " finished != NONE ORDER BY finished DESC",
            params,
        )
        answers = await repo_query(
            f"SELECT quiz, question, is_correct FROM quiz_answer{scope} "
            "ORDER BY created DESC",
            params,
        )

        question_counts = {str(row["quiz"]): row["n"] for row in counts}
        ids = set(question_counts)
        ids.update(quiz_ids or [])
        ids.update(str(row["quiz"]) for row in attempts)
        ids.update(str(row["quiz"]) for row in answers)
        return {
            quiz_id: compute_quiz_stats(
                question_counts.get(quiz_id, 0),
                [r for r in attempts if str(r["quiz"]) == quiz_id],
                [r for r in answers if str(r["quiz"]) == quiz_id],
            )
            for quiz_id in ids
        }

    async def get_stats(self) -> Dict[str, Any]:
        if not self.id:
            return compute_quiz_stats(0, [], [])
        stats = await self.get_stats_map([self.id])
        return stats.get(self.id) or compute_quiz_stats(0, [], [])


class QuizQuestion(ObjectModel):
    table_name: ClassVar[str] = "quiz_question"
    nullable_fields: ClassVar[set[str]] = {"explanation"}

    quiz: str = Field(..., description="Quiz record ID")
    position: int = Field(..., ge=0, description="Order within the quiz")
    type: QuestionType
    question: str = Field(..., min_length=1)
    options: List[Dict[str, str]] = Field(
        ..., description='Answer options, each {"id": ..., "text": ...}'
    )
    correct_option_ids: List[str]
    explanation: Optional[str] = None

    @field_validator("question")
    @classmethod
    def question_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Question text cannot be blank")
        return v

    @model_validator(mode="after")
    def validate_options(self) -> "QuizQuestion":
        if not MIN_OPTIONS <= len(self.options) <= MAX_OPTIONS:
            raise ValueError(f"A question needs {MIN_OPTIONS} to {MAX_OPTIONS} options")
        ids = []
        for option in self.options:
            if not option.get("id") or not option.get("text", "").strip():
                raise ValueError("Every option needs an id and a text")
            ids.append(option["id"])
        if len(set(ids)) != len(ids):
            raise ValueError("Option ids must be unique")
        correct = self.correct_option_ids
        if len(set(correct)) != len(correct):
            raise ValueError("Correct option ids must be unique")
        if not set(correct) <= set(ids):
            raise ValueError("Correct option ids must refer to existing options")
        if self.type == "single" and len(correct) != 1:
            raise ValueError("A single-choice question has exactly one correct option")
        if self.type == "multiple" and len(correct) < 2:
            raise ValueError(
                "A multiple-choice question has at least two correct options"
            )
        return self

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        data["quiz"] = ensure_record_id(data["quiz"])
        return data

    def grade(self, selected_option_ids: List[str]) -> bool:
        """Correct only if exactly the correct options are selected."""
        return set(selected_option_ids) == set(self.correct_option_ids)


class QuizAttempt(ObjectModel):
    table_name: ClassVar[str] = "quiz_attempt"
    nullable_fields: ClassVar[set[str]] = {"finished", "score"}

    quiz: str
    mode: AttemptMode = "full"
    question_ids: List[str] = Field(..., min_length=1)
    finished: Optional[datetime] = None
    score: Optional[int] = None
    total: int = Field(..., ge=1)

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        data["quiz"] = ensure_record_id(data["quiz"])
        data["question_ids"] = [ensure_record_id(q) for q in data["question_ids"]]
        return data

    async def get_answers(self) -> List["QuizAnswer"]:
        if not self.id:
            return []
        rows = await repo_query(
            "SELECT * FROM quiz_answer WHERE attempt = $attempt ORDER BY created ASC",
            {"attempt": ensure_record_id(self.id)},
        )
        return [QuizAnswer(**row) for row in rows]


class QuizAnswer(ObjectModel):
    table_name: ClassVar[str] = "quiz_answer"

    quiz: str
    attempt: str
    question: str
    selected_option_ids: List[str]
    is_correct: bool

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        for field in ("quiz", "attempt", "question"):
            data[field] = ensure_record_id(data[field])
        return data
