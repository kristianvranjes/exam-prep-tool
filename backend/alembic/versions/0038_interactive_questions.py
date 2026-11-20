"""Interactive question types (#161, #164): TABLE, CIRCUIT and WAVEFORM keep a JSON spec."""

from sqlalchemy import text

from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None

OLD_TYPES = "'MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER','NUMERIC','MULTIPLE_SELECT','MATCH'"
NEW_TYPES = OLD_TYPES + ",'TABLE','CIRCUIT','WAVEFORM'"
OLD_ANSWER = (
    "(type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT','MATCH') AND correct_boolean IS NULL "
    "AND reference_answer IS NULL AND correct_value IS NULL) OR "
    "(type = 'TRUE_FALSE' AND correct_boolean IS NOT NULL AND reference_answer IS NULL "
    "AND correct_value IS NULL) OR "
    "(type = 'SHORT_ANSWER' AND correct_boolean IS NULL AND reference_answer IS NOT NULL "
    "AND length(btrim(reference_answer)) > 0 AND correct_value IS NULL) OR "
    "(type = 'NUMERIC' AND correct_boolean IS NULL AND reference_answer IS NULL "
    "AND correct_value IS NOT NULL)"
)
NEW_ANSWER = OLD_ANSWER.replace(
    "type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT','MATCH')",
    "type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT','MATCH','TABLE','CIRCUIT','WAVEFORM')",
)
SPEC = (
    "(type IN ('TABLE','CIRCUIT','WAVEFORM')) = (spec IS NOT NULL) "
    "AND (spec IS NULL OR jsonb_typeof(spec) = 'object')"
)


def upgrade() -> None:
    # The spec holds the layout and the key; the API validates its shape per type. Existing
    # questions keep no spec.
    op.execute(f"""
ALTER TABLE questions ADD COLUMN spec JSONB;
ALTER TABLE questions DROP CONSTRAINT ck_question_type;
ALTER TABLE questions ADD CONSTRAINT ck_question_type CHECK (type IN ({NEW_TYPES}));
ALTER TABLE questions DROP CONSTRAINT ck_question_answer;
ALTER TABLE questions ADD CONSTRAINT ck_question_answer CHECK ({NEW_ANSWER});
ALTER TABLE questions ADD CONSTRAINT ck_question_spec CHECK ({SPEC});
""")


def downgrade() -> None:
    if op.get_bind().scalar(
        text("SELECT count(*) FROM questions WHERE type IN ('TABLE','CIRCUIT','WAVEFORM')")
    ):
        raise RuntimeError("Cannot downgrade: interactive questions exist; delete them first")
    op.execute(f"""
ALTER TABLE questions DROP CONSTRAINT ck_question_spec;
ALTER TABLE questions DROP CONSTRAINT ck_question_answer;
ALTER TABLE questions ADD CONSTRAINT ck_question_answer CHECK ({OLD_ANSWER});
ALTER TABLE questions DROP CONSTRAINT ck_question_type;
ALTER TABLE questions ADD CONSTRAINT ck_question_type CHECK (type IN ({OLD_TYPES}));
ALTER TABLE questions DROP COLUMN spec;
""")
