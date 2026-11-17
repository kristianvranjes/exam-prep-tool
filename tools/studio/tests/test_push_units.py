import json
from typing import Any

import httpx
import pytest

from studio.config import App, StudioError
from studio.course import SourceRange, Unit
from studio.push import AppClient, create_missing_units, match_unit, needs_app_unit

COURSE = "24d62ed8-362a-454e-94d6-4c20d37c4d17"
APP = App(
    api_url="https://api.example.org",
    origin="https://app.example.org",
    course_id=COURSE,
    email="a@example.org",
)


def unit(unit_id: str, title: str, **fields: Any) -> Unit:
    return Unit(id=unit_id, title=title, sources=[SourceRange(pdf="a", pages="1-2")], **fields)


def row(title: str, **fields: Any) -> dict[str, Any]:
    return {"id": f"id-{title}", "title": title, "is_archived": False} | fields


def client(created: list[dict[str, Any]]) -> AppClient:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST" and request.url.path == f"/courses/{COURSE}/units"
        body = json.loads(request.content)
        created.append(body)
        made = {"id": f"new-{len(created)}", "title": body["title"], "is_archived": False}
        return httpx.Response(201, json=made)

    return AppClient(APP, httpx.MockTransport(handler))


def test_a_unit_is_needed_only_when_no_active_unit_has_its_title() -> None:
    assert needs_app_unit(unit("01", "Uvod"), [])
    assert not needs_app_unit(unit("01", "Uvod"), [row("uvod")])  # case and accents are ignored
    assert needs_app_unit(unit("01", "Uvod"), [row("Uvod", is_archived=True)])
    # A hand-chosen unit or an ambiguous title is reported by match_unit, never "fixed" by creating.
    chosen = unit("01", "Uvod", app_unit="11111111-1111-1111-1111-111111111111")
    assert not needs_app_unit(chosen, [])
    assert not needs_app_unit(unit("01", "Uvod"), [row("Uvod"), row("Uvod", id="other")])


def test_missing_units_are_created_in_course_order_and_then_match() -> None:
    created: list[dict[str, Any]] = []
    units = [
        unit("01", "Uvod"),
        unit("02", "Leksička analiza"),
        unit("03", "Sintaksna analiza (1/3)"),
    ]
    found, made = create_missing_units(client(created), units, [row("Uvod")])
    assert [body["title"] for body in created] == ["Leksička analiza", "Sintaksna analiza (1/3)"]
    assert [u.id for u in made] == ["02", "03"]
    assert [match_unit(u, found) for u in units] == ["id-Uvod", "new-1", "new-2"]


def test_units_sharing_an_app_title_share_one_application_unit() -> None:
    created: list[dict[str, Any]] = []
    units = [
        unit("03", "Sintaksna analiza (1/3)", app_title="Sintaksna analiza"),
        unit("04", "Sintaksna analiza (2/3)", app_title="Sintaksna analiza"),
        unit("05", "Sintaksna analiza (3/3)", app_title="Sintaksna analiza"),
        unit("06", "Semantička analiza"),
    ]
    found, made = create_missing_units(client(created), units, [])
    # One unit for the three parts, named by app_title, created once and before the next topic.
    assert [body["title"] for body in created] == ["Sintaksna analiza", "Semantička analiza"]
    assert [u.id for u in made] == ["03", "06"]
    targets = [match_unit(u, found) for u in units]
    assert targets == ["new-1", "new-1", "new-1", "new-2"]


def test_an_existing_unit_with_the_app_title_is_used_without_creating() -> None:
    created: list[dict[str, Any]] = []
    parts = [
        unit("03", "Analiza (1/2)", app_title="Analiza"),
        unit("04", "Analiza (2/2)", app_title="Analiza"),
    ]
    found, made = create_missing_units(client(created), parts, [row("analiza")])
    assert created == [] and made == []
    assert [match_unit(u, found) for u in parts] == ["id-analiza", "id-analiza"]


def test_nothing_is_created_when_every_unit_exists() -> None:
    created: list[dict[str, Any]] = []
    found, made = create_missing_units(client(created), [unit("01", "Uvod")], [row("Uvod")])
    assert created == [] and made == [] and len(found) == 1


def test_a_refused_creation_stops_with_the_reason() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "Only the course owner can add units"})

    refusing = AppClient(APP, httpx.MockTransport(handler))
    with pytest.raises(StudioError, match="creating a unit failed: HTTP 403 Only the course owner"):
        create_missing_units(refusing, [unit("01", "Uvod")], [])
