from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal, cast
from uuid import UUID

from fastapi import HTTPException
from pydantic import TypeAdapter
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import User
from app.models.course_unit import CourseUnit, QuestionUnit
from app.models.exam_paper import ExamPaper, ExamPaperItem
from app.models.question import Question, QuestionVersion
from app.models.quiz import Answer, Quiz, QuizAttempt, QuizQuestion
from app.schemas.question import OwnerQuestion, PublicOption
from app.schemas.quiz import (
    AbandonedAttempt,
    ActiveAttempt,
    ActiveQuestion,
    AnswerPayload,
    AttemptResponse,
    AttemptSummary,
    CheckAnswer,
    Confidence,
    FeedbackMode,
    Grade,
    MCQAnswer,
    MultipleSelectAnswer,
    PaperScore,
    PaperSession,
    PracticeAvailability,
    PracticeFilters,
    QuestionFeedback,
    QuestionUnitLabel,
    RateAnswer,
    ResultQuestion,
    ReviewRating,
    SelfReview,
    SelfReviewRequest,
    SelfReviewSummary,
    StartMock,
    StartPaper,
    StartQuiz,
    SubmittedAttempt,
    TypeAvailability,
    UnitAvailability,
)
from app.services.courses import get_member_course
from app.services.exam_papers import load_paper
from app.services.exam_scopes import resolve_focus
from app.services.favorites import favorited
from app.services.grading import grade
from app.services.paper_scoring import SCORING_VERSION, ItemResult, item_points, score
from app.services.progress import apply_reviews
from app.services.questions.service import owner_view
from app.services.quiz_selection import (
    count_by_type,
    count_by_unit,
    count_eligible,
    count_total,
    select_questions,
)

answer_adapter: TypeAdapter[AnswerPayload] = TypeAdapter(AnswerPayload)


def load_attempt(db: Session, user: User, course_id: UUID, attempt_id: UUID) -> QuizAttempt:
    get_member_course(db, user, course_id)
    # Reads also lock: an ACTIVE status must never be paired with post-submission data.
    attempt = db.scalar(
        select(QuizAttempt)
        .join(Quiz)
        .where(QuizAttempt.id == attempt_id, Quiz.course_id == course_id, Quiz.user_id == user.id)
        .with_for_update(of=QuizAttempt)
        .execution_options(populate_existing=True)
    )
    if attempt is None:
        raise HTTPException(404, "Attempt not found")
    return attempt


def summary(attempt: QuizAttempt, quiz: Quiz) -> AttemptSummary:
    return AttemptSummary(
        id=attempt.id,
        course_id=quiz.course_id,
        status=cast(Literal["ACTIVE", "SUBMITTED", "ABANDONED"], attempt.status),
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        exam_scope_id=quiz.exam_scope_id,
        focus_unit_ids=[UUID(id_) for id_ in quiz.focus_unit_ids],
        focus_label=quiz.focus_label,
        feedback_mode=cast(FeedbackMode, quiz.feedback_mode),
        paper=paper_session(quiz),
        deadline_at=attempt.deadline_at,
        server_time=datetime.now(UTC)
        if attempt.deadline_at and attempt.status == "ACTIVE"
        else None,
    )


def paper_session(quiz: Quiz) -> PaperSession | None:
    rule = quiz.scoring
    if rule is None:
        return None
    threshold = rule["pass_threshold"]
    duration = rule["duration_minutes"]
    return PaperSession(
        exam_paper_id=quiz.exam_paper_id,
        title=str(rule["title"]),
        total_points=float(str(rule["total_points"])),
        wrong_answer_penalty=float(str(rule["wrong_answer_penalty"])),
        pass_threshold=None if threshold is None else float(str(threshold)),
        duration_minutes=None if duration is None else int(str(duration)),
    )


