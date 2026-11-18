import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from community_helpers import provision
from fastapi.testclient import TestClient
from migration_helpers import legacy_question_columns
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession
from test_community_database import community as community
from test_community_database import contribute
from test_materials import clients as clients

from alembic import command
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User
from app.models.question import Question
from app.models.question_report import QuestionReport
from app.services.questions import service as question_service

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
BODY = {"reason": "UNCLEAR", "details": "Wording is ambiguous"}


def approved(creator, moderator, course):
    question = contribute(creator, course, "Report test " + uuid4().hex)
    path = f"/questions/{question['id']}"
    assert creator.post(path + "/submit").status_code == 200
    assert moderator.post(path + "/approve").status_code == 200
    return path


def register():
    client = TestClient(app)
    assert (
        client.post(
            "/auth/register",
            json={
                "email": f"reporter-{uuid4().hex}@example.com",
                "password": "correct horse",
                "display_name": "Reporter",
            },
        ).status_code
        == 201
    )
    return client


def question_history(question_id):
    with engine.connect() as conn:
        question = conn.execute(
            text(f"SELECT {legacy_question_columns(conn)} FROM questions WHERE id = :id"),
            {"id": question_id},
        ).one()
        versions = conn.execute(
            text("SELECT * FROM question_versions WHERE question_id = :id ORDER BY version_number"),
            {"id": question_id},
        ).all()
        return question, versions


def test_report_validation_privacy_and_duplicate(community):
    owner, creator, moderator, course, faculty, other_faculty = community
    draft = contribute(creator, course, "Private report " + uuid4().hex)
    private = f"/questions/{draft['id']}/reports"
    with register() as outsider, TestClient(app) as anonymous:
        assert anonymous.post(private, json=BODY).status_code == 401
        assert outsider.post(private, json=BODY).status_code == 404
        assert creator.post(private, json=BODY).status_code == 409
        assert owner.post(private, json=BODY).status_code == 404
        assert moderator.post(private, json=BODY).status_code == 404
        path = approved(creator, moderator, course)
        endpoint = path + "/reports"
        assert outsider.post(endpoint, json=BODY).status_code == 404
        assert moderator.post(endpoint, json=BODY).status_code == 404
        for invalid in (
            {"reason": "INVALID"},
            {"reason": "OTHER"},
            {"reason": "TYPO", "details": " "},
            {"reason": "TYPO", "details": "x" * 1001},
            BODY | {"status": "RESOLVED"},
            BODY | {"reported_by_user_id": str(uuid4())},
        ):
            assert owner.post(endpoint, json=invalid).status_code == 422
        before = creator.get(path + "/versions").json()
        for client in (creator, owner):
            response = client.post(endpoint, json=BODY)
            assert response.status_code == 201, response.text
            assert set(response.json()) == {
                "id",
                "question_id",
                "reason",
                "details",
                "status",
                "created_at",
            }
            assert response.json()["status"] == "OPEN"
        assert creator.post(endpoint, json=BODY).status_code == 409
        assert creator.get(path + "/versions").json() == before
        assert creator.get(path).json()["status"] == "APPROVED"
        assert owner.get(f"/faculties/{faculty}/question-reports").status_code == 403
        assert moderator.get(f"/faculties/{other_faculty}/question-reports").status_code == 403
        assert (
            moderator.get(f"/faculties/{faculty}/question-reports?course_id={uuid4()}").status_code
            == 404
        )
        queue = moderator.get(f"/faculties/{faculty}/question-reports").json()
        matching = [item for item in queue if item["question_id"] == path.split("/")[2]]
        assert len(matching) == 2
        assert matching[0]["question"]["correct_boolean"] is True
        assert "reported_by_user_id" not in matching[0]
        dismissed = moderator.post(f"/question-reports/{matching[0]['id']}/dismiss")
        assert dismissed.status_code == 200
        assert dismissed.json()["resolution"] == "DISMISSED"
        assert dismissed.json()["resolved_by_user_id"] == moderator.get("/auth/me").json()["id"]
        assert moderator.post(f"/question-reports/{matching[0]['id']}/dismiss").status_code == 409
        assert creator.post(endpoint, json=BODY).status_code == 201
        assert moderator.post(path + "/archive").status_code == 200
        assert creator.post(endpoint, json=BODY).status_code == 409
        resolved = moderator.get(f"/faculties/{faculty}/question-reports?status=RESOLVED").json()
        same = [item for item in resolved if item["question_id"] == path.split("/")[2]]
        assert len(same) == 3
        assert [item["resolution"] for item in same].count("DISMISSED") == 1
        assert [item["resolution"] for item in same].count("QUESTION_ARCHIVED") == 2
        assert len(creator.get(path + "/versions").json()) == len(before) + 1


def test_concurrent_report_and_dismiss_are_serialized(community):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    endpoint = path + "/reports"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: creator.post(endpoint, json=BODY).status_code, range(2)))
    assert sorted(results) == [201, 409]
    assert owner.post(endpoint, json=BODY).status_code == 201
    queue = moderator.get(f"/faculties/{faculty}/question-reports").json()
    report_id = next(item["id"] for item in queue if item["question_id"] == path.split("/")[2])
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(
            pool.map(
                lambda _: moderator.post(f"/question-reports/{report_id}/dismiss").status_code,
                range(2),
            )
        )
    assert sorted(outcomes) == [200, 409]


