"""Explicit trusted provisioning for pre-existing course/curation test fixtures."""

from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Course
from app.models.faculty_moderator import FacultyModerator
from app.models.question import Question


def provision(client, faculty_id):
    user_id = UUID(client.get("/auth/me").json()["id"])
    with SessionLocal() as db:
        db.merge(FacultyModerator(faculty_id=UUID(str(faculty_id)), user_id=user_id))
        db.commit()


def create_course(client, *, json):
    provision(client, json["faculty_id"])
    return client.post("/courses", json=json)


def archive_course(client, course_id):
    """Archive a course and return its name, which deleting it requires."""
    response = client.post(f"/courses/{course_id}/archive")
    assert response.status_code == 200, response.text
    return response.json()["name"]


def delete_course(client, course_id, name=None):
    """Delete a course the way the settings do: archive it, then confirm with its name."""
    if name is None:
        name = archive_course(client, course_id)
    return client.delete(f"/courses/{course_id}", params={"confirm_name": name})


def review_question(client, path, **kwargs):
    # A separate human reviewer, never the creator. No public provisioning API.
    with TestClient(app) as reviewer:
        response = reviewer.post(
            "/auth/register",
            json={
                "email": f"reviewer-{uuid4().hex}@example.com",
                "password": "correct horse",
                "display_name": "Reviewer",
            },
        )
        assert response.status_code == 201
        with SessionLocal() as db:
            question = db.get(Question, UUID(path.split("/")[2]))
            faculty_id = db.get(Course, question.course_id).faculty_id
        provision(reviewer, faculty_id)
        return reviewer.post(path, **kwargs)
