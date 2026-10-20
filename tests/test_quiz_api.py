"""Tests for the quiz API (api/routers/quizzes.py) and its content service."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.quiz_service import QuizService, format_quiz_content
from open_notebook.exceptions import ExternalServiceError, NotFoundError
from open_notebook.quiz.models import Quiz, QuizAnswer, QuizAttempt, QuizQuestion


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def make_question(qid="quiz_question:q1", type="single", correct=None, **kw):
    return QuizQuestion(
        id=qid,
        quiz="quiz:1",
        position=kw.pop("position", 0),
        type=type,
        question=kw.pop("question", "Which one?"),
        options=[{"id": k, "text": f"opt {k}"} for k in "abcd"],
        correct_option_ids=correct or (["a"] if type == "single" else ["a", "c"]),
        explanation="because",
        **kw,
    )


def make_attempt(question_ids=("quiz_question:q1",), finished=None, score=None):
    return QuizAttempt(
        id="quiz_attempt:1",
        quiz="quiz:1",
        question_ids=list(question_ids),
        total=len(question_ids),
        finished=finished,
        score=score,
    )


def ready_quiz(**kw):
    return Quiz(id="quiz:1", name="Q", status=kw.pop("status", "ready"), **kw)


# ============================================================================
# Content service
# ============================================================================


class TestFormatQuizContent:
    def test_sources_and_notes_are_rendered_like_notebook_context(self):
        text = format_quiz_content(
            {
                "sources": [
                    {
                        "title": "Cells",
                        "full_text": "Mitochondria make ATP.",
                        "insights": [{"insight_type": "Summary", "content": "short"}],
                    }
                ],
                "notes": [{"title": "My note", "content": "remember this"}],
            }
        )
        assert "## Source: Cells\n\nMitochondria make ATP." in text
        assert "Insights:\n- Summary: short" in text
        assert "## Note: My note\n\nremember this" in text

    def test_insights_only_source_is_supported(self):
        text = format_quiz_content(
            {"sources": [{"title": "S", "insights": [{"content": "only insight"}]}]}
        )
        assert "- Insight: only insight" in text

    def test_items_without_text_are_skipped(self):
        assert (
            format_quiz_content(
                {
                    "sources": [{"title": "Empty", "full_text": "  ", "insights": []}],
                    "notes": [{"title": "N", "content": None}],
                }
            )
            == ""
        )


@pytest.mark.asyncio
class TestBuildContent:
    async def test_without_config_uses_the_whole_notebook(self):
        notebook = MagicMock()
        notebook.get_context = AsyncMock(return_value="  whole notebook  ")
        assert await QuizService.build_content(notebook, None) == "whole notebook"

    async def test_with_config_uses_the_selection(self):
        notebook = MagicMock()
        built = ({"sources": [{"title": "T", "full_text": "text"}], "notes": []}, "")
        with patch(
            "api.quiz_service.build_notebook_context", AsyncMock(return_value=built)
        ) as build:
            content = await QuizService.build_content(notebook, {"sources": {"a": "x"}})
        assert content == "## Source: T\n\ntext"
        build.assert_awaited_once_with(notebook, {"sources": {"a": "x"}})


# ============================================================================
# Generate
# ============================================================================

GENERATE = {"name": "  My quiz ", "notebook_id": "notebook:n1"}


async def fake_save(self):
    self.id = self.id or "quiz:1"


class TestGenerate:
    def patches(self, content="material", submit=None):
        return (
            patch(
                "api.routers.quizzes.Notebook.get",
                AsyncMock(return_value=MagicMock(id="notebook:n1")),
            ),
            patch(
                "api.routers.quizzes.QuizService.build_content",
                AsyncMock(return_value=content),
            ),
            patch.object(Quiz, "save", fake_save),
            patch(
                "api.routers.quizzes.CommandService.submit_command_job",
                submit or AsyncMock(return_value="command:j1"),
            ),
        )

    def test_creates_quiz_and_submits_job(self, client):
        submit = AsyncMock(return_value="command:j1")
        p1, p2, p3, p4 = self.patches(submit=submit)
        with p1, p2, p3, p4:
            response = client.post(
                "/api/quizzes/generate",
                json={
                    **GENERATE,
                    "num_questions": 5,
                    "max_options": 3,
                    "language": "de",
                },
            )
        assert response.status_code == 200
        assert response.json() == {
            "quiz_id": "quiz:1",
            "job_id": "command:j1",
            "status": "generating",
        }
        app_name, command, args = submit.await_args.args
        assert (app_name, command) == ("open_notebook", "generate_quiz")
        assert args == {
            "quiz_id": "quiz:1",
            "content": "material",
            "num_questions": 5,
            "max_options": 3,
            "model_id": None,
            "language": "de",
        }

    def test_empty_content_is_rejected_without_creating_anything(self, client):
        p1, p2, p3, p4 = self.patches(content="")
        save = AsyncMock()
        with p1, p2, p4, patch.object(Quiz, "save", save):
            response = client.post("/api/quizzes/generate", json=GENERATE)
        assert response.status_code == 400
        save.assert_not_awaited()

    def test_failed_submission_removes_the_quiz(self, client):
        p1, p2, p3, p4 = self.patches(
            submit=AsyncMock(side_effect=ExternalServiceError("queue down"))
        )
        delete = AsyncMock()
        with p1, p2, p3, p4, patch.object(Quiz, "delete", delete):
            response = client.post("/api/quizzes/generate", json=GENERATE)
        assert response.status_code == 502
        delete.assert_awaited_once()

    @pytest.mark.parametrize(
        "overrides",
        [
            {"num_questions": 0},
            {"num_questions": 51},
            {"max_options": 1},
            {"max_options": 9},
            {"name": ""},
        ],
    )
    def test_request_limits(self, client, overrides):
        response = client.post("/api/quizzes/generate", json={**GENERATE, **overrides})
        assert response.status_code == 422

    def test_ids_of_the_wrong_table_are_rejected(self, client):
        assert (
            client.post(
                "/api/quizzes/generate", json={**GENERATE, "notebook_id": "source:1"}
            ).status_code
            == 400
        )
        with patch("api.routers.quizzes.Notebook.get", AsyncMock()):
            assert (
                client.post(
                    "/api/quizzes/generate", json={**GENERATE, "model_id": "notebook:1"}
                ).status_code
                == 400
            )


# ============================================================================
# Read / delete
# ============================================================================


class TestReadAndDelete:
    def test_wrong_table_id_is_rejected_before_any_lookup(self, client):
        with patch("api.routers.quizzes.Quiz.get", AsyncMock()) as get:
            assert client.get("/api/quizzes/notebook:1").status_code == 400
            assert client.delete("/api/quizzes/notebook:1").status_code == 400
        get.assert_not_awaited()

    def test_missing_quiz_is_404(self, client):
        with patch(
            "api.routers.quizzes.Quiz.get", AsyncMock(side_effect=NotFoundError("x"))
        ):
            assert client.get("/api/quizzes/quiz:gone").status_code == 404
            assert client.delete("/api/quizzes/quiz:gone").status_code == 404

    def test_detail_never_contains_solutions(self, client):
        quiz = ready_quiz()
        with (
            patch("api.routers.quizzes.Quiz.get", AsyncMock(return_value=quiz)),
            patch.object(
                Quiz, "get_questions", AsyncMock(return_value=[make_question()])
            ),
            patch.object(Quiz, "get_stats_map", AsyncMock(return_value={})),
        ):
            body = client.get("/api/quizzes/quiz:1").json()
        assert body["stats"]["question_count"] == 0  # empty stats fallback
        [question] = body["questions"]
        assert set(question) == {"id", "position", "type", "question", "options"}

    def test_list_filters_by_notebook_and_attaches_stats(self, client):
        quizzes = [
            Quiz(id="quiz:1", name="A", notebook="notebook:a", status="ready"),
            Quiz(id="quiz:2", name="B", notebook="notebook:b", status="ready"),
        ]
        stats = {
            "quiz:1": dict(
                question_count=3,
                attempt_count=1,
                last_score_pct=67,
                best_score_pct=67,
                answered_count=3,
                mastered_count=2,
                wrong_count=1,
            )
        }
        with (
            patch("api.routers.quizzes.Quiz.get_all", AsyncMock(return_value=quizzes)),
            patch.object(
                Quiz, "get_stats_map", AsyncMock(return_value=stats)
            ) as stats_map,
        ):
            body = client.get("/api/quizzes?notebook_id=notebook:a").json()
        assert [q["id"] for q in body] == ["quiz:1"]
        assert body[0]["stats"]["wrong_count"] == 1
        stats_map.assert_awaited_once_with(["quiz:1"])


# ============================================================================
# Attempts
# ============================================================================


class TestStartAttempt:
    def run(self, client, quiz, mode="full", questions=None, wrong=()):
        saved = []

        async def save(self_):
            self_.id = "quiz_attempt:1"
            saved.append(self_)

        with (
            patch("api.routers.quizzes.Quiz.get", AsyncMock(return_value=quiz)),
            patch.object(
                Quiz, "get_questions", AsyncMock(return_value=questions or [])
            ),
            patch.object(
                Quiz, "get_wrong_question_ids", AsyncMock(return_value=list(wrong))
            ),
            patch.object(QuizAttempt, "save", save),
        ):
            response = client.post("/api/quizzes/quiz:1/attempts", json={"mode": mode})
        return response, saved

    def test_full_attempt_asks_every_question(self, client):
        questions = [
            make_question("quiz_question:a"),
            make_question("quiz_question:b", position=1),
        ]
        response, saved = self.run(client, ready_quiz(), questions=questions)
        assert response.status_code == 200
        assert response.json()["total"] == 2
        assert saved[0].question_ids == ["quiz_question:a", "quiz_question:b"]
        assert saved[0].mode == "full"

    def test_retry_wrong_asks_only_wrong_questions(self, client):
        questions = [
            make_question("quiz_question:a"),
            make_question("quiz_question:b", position=1),
        ]
        response, saved = self.run(
            client, ready_quiz(), "retry_wrong", questions, wrong=["quiz_question:b"]
        )
        assert response.status_code == 200
        assert [q["id"] for q in response.json()["questions"]] == ["quiz_question:b"]
        assert saved[0].mode == "retry_wrong"

    def test_retry_wrong_without_wrong_questions_is_rejected(self, client):
        response, saved = self.run(
            client, ready_quiz(), "retry_wrong", [make_question()], wrong=[]
        )
        assert response.status_code == 400
        assert saved == []

    @pytest.mark.parametrize("status", ["generating", "failed"])
    def test_quiz_must_be_ready(self, client, status):
        response, _ = self.run(
            client, ready_quiz(status=status), questions=[make_question()]
        )
        assert response.status_code == 400

    def test_quiz_without_questions_is_rejected(self, client):
        response, _ = self.run(client, ready_quiz(), questions=[])
        assert response.status_code == 400

    def test_unknown_mode_is_a_validation_error(self, client):
        response = client.post("/api/quizzes/quiz:1/attempts", json={"mode": "cheat"})
        assert response.status_code == 422


# ============================================================================
# Answering
# ============================================================================


class TestAnswer:
    def post(self, client, selected, question=None, attempt=None, answered=()):
        question = question or make_question()
        attempt = attempt or make_attempt()
        previous = [
            QuizAnswer(
                quiz="quiz:1",
                attempt="quiz_attempt:1",
                question=q,
                selected_option_ids=["a"],
                is_correct=True,
            )
            for q in answered
        ]
        save = AsyncMock()
        with (
            patch(
                "api.routers.quizzes.QuizAttempt.get", AsyncMock(return_value=attempt)
            ),
            patch(
                "api.routers.quizzes.QuizQuestion.get", AsyncMock(return_value=question)
            ),
            patch.object(QuizAttempt, "get_answers", AsyncMock(return_value=previous)),
            patch.object(QuizAnswer, "save", save),
        ):
            response = client.post(
                "/api/quizzes/attempts/quiz_attempt:1/answers",
                json={"question_id": question.id, "selected_option_ids": selected},
            )
        return response, save

    def test_correct_answer_reveals_solution_and_is_stored(self, client):
        response, save = self.post(client, ["a"])
        assert response.status_code == 200
        assert response.json() == {
            "question_id": "quiz_question:q1",
            "is_correct": True,
            "correct_option_ids": ["a"],
            "explanation": "because",
        }
        save.assert_awaited_once()

    def test_wrong_answer_is_stored_as_wrong(self, client):
        response, save = self.post(client, ["b"])
        assert response.json()["is_correct"] is False
        save.assert_awaited_once()

    def test_multiple_choice_needs_the_exact_set(self, client):
        question = make_question(type="multiple")
        assert self.post(client, ["c", "a"], question)[0].json()["is_correct"] is True
        assert self.post(client, ["a"], question)[0].json()["is_correct"] is False
        assert (
            self.post(client, ["a", "b", "c"], question)[0].json()["is_correct"]
            is False
        )

    @pytest.mark.parametrize(
        "selected",
        [[], ["zzz"], ["a", "b"]],
        ids=["empty", "unknown", "two-for-single"],
    )
    def test_invalid_selection_is_rejected_and_not_stored(self, client, selected):
        response, save = self.post(client, selected)
        assert response.status_code == 400
        save.assert_not_awaited()

    def test_question_can_only_be_answered_once_per_attempt(self, client):
        response, save = self.post(client, ["a"], answered=["quiz_question:q1"])
        assert response.status_code == 400
        save.assert_not_awaited()

    def test_question_must_belong_to_the_attempt(self, client):
        other = make_question("quiz_question:other")
        response, save = self.post(client, ["a"], question=other)
        assert response.status_code == 400
        save.assert_not_awaited()

    def test_finished_attempt_accepts_no_answers(self, client):
        attempt = make_attempt(finished=datetime.now(timezone.utc), score=0)
        response, save = self.post(client, ["a"], attempt=attempt)
        assert response.status_code == 400
        save.assert_not_awaited()

    def test_wrong_table_attempt_id(self, client):
        response = client.post(
            "/api/quizzes/attempts/quiz:1/answers",
            json={"question_id": "quiz_question:q1", "selected_option_ids": ["a"]},
        )
        assert response.status_code == 400


# ============================================================================
# Finishing
# ============================================================================


class TestFinish:
    def finish(self, client, attempt, answers):
        answer_save = AsyncMock()
        attempt_save = AsyncMock()
        stats = dict(
            question_count=2,
            attempt_count=1,
            last_score_pct=50,
            best_score_pct=50,
            answered_count=2,
            mastered_count=1,
            wrong_count=1,
        )
        with (
            patch(
                "api.routers.quizzes.QuizAttempt.get", AsyncMock(return_value=attempt)
            ),
            patch.object(QuizAttempt, "get_answers", AsyncMock(return_value=answers)),
            patch.object(QuizAnswer, "save", answer_save),
            patch.object(QuizAttempt, "save", attempt_save),
            patch.object(
                Quiz, "get_stats_map", AsyncMock(return_value={"quiz:1": stats})
            ),
        ):
            response = client.post("/api/quizzes/attempts/quiz_attempt:1/finish")
        return response, answer_save, attempt_save

    @staticmethod
    def answer(question, correct):
        return QuizAnswer(
            quiz="quiz:1",
            attempt="quiz_attempt:1",
            question=question,
            selected_option_ids=["a"],
            is_correct=correct,
        )

    def test_scores_and_records_skipped_questions_as_wrong(self, client):
        attempt = make_attempt(["quiz_question:a", "quiz_question:b"])
        response, answer_save, attempt_save = self.finish(
            client, attempt, [self.answer("quiz_question:a", True)]
        )
        assert response.status_code == 200
        body = response.json()
        assert (body["score"], body["total"], body["score_pct"]) == (1, 2, 50)
        assert body["wrong_question_ids"] == ["quiz_question:b"]
        answer_save.assert_awaited_once()  # the skipped question
        attempt_save.assert_awaited_once()
        assert attempt.finished is not None and attempt.score == 1

    def test_finishing_twice_changes_nothing(self, client):
        attempt = make_attempt(
            ["quiz_question:a", "quiz_question:b"],
            finished=datetime.now(timezone.utc),
            score=1,
        )
        response, answer_save, attempt_save = self.finish(
            client,
            attempt,
            [
                self.answer("quiz_question:a", True),
                self.answer("quiz_question:b", False),
            ],
        )
        assert response.json()["score"] == 1
        answer_save.assert_not_awaited()
        attempt_save.assert_not_awaited()
