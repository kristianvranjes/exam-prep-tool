# ExamPrep content studio

A local command-line tool that turns a course's lecture PDFs into reviewed ExamPrep
import files. The plan and the decisions behind it are in
[docs/CONTENT_STUDIO.md](../../docs/CONTENT_STUDIO.md). Built so far: **S0** (ingest,
the `course.yaml` proposal, a provider check), **S1** (question generation to a
blueprint and deterministic checks), **S2** (an independent verifier), **S3** (a local
review page) and **S4** (import files and a push into the application). Lessons (S5)
come next.

## Install

```sh
cd tools/studio
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # Windows; on Linux/macOS: .venv/bin/python
```

The studio needs no database and no backend install. It loads only the application's
question schemas, straight from `backend/` of the same checkout, so install it from an
ExamPrep checkout.

## Use

Course material and everything the studio writes stay **outside the repository**, one
folder per course (the studio refuses a folder inside the repository):

```sh
studio init ../../../srs/studio --name "Sigurnost računalnih sustava" --code SRS --pdfs "../pdfpreze/*.pdf"
studio ingest ../../../srs/studio      # page text + course.proposed.yaml
studio ocr ../../../srs/studio         # re-read scanned or damaged pages with Tesseract
studio status ../../../srs/studio      # sources, units, problems
studio providers ../../../srs/studio   # one tiny request per AI stage
studio generate ../../../srs/studio --dry-run   # requests and input size, nothing sent
studio generate ../../../srs/studio --unit 03   # questions for one unit (all by default)
studio rewrite ../../../srs/studio     # remove mentions of slides/sources from older questions
studio verify ../../../srs/studio      # blind answers from the verifier model
studio check ../../../srs/studio       # deterministic checks, plus verifier flags
studio calibrate ../../../srs/studio   # seeded wrong keys the verifier would catch
studio review ../../../srs/studio      # local page: accept, edit or reject each question
studio publish ../../../srs/studio     # accepted questions as quiz-import-v2 files in out/
studio push ../../../srs/studio --dry-run    # what would be imported, nothing sent
studio push ../../../srs/studio --approve    # import new accepted questions and approve them
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
| `build/units/<id>/questions.json` | `generate` | `studio-questions-v1`: windows (pages, requested counts, outcome) and questions, each with its `content` in the application's `quiz-import-v2` shape, its `source` (`pdf`, `page`, `quote`) and `schema_error` |
| `build/units/<id>/verify.json` | `verify` | `studio-verify-v1`: request batches and, per question, the verifier's answer, whether it matches the key, confidence, a named problem and its reason; the hash of the `questions.json` it verified |
| `build/units/<id>/review.json` | `review` | `studio-review-v1`: per question id the owner's decision (`accept`, `edit` with the edited content, `reject` with an optional note), whether it was a bulk acceptance, when, and the hash of the generated content it was made on |
| `out/<id>-<title>.quiz-import-v2.json` | `publish` | The unit's accepted questions (edited ones as edited) in the application's import format, validated with its `QuizImport` |
| `out/manifest.json` | `publish` | `studio-publish-v1`: per unit the file, its SHA-256, counts of accepted, rejected and undecided questions, and per question the studio id, decision and cited PDF page (the import format has no room for provenance) |
| `out/pushed-<course id>.json` | `push` | `studio-push-v1`: every pushed question by studio id, a hash of its final content and its id in the application, per push with the target unit and how many were approved |
| `build/units/<id>/checks.json` | `check` | `studio-checks-v1`: flags per question and per unit, a summary, and the hash of the `questions.json` it checked |
| `build/calls.jsonl` | AI stages | One line per call: stage, subject (unit and window), provider, model, routed model/provider, prompt version, outcome code, latency, token counts, cost. Never the key or prompt text |

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

## Reading scanned and damaged PDFs (OCR)

`studio ocr` reads pages again with [Tesseract](https://github.com/tesseract-ocr/tesseract)
in Croatian and English and `studio ingest` then uses that text instead of the PDF's own
text layer. By default it reads the pages ingest flagged (no text, or OCR damage such as
`■` for č/ć/đ); `--all-pages` reads every page, `--pdf` limits it to some PDFs, and
`--jobs` sets how many pages are read in parallel. Page numbers never change and the
PDF is not modified; the text is cached in `build/ocr/` per PDF hash, language and DPI.

On PPJ's 1061-page lecture collection this took about ten minutes and left no page with
OCR damage (783 before); diacritics come back, while code slides and diagrams stay
imperfect.

Setup on Windows: `winget install UB-Mannheim.TesseractOCR`, then put `hrv.traineddata`
from [tessdata](https://github.com/tesseract-ocr/tessdata) next to a copy of
`eng.traineddata` and `osd.traineddata` in `%LOCALAPPDATA%\examprep-studio\tessdata`
(or point `STUDIO_TESSDATA` at a folder with them; `STUDIO_TESSERACT` overrides the
program path).

## Generating questions

The blueprint is `[questions]` in `studio.toml`. `types` gives the mix (12 multiple
choice, 4 true/false, 2 multiple select, 2 short answer by default). With
`questions_per_page` (0.3 in new configurations) a unit gets that many questions per
slide page with text, at least `min_per_unit` (10) and at most `max_per_unit` (150), in
that mix: a 25-slide deck gets 10, a 182-slide deck 55. Without it, `types` are exact
counts per unit. A unit in `course.yaml` may set its own exact counts with
`questions:`. More questions cost little to generate; the limit is review time.
A unit's pages with text are split into windows of
consecutive pages, at most `max_input_chars` (12000) characters and roughly
`max_questions_per_call` (8) questions each, and the blueprint is shared out across
windows in proportion to their text. Each request sees only its window, with pages
labelled P1, P2, … that the studio maps back to PDF and page.

Each question is validated with the application's own schemas, loaded from
`backend/app/schemas/question.py` in this checkout, so a question the studio accepts is
one the application imports. Options are reordered deterministically (seeded by the
question id): models put the key first far more often than chance, and the application
shows options in stored order.

Students see a question in the app, never the slides, so no stem, option,
explanation or reference answer may say where a fact comes from ("Prema izvoru, …",
"Izvor navodi da …", "na slajdu", "s predavanja", "(S3)"). The prompt forbids it;
after each window the studio removes such lead-ins and asides where the sentence stays
whole ("Prema izvoru, AES …" becomes "AES …"), and sends what remains back to the
generator model, which rephrases only the flagged fields. The reply never contains the
type, the options' correctness, the true/false answer or numeric values, so the key
cannot change; a rewrite that still cites a source or fails the schema is dropped.
`studio rewrite` does the same for questions generated before this (`--dry-run` only
reports). Rewritten units need `studio verify` again. "Izvor" alone is not flagged,
since it is an ordinary word in these courses ("izvor prijetnje", "IP adresa izvora",
"izvorni program").

A unit is sent again only when its pages, blueprint, model or prompt version change
(`--force` regenerates anyway). If some windows fail (rate limit, timeout), a rerun
requests only those.

## Verifying

`studio verify` sends each valid question to the verifier model (a different family from
the generator) **without its key**, with the text of the one page it cites, at most
`[verification] questions_per_call` (6) questions per request. The verifier answers as a
student who has only that page would, says when the page does not settle the answer,
and may name a problem (two defensible answers, an ambiguous stem, a contradiction with
the page, a flattened exponent). The studio compares its answer with the key
deterministically; numbers go through the application's own parser and tolerance rule.
Short answers are the exception: the verifier sees the reference answer and judges
whether the page supports it.

As with generation, unchanged units are not resent and a rerun repeats only failed
batches; a batch where the verifier skipped a question counts as failed. Run
`studio check` afterwards to merge the verifier's findings into `checks.json`.

`studio calibrate` reports, without any request, how many deliberately wrong keys the
verifier would have caught: for each objective question it derives a wrong key (true
and false swapped, another option for multiple choice, one option flipped for multiple
select) and counts it caught unless the verifier's blind answer equals exactly that
wrong key with no named problem. This is only valid because the verifier never sees
objective keys. Agreement between two models is still not proof: review stays the gate.

## Reviewing

`studio review` starts a local server on 127.0.0.1 (any free port, or `--port`) and opens
the page in the browser (`--no-browser` only prints the address). Per unit it lists the
questions with flagged ones first; for each it shows the stem, options with the key
marked in words, the explanation, every flag, the verifier's blind answer and reason,
and the cited page with the quote highlighted.

Keys: `j`/`k` next/previous, `a` accept, `r` reject (with the optional note typed in the
note field), `e` edit, `u` undo the decision, `Esc` leave the editor. An edit is checked
with the application's import schema and keeps the question type; saving it accepts the
edited version. A question that fails the import schema can only be accepted by editing.

Decisions are saved at once to `review.json` and are tied to a hash of the generated
content: if a unit is regenerated, a decision never carries over to different text.
A damaged `review.json` stops the studio instead of being replaced.

Unflagged questions are sampled. After at least a fifth of them (minimum three) have
been reviewed one by one with none rejected, "accept the remaining unflagged" accepts
the rest, marked as bulk decisions. A rejection in the sample means the checks miss a
problem in this unit, so bulk acceptance stays off and each question needs a look.

The server only answers on 127.0.0.1, checks the Host header (against DNS rebinding),
requires the random token from the printed address on every API call and sends a
strict Content-Security-Policy. The page loads nothing from the internet and inserts
generated text only as text, never as HTML.

## Speed

Requests to ZDR endpoints take 30 seconds to several minutes, so a stage can handle
several units at once: `parallel = 4` under `[stages.generate]` or `[stages.verify]`
(requests within a unit stay in order). `ignore_providers = ["Crusoe"]` makes OpenRouter
skip a provider; on 4 November Crusoe wrote up to 16 000 tokens for eight questions where
others wrote about 2 500, and was truncated. Progress lines appear as each unit
finishes.

## Publishing and pushing

`studio publish` writes one import file per unit with the accepted questions only, and
refuses to write anything if a unit's file would fail the application's import schema
(for example two accepted questions with the same stem). A unit with nothing accepted
loses its earlier file. The files can be imported by hand in the question bank, one
unit at a time.

`studio push` does the import through the application's API instead. It needs an
`[app]` table in `studio.toml` (API address, the frontend origin the API trusts,
course id, owner email); the password is read from `EXAMPREP_PASSWORD` (or the variable
named by `password_env`) or typed when asked, and never stored. Per unit it imports only
accepted questions not pushed before, so pushing again after reviewing more questions
never duplicates the bank. Each unit is linked to the application's course unit named in
`app_unit` in `course.yaml`, or else to the one active unit with the same title
(ignoring case, diacritics and punctuation); otherwise the push stops before importing
anything and lists the units to choose from. With `--approve`, the imported questions
are approved in batches of 50, which works for an owner who is also a faculty
moderator; anyone else gets drafts and a note. API addresses must be https, except on
localhost.

Imported questions get the application's `USER` source and no source links, as for any
quiz import; the cited pages stay in `out/manifest.json`.

## Checks

`studio check` flags, it never fixes. `error` means the question cannot be imported as
it is, `warn` needs a careful look in review, `info` is a hint.

| Check | Severity |
| --- | --- |
| Fails the application's import schema | error |
| Cites a label that was not in its window | error |
| Quote not found on the cited page (fuzzy: case, diacritics, OCR `■`, LaTeX commands and `...` joins are tolerated) / found only partly / too short | warn / info / warn |
| Same or nearly the same stem as another question of the course or of the existing bank (`[checks] existing`) | warn |
| Stem, option, explanation or reference answer mentions the source, slides or lecture, which students never see (`studio rewrite` fixes it) | error |
| Explanation names an option by letter or position, which shuffling breaks | warn |
| "All/none of the above" option; two options nearly identical | warn |
| Negated stem; key clearly the longest option; no explanation | info |
| Verifier answered differently from the key; found the question not answerable from its page; named a problem | warn |
| Verifier agreed with low confidence | info |
| Unit: failed or uncovered window | error / warn |
| Unit: a verifier batch failed | warn |
| Unit: fewer questions of a type than the blueprint; true/false share outside 30–70 %; the key in one position for over half the multiple-choice items; the key the longest in 40 % or more; one difficulty for all | warn |

Checks cannot see wrong facts that the page text itself carries. PDF text extraction
loses superscripts, so "2^40" on a slide reads "240" and a question built on it is
wrong although its quote matches. The verifier prompt warns about flattened exponents;
the reviewer remains the last line.

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
