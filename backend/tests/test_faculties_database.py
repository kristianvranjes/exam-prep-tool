import os
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from community_helpers import provision
from fastapi.testclient import TestClient
from migration_helpers import legacy_question_columns
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DataError, IntegrityError
from test_materials import clients as clients
from test_materials import upload
from test_practice_database import assert_no_keys, save_all, start
from test_practice_database import bank as bank
from test_quiz_import import document

from alembic import command
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Course, CourseMembership
from app.models.faculty import Faculty

pytestmark = pytest.mark.skipif(os.getenv("RUN_DB_TESTS") != "1", reason="Requires PostgreSQL")
LEGACY = UUID("00000000-0000-0000-0000-000000000010")


def faculty(name="Engineering", **kwargs):
    with SessionLocal() as db:
        row = Faculty(name=name, slug="faculty-" + uuid4().hex, **kwargs)
        db.add(row)
        db.commit()
        return row.id


def create(client, faculty_id, name="Algorithms"):
    provision(client, faculty_id)
    response = client.post("/courses", json={"name": name, "faculty_id": str(faculty_id)})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", ""),
        ("name", "   "),
        ("name", "x" * 151),
        ("slug", ""),
        ("slug", "UPPER"),
        ("slug", "has space"),
        ("slug", "-leading"),
        ("slug", "double--dash"),
        ("slug", "x" * 101),
        ("university_name", "x" * 201),
    ],
)
def test_faculty_constraints(field, value):
    data = {"name": "Engineering", "slug": "test-" + uuid4().hex, field: value}
    with SessionLocal() as db, pytest.raises((IntegrityError, DataError)):
        db.add(Faculty(**data))
        db.flush()


def test_unique_slug_and_restricted_faculty_delete(clients):
    owner, _, _, _ = clients
    fid = faculty()
    create(owner, fid)
    with SessionLocal() as db:
        slug = db.get(Faculty, fid).slug
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(Faculty(name="Duplicate", slug=slug))
        db.flush()
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.execute(delete(Faculty).where(Faculty.id == fid))


def test_authenticated_catalog_order_isolation_and_availability(clients):
    owner, _, stranger, _ = clients
    alpha, beta, inactive = faculty("Alpha"), faculty("Beta"), faculty(is_active=False)
    first = create(owner, alpha, "A course")
    second = create(owner, alpha, "Z course")
    hidden = create(owner, alpha, "Hidden")
    create(owner, beta, "Other faculty")
    with SessionLocal() as db:
        db.get(Course, UUID(hidden["id"])).is_active = False
        db.commit()
        expected = [
            str(f.id)
            for f in db.scalars(
                select(Faculty)
                .where(Faculty.is_active.is_(True))
                .order_by(Faculty.name, Faculty.id)
            )
        ]
    response = stranger.get("/faculties")
    assert response.status_code == 200
    assert [f["id"] for f in response.json()] == expected
    assert str(inactive) not in expected
    path = f"/faculties/{alpha}/courses"
    catalog = stranger.get(path).json()
    assert [c["id"] for c in catalog] == [first["id"], second["id"]]
    assert all(c["faculty_id"] == str(alpha) and c["is_active"] for c in catalog)
    assert stranger.get(path + "?limit=1&offset=1").json() == [catalog[1]]
    assert stranger.get(f"/courses/{first['id']}").status_code == 404
    for fid in (inactive, uuid4()):
        assert stranger.get(f"/faculties/{fid}/courses").status_code == 404
    with TestClient(app) as anonymous:
        for url in ("/faculties", path):
            assert anonymous.get(url).status_code == 401
        assert anonymous.post(f"/courses/{first['id']}/join").status_code == 401


def test_explicit_active_faculty_required_for_new_course(clients):
    owner, _, _, _ = clients
    assert owner.post("/courses", json={"name": "No faculty"}).status_code == 422
    for fid in (uuid4(), faculty(is_active=False)):
        assert (
            owner.post("/courses", json={"name": "Invalid", "faculty_id": str(fid)}).status_code
            == 404
        )
    fid = faculty()
    course = create(owner, fid)
    assert course["faculty_id"] == str(fid)
    assert owner.get(f"/courses/{course['id']}/membership").json()["role"] == "OWNER"


def test_empty_course_delete_permissions_cascade_and_duplicate(clients):
    owner, member, stranger, course_id = clients
    path = f"/courses/{course_id}"
    with SessionLocal() as db:
        faculty_id = db.get(Course, UUID(course_id)).faculty_id
    with TestClient(app) as anonymous:
        assert anonymous.delete(path).status_code == 401
    assert stranger.delete(path).status_code == 404
    assert member.delete(path).status_code == 403
    assert owner.delete(path).status_code == 204
    assert owner.delete(path).status_code == 404
    with SessionLocal() as db:
        assert db.get(Course, UUID(course_id)) is None
        assert (
            db.scalars(
                select(CourseMembership).where(CourseMembership.course_id == UUID(course_id))
            ).all()
            == []
        )
        assert db.get(Faculty, faculty_id) is not None


