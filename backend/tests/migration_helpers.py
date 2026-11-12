"""Row captures for migration roundtrip tests that run older revisions."""

from sqlalchemy import Connection, text

# Added by 0024 (R4) and tested with the new question types, not by older roundtrips.
NUMERIC_QUESTION_COLUMNS = ("correct_value", "absolute_tolerance", "relative_tolerance", "unit")
# Added by 0026 and tested by its own roundtrip: older downgrades drop the recorded mode.
RECORDED_QUIZ_COLUMNS = ("selection_mode",)
# Added by 0028 and tested by its own roundtrip: older downgrades drop the student's list status.
MEMBERSHIP_STATUS_COLUMNS = ("status",)


def legacy_columns(conn: Connection, table: str, newer: tuple[str, ...]) -> str:
    """The `table` columns that every older revision also has, in table order."""
    names = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = :table "
            "ORDER BY ordinal_position"
        ),
        {"table": table},
    ).scalars()
    return ", ".join(name for name in names if name not in newer)


def legacy_question_columns(conn: Connection) -> str:
    return legacy_columns(conn, "questions", NUMERIC_QUESTION_COLUMNS)


def legacy_quiz_columns(conn: Connection) -> str:
    return legacy_columns(conn, "quizzes", RECORDED_QUIZ_COLUMNS)


def legacy_membership_columns(conn: Connection) -> str:
    return legacy_columns(conn, "course_memberships", MEMBERSHIP_STATUS_COLUMNS)


def legacy_rows(conn: Connection, table: str) -> list[object]:
    """Every row of `table` ordered by id, without columns newer revisions add."""
    columns = {
        "questions": legacy_question_columns,
        "quizzes": legacy_quiz_columns,
        "course_memberships": legacy_membership_columns,
    }.get(table)
    selected = columns(conn) if columns else "*"
    return list(conn.execute(text(f"SELECT {selected} FROM {table} ORDER BY id")).all())
