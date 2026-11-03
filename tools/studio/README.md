# ExamPrep content studio

A local command-line tool that turns a course's lecture PDFs into reviewed ExamPrep
import files. The plan and the decisions behind it are in
[docs/CONTENT_STUDIO.md](../../docs/CONTENT_STUDIO.md). This is **S0**: ingest, the
`course.yaml` proposal and a provider check. Question generation (S1) comes next.

## Install

```sh
cd tools/studio
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # Windows; on Linux/macOS: .venv/bin/python
```

The studio does not import the application and needs no database.

## Use

Course material and everything the studio writes stay **outside the repository**, one
folder per course (the studio refuses a folder inside the repository):

```sh
studio init ../../../srs/studio --name "Sigurnost računalnih sustava" --code SRS --pdfs "../pdfpreze/*.pdf"
studio ingest ../../../srs/studio      # page text + course.proposed.yaml
studio status ../../../srs/studio      # sources, units, problems
studio providers ../../../srs/studio   # one tiny request per AI stage
```

`ingest` rereads only PDFs whose bytes changed (`--force` rereads all). After it, check
`course.proposed.yaml` (titles, page ranges, `exam_cycles`) and save it as
`course.yaml`. The studio never writes `course.yaml`; later stages read only that file.

## Files in a course folder

| File | Written by | Content |
| --- | --- | --- |
| `studio.toml` | `init`, then you | Course, source PDF globs, providers and per-stage models |
| `build/pages/<slug>.json` | `ingest` | `studio-pages-v1`: per page the raw `text`, the `body` without repeated header/footer lines, and `flags` (`no_text`, `ocr_noise`); the PDF outline; the SHA-256 of the PDF |
| `course.proposed.yaml` | `ingest` | `studio-course-v1` proposal with warnings in its header |
| `course.yaml` | you | The confirmed units (`id`, `title`, `sources: [{pdf, pages}]`) and `exam_cycles` |
| `build/calls.jsonl` | AI stages | One line per call: stage, provider, model, routed model/provider, prompt version, outcome code, latency, token counts, cost. Never the key or prompt text |

### How units are proposed

Per PDF, in natural filename order: a PDF with a real outline gets one unit per
top-level entry ("Slide N" bookmarks that slide software generates do not count); any
other PDF with text becomes one unit titled from its filename; a PDF without
extractable text (a scan) is left out with a warning, since the studio has no OCR. A
single-PDF course without an outline (PPJ's 1061-page lecture collection) becomes one
unit with a warning to split it by page range.

Only the first and last two lines of a page can count as header or footer lines (when
they appear on at least 60 % of the pages with text, with numbers ignored). This
removes "Laboratorij za … Sigurnost računalnih sustava" and "12/62" without touching
content lines like "Korak 1".

## Providers

Every AI stage uses an OpenAI-compatible `/v1/chat/completions` endpoint with strict
`json_schema` output, temperature 0, no proxies, no redirects and no automatic retries.
On OpenRouter it also sends `provider.require_parameters`, so a request is not routed to
an endpoint that ignores the schema. The key comes from the environment variable named
by `api_key_env` (`OPENROUTER_API_KEY` by default).

Generator and verifier must be different model families (the vendor prefix of the model
id); the configuration is rejected otherwise. Defaults: `deepseek/deepseek-v4-flash`
generates, `qwen/qwen3.8-27b` verifies. Both have zero-data-retention (ZDR) endpoints
with structured output, which matters when the OpenRouter account enforces ZDR. Such an
account rejects a model without ZDR endpoints with `NO_COMPATIBLE_ENDPOINT`;
`https://openrouter.ai/api/v1/endpoints/zdr` lists the eligible ones.

## Checks

```sh
ruff format --check . && ruff check . && mypy studio && pytest
```

Tests build small PDFs in memory and mock HTTP; they never call a provider. CI runs the
same commands in the `studio` job.