def test_archive_and_report_terminal_races(community):
    _, creator, moderator, course, faculty, _ = community
    with register() as second_moderator:
        provision(second_moderator, faculty)
        path = approved(creator, moderator, course)
        endpoint = path + "/reports"
        assert creator.post(endpoint, json=BODY).status_code == 201
        queue = moderator.get(f"/faculties/{faculty}/question-reports").json()
        report_id = next(item["id"] for item in queue if item["question_id"] == path.split("/")[2])
        with ThreadPoolExecutor(max_workers=2) as pool:
            archive = pool.submit(moderator.post, path + "/archive")
            dismiss = pool.submit(second_moderator.post, f"/question-reports/{report_id}/dismiss")
            assert archive.result().status_code == 200
            assert dismiss.result().status_code in (200, 409)
        assert moderator.get(f"/faculties/{faculty}/question-reports").json() == []
        resolved = moderator.get(f"/faculties/{faculty}/question-reports?status=RESOLVED").json()
        assert next(item for item in resolved if item["id"] == report_id)["resolution"] in (
            "DISMISSED",
            "QUESTION_ARCHIVED",
        )

        next_path = approved(creator, moderator, course)
        with ThreadPoolExecutor(max_workers=2) as pool:
            report = pool.submit(creator.post, next_path + "/reports", json=BODY)
            archive = pool.submit(moderator.post, next_path + "/archive")
            assert archive.result().status_code == 200
            assert report.result().status_code in (201, 409)
        assert moderator.get(f"/faculties/{faculty}/question-reports").json() == []

        last_path = approved(creator, moderator, course)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(moderator.post, last_path + "/archive")
            second = pool.submit(second_moderator.post, last_path + "/archive")
            assert sorted((first.result().status_code, second.result().status_code)) == [200, 409]
        reasons = [item["reason"] for item in creator.get(last_path + "/versions").json()]
        assert reasons.count("ARCHIVED") == 1


def test_archive_failure_rolls_back_reports_and_version(community, monkeypatch):
    _, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    before = creator.get(path + "/versions").json()
    original = question_service.add_version

    def fail_archive(db, question, user, reason):
        if reason == "ARCHIVED":
            raise RuntimeError("forced archive failure")
        return original(db, question, user, reason)

    monkeypatch.setattr(question_service, "add_version", fail_archive)
    assert moderator.post(path + "/archive").status_code == 503
    assert creator.get(path).json()["status"] == "APPROVED"
    assert creator.get(path + "/versions").json() == before
    assert len(moderator.get(f"/faculties/{faculty}/question-reports").json()) == 1


def test_unexpected_report_integrity_error_is_safe_503(community, monkeypatch):
    _, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    original_flush = OrmSession.flush

    def fail_report_flush(db, objects=None):
        if any(isinstance(row, QuestionReport) for row in db.new):
            raise IntegrityError("insert question report", {}, Exception("unexpected constraint"))
        return original_flush(db, objects)

    monkeypatch.setattr(OrmSession, "flush", fail_report_flush)
    assert creator.post(path + "/reports", json=BODY).status_code == 503
    assert moderator.get(f"/faculties/{faculty}/question-reports").json() == []


def test_report_fk_integrity_and_resolver_deletion(community):
    _, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    report_id = moderator.get(f"/faculties/{faculty}/question-reports").json()[0]["id"]
    with register() as resolver:
        provision(resolver, faculty)
        resolver_id = UUID(resolver.get("/auth/me").json()["id"])
        assert resolver.post(f"/question-reports/{report_id}/dismiss").status_code == 200
    with SessionLocal() as db:
        db.execute(delete(User).where(User.id == resolver_id))
        db.commit()
        report = db.get(QuestionReport, UUID(report_id))
        assert report is not None
        assert report.status == "RESOLVED" and report.resolution == "DISMISSED"
        assert report.resolved_by_user_id is None
        db.execute(delete(Question).where(Question.id == UUID(path.split("/")[2])))
        db.commit()
        db.expire_all()
        assert db.get(QuestionReport, UUID(report_id)) is None


def test_report_queue_cross_course_filter_and_pagination(community):
    owner, creator, moderator, course, faculty, _ = community
    first = approved(creator, moderator, course)
    assert creator.post(first + "/reports", json=BODY).status_code == 201
    assert owner.post(first + "/reports", json={"reason": "TYPO"}).status_code == 201
    created = moderator.post(
        "/courses", json={"name": "Second report course", "faculty_id": faculty}
    )
    assert created.status_code == 201
    second_course = created.json()["id"]
    assert creator.post(f"/courses/{second_course}/join").status_code == 200
    second = approved(creator, moderator, second_course)
    assert creator.post(second + "/reports", json=BODY).status_code == 201
    base = f"/faculties/{faculty}/question-reports"
    all_rows = moderator.get(base).json()
    assert len(all_rows) == 3
    assert [row["question"]["course_id"] for row in all_rows] == [
        course,
        course,
        second_course,
    ]
    assert moderator.get(base + "?limit=1&offset=1").json() == all_rows[1:2]
    assert len(moderator.get(base + f"?course_id={course}").json()) == 2
    assert len(moderator.get(base + f"?course_id={second_course}").json()) == 1
    with SessionLocal() as db:
        db.execute(text("DELETE FROM courses WHERE id = :id"), {"id": UUID(second_course)})
        db.commit()
        assert db.get(QuestionReport, UUID(all_rows[2]["id"])) is None