def question_rows(db: Session, attempt: QuizAttempt) -> list[QuizQuestion]:
    return list(
        db.scalars(
            select(QuizQuestion)
            .where(QuizQuestion.quiz_id == attempt.quiz_id)
            .order_by(QuizQuestion.position)
        )
    )


def unit_labels(
    db: Session, course_id: UUID, question_ids: list[UUID]
) -> dict[UUID, list[QuestionUnitLabel]]:
    """Current active units per source question; deleted sources simply have none."""
    labels: dict[UUID, list[QuestionUnitLabel]] = {}
    if not question_ids:
        return labels
    rows = db.execute(
        select(QuestionUnit.question_id, CourseUnit.id, CourseUnit.title)
        .join(CourseUnit, CourseUnit.id == QuestionUnit.unit_id)
        .where(
            QuestionUnit.question_id.in_(question_ids),
            CourseUnit.course_id == course_id,
            CourseUnit.is_archived.is_(False),
        )
        .order_by(CourseUnit.position, CourseUnit.id)
    )
    for question_id, unit_id, title in rows:
        labels.setdefault(question_id, []).append(QuestionUnitLabel(id=unit_id, title=title))
    return labels


def feedback(content: OwnerQuestion, answer: Answer | None) -> QuestionFeedback:
    return QuestionFeedback(
        options=content.options,
        explanation=content.explanation,
        correct_boolean=content.correct_boolean,
        reference_answer=content.reference_answer,
        correct_value=content.correct_value,
        absolute_tolerance=content.absolute_tolerance,
        relative_tolerance=content.relative_tolerance,
        grading_status=cast(Grade, answer.grading_status) if answer else "PENDING",
        confidence=cast(Confidence | None, answer.confidence) if answer else None,
        self_review=cast(SelfReview | None, answer.self_review) if answer else None,
    )


def representation(db: Session, attempt: QuizAttempt, course_id: UUID) -> AttemptResponse:
    answers = {
        a.quiz_question_id: a
        for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))
    }
    rows = question_rows(db, attempt)
    sources = [row.source_question_id for row in rows]
    units = unit_labels(db, course_id, sources)
    quiz = db.get(Quiz, attempt.quiz_id)
    assert quiz is not None and quiz.course_id == course_id
    favorites = favorited(db, quiz.user_id, sources)
    penalty = Decimal(str(quiz.scoring["wrong_answer_penalty"])) if quiz.scoring else None
    active: list[ActiveQuestion] = []
    results: list[ResultQuestion] = []
    items: list[ItemResult] = []
    reviews = SelfReviewTally()
    for row in rows:
        content = OwnerQuestion.model_validate(row.snapshot)
        answer = answers.get(row.id)
        public = ActiveQuestion(
            id=row.id,
            source_question_id=row.source_question_id,
            position=row.position,
            type=content.type,
            stem=content.stem,
            difficulty=content.difficulty,
            options=[PublicOption(position=o.position, text=o.text) for o in content.options],
            answer=answer_adapter.validate_python(answer.payload) if answer else None,
            units=units.get(row.source_question_id, []),
            favorite=row.source_question_id in favorites,
            rating=cast(ReviewRating | None, answer.rating) if answer else None,
            points=None if row.points is None else float(row.points),
            label=row.label,
            unit=content.unit,
        )
        if attempt.status == "SUBMITTED":
            result = ResultQuestion(
                **public.model_dump(exclude={"options"}),
                **feedback(content, answer).model_dump(),
            )
            if penalty is not None and row.points is not None:
                item = ItemResult(
                    row.points, cast(Grade, answer.grading_status) if answer else None
                )
                items.append(item)
                earned = item_points(item, penalty)
                result.earned_points = None if earned is None else float(earned)
            if answer is None:
                # Left blank in a paper or in practice: never graded, never pending review.
                result.grading_status = "UNANSWERED"
            if answer is not None and result.grading_status == "PENDING":
                reviews.add(answer.self_review, row.points)
            results.append(result)
            continue
        # The student already saw a checked key, so abandoned history keeps showing it.
        if answer is not None and answer.checked_at is not None:
            public.feedback = feedback(content, answer)
        active.append(public)
    fields = summary(attempt, quiz).model_dump(exclude={"status"})
    if attempt.status == "SUBMITTED":
        return SubmittedAttempt(
            **fields,
            questions=results,
            score=paper_score(quiz, items),
            self_review=reviews.summary(paper=quiz.scoring is not None),
        )
    if attempt.status == "ABANDONED":
        assert attempt.abandoned_at is not None
        return AbandonedAttempt(**fields, abandoned_at=attempt.abandoned_at, questions=active)
    return ActiveAttempt(**fields, questions=active)


