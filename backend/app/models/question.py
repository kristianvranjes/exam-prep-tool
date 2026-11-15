from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint(
            "type IN ('MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER','NUMERIC','MULTIPLE_SELECT',"
            "'MATCH')",
            name="ck_question_type",
        ),
        CheckConstraint(
            "status IN ('DRAFT','PENDING_REVIEW','APPROVED','REJECTED','ARCHIVED')",
            name="ck_question_status",
        ),
        CheckConstraint("source IN ('AI','USER')", name="ck_question_source"),
        CheckConstraint(
            "difficulty IS NULL OR difficulty BETWEEN 1 AND 5", name="ck_question_difficulty"
        ),
        CheckConstraint(
            "length(btrim(stem)) > 0 AND char_length(stem) <= 400", name="ck_question_stem"
        ),
        CheckConstraint(
            "(type IN ('MULTIPLE_CHOICE','MULTIPLE_SELECT','MATCH') AND correct_boolean IS NULL "
            "AND reference_answer IS NULL AND correct_value IS NULL) OR "
            "(type = 'TRUE_FALSE' AND correct_boolean IS NOT NULL AND reference_answer IS NULL "
            "AND correct_value IS NULL) OR "
            "(type = 'SHORT_ANSWER' AND correct_boolean IS NULL AND reference_answer IS NOT NULL "
            "AND length(btrim(reference_answer)) > 0 AND correct_value IS NULL) OR "
            "(type = 'NUMERIC' AND correct_boolean IS NULL AND reference_answer IS NULL "
            "AND correct_value IS NOT NULL)",
            name="ck_question_answer",
        ),
        CheckConstraint(
            "(type = 'NUMERIC' OR (absolute_tolerance IS NULL AND relative_tolerance IS NULL "
            "AND unit IS NULL)) "
            "AND (absolute_tolerance IS NULL OR absolute_tolerance >= 0) "
            "AND (relative_tolerance IS NULL OR relative_tolerance BETWEEN 0 AND 1) "
            "AND (unit IS NULL OR (length(btrim(unit)) > 0 AND char_length(unit) <= 20))",
            name="ck_question_numeric",
        ),
        CheckConstraint(
            "(hint IS NULL OR (length(btrim(hint)) > 0 AND char_length(hint) <= 400)) "
            "AND (expr IS NULL OR (length(btrim(expr)) > 0 AND char_length(expr) <= 200))",
            name="ck_question_hint_expr",
        ),
        Index("ix_question_course_status", "course_id", "status"),
        Index("ix_question_course_type", "course_id", "type"),
        Index(
            "uq_question_creator_active_stem",
            "course_id",
            "created_by_user_id",
            "normalized_stem",
            unique=True,
            postgresql_where=text("status != 'ARCHIVED'"),
        ),
        Index(
            "uq_question_approved_stem",
            "course_id",
            "normalized_stem",
            unique=True,
            postgresql_where=text("status = 'APPROVED'"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    created_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    ai_job_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("ai_jobs.id", ondelete="SET NULL"), index=True
    )
    type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    source: Mapped[str] = mapped_column(String(10))
    stem: Mapped[str] = mapped_column(Text)
    normalized_stem: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    # Optional aids shown with the question: a nudge the student may open before answering, and a
    # Boolean or algebraic expression set apart from the stem.
    hint: Mapped[str | None] = mapped_column(Text)
    expr: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[int | None] = mapped_column(SmallInteger)
    correct_boolean: Mapped[bool | None] = mapped_column(Boolean)
    reference_answer: Mapped[str | None] = mapped_column(Text)
    # NUMERIC: the key and its allowed error; the larger allowance wins.
    correct_value: Mapped[Decimal | None] = mapped_column(Numeric)
    absolute_tolerance: Mapped[Decimal | None] = mapped_column(Numeric)
    relative_tolerance: Mapped[Decimal | None] = mapped_column(Numeric)
    unit: Mapped[str | None] = mapped_column(String(20))
    reviewed_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestionOption(Base):
    __tablename__ = "question_options"
    __table_args__ = (
        UniqueConstraint("question_id", "position", name="uq_question_option_position"),
        CheckConstraint("position >= 0", name="ck_question_option_position"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    position: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    is_correct: Mapped[bool]
    # MATCH only: the partner of the left item in `text`.
    match_text: Mapped[str | None] = mapped_column(Text)


class QuestionConcept(Base):
    __tablename__ = "question_concepts"
    question_id: Mapped[UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    concept_id: Mapped[UUID] = mapped_column(
        ForeignKey("concepts.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class QuestionChunk(Base):
    __tablename__ = "question_chunks"
    question_id: Mapped[UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True
    )
    chunk_id: Mapped[UUID] = mapped_column(
        ForeignKey("material_chunks.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class QuestionVersion(Base):
    __tablename__ = "question_versions"
    __table_args__ = (
        UniqueConstraint("question_id", "version_number", name="uq_question_version"),
        CheckConstraint("version_number >= 1", name="ck_question_version_number"),
        CheckConstraint(
            "reason IN ('CREATED','EDITED','SUBMITTED','APPROVED','REJECTED','ARCHIVED')",
            name="ck_question_version_reason",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    version_number: Mapped[int]
    snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)
    changed_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    reason: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
