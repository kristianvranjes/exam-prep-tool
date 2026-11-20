"""Row captures for migration roundtrip tests that run older revisions."""

from sqlalchemy import Connection, text

# Added by 0024 (R4) and tested with the new question types, not by older roundtrips.
NUMERIC_QUESTION_COLUMNS = ("correct_value", "absolute_tolerance", "relative_tolerance", "unit")
# Added by 0033 and tested with the matching questions, not by older roundtrips.
HINT_QUESTION_COLUMNS = ("hint", "expr")
# Added by 0038 and tested with the interactive questions, not by older roundtrips.
SPEC_QUESTION_COLUMNS = ("spec",)
MATCH_OPTION_COLUMNS = ("match_text",)
# Added by 0026 and tested by its own roundtrip: older downgrades drop the recorded mode.
RECORDED_QUIZ_COLUMNS = ("selection_mode",)
# Added by 0028 and tested by its own roundtrip: older downgrades drop the student's list status.
MEMBERSHIP_STATUS_COLUMNS = ("status",)
# Added by 0029 and tested by its own roundtrip: older downgrades drop the rating schedule.
REVIEW_SCHEDULE_COLUMNS = ("interval_minutes", "repetitions", "lapses", "last_rating")


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
    return legacy_columns(
        conn, "questions", NUMERIC_QUESTION_COLUMNS + HINT_QUESTION_COLUMNS + SPEC_QUESTION_COLUMNS
    )


def legacy_option_columns(conn: Connection) -> str:
    return legacy_columns(conn, "question_options", MATCH_OPTION_COLUMNS)


def legacy_quiz_columns(conn: Connection) -> str:
    return legacy_columns(conn, "quizzes", RECORDED_QUIZ_COLUMNS)


def legacy_membership_columns(conn: Connection) -> str:
    return legacy_columns(conn, "course_memberships", MEMBERSHIP_STATUS_COLUMNS)


def legacy_review_columns(conn: Connection) -> str:
    return legacy_columns(conn, "question_review_progress", REVIEW_SCHEDULE_COLUMNS)


def legacy_rows(conn: Connection, table: str) -> list[object]:
    """Every row of `table` ordered by id, without columns newer revisions add."""
    columns = {
        "questions": legacy_question_columns,
        "question_options": legacy_option_columns,
        "quizzes": legacy_quiz_columns,
        "course_memberships": legacy_membership_columns,
        "question_review_progress": legacy_review_columns,
    }.get(table)
    selected = columns(conn) if columns else "*"
    return list(conn.execute(text(f"SELECT {selected} FROM {table} ORDER BY id")).all())
