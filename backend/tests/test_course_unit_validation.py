from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from app.config import Settings
from app.main import app
from app.schemas.course_unit import (
    CourseUnitCreate,
    CourseUnitOrder,
    CourseUnitUpdate,
    QuestionUnits,
)
from app.schemas.question import QuestionCreate, QuestionPatch

create_adapter: TypeAdapter[QuestionCreate] = TypeAdapter(QuestionCreate)


def test_unit_create_strips_and_bounds_text():
    assert CourseUnitCreate.model_validate({"title": "  Uvod  "}).title == "Uvod"
    for body in ({"title": ""}, {"title": "x" * 151}, {"title": "Ok", "description": " "}):
        with pytest.raises(ValidationError):
            CourseUnitCreate.model_validate(body)
    with pytest.raises(ValidationError):
        CourseUnitCreate.model_validate({"title": "Ok", "is_archived": True})


def test_unit_update_requires_a_change_and_keeps_explicit_null():
    with pytest.raises(ValidationError):
        CourseUnitUpdate.model_validate({})
    with pytest.raises(ValidationError):
        CourseUnitUpdate.model_validate({"title": None})
    cleared = CourseUnitUpdate.model_validate({"description": None})
    assert cleared.model_fields_set == {"description"}


def test_unit_id_lists_are_unique_and_bounded():
    unit = str(uuid4())
    for model in (CourseUnitOrder, QuestionUnits):
        with pytest.raises(ValidationError):
            model.model_validate({"unit_ids": [unit, unit]})
    with pytest.raises(ValidationError):
        CourseUnitOrder.model_validate({"unit_ids": []})
    assert QuestionUnits.model_validate({"unit_ids": []}).unit_ids == []
    with pytest.raises(ValidationError):
        QuestionUnits.model_validate({"unit_ids": [str(uuid4()) for _ in range(6)]})


def test_question_create_and_patch_accept_unit_ids():
    unit = uuid4()
    body = {"type": "TRUE_FALSE", "stem": "True?", "correct_answer": True}
    assert create_adapter.validate_python(body).unit_ids == []
    assert create_adapter.validate_python(body | {"unit_ids": [str(unit)]}).unit_ids == [unit]
    with pytest.raises(ValidationError):
        create_adapter.validate_python(body | {"unit_ids": [str(unit), str(unit)]})
    with pytest.raises(ValidationError):
        QuestionPatch.model_validate({"unit_ids": [str(uuid4()) for _ in range(6)]})


@pytest.mark.parametrize(
    "path", [f"/courses/{uuid4()}/units/order", f"/questions/{uuid4()}/units", f"/units/{uuid4()}"]
)
def test_browser_preflight_allows_unit_updates(path):
    # The frontend calls these routes cross-origin; CORS only allows listed methods.
    origin = Settings().frontend_url
    with TestClient(app) as client:
        response = client.options(
            path, headers={"Origin": origin, "Access-Control-Request-Method": "PATCH"}
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
