"""Question reports can be closed as FIXED: the question was corrected (23c)."""

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

OPEN_OR_RESOLVED = (
    "(status = 'OPEN' AND resolution IS NULL AND resolved_by_user_id IS NULL "
    "AND resolved_at IS NULL) OR (status = 'RESOLVED' "
    "AND resolution IS NOT NULL AND resolution IN ({}) "
    "AND resolved_at IS NOT NULL)"
)


def upgrade() -> None:
    op.drop_constraint("ck_question_report_resolution", "question_reports", type_="check")
    op.create_check_constraint(
        "ck_question_report_resolution",
        "question_reports",
        OPEN_OR_RESOLVED.format("'DISMISSED','QUESTION_ARCHIVED','FIXED'"),
    )


def downgrade() -> None:
    # A FIXED report has no older meaning; it becomes DISMISSED (closed, question kept).
    op.execute("UPDATE question_reports SET resolution = 'DISMISSED' WHERE resolution = 'FIXED'")
    op.drop_constraint("ck_question_report_resolution", "question_reports", type_="check")
    op.create_check_constraint(
        "ck_question_report_resolution",
        "question_reports",
        OPEN_OR_RESOLVED.format("'DISMISSED','QUESTION_ARCHIVED'"),
    )
