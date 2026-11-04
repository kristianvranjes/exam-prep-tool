"""studio.toml: course identity, lecture sources and per-stage AI providers.

API keys never live in this file; a provider names the environment variable that holds
its key. Every AI stage talks to an OpenAI-compatible endpoint, so switching between an
aggregator (OpenRouter) and a vendor API is a configuration change, not a code change.
"""

import tomllib
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

CONFIG_NAME = "studio.toml"
StageName = Literal["generate", "verify"]
QuestionType = Literal[
    "MULTIPLE_CHOICE", "TRUE_FALSE", "MULTIPLE_SELECT", "SHORT_ANSWER", "NUMERIC"
]
QUESTION_TYPES: tuple[QuestionType, ...] = (
    "MULTIPLE_CHOICE",
    "TRUE_FALSE",
    "MULTIPLE_SELECT",
    "SHORT_ANSWER",
    "NUMERIC",
)
TypeCounts = dict[QuestionType, int]
DEFAULT_TYPES: TypeCounts = {
    "MULTIPLE_CHOICE": 12,
    "TRUE_FALSE": 4,
    "MULTIPLE_SELECT": 2,
    "SHORT_ANSWER": 2,
}


class StudioError(Exception):
    """A user-facing error: printed without a traceback."""


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Course(Strict):
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_-]+$")


class Sources(Strict):
    pdfs: list[str] = Field(min_length=1)


class Provider(Strict):
    base_url: str
    api_key_env: str = Field(pattern=r"^[A-Z_][A-Z0-9_]*$")

    @field_validator("base_url")
    @classmethod
    def https_v1(cls, url: str) -> str:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/").split("/")[-1] != "v1"
        ):
            raise ValueError("base_url must be an https URL ending in /v1, without credentials")
        return url.rstrip("/")


class Stage(Strict):
    provider: str
    model: str = Field(pattern=r"^~?[a-z0-9][a-z0-9._-]*/[A-Za-z0-9._:-]+$")
    timeout_seconds: float = Field(default=120, gt=0, le=600)
    max_output_tokens: int = Field(default=4096, ge=64, le=32768)
    # Free and low-cost tiers rate-limit; calls within a stage are spaced at least this far.
    min_interval_seconds: float = Field(default=1.0, ge=0, le=60)

    @property
    def family(self) -> str:
        return self.model.lstrip("~").split("/", 1)[0]


def check_counts(counts: TypeCounts) -> TypeCounts:
    if any(n < 0 or n > 100 for n in counts.values()):
        raise ValueError("question counts must be between 0 and 100")
    if not 1 <= sum(counts.values()) <= 200:
        raise ValueError("a unit needs between 1 and 200 questions in total")
    return {t: n for t, n in counts.items() if n}


class Questions(Strict):
    """The per-unit blueprint and how generation splits a unit into bounded requests."""

    types: TypeCounts = Field(default_factory=lambda: dict(DEFAULT_TYPES))
    # Characters of page text per request; a unit is never sent whole.
    max_input_chars: int = Field(default=12000, ge=2000, le=60000)
    max_questions_per_call: int = Field(default=8, ge=1, le=20)

    @field_validator("types")
    @classmethod
    def valid_counts(cls, counts: TypeCounts) -> TypeCounts:
        return check_counts(counts)


class Checks(Strict):
    # quiz-import JSON files already in the course bank, for duplicate checks.
    existing: list[str] = Field(default_factory=list)


class StudioConfig(Strict):
    course: Course
    sources: Sources
    providers: dict[str, Provider] = Field(min_length=1)
    stages: dict[StageName, Stage]
    questions: Questions = Field(default_factory=Questions)
    checks: Checks = Field(default_factory=Checks)

    @model_validator(mode="after")
    def consistent(self) -> Self:
        for name, stage in self.stages.items():
            if stage.provider not in self.providers:
                raise ValueError(f"stage {name!r} uses unknown provider {stage.provider!r}")
        generate, verify = self.stages.get("generate"), self.stages.get("verify")
        if generate and verify and generate.family == verify.family:
            # Same-family models share blind spots; the verifier would agree with the
            # generator's mistakes more often than an independent model would.
            raise ValueError(
                "generate and verify must use different model families "
                f"(both are {generate.family!r})"
            )
        return self


TEMPLATE = """\
# ExamPrep content studio settings. Keep this folder outside the repository.
# API keys are read from the environment variable named by api_key_env.

[course]
name = {name}
code = {code}

[sources]
# Lecture PDFs, relative to this folder. Glob patterns are allowed.
# Past exams and question lists are not unit sources; they come in later stages.
pdfs = {pdfs}

[providers.openrouter]
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"

# Generator and verifier must be different model families (the vendor prefix).
# Both defaults have zero-data-retention endpoints with structured output on OpenRouter,
# so they keep working when the account enforces ZDR.
[stages.generate]
provider = "openrouter"
model = "deepseek/deepseek-v4-flash"
max_output_tokens = 8192
# ZDR endpoints took 30 to 150 seconds per eight-question request in the first runs.
timeout_seconds = 300

[stages.verify]
provider = "openrouter"
model = "qwen/qwen3.8-27b"

[questions]
# Questions per unit by type; a unit in course.yaml may override this with `questions:`.
types = {{ MULTIPLE_CHOICE = 12, TRUE_FALSE = 4, MULTIPLE_SELECT = 2, SHORT_ANSWER = 2 }}

[checks]
# quiz-import JSON files already in the course bank, checked for duplicate stems.
existing = []
"""


def render_template(name: str, code: str, pdfs: list[str]) -> str:
    return TEMPLATE.format(
        name=_toml_string(name),
        code=_toml_string(code),
        pdfs="[" + ", ".join(_toml_string(p) for p in pdfs) + "]",
    )


def _toml_string(value: str) -> str:
    # Literal strings keep Windows backslashes exactly as typed.
    if "'" not in value and "\n" not in value:
        return f"'{value}'"
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def load_config(studio_dir: Path) -> StudioConfig:
    path = studio_dir / CONFIG_NAME
    if not path.is_file():
        raise StudioError(f"{path} not found; run `studio init {studio_dir}` first")
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise StudioError(f"{path}: {exc}") from None
    try:
        return StudioConfig.model_validate(data)
    except ValueError as exc:
        raise StudioError(f"{path}: {exc}") from None


def ensure_outside_repo(studio_dir: Path) -> None:
    """Refuse a studio folder inside the ExamPrep repository: source PDFs are never committed."""
    resolved = studio_dir.resolve()
    for parent in [resolved, *resolved.parents]:
        if (parent / "tools" / "studio" / "pyproject.toml").is_file():
            raise StudioError(
                f"{studio_dir} is inside the ExamPrep repository ({parent}); "
                "keep course material and studio output outside it"
            )


def resolve_sources(studio_dir: Path, sources: Sources) -> list[Path]:
    found: dict[Path, None] = {}
    for pattern in sources.pdfs:
        candidate = Path(pattern)
        if candidate.is_absolute():
            matches = sorted(candidate.parent.glob(candidate.name))
        else:
            matches = sorted(studio_dir.glob(pattern))
        pdfs = [m.resolve() for m in matches if m.is_file() and m.suffix.lower() == ".pdf"]
        if not pdfs:
            raise StudioError(f"source pattern {pattern!r} matches no PDF files")
        for pdf in pdfs:
            found[pdf] = None
    return list(found)