class SelfReviewTally:
    """Counts self-assessments of pending short answers; kept apart from the score."""

    def __init__(self) -> None:
        self.counts = {"CORRECT": 0, "INCORRECT": 0, None: 0}
        self.correct_points = self.unreviewed_points = Decimal(0)

    def add(self, verdict: str | None, points: Decimal | None) -> None:
        self.counts[verdict] += 1
        if verdict == "CORRECT":
            self.correct_points += points or 0
        elif verdict is None:
            self.unreviewed_points += points or 0

    def summary(self, paper: bool) -> SelfReviewSummary:
        return SelfReviewSummary(
            correct=self.counts["CORRECT"],
            incorrect=self.counts["INCORRECT"],
            unreviewed=self.counts[None],
            correct_points=float(self.correct_points) if paper else None,
            unreviewed_points=float(self.unreviewed_points) if paper else None,
        )


def paper_score(quiz: Quiz, items: list[ItemResult]) -> PaperScore | None:
    if quiz.scoring is None:
        return None
    threshold = quiz.scoring["pass_threshold"]
    result = score(
        items,
        Decimal(str(quiz.scoring["wrong_answer_penalty"])),
        None if threshold is None else Decimal(str(threshold)),
    )
    return PaperScore(
        version=str(quiz.scoring["version"]),
        earned=float(result.earned),
        max_points=float(result.max_points),
        correct_points=float(result.correct_points),
        penalty_points=float(result.penalty_points),
        pending_points=float(result.pending_points),
        unanswered_count=result.unanswered_count,
        passed=result.passed,
    )


def availability(
    db: Session, user: User, course_id: UUID, data: PracticeFilters
) -> PracticeAvailability:
    """Count what `start` would select now, without creating a session."""
    get_member_course(db, user, course_id)
    as_of = datetime.now(UTC)
    unit_ids, scope_id, _ = resolve_focus(db, course_id, data.unit_ids, data.exam_scope_id)
    course_total = count_eligible(db, user.id, course_id)
    mistakes = data.model_copy(update={"selection_mode": "MISTAKES"})
    due = data.model_copy(update={"selection_mode": "DUE"})
    favorites = data.model_copy(update={"selection_mode": "FAVORITES"})
    if scope_id and not unit_ids:
        # Starting such a scope is refused, so nothing is available.
        by_type = dict.fromkeys(data.question_types, 0)
        mistakes_total = due_total = favorites_total = 0
    else:
        by_type = count_by_type(db, user.id, course_id, data, unit_ids, as_of)
        mistakes_total = count_total(db, user.id, course_id, mistakes, unit_ids, as_of)
        due_total = count_total(db, user.id, course_id, due, unit_ids, as_of)
        favorites_total = count_total(db, user.id, course_id, favorites, unit_ids, as_of)
    by_unit = count_by_unit(db, user.id, course_id, data, unit_ids, as_of)
    return PracticeAvailability(
        course_total=course_total,
        total=sum(by_type.values()),
        by_type=[TypeAvailability(type=type_, count=count) for type_, count in by_type.items()],
        by_unit=[UnitAvailability(unit_id=id_, count=count) for id_, count in by_unit.items()],
        mistakes_total=mistakes_total,
        due_total=due_total,
        favorites_total=favorites_total,
    )


