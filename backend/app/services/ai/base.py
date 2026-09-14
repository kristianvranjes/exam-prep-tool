from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True)
class Generation:
    """Untrusted provider content and optional measured usage."""

    content: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    routed_provider: str | None = None
    routed_model: str | None = None


class AIProvider(Protocol):
    name: str
    model: str

    def generate_structured(
        self, system_prompt: str, user_prompt: str, response_model: type[T]
    ) -> Generation: ...


class AIError(Exception):
    """Safe categorized error; raw provider errors never leave the adapter."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
