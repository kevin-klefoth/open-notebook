# ADR-0XX: Quizzes are four SurrealDB tables; statistics derive from the latest answer

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: [ADR-004](ADR-004-background-workers.md), migration 26

## Context

The quiz feature generates single- and multiple-choice questions from a notebook, lets the user answer them, and shows learning statistics on each quiz plus a "repeat wrong questions" mode. It needs a data model, a rule for what "wrong" means, and a decision on where answers are graded.

## Decision

- **Four `SCHEMAFULL` tables** (migration 26): `quiz`, `quiz_question`, `quiz_attempt`, `quiz_answer`. A quiz is a snapshot of generated questions, independent of later source edits. Deleting a quiz removes everything that belongs to it through a database event (`quiz_delete`), like `source_delete`.
- **No stored counters.** Statistics (attempts, last/best score, mastered, wrong) are computed from `quiz_attempt` and `quiz_answer` in three queries for any number of quizzes (`Quiz.get_stats_map`). `quiz_answer` carries `quiz` as well, so no join through the attempt is needed.
- **The latest answer to a question decides.** A question is *mastered* if its latest answer was correct and *wrong* if it was wrong. "Repeat wrong questions" asks exactly the wrong ones, so answering one correctly takes it out of the set. Questions left unanswered when an attempt is finished are recorded as wrong answers, so skipping can't hide a gap.
- **Grading is server-side.** The question endpoints never return the solution; `POST /api/quizzes/attempts/{id}/answers` grades the answer (exactly the correct set) and then reveals the correct options and the explanation. This isn't cheat protection for a self-hosted app; it keeps the rule in one place and the client simple.
- **Generation is a background command** (`generate_quiz`, `max_attempts: 1`) filling a quiz record the API created with status `generating`. The model's output is never trusted: Python validates and normalizes it (type derived from the number of correct options, options shuffled, duplicates and unusable questions dropped).

## Alternatives considered

- **`SCHEMALESS` tables, as for podcasts:** less migration work, but the status and question-type constraints would live only in Python. The database enforces them now.
- **Counters on the quiz record** (`attempts`, `wrong_count`): cheaper reads, but they drift when an answer is retried or a record is deleted, and "latest answer wins" would need bookkeeping on every write.
- **Wrong = ever answered wrong:** simpler, but a question could never leave the repeat set, which defeats the purpose.
- **Grading in the client:** needs the solutions in the question payload.

## Consequences

- Statistics are always consistent with the answers, at the cost of three queries per list request (fine at the scale of a personal notebook).
- Attempts are never deleted individually; they go with their quiz.
- A quiz whose worker died stays `generating` until the user deletes it. There is no timeout sweep yet.
- Question types are fixed by the schema (`single`, `multiple`); adding another type means a migration.