def test_join_member_idempotent_concurrent_and_no_elevation(bank):
    owner, _, stranger, course, _ = bank
    path = f"/courses/{course}/join"
    user_id = stranger.get("/auth/me").json()["id"]

    def join(_):
        with TestClient(app) as client:
            client.cookies.update(stranger.cookies)
            return client.post(
                path, json={"role": "OWNER", "user_id": owner.get("/auth/me").json()["id"]}
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(join, range(2)))
    assert all(r.status_code == 200 for r in results)
    expected = {"course_id": course, "user_id": user_id, "role": "MEMBER", "status": "ACTIVE"}
    assert results[0].json() == results[1].json() == expected
    with SessionLocal() as db:
        membership = db.scalar(
            select(CourseMembership).where(
                CourseMembership.course_id == UUID(course),
                CourseMembership.user_id == UUID(user_id),
            )
        )
        before = (membership.id, membership.created_at)
    assert stranger.post(path).json() == expected
    with SessionLocal() as db:
        members = list(
            db.scalars(
                select(CourseMembership).where(
                    CourseMembership.course_id == UUID(course),
                    CourseMembership.user_id == UUID(user_id),
                )
            )
        )
        assert len(members) == 1 and (members[0].id, members[0].created_at) == before
    assert owner.post(path).json()["role"] == "OWNER"
    assert stranger.patch(f"/courses/{course}", json={"name": "Forbidden"}).status_code == 403
    assert stranger.delete(f"/courses/{course}").status_code == 403
    assert owner.patch(f"/courses/{course}", json={"name": "Updated"}).status_code == 200
    attempt = start(stranger, course, 3, selection_mode="ADAPTIVE")
    assert_no_keys(attempt)
    attempt_path = save_all(stranger, course, attempt)
    result = stranger.post(attempt_path + "/submit")
    assert result.status_code == 200
    assert stranger.post(attempt_path + "/submit").json() == result.json()
    assert len(stranger.get(f"/courses/{course}/review-progress").json()) == 2
    assert stranger.post(f"/courses/{course}/questions/import", json=document()).status_code == 201


@pytest.mark.parametrize("inactive", ["faculty", "course"])
def test_join_unavailable_course(clients, inactive):
    owner, _, stranger, _ = clients
    fid = faculty()
    course = create(owner, fid)
    with SessionLocal() as db:
        row = db.get(Faculty, fid) if inactive == "faculty" else db.get(Course, UUID(course["id"]))
        row.is_active = False
        db.commit()
    assert stranger.post(f"/courses/{course['id']}/join").status_code == 404
    assert stranger.post(f"/courses/{uuid4()}/join").status_code == 404
    # Existing members retain historical/private access; activity gates only discovery/enrollment.
    assert owner.get(f"/courses/{course['id']}").status_code == 200


def historical_rows():
    tables = [
        "materials",
        "material_sections",
        "material_chunks",
        "question_options",
        "question_versions",
        "question_review_progress",
    ]
    with engine.connect() as conn:
        result = {
            name: conn.execute(text(f"SELECT * FROM {name} ORDER BY id")).all() for name in tables
        }
        # Compare columns shared by old revisions; 0028's status is tested separately.
        result["course_memberships"] = conn.execute(
            text(
                "SELECT id, course_id, user_id, role, created_at "
                "FROM course_memberships ORDER BY id"
            )
        ).all()
        result["questions"] = conn.execute(
            text(f"SELECT {legacy_question_columns(conn)} FROM questions ORDER BY id")
        ).all()
        # Compare columns shared by old revisions; 0017's practice focus is tested separately.
        result["quizzes"] = conn.execute(
            text("SELECT id, course_id, user_id, created_at FROM quizzes ORDER BY id")
        ).all()
        # Compare columns shared by old revisions; 0021's paper points are tested separately.
        result["quiz_questions"] = conn.execute(
            text(
                "SELECT id, quiz_id, position, source_question_id, source_version, snapshot "
                "FROM quiz_questions ORDER BY id"
            )
        ).all()
        # Compare columns shared by old revisions; 0018's check/confidence is tested separately.
        result["answers"] = conn.execute(
            text(
                "SELECT id, attempt_id, quiz_question_id, payload, grading_status, "
                "grading_method, grading_version, updated_at FROM answers ORDER BY id"
            )
        ).all()
        # Compare columns shared by old revisions; 0015's timestamp is tested separately.
        result["quiz_attempts"] = conn.execute(
            text(
                "SELECT id, quiz_id, status, started_at, submitted_at "
                "FROM quiz_attempts ORDER BY id"
            )
        ).all()
        result["courses"] = conn.execute(
            text(
                "SELECT id, name, code, description, created_by_user_id, created_at, updated_at "
                "FROM courses ORDER BY id"
            )
        ).all()
        return result


def test_legacy_roundtrip_preserves_courses_and_all_children(bank):
    owner, member, _, course, _ = bank
    assert upload(owner, course).status_code == 201
    attempt = start(member, course)
    path = save_all(member, course, attempt)
    frozen = member.post(path + "/submit").json()
    before = historical_rows()
    assert all(
        before[t]
        for t in ("materials", "questions", "quizzes", "answers", "question_review_progress")
    )
    config = Config("alembic.ini")
    try:
        for _ in range(2):
            command.downgrade(config, "0009")
            assert historical_rows() == before
            command.upgrade(config, "head")
            assert historical_rows() == before
            with SessionLocal() as db:
                assert db.get(Course, UUID(course)).faculty_id == LEGACY
                legacy = db.get(Faculty, LEGACY)
                assert (legacy.slug, legacy.name) == ("legacy-unassigned", "Legacy / Unassigned")
            assert member.get(path).json() == frozen
            assert member.post(path + "/submit").json() == frozen
    finally:
        command.upgrade(config, "head")
    with engine.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "include_object": lambda obj, name, type_, reflected, compare_to: (
                    type_ != "table" or name in {"faculties", "courses"}
                )
            },
        )
        assert compare_metadata(context, Base.metadata) == []
