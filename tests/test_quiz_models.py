"""Unit tests for the quiz domain models (open_notebook.quiz.models)."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from open_notebook.quiz.models import (
    Quiz,
    QuizAnswer,
    QuizAttempt,
    QuizQuestion,
    compute_quiz_stats,
)

MIGRATIONS_DIR = Path(__file__).parent.parent / "open_notebook/database/migrations"


def make_question(**overrides) -> QuizQuestion:
    data = {
        "quiz": "quiz:1",
        "position": 0,
        "type": "single",
        "question": "What is 2 + 2?",
        "options": [
            {"id": "a", "text": "3"},
            {"id": "b", "text": "4"},
            {"id": "c", "text": "5"},
        ],
        "correct_option_ids": ["b"],
    }
    data.update(overrides)
    return QuizQuestion(**data)


# ============================================================================
# Migration
# ============================================================================


class TestQuizMigration:
    def test_migration_is_registered_in_manager(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 26
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "quiz_question" in manager.up_migrations[25].sql
        assert "quiz_question" in manager.down_migrations[25].sql

    def test_migration_defines_all_tables_and_down_removes_them(self):
        up = (MIGRATIONS_DIR / "26.surrealql").read_text()
        down = (MIGRATIONS_DIR / "26_down.surrealql").read_text()
        for table in ("quiz", "quiz_question", "quiz_attempt", "quiz_answer"):
            assert f"DEFINE TABLE IF NOT EXISTS {table} SCHEMAFULL" in up
            assert f"REMOVE TABLE IF EXISTS {table};" in down


# ============================================================================
# QuizQuestion validation and grading
# ============================================================================


class TestQuizQuestion:
    def test_valid_single_choice(self):
        question = make_question()
        assert question.grade(["b"]) is True
        assert question.grade(["a"]) is False
        assert question.grade([]) is False

    def test_valid_multiple_choice_needs_exact_set(self):
        question = make_question(type="multiple", correct_option_ids=["a", "b"])
        assert question.grade(["b", "a"]) is True
        assert question.grade(["a"]) is False
        assert question.grade(["a", "b", "c"]) is False

    def test_single_choice_requires_exactly_one_correct(self):
        with pytest.raises(ValidationError):
            make_question(correct_option_ids=["a", "b"])
        with pytest.raises(ValidationError):
            make_question(correct_option_ids=[])

    def test_multiple_choice_requires_at_least_two_correct(self):
        with pytest.raises(ValidationError):
            make_question(type="multiple", correct_option_ids=["a"])

    def test_correct_ids_must_exist(self):
        with pytest.raises(ValidationError):
            make_question(correct_option_ids=["zzz"])

    def test_duplicate_option_ids_rejected(self):
        with pytest.raises(ValidationError):
            make_question(
                options=[{"id": "a", "text": "x"}, {"id": "a", "text": "y"}],
                correct_option_ids=["a"],
            )

    def test_option_count_bounds(self):
        with pytest.raises(ValidationError):
            make_question(options=[{"id": "a", "text": "x"}], correct_option_ids=["a"])
        many = [{"id": str(i), "text": f"o{i}"} for i in range(9)]
        with pytest.raises(ValidationError):
            make_question(options=many, correct_option_ids=["0"])

    def test_blank_texts_rejected(self):
        with pytest.raises(ValidationError):
            make_question(question="   ")
        with pytest.raises(ValidationError):
            make_question(
                options=[{"id": "a", "text": " "}, {"id": "b", "text": "y"}],
                correct_option_ids=["b"],
            )

    def test_unknown_type_rejected(self):
        with pytest.raises(ValidationError):
            make_question(type="essay")


# ============================================================================
# Statistics
# ============================================================================


class TestComputeQuizStats:
    def test_empty_quiz(self):
        stats = compute_quiz_stats(0, [], [])
        assert stats == {
            "question_count": 0,
            "attempt_count": 0,
            "last_score_pct": None,
            "best_score_pct": None,
            "answered_count": 0,
            "mastered_count": 0,
            "wrong_count": 0,
        }

    def test_scores_use_newest_first_ordering(self):
        attempts = [
            {"score": 6, "total": 10},  # newest
            {"score": 9, "total": 10},
            {"score": 3, "total": 10},
        ]
        stats = compute_quiz_stats(10, attempts, [])
        assert stats["attempt_count"] == 3
        assert stats["last_score_pct"] == 60
        assert stats["best_score_pct"] == 90

    def test_latest_answer_decides_mastered_or_wrong(self):
        answers = [  # newest first
            {"question": "q:1", "is_correct": True},  # fixed on retry
            {"question": "q:2", "is_correct": False},
            {"question": "q:1", "is_correct": False},  # first try wrong
            {"question": "q:3", "is_correct": True},
        ]
        stats = compute_quiz_stats(5, [], answers)
        assert stats["answered_count"] == 3
        assert stats["mastered_count"] == 2  # q:1, q:3
        assert stats["wrong_count"] == 1  # q:2

    def test_attempts_without_score_are_ignored_for_percentages(self):
        stats = compute_quiz_stats(3, [{"score": None, "total": 3}], [])
        assert stats["attempt_count"] == 1
        assert stats["last_score_pct"] is None


@pytest.mark.asyncio
class TestQuizQueries:
    async def test_stats_map_groups_rows_by_quiz(self):
        rows = [
            [{"quiz": "quiz:1", "n": 3}, {"quiz": "quiz:2", "n": 2}],  # counts
            [{"quiz": "quiz:1", "score": 2, "total": 3}],  # attempts
            [  # answers, newest first
                {"quiz": "quiz:1", "question": "quiz_question:a", "is_correct": False},
                {"quiz": "quiz:1", "question": "quiz_question:b", "is_correct": True},
            ],
        ]
        with patch(
            "open_notebook.quiz.models.repo_query", new=AsyncMock(side_effect=rows)
        ):
            stats = await Quiz.get_stats_map()

        assert stats["quiz:1"]["question_count"] == 3
        assert stats["quiz:1"]["last_score_pct"] == 67
        assert stats["quiz:1"]["wrong_count"] == 1
        assert stats["quiz:1"]["mastered_count"] == 1
        assert stats["quiz:2"]["question_count"] == 2
        assert stats["quiz:2"]["attempt_count"] == 0

    async def test_stats_map_scoped_ids_are_bound_as_parameters(self):
        mock = AsyncMock(side_effect=[[], [], []])
        with patch("open_notebook.quiz.models.repo_query", new=mock):
            stats = await Quiz.get_stats_map(["quiz:1"])

        assert stats["quiz:1"]["question_count"] == 0
        for call in mock.await_args_list:
            assert "$quiz_ids" in call.args[0]
            assert "quiz:1" not in call.args[0]
        attempts_query = mock.await_args_list[1].args[0]
        assert "WHERE quiz IN $quiz_ids AND finished != NONE" in attempts_query

    async def test_stats_map_empty_id_list_runs_no_queries(self):
        mock = AsyncMock()
        with patch("open_notebook.quiz.models.repo_query", new=mock):
            assert await Quiz.get_stats_map([]) == {}
        mock.assert_not_awaited()

    async def test_wrong_question_ids_follow_quiz_order(self):
        quiz = Quiz(id="quiz:1", name="Q")
        answers = [  # newest first: b was fixed, c and a are wrong
            {"question": "quiz_question:b", "is_correct": True},
            {"question": "quiz_question:c", "is_correct": False},
            {"question": "quiz_question:b", "is_correct": False},
            {"question": "quiz_question:a", "is_correct": False},
        ]
        questions = [
            make_question(id=f"quiz_question:{key}", position=i)
            for i, key in enumerate("abc")
        ]
        with (
            patch(
                "open_notebook.quiz.models.repo_query",
                new=AsyncMock(return_value=answers),
            ),
            patch.object(Quiz, "get_questions", new=AsyncMock(return_value=questions)),
        ):
            assert await quiz.get_wrong_question_ids() == [
                "quiz_question:a",
                "quiz_question:c",
            ]

    async def test_unsaved_quiz_has_no_questions_or_stats(self):
        quiz = Quiz(name="Q")
        assert await quiz.get_questions() == []
        assert await quiz.get_wrong_question_ids() == []
        assert (await quiz.get_stats())["question_count"] == 0


# ============================================================================
# Persistence payloads
# ============================================================================


class TestSavePayloads:
    def test_quiz_converts_links_to_record_ids(self):
        from surrealdb import RecordID

        quiz = Quiz(name="Q", notebook="notebook:abc", command="command:xyz")
        data = quiz._prepare_save_data()
        assert isinstance(data["notebook"], RecordID)
        assert isinstance(data["command"], RecordID)
        assert data["status"] == "generating"

    def test_quiz_without_links_omits_them_but_keeps_nullable_none(self):
        data = Quiz(name="Q")._prepare_save_data()
        assert data["notebook"] is None
        assert data["command"] is None

    def test_attempt_and_answer_convert_links(self):
        from surrealdb import RecordID

        attempt = QuizAttempt(
            quiz="quiz:1", question_ids=["quiz_question:a"], total=1
        )._prepare_save_data()
        assert isinstance(attempt["quiz"], RecordID)
        assert all(isinstance(q, RecordID) for q in attempt["question_ids"])

        answer = QuizAnswer(
            quiz="quiz:1",
            attempt="quiz_attempt:1",
            question="quiz_question:a",
            selected_option_ids=["a"],
            is_correct=True,
        )._prepare_save_data()
        assert all(
            isinstance(answer[k], RecordID) for k in ("quiz", "attempt", "question")
        )

    def test_attempt_requires_questions(self):
        with pytest.raises(ValidationError):
            QuizAttempt(quiz="quiz:1", question_ids=[], total=1)
