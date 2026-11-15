"""MATCH questions (pairs), and an optional hint and expression on every question."""

from sqlalchemy import text

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

OLD_ANSWER = (
    "(type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT') AND correct_boolean IS NULL "
    "AND reference_answer IS NULL AND correct_value IS NULL) OR "
    "(type = 'TRUE_FALSE' AND correct_boolean IS NOT NULL AND reference_answer IS NULL "
    "AND correct_value IS NULL) OR "
    "(type = 'SHORT_ANSWER' AND correct_boolean IS NULL AND reference_answer IS NOT NULL "
    "AND length(btrim(reference_answer)) > 0 AND correct_value IS NULL) OR "
    "(type = 'NUMERIC' AND correct_boolean IS NULL AND reference_answer IS NULL "
    "AND correct_value IS NOT NULL)"
)
NEW_ANSWER = OLD_ANSWER.replace(
    "type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT')",
    "type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT','MATCH')",
)
TYPES = "'MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER','NUMERIC','MULTIPLE_SELECT'"


def upgrade() -> None:
    # A MATCH question keeps one question_options row per pair: `text` is the left item and
    # `match_text` its partner. `hint` and `expr` are optional display fields of any question.
    op.execute(f"""
ALTER TABLE question_options ADD COLUMN match_text TEXT;
ALTER TABLE questions ADD COLUMN hint TEXT;
ALTER TABLE questions ADD COLUMN expr TEXT;
ALTER TABLE questions ADD CONSTRAINT ck_question_hint_expr CHECK (
    (hint IS NULL OR (length(btrim(hint)) > 0 AND char_length(hint) <= 400))
    AND (expr IS NULL OR (length(btrim(expr)) > 0 AND char_length(expr) <= 200)));
ALTER TABLE questions DROP CONSTRAINT ck_question_type;
ALTER TABLE questions ADD CONSTRAINT ck_question_type CHECK (type IN ({TYPES},'MATCH'));
ALTER TABLE questions DROP CONSTRAINT ck_question_answer;
ALTER TABLE questions ADD CONSTRAINT ck_question_answer CHECK ({NEW_ANSWER});
""")


def downgrade() -> None:
    if op.get_bind().scalar(text("SELECT count(*) FROM questions WHERE type = 'MATCH'")):
        raise RuntimeError("Cannot downgrade: matching questions exist; delete them first")
    op.execute(f"""
ALTER TABLE questions DROP CONSTRAINT ck_question_answer;
ALTER TABLE questions ADD CONSTRAINT ck_question_answer CHECK ({OLD_ANSWER});
ALTER TABLE questions DROP CONSTRAINT ck_question_type;
ALTER TABLE questions ADD CONSTRAINT ck_question_type CHECK (type IN ({TYPES}));
ALTER TABLE questions DROP CONSTRAINT ck_question_hint_expr;
ALTER TABLE questions DROP COLUMN expr;
ALTER TABLE questions DROP COLUMN hint;
ALTER TABLE question_options DROP COLUMN match_text;
""")
