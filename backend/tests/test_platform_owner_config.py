import pytest
from pydantic import ValidationError

from app.config import Settings

FIRST = "6f1c1b2e-6f0a-4a43-9d57-0c5d1f3a1111"
SECOND = "0a8d1c7e-3b0e-4c5f-8a71-2f4e6b7c2222"


def settings(**values: str) -> Settings:
    return Settings(_env_file=None, **values)


def test_nobody_runs_the_platform_by_default():
    assert settings().platform_owner_ids == frozenset()


def test_platform_owner_ids_are_parsed_from_a_comma_separated_list():
    parsed = settings(platform_owner_user_ids=f" {FIRST} , {SECOND},").platform_owner_ids
    assert {str(id_) for id_ in parsed} == {FIRST, SECOND}


def test_a_malformed_platform_owner_id_fails_startup():
    with pytest.raises(ValidationError):
        settings(platform_owner_user_ids="kv@example.com")
