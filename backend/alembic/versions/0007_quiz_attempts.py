"""Practice quizzes, immutable snapshots and persisted attempts."""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE quizzes (
id UUID PRIMARY KEY,
course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_quizzes_course_id ON quizzes(course_id);
CREATE INDEX ix_quizzes_user_id ON quizzes(user_id);
CREATE TABLE quiz_questions (
id UUID PRIMARY KEY,
quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
position INTEGER NOT NULL,
source_question_id UUID NOT NULL,
source_version INTEGER NOT NULL,
snapshot JSONB NOT NULL,
CONSTRAINT uq_quiz_question_position UNIQUE (quiz_id, position),
CONSTRAINT ck_quiz_question_position CHECK (position >= 0)
);
CREATE TABLE quiz_attempts (
id UUID PRIMARY KEY,
quiz_id UUID NOT NULL UNIQUE REFERENCES quizzes(id) ON DELETE CASCADE,
status VARCHAR(20) NOT NULL,
started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
submitted_at TIMESTAMPTZ,
CONSTRAINT ck_attempt_status CHECK (status IN ('ACTIVE','SUBMITTED')),
CONSTRAINT ck_attempt_submission CHECK (
(status = 'ACTIVE' AND submitted_at IS NULL) OR
(status = 'SUBMITTED' AND submitted_at IS NOT NULL))
);
CREATE TABLE answers (
id UUID PRIMARY KEY,
attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
quiz_question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
payload JSONB NOT NULL,
grading_status VARCHAR(20) NOT NULL,
updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
CONSTRAINT uq_answer_question UNIQUE (attempt_id, quiz_question_id),
CONSTRAINT ck_answer_grade CHECK (grading_status IN ('PENDING','CORRECT','INCORRECT'))
);
""")


def downgrade() -> None:
    op.execute("DROP TABLE answers, quiz_attempts, quiz_questions, quizzes")
