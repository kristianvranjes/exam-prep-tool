import pytest
from pydantic import ValidationError

from app.schemas.course import CourseCreate, CourseUpdate, MembershipUpdate
from app.schemas.preferences import DEFAULT_PREFERENCES, PreferencesBody

BASE = {"palette": "dark", "font_scale_percent": 100, "answer_markers": "letters"}
COLORS = {"background": "#101820", "text": "#EEEEEE", "accent": "#A1C349"}


def test_defaults_match_the_frontend_defaults():
    assert DEFAULT_PREFERENCES.palette == "dark"
    assert DEFAULT_PREFERENCES.font_scale_percent == 100
    assert DEFAULT_PREFERENCES.answer_markers == "letters"
    assert DEFAULT_PREFERENCES.custom_colors is None and DEFAULT_PREFERENCES.updated_at is None


def test_custom_colors_are_normalised_to_lower_case():
    body = PreferencesBody.model_validate(BASE | {"palette": "custom", "custom_colors": COLORS})
    assert body.custom_colors is not None
    assert (body.custom_colors.text, body.custom_colors.accent) == ("#eeeeee", "#a1c349")


@pytest.mark.parametrize("palette", ["dark", "light", "night", "contrast", "system"])
def test_other_palettes_do_not_need_colors(palette):
    assert PreferencesBody.model_validate(BASE | {"palette": palette}).custom_colors is None


@pytest.mark.parametrize(
    "change",
    [
        {"palette": "custom"},
        {"palette": "pink"},
        {"font_scale_percent": 120},
        {"font_scale_percent": 1.15},
        {"answer_markers": "numbers"},
        {"lang": "en"},
        {"custom_colors": COLORS | {"accent": "#abc"}},
        {"custom_colors": COLORS | {"extra": "#000000"}},
    ],
)
def test_invalid_preferences(change):
    with pytest.raises(ValidationError):
        PreferencesBody.model_validate(BASE | change)


@pytest.mark.parametrize("year", [0, 6, -1])
def test_year_of_study_bounds(year):
    with pytest.raises(ValidationError):
        CourseCreate.model_validate(
            {
                "faculty_id": "00000000-0000-0000-0000-000000000001",
                "name": "A",
                "year_of_study": year,
            }
        )
    with pytest.raises(ValidationError):
        CourseUpdate.model_validate({"year_of_study": year})


def test_year_of_study_is_optional_and_nullable():
    assert CourseUpdate.model_validate({}).model_dump(exclude_unset=True) == {}
    cleared = CourseUpdate.model_validate({"year_of_study": None})
    assert cleared.model_dump(exclude_unset=True) == {"year_of_study": None}
    assert CourseUpdate.model_validate({"year_of_study": 5}).year_of_study == 5


def test_membership_update_accepts_only_a_status():
    assert MembershipUpdate.model_validate({"status": "FINISHED"}).status == "FINISHED"
    for bad in ({"status": "LEFT"}, {"status": "ACTIVE", "role": "OWNER"}, {}):
        with pytest.raises(ValidationError):
            MembershipUpdate.model_validate(bad)
