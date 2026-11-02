"""Row captures for migration roundtrip tests that run older revisions."""

from sqlalchemy import Connection, text

# Added by 0024 (R4) and tested with the new question types, not by older roundtrips.
NUMERIC_QUESTION_COLUMNS = ("correct_value", "absolute_tolerance", "relative_tolerance", "unit")


def legacy_question_columns(conn: Connection) -> str:
    """The `questions` columns that every older revision also has, in table order."""
    names = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = 'questions' "
            "ORDER BY ordinal_position"
        )
    ).scalars()
    return ", ".join(name for name in names if name not in NUMERIC_QUESTION_COLUMNS)
