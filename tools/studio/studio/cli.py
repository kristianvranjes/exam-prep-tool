"""`studio` command line: init, ingest, status, providers, generate and check."""

import argparse
import hashlib
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from studio.checks import check_course, load_checks
from studio.config import (
    CONFIG_NAME,
    StudioConfig,
    StudioError,
    ensure_outside_repo,
    load_config,
    render_template,
    resolve_sources,
)
from studio.course import (
    COURSE_NAME,
    PROPOSAL_NAME,
    CourseFile,
    Unit,
    check_pages,
    dump_course,
    load_course,
)
from studio.generate import (
    generate_unit,
    load_questions,
    plan_windows,
    questions_path,
    unit_counts,
    unit_pages,
)
from studio.ingest import PdfPages, ingest_all, load_all_pages, sha256_file
from studio.llm import ChatClient, LLMError, calls_log
from studio.prompts import QUESTIONS_SYSTEM
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
        print(f"  {unit.id} {unit.title} ({pages} pages){question_state(studio_dir, unit.id)}")
    for cycle in course.exam_cycles:
        print(f"  {cycle.name}: units {', '.join(cycle.units)}")
    problems = check_pages(course, ingested)
    for problem in problems:
        print(f"  problem: {problem}")
    return 1 if problems or stale else 0


def question_state(studio_dir: Path, unit_id: str) -> str:
    questions = load_questions(studio_dir, unit_id)
    if questions is None:
        return ""
    state = f": {len(questions.questions)} questions"
    if not questions.complete:
        state += ", some windows failed"
    checks = load_checks(studio_dir, unit_id)
    path = questions_path(studio_dir, unit_id)
    if checks is None or checks.questions_hash != hashlib.sha256(path.read_bytes()).hexdigest():
        return state + ", not checked"
    s = checks.summary
    return state + f", {s['error']} errors, {s['warn']} warnings"


def stage_client(
    config: StudioConfig, studio_dir: Path, name: Literal["generate", "verify"]
) -> ChatClient:
    stage = config.stages.get(name)
    if stage is None:
        raise StudioError(f"stage not configured in {CONFIG_NAME}: [stages.{name}]")
    return ChatClient(
        stage_name=name,
        provider_name=stage.provider,
        provider=config.providers[stage.provider],
        stage=stage,
        log_path=calls_log(studio_dir),
    )


def confirmed_course(studio_dir: Path) -> CourseFile:
    course = load_course(studio_dir)
    if course is None:
        raise StudioError(f"{studio_dir / COURSE_NAME} not found; confirm {PROPOSAL_NAME} first")
    return course


def selected_units(course: CourseFile, ids: list[str] | None) -> list[Unit]:
    if not ids:
        return course.units
    known = {u.id: u for u in course.units}
    missing = [i for i in ids if i not in known]
    if missing:
        raise StudioError(f"unknown unit ids: {', '.join(missing)}")
    return [known[i] for i in ids]


def ready_pages(course: CourseFile, studio_dir: Path) -> dict[str, PdfPages]:
    docs = load_all_pages(studio_dir)
    problems = check_pages(course, docs)
    if problems:
        raise StudioError(f"{COURSE_NAME} does not match the ingested PDFs: {problems[0]}")
    return docs


def cmd_generate(args: argparse.Namespace) -> int:
    studio_dir: Path = args.dir
    config = load_config(studio_dir)
    course = confirmed_course(studio_dir)
    docs = ready_pages(course, studio_dir)
    units = selected_units(course, args.unit)
    blueprint = config.questions

    if args.dry_run:
        total_chars = total_calls = 0
        for unit in units:
            counts = unit_counts(unit, blueprint)
            windows = plan_windows(
                unit_pages(unit, docs, blueprint.max_input_chars), counts, blueprint
            )
            chars = sum(w.chars for w in windows)
            calls = sum(1 for w in windows if w.counts)
            total_chars, total_calls = total_chars + chars, total_calls + calls
            print(
                f"{unit.id} {unit.title}: {sum(counts.values())} questions in {calls} requests, "
                f"{chars} characters of page text"
            )
        tokens = (total_chars + total_calls * len(QUESTIONS_SYSTEM)) / 3.5
        print(f"\n{total_calls} requests, roughly {tokens:,.0f} input tokens; nothing was sent")
        return 0

    client = stage_client(config, studio_dir, "generate")
    failed = 0
    for unit in units:
        result = generate_unit(
            course_name=config.course.name,
            unit=unit,
            docs=docs,
            blueprint=blueprint,
            client=client,
            studio_dir=studio_dir,
            force=args.force,
        )
        made = result.questions
        invalid = sum(1 for q in made.questions if q.schema_error)
        line = f"{result.state:9}  {unit.id} {unit.title}: {len(made.questions)} questions"
        if invalid:
            line += f", {invalid} fail the import schema"
        if result.calls:
            line += f" ({result.calls} requests)"
        print(line)
        for window in made.windows:
            if window.error:
                failed += 1
                print(f"  window {window.index}: {window.error}; rerun to retry only this window")
    print(f"\nnext: studio check {studio_dir}")
    return 1 if failed else 0


def cmd_check(args: argparse.Namespace) -> int:
    studio_dir: Path = args.dir
    config = load_config(studio_dir)
    course = confirmed_course(studio_dir)
    results = check_course(config, course, ready_pages(course, studio_dir), studio_dir)
    if not results:
        raise StudioError(f"no generated questions yet; run `studio generate {studio_dir}`")
    errors = 0
    for result in results:
        s = result.summary
        errors += s["error"]
        codes = Counter(f.code for q in result.questions for f in q.flags)
        codes.update(f.code for f in result.unit_flags)
        listed = ", ".join(f"{code} {n}" for code, n in codes.most_common())
        print(
            f"{result.unit}: {s['questions']} questions, {s['error']} errors, {s['warn']} warnings,"
            f" {s['info']} hints; {s['cited_pages']} of {s['pages']} pages cited"
        )
        if listed:
            print(f"  {listed}")
        for unit_flag in result.unit_flags:
            print(f"  {unit_flag.severity}: {unit_flag.code} {unit_flag.detail}")
    return 1 if errors else 0


def ping_stage(config: StudioConfig, studio_dir: Path, name: Literal["generate", "verify"]) -> bool:
    stage = config.stages[name]
    client = stage_client(config, studio_dir, name)
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

    generate = commands.add_parser("generate", help="generate questions per unit (stage 3)")
    generate.add_argument("dir", type=Path)
    generate.add_argument("--unit", action="append", help="unit id; repeat for several")
    generate.add_argument("--force", action="store_true", help="regenerate unchanged units")
    generate.add_argument(
        "--dry-run", action="store_true", help="show the requests without sending them"
    )
    generate.set_defaults(run=cmd_generate)

    check = commands.add_parser("check", help="deterministic checks on questions (stage 4)")
    check.add_argument("dir", type=Path)
    check.set_defaults(run=cmd_check)
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