def start(db: Session, user: User, course_id: UUID, data: StartQuiz) -> AttemptResponse:
    return start_generated(db, user, course_id, data)


def start_mock(db: Session, user: User, course_id: UUID, data: StartMock) -> AttemptResponse:
    """A mock exam: the MOCK selection, one point per question and an optional deadline."""
    selection = StartQuiz(
        selection_mode="MOCK",
        exam_scope_id=data.exam_scope_id,
        count=data.count,
        question_types=data.question_types,
        feedback_mode=data.feedback_mode,
    )
    return start_generated(db, user, course_id, selection, mock=data)


def mock_scoring(mock: StartMock, label: str | None, questions: int) -> dict[str, object]:
    """The rule frozen with a mock exam: one point per question, no penalty, no pass mark."""
    return {
        "version": SCORING_VERSION,
        "title": f"Probni ispit · {label}",
        "total_points": str(questions),
        "wrong_answer_penalty": "0",
        "pass_threshold": None,
        "duration_minutes": mock.duration_minutes,
    }


def start_generated(
    db: Session,
    user: User,
    course_id: UUID,
    data: StartQuiz,
    mock: StartMock | None = None,
) -> AttemptResponse:
    get_member_course(db, user, course_id)
    try:
        # Serialize all starts for this user so adaptive exclusion sees committed starts.
        # Compatible with FK locks; shares submission's per-user serialization boundary.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        selection_time = datetime.now(UTC)
        unit_ids, scope_id, label = resolve_focus(db, course_id, data.unit_ids, data.exam_scope_id)
        if scope_id and not unit_ids:
            raise HTTPException(409, "This exam scope has no units yet")
        questions = select_questions(db, user.id, course_id, data, selection_time, unit_ids)
        if len(questions) < data.count:
            filters = "type or unit filter" if unit_ids else "type filter"
            raise HTTPException(
                409,
                f"Only {len(questions)} eligible questions available; "
                f"requested {data.count}. Reduce the count or change the {filters}.",
            )
        quiz = Quiz(
            course_id=course_id,
            user_id=user.id,
            exam_scope_id=scope_id,
            focus_unit_ids=[str(id_) for id_ in unit_ids],
            focus_label=label,
            feedback_mode=data.feedback_mode,
            selection_mode="QUICK" if data.quick_quiz else data.selection_mode,
            # Left unset for practice: an explicit None would be stored as JSON null, not NULL.
            **({} if mock is None else {"scoring": mock_scoring(mock, label, len(questions))}),
        )
        db.add(quiz)
        db.flush()
        points = None if mock is None else Decimal(1)
        for position, question in enumerate(questions):
            db.add(snapshot_row(db, quiz, position, question, points))
        # The single clock reading of this start; only a timed exam needs it as the attempt's start.
        timing: dict[str, datetime] = {}
        if mock is not None and mock.duration_minutes:
            timing = {
                "started_at": selection_time,
                "deadline_at": selection_time + timedelta(minutes=mock.duration_minutes),
            }
        attempt = QuizAttempt(quiz_id=quiz.id, **timing)
        db.add(attempt)
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def snapshot_row(
    db: Session,
    quiz: Quiz,
    position: int,
    question: Question,
    points: Decimal | None = None,
    label: str | None = None,
) -> QuizQuestion:
    version = db.scalar(
        select(func.max(QuestionVersion.version_number)).where(
            QuestionVersion.question_id == question.id
        )
    )
    if version is None:
        raise HTTPException(409, "Approved question has no version history")
    return QuizQuestion(
        quiz_id=quiz.id,
        position=position,
        source_question_id=question.id,
        source_version=version,
        snapshot=owner_view(db, question).model_dump(mode="json"),
        points=points,
        label=label,
    )