def test_reporter_restrict_without_other_question_ownership(community):
    _, creator, moderator, course, _, _ = community
    path = approved(creator, moderator, course)
    with register() as reporter:
        assert reporter.post(f"/courses/{course}/join").status_code == 200
        reporter_id = UUID(reporter.get("/auth/me").json()["id"])
        assert reporter.post(path + "/reports", json=BODY).status_code == 201
    with SessionLocal() as db:
        with pytest.raises(IntegrityError):
            db.execute(delete(User).where(User.id == reporter_id))
            db.commit()
        db.rollback()


def test_migration_0012_roundtrip_preserves_question_history(community):
    owner, creator, moderator, course, _, _ = community
    path = approved(creator, moderator, course)
    assert creator.post(path + "/reports", json=BODY).status_code == 201
    question_id = UUID(path.split("/")[2])
    creator_id = UUID(creator.get("/auth/me").json()["id"])
    owner_id = UUID(owner.get("/auth/me").json()["id"])
    before = question_history(question_id)
    config = Config("alembic.ini")
    try:
        command.downgrade(config, "0011")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0011"
            assert conn.scalar(text("SELECT to_regclass('question_reports')")) is None
        assert question_history(question_id) == before
        command.upgrade(config, "0012")
        assert question_history(question_id) == before
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "include_object": lambda obj, name, type_, reflected, compare_to: (
                        type_ != "table" or name == "question_reports"
                    )
                },
            )
            assert compare_metadata(context, Base.metadata) == []
        with SessionLocal() as db:
            row = QuestionReport(
                question_id=question_id,
                reported_by_user_id=creator_id,
                reason="UNCLEAR",
                details=None,
                status="OPEN",
            )
            db.add(row)
            db.commit()
            insert = text(
                "INSERT INTO question_reports(id, question_id, reported_by_user_id, "
                "reason, details, status, resolution, resolved_at) "
                "VALUES (:id, :question, :user, :reason, :details, :status, "
                ":resolution, :resolved_at)"
            )
            invalid = [
                {"reason": "OTHER"},
                {"reason": "UNKNOWN"},
                {"details": "x" * 1001},
                {"status": "RESOLVED"},
                {"status": "RESOLVED", "resolved_at": datetime.now(UTC)},
                {"status": "OPEN", "resolution": "DISMISSED"},
            ]
            for changes in invalid:
                values = {
                    "id": uuid4(),
                    "question": question_id,
                    "user": owner_id,
                    "reason": "TYPO",
                    "details": None,
                    "status": "OPEN",
                    "resolution": None,
                    "resolved_at": None,
                } | changes
                with pytest.raises(IntegrityError):
                    db.execute(insert, values)
                db.rollback()
            with pytest.raises(IntegrityError):
                db.execute(
                    text(
                        "INSERT INTO question_reports(id, question_id, reported_by_user_id, "
                        "reason, status) VALUES (:id, :question, :user, 'TYPO', 'OPEN')"
                    ),
                    {"id": uuid4(), "question": question_id, "user": creator_id},
                )
            db.rollback()
    finally:
        command.upgrade(config, "head")


def test_a_report_closes_as_fixed_and_the_question_stays(community):
    owner, creator, moderator, course, faculty, _ = community
    path = approved(creator, moderator, course)
    reported = owner.post(path + "/reports", json=BODY)
    assert reported.status_code == 201, reported.text
    report = reported.json()["id"]
    # Only a faculty moderator closes reports.
    assert owner.post(f"/question-reports/{report}/resolve").status_code == 403
    assert creator.post(f"/question-reports/{report}/resolve").status_code == 403
    assert moderator.post(f"/question-reports/{uuid4()}/resolve").status_code == 404
    fixed = moderator.post(f"/question-reports/{report}/resolve")
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["status"] == "RESOLVED" and fixed.json()["resolution"] == "FIXED"
    assert fixed.json()["resolved_by_user_id"] == moderator.get("/auth/me").json()["id"]
    assert moderator.post(f"/question-reports/{report}/resolve").status_code == 409
    assert moderator.post(f"/question-reports/{report}/dismiss").status_code == 409
    assert creator.get(path).json()["status"] == "APPROVED"
    # With nothing open, the same student may report the question again.
    assert owner.post(path + "/reports", json=BODY).status_code == 201
    resolved = moderator.get(f"/faculties/{faculty}/question-reports?status=RESOLVED").json()
    assert [item["resolution"] for item in resolved if item["id"] == report] == ["FIXED"]
