"""Paper sessions: the paper and scoring rule on quizzes, frozen points per question."""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
ALTER TABLE quizzes ADD COLUMN exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE SET NULL;
ALTER TABLE quizzes ADD COLUMN scoring JSONB;
CREATE INDEX ix_quizzes_exam_paper_id ON quizzes(exam_paper_id);
ALTER TABLE quiz_questions ADD COLUMN points NUMERIC(6, 2);
ALTER TABLE quiz_questions ADD COLUMN label VARCHAR(40);
ALTER TABLE quiz_questions ADD CONSTRAINT ck_quiz_question_points
    CHECK (points IS NULL OR points > 0);
""")


def downgrade() -> None:
    op.execute("""
ALTER TABLE quiz_questions DROP CONSTRAINT ck_quiz_question_points;
ALTER TABLE quiz_questions DROP COLUMN label;
ALTER TABLE quiz_questions DROP COLUMN points;
DROP INDEX ix_quizzes_exam_paper_id;
ALTER TABLE quizzes DROP COLUMN scoring;
ALTER TABLE quizzes DROP COLUMN exam_paper_id;
""")