def start_paper(db: Session, user: User, paper_id: UUID, data: StartPaper) -> AttemptResponse:
    """Start a session with exactly a published paper's questions, order and points."""
    found, _ = load_paper(db, user, paper_id)
    get_member_course(db, user, found.course_id)
    try:
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        # Share-lock the paper so it cannot be unpublished or edited mid-start.
        paper = db.scalar(
            select(ExamPaper)
            .where(ExamPaper.id == paper_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        if paper is None or paper.status != "PUBLISHED":
            raise HTTPException(409, "Only published papers can be taken")
        rows = db.execute(
            select(ExamPaperItem, Question)
            .join(Question, Question.id == ExamPaperItem.question_id)
            .where(ExamPaperItem.paper_id == paper.id)
            .order_by(ExamPaperItem.position)
            .with_for_update(of=Question, read=True)
        ).tuples()
        items = list(rows)
        if not items:
            raise HTTPException(409, "This paper has no questions")
        total = sum((item.points for item, _ in items), Decimal(0))
        quiz = Quiz(
            course_id=paper.course_id,
            user_id=user.id,
            exam_scope_id=paper.exam_scope_id,
            focus_label=paper.title,
            feedback_mode=data.feedback_mode,
            exam_paper_id=paper.id,
            selection_mode="PAPER",
            scoring={
                "version": SCORING_VERSION,
                "title": paper.title,
                "total_points": str(total),
                "wrong_answer_penalty": str(paper.wrong_answer_penalty),
                "pass_threshold": None
                if paper.pass_threshold is None
                else str(paper.pass_threshold),
                "duration_minutes": paper.duration_minutes,
            },
        )
        db.add(quiz)
        db.flush()
        for position, (item, question) in enumerate(items):
            db.add(snapshot_row(db, quiz, position, question, item.points, item.label))
        started_at = datetime.now(UTC)
        timed = data.timed and paper.duration_minutes is not None
        attempt = QuizAttempt(
            quiz_id=quiz.id,
            started_at=started_at,
            deadline_at=started_at + timedelta(minutes=paper.duration_minutes)
            if timed and paper.duration_minutes
            else None,
        )
        db.add(attempt)
        db.flush()
        result = representation(db, attempt, paper.course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def list_attempts(
    db: Session, user: User, course_id: UUID, limit: int, offset: int
) -> list[AttemptSummary]:
    get_member_course(db, user, course_id)
    return [
        summary(attempt, quiz)
        for attempt, quiz in db.execute(
            select(QuizAttempt, Quiz)
            .join(Quiz)
            .where(Quiz.course_id == course_id, Quiz.user_id == user.id)
            .order_by(QuizAttempt.started_at.desc(), QuizAttempt.id)
            .limit(limit)
            .offset(offset)
        ).tuples()
    ]


def require_active(attempt: QuizAttempt) -> None:
    if attempt.status == "ABANDONED":
        raise HTTPException(409, "Quiz abandoned; answers are frozen")
    if attempt.status != "ACTIVE":
        raise HTTPException(409, "Quiz already submitted; answers are frozen")


def require_writable(attempt: QuizAttempt) -> None:
    """Answers may change only while the attempt is active and before any deadline."""
    require_active(attempt)
    if attempt.deadline_at is not None and datetime.now(UTC) >= attempt.deadline_at:
        raise HTTPException(
            409, "Time is up; hand in the exam. Answers saved before the deadline count."
        )


def attempt_question(db: Session, attempt: QuizAttempt, question_id: UUID) -> QuizQuestion:
    question = db.scalar(
        select(QuizQuestion).where(
            QuizQuestion.id == question_id, QuizQuestion.quiz_id == attempt.quiz_id
        )
    )
    if question is None:
        raise HTTPException(404, "Attempt question not found")
    return question


def saved_answer(db: Session, attempt: QuizAttempt, question: QuizQuestion) -> Answer | None:
    return db.scalar(
        select(Answer).where(
            Answer.attempt_id == attempt.id, Answer.quiz_question_id == question.id
        )
    )


def save_answer(
    db: Session,
    user: User,
    course_id: UUID,
    attempt_id: UUID,
    question_id: UUID,
    data: AnswerPayload,
) -> AttemptResponse:
    attempt = load_attempt(db, user, course_id, attempt_id)
    require_writable(attempt)
    question = attempt_question(db, attempt, question_id)
    content = OwnerQuestion.model_validate(question.snapshot)
    if (
        data.type != content.type
        or (
            isinstance(data, MCQAnswer)
            and data.option_position not in {o.position for o in content.options}
        )
        or (
            isinstance(data, MultipleSelectAnswer)
            and not set(data.option_positions) <= {o.position for o in content.options}
        )
    ):
        raise HTTPException(422, "Answer must match the question type and available options")
    try:
        answer = saved_answer(db, attempt, question)
        if answer is None:
            answer = Answer(attempt_id=attempt.id, quiz_question_id=question.id)
            db.add(answer)
        elif answer.checked_at is not None:
            raise HTTPException(409, "Answer already checked; it can no longer change")
        answer.payload = data.model_dump()
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def clear_answer(
    db: Session, user: User, course_id: UUID, attempt_id: UUID, question_id: UUID
) -> AttemptResponse:
    """Leave a question blank again; on a paper a blank scores 0 instead of a penalty."""
    attempt = load_attempt(db, user, course_id, attempt_id)
    require_writable(attempt)
    question = attempt_question(db, attempt, question_id)
    try:
        answer = saved_answer(db, attempt, question)
        if answer is not None:
            if answer.checked_at is not None:
                raise HTTPException(409, "Answer already checked; it can no longer change")
            db.delete(answer)
            db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def rate_answer(
    db: Session,
    user: User,
    course_id: UUID,
    attempt_id: UUID,
    question_id: UUID,
    data: RateAnswer,
) -> AttemptResponse:
    """Keep the student's rating of a checked answer; submission reschedules the card from it.

    Rating here instead of after submission means the card is scheduled once, not first by the
    graded result and again by the rating.
    """
    attempt = load_attempt(db, user, course_id, attempt_id)
    require_writable(attempt)
    question = attempt_question(db, attempt, question_id)
    try:
        answer = saved_answer(db, attempt, question)
        if answer is None or answer.checked_at is None:
            raise HTTPException(409, "Check the answer before rating it")
        answer.rating = data.rating
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def check_answer(
    db: Session,
    user: User,
    course_id: UUID,
    attempt_id: UUID,
    question_id: UUID,
    data: CheckAnswer,
) -> AttemptResponse:
    """Grade one saved IMMEDIATE answer now and freeze it; scheduling waits for submission."""
    attempt = load_attempt(db, user, course_id, attempt_id)
    require_writable(attempt)
    quiz = db.get(Quiz, attempt.quiz_id)
    assert quiz is not None
    if quiz.feedback_mode != "IMMEDIATE":
        raise HTTPException(409, "This session shows results after submission")
    question = attempt_question(db, attempt, question_id)
    try:
        answer = saved_answer(db, attempt, question)
        if answer is None:
            raise HTTPException(409, "Save an answer before checking it")
        # Repeats return the first check unchanged, including its confidence.
        if answer.checked_at is None:
            result = grade(
                OwnerQuestion.model_validate(question.snapshot),
                answer_adapter.validate_python(answer.payload),
            )
            answer.grading_status = result.status
            answer.grading_method = result.method
            answer.grading_version = result.version
            answer.checked_at = datetime.now(UTC)
            answer.confidence = data.confidence
            db.flush()
        response = representation(db, attempt, course_id)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


def self_review_answer(
    db: Session,
    user: User,
    course_id: UUID,
    attempt_id: UUID,
    question_id: UUID,
    data: SelfReviewRequest,
) -> AttemptResponse:
    """Record or clear the student's verdict on a short answer whose reference they can see.

    Stored apart from the grade: grading_status, the frozen paper score, review progress,
    readiness and item analysis never read it.
    """
    attempt = load_attempt(db, user, course_id, attempt_id)
    if attempt.status == "ABANDONED":
        raise HTTPException(409, "Quiz abandoned; answers are frozen")
    question = attempt_question(db, attempt, question_id)
    if OwnerQuestion.model_validate(question.snapshot).type != "SHORT_ANSWER":
        raise HTTPException(409, "Only short answers are self-assessed; this one is graded")
    try:
        answer = saved_answer(db, attempt, question)
        if answer is None:
            raise HTTPException(409, "There is no saved answer to assess")
        # The reference answer is visible only once checked, or after submission.
        if attempt.status == "ACTIVE" and answer.checked_at is None:
            raise HTTPException(409, "Check this answer before assessing it")
        if answer.grading_method != "PENDING_SEMANTIC":
            raise HTTPException(409, "Only short answers awaiting review are self-assessed")
        if answer.self_review != data.verdict:
            # Explicit columns only: updated_at keeps dating the answer itself.
            db.execute(
                update(Answer)
                .where(Answer.id == answer.id)
                .values(
                    self_review=data.verdict,
                    self_reviewed_at=None if data.verdict is None else datetime.now(UTC),
                    updated_at=Answer.updated_at,
                )
            )
            db.expire(answer)
        response = representation(db, attempt, course_id)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


def submit(db: Session, user: User, course_id: UUID, attempt_id: UUID) -> AttemptResponse:
    attempt = load_attempt(db, user, course_id, attempt_id)
    if attempt.status == "SUBMITTED":
        return representation(db, attempt, course_id)
    require_active(attempt)
    try:
        answers = {
            a.quiz_question_id: a
            for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))
        }
        questions = question_rows(db, attempt)
        quiz = db.get(Quiz, attempt.quiz_id)
        assert quiz is not None
        # Blanks are allowed everywhere. A paper may even be handed in empty when its time
        # runs out; ordinary practice needs one answer, otherwise there is nothing to record.
        if not answers and quiz.scoring is None:
            raise HTTPException(
                409, "Answer at least one question before finishing, or abandon the attempt"
            )
        # Serialize overlapping attempts, including first inserts for the same question.
        # NO KEY UPDATE is compatible with FK key-share locks held by other attempts.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        submitted_at = datetime.now(UTC)
        review_results: dict[UUID, Grade] = {}
        for question in questions:
            answer = answers.get(question.id)
            if answer is None:
                # Blank questions are neither graded nor scheduled.
                continue
            # A checked answer keeps the grade the student already saw.
            if answer.checked_at is None:
                grading_result = grade(
                    OwnerQuestion.model_validate(question.snapshot),
                    answer_adapter.validate_python(answer.payload),
                )
                answer.grading_status = grading_result.status
                answer.grading_method = grading_result.method
                answer.grading_version = grading_result.version
            review_results[question.source_question_id] = cast(Grade, answer.grading_status)
        attempt.status = "SUBMITTED"
        attempt.submitted_at = submitted_at
        ratings = {
            question.source_question_id: cast(ReviewRating, answers[question.id].rating)
            for question in questions
            if question.id in answers and answers[question.id].rating is not None
        }
        apply_reviews(db, user.id, review_results, submitted_at, ratings)
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def abandon(db: Session, user: User, course_id: UUID, attempt_id: UUID) -> AttemptResponse:
    attempt = load_attempt(db, user, course_id, attempt_id)
    if attempt.status == "ABANDONED":
        return representation(db, attempt, course_id)
    require_active(attempt)
    try:
        # Share the start/submission boundary so adaptive starts see committed closure.
        db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))
        attempt.status = "ABANDONED"
        attempt.abandoned_at = datetime.now(UTC)
        db.flush()
        result = representation(db, attempt, course_id)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
