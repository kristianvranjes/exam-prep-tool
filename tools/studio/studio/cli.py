"""`studio` command line: init, ingest, status and providers."""

import argparse
import sys
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from studio.config import (
    CONFIG_NAME,
    StudioConfig,
    StudioError,
    ensure_outside_repo,
    load_config,
    render_template,
    resolve_sources,
)
from studio.course import COURSE_NAME, PROPOSAL_NAME, check_pages, dump_course, load_course
from studio.ingest import PdfPages, ingest_all, load_all_pages, sha256_file
from studio.llm import ChatClient, LLMError, calls_log
from studio.proposal import proposal_header, propose

PING_VERSION = "ping-v1"
PING_SYSTEM = "You answer with JSON that matches the given schema and nothing else."
PING_USER = (
    "Set ready to true. Set language to the ISO 639-1 code of the language of this "
    "sentence: 'Pripremam ispit iz kriptografije.'"
)


class Ping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    language: str


def cmd_init(args: argparse.Namespace) -> int:
    studio_dir: Path = args.dir
    ensure_outside_repo(studio_dir)
    target = studio_dir / CONFIG_NAME
    if target.exists():
        raise StudioError(f"{target} already exists; edit it instead")
    studio_dir.mkdir(parents=True, exist_ok=True)
    target.write_text(render_template(args.name, args.code, args.pdfs), encoding="utf-8")
    config = load_config(studio_dir)  # the written template must load
    sources = resolve_sources(studio_dir, config.sources)
    print(f"wrote {target} ({len(sources)} source PDFs)")
    print(f"next: studio ingest {studio_dir}")
    return 0


def describe(doc: PdfPages) -> str:
    parts = [f"{doc.page_count} pages"]
    if n := doc.count("no_text"):
        parts.append(f"{n} without text")
    if n := doc.count("ocr_noise"):
        parts.append(f"{n} with OCR damage")
    if doc.repeated_lines:
        parts.append(f"{len(doc.repeated_lines)} repeated header/footer lines removed")
    return ", ".join(parts)


def cmd_ingest(args: argparse.Namespace) -> int:
    studio_dir: Path = args.dir
    ensure_outside_repo(studio_dir)
    config = load_config(studio_dir)
    results = ingest_all(resolve_sources(studio_dir, config.sources), studio_dir, force=args.force)
    for result in results:
        state = "unchanged" if result.skipped else "ingested"
        print(f"{state:9}  {result.doc.slug}: {describe(result.doc)}")

    docs = [r.doc for r in results]
    course, warnings = propose(config, docs)
    proposal = studio_dir / PROPOSAL_NAME
    proposal.write_text(
        dump_course(course, proposal_header(warnings, date.today())), encoding="utf-8"
    )
    print(f"\nwrote {proposal}: {len(course.units)} proposed units")
    for warning in warnings:
        print(f"  warning: {warning}")

    confirmed = load_course(studio_dir)
    if confirmed is None:
        print(f"next: review the proposal and save it as {studio_dir / COURSE_NAME}")
        return 0
    problems = check_pages(confirmed, {d.slug: d for d in docs})
    for problem in problems:
        print(f"  {COURSE_NAME}: {problem}")
    return 1 if problems else 0


def cmd_status(args: argparse.Namespace) -> int:
    studio_dir: Path = args.dir
    config = load_config(studio_dir)
    print(f"{config.course.code}: {config.course.name}")
    for name, stage in sorted(config.stages.items()):
        print(f"  {name}: {stage.model} via {stage.provider}")

    ingested = load_all_pages(studio_dir)
    by_path = {(studio_dir / d.source).resolve(): d for d in ingested.values()}
    print("\nsources:")
    stale = 0
    for pdf in resolve_sources(studio_dir, config.sources):
        doc = by_path.get(pdf)
        if doc is None:
            state, stale = "not ingested", stale + 1
        elif doc.sha256 != sha256_file(pdf):
            state, stale = "changed since ingest", stale + 1
        else:
            state = describe(doc)
        print(f"  {pdf.name}: {state}")

    course = load_course(studio_dir)
    if course is None:
        hint = f" ({PROPOSAL_NAME} exists)" if (studio_dir / PROPOSAL_NAME).is_file() else ""
        print(f"\n{COURSE_NAME}: not confirmed yet{hint}")
        return 1
    print(f"\n{COURSE_NAME}: {len(course.units)} units, {len(course.exam_cycles)} exam cycles")
    for unit in course.units:
        pages = sum(s.bounds[1] - s.bounds[0] + 1 for s in unit.sources)
        print(f"  {unit.id} {unit.title} ({pages} pages)")
    for cycle in course.exam_cycles:
        print(f"  {cycle.name}: units {', '.join(cycle.units)}")
    problems = check_pages(course, ingested)
    for problem in problems:
        print(f"  problem: {problem}")
    return 1 if problems or stale else 0


def ping_stage(config: StudioConfig, studio_dir: Path, name: Literal["generate", "verify"]) -> bool:
    stage = config.stages[name]
    client = ChatClient(
        stage_name=name,
        provider_name=stage.provider,
        provider=config.providers[stage.provider],
        stage=stage,
        log_path=calls_log(studio_dir),
    )
    try:
        reply = client.complete_json(
            system=PING_SYSTEM, user=PING_USER, response_model=Ping, prompt_version=PING_VERSION
        )
    except LLMError as exc:
        print(f"  {name}: FAILED {stage.model}: {exc}")
        return False
    ok = reply.ready and reply.language.strip().lower() == "hr"
    verdict = "ok" if ok else "UNEXPECTED ANSWER"
    print(f"  {name}: {verdict} {stage.model} (language={reply.language!r})")
    return ok


def cmd_providers(args: argparse.Namespace) -> int:
    studio_dir: Path = args.dir
    config = load_config(studio_dir)
    names: list[Literal["generate", "verify"]] = (
        [args.stage] if args.stage else sorted(config.stages)
    )
    missing = [n for n in names if n not in config.stages]
    if missing:
        raise StudioError(f"stage not configured: {', '.join(missing)}")
    print(f"checking {len(names)} stage(s); call records go to {calls_log(studio_dir)}")
    results = [ping_stage(config, studio_dir, name) for name in names]
    return 0 if all(results) else 1


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="studio", description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="create studio.toml in a course studio folder")
    init.add_argument("dir", type=Path)
    init.add_argument("--name", required=True, help="course name")
    init.add_argument("--code", required=True, help="short course code, for example SRS")
    init.add_argument(
        "--pdfs", nargs="+", required=True, help="lecture PDFs or globs, relative to dir"
    )
    init.set_defaults(run=cmd_init)

    ingest = commands.add_parser("ingest", help="extract page text and propose course.yaml")
    ingest.add_argument("dir", type=Path)
    ingest.add_argument("--force", action="store_true", help="re-read unchanged PDFs")
    ingest.set_defaults(run=cmd_ingest)

    status = commands.add_parser("status", help="show sources, units and problems")
    status.add_argument("dir", type=Path)
    status.set_defaults(run=cmd_status)

    providers = commands.add_parser("providers", help="send one tiny request per AI stage")
    providers.add_argument("dir", type=Path)
    providers.add_argument("--stage", choices=["generate", "verify"])
    providers.set_defaults(run=cmd_providers)
    return root


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:  # Windows consoles default to a legacy code page
            reconfigure(encoding="utf-8", errors="replace")
    args = parser().parse_args(argv)
    try:
        code: int = args.run(args)
        return code
    except StudioError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
