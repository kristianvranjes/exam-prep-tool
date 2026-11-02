"""NUMERIC and MULTIPLE_SELECT question types."""

from sqlalchemy import text

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None

OLD_ANSWER = (
    "(type = 'MULTIPLE_CHOICE' AND correct_boolean IS NULL AND reference_answer IS NULL) OR "
    "(type = 'TRUE_FALSE' AND correct_boolean IS NOT NULL AND reference_answer IS NULL) OR "
    "(type = 'SHORT_ANSWER' AND correct_boolean IS NULL AND reference_answer IS NOT NULL "
    "AND length(btrim(reference_answer)) > 0)"
)
NEW_ANSWER = (
    "(type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT') AND correct_boolean IS NULL "
    "AND reference_answer IS NULL AND correct_value IS NULL) OR "
    "(type = 'TRUE_FALSE' AND correct_boolean IS NOT NULL AND reference_answer IS NULL "
    "AND correct_value IS NULL) OR "
    "(type = 'SHORT_ANSWER' AND correct_boolean IS NULL AND reference_answer IS NOT NULL "
    "AND length(btrim(reference_answer)) > 0 AND correct_value IS NULL) OR "
    "(type = 'NUMERIC' AND correct_boolean IS NULL AND reference_answer IS NULL "
    "AND correct_value IS NOT NULL)"
)
NUMERIC_FIELDS = (
    "(type = 'NUMERIC' OR (absolute_tolerance IS NULL AND relative_tolerance IS NULL "
    "AND unit IS NULL)) "
    "AND (absolute_tolerance IS NULL OR absolute_tolerance >= 0) "
    "AND (relative_tolerance IS NULL OR relative_tolerance BETWEEN 0 AND 1) "
    "AND (unit IS NULL OR (length(btrim(unit)) > 0 AND char_length(unit) <= 20))"
)
TYPES = "'MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER'"


def upgrade() -> None:
    op.execute(f"""
ALTER TABLE questions ADD COLUMN correct_value NUMERIC;
ALTER TABLE questions ADD COLUMN absolute_tolerance NUMERIC;
ALTER TABLE questions ADD COLUMN relative_tolerance NUMERIC;
ALTER TABLE questions ADD COLUMN unit VARCHAR(20);
ALTER TABLE questions DROP CONSTRAINT ck_question_type;
ALTER TABLE questions ADD CONSTRAINT ck_question_type
    CHECK (type IN ({TYPES},'NUMERIC','MULTIPLE_SELECT'));
ALTER TABLE questions DROP CONSTRAINT ck_question_answer;
ALTER TABLE questions ADD CONSTRAINT ck_question_answer CHECK ({NEW_ANSWER});
ALTER TABLE questions ADD CONSTRAINT ck_question_numeric CHECK ({NUMERIC_FIELDS});
""")


def downgrade() -> None:
    newer = op.get_bind().scalar(
        text("SELECT count(*) FROM questions WHERE type IN ('NUMERIC','MULTIPLE_SELECT')")
    )
    if newer:
        raise RuntimeError(
            "Cannot downgrade: numeric or multiple-select questions exist; delete them first"
        )
    op.execute(f"""
ALTER TABLE questions DROP CONSTRAINT ck_question_numeric;
ALTER TABLE questions DROP CONSTRAINT ck_question_answer;
ALTER TABLE questions ADD CONSTRAINT ck_question_answer CHECK ({OLD_ANSWER});
ALTER TABLE questions DROP CONSTRAINT ck_question_type;
ALTER TABLE questions ADD CONSTRAINT ck_question_type CHECK (type IN ({TYPES}));
ALTER TABLE questions DROP COLUMN unit;
ALTER TABLE questions DROP COLUMN relative_tolerance;
ALTER TABLE questions DROP COLUMN absolute_tolerance;
ALTER TABLE questions DROP COLUMN correct_value;
""")
