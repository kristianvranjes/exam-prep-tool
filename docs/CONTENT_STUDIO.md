# Content Studio: lessons, quizzes and exams from course PDFs

**Status:** S0 implemented in [`tools/studio/`](../tools/studio/README.md) (ingest, the
`course.yaml` proposal, provider check); S1 onwards are proposals. Written 3 November
2026; decisions below are the project owner's from the same day. Nothing here changes
the application before the 16 November feature freeze.

## 1. Problem

Turning a course's lecture PDFs into practice content is the slowest part of running
ExamPrep. For PPJ (469 questions, October 2026) the cost was:

1. **Writing.** 283 new questions were written conversationally into Python generator
   files, one unit at a time.
2. **Setup.** Twelve units and three exam cycles were created by hand, then twelve
   files were imported one by one (each import can target one unit through `unit_ids`).
3. **Checking.** The only automatic check is the import schema. Whether an answer key is
   right is checked by a person, question by question; two wrong keys from the Anki deck
   (#146, #157) were caught only by careful reading.

Most of the time goes into steps 2 and 3, not into generating text. A faster generator
alone would mostly produce more unchecked questions.

## 2. Decisions (3 November 2026)

| Topic | Decision |
| --- | --- |
| Where generation runs | A standalone local tool, outside the application. The app keeps importing reviewed JSON |
| AI engine | Two inexpensive agents: a **generator** and an independent **verifier** on a different model family (for example DeepSeek and Qwen), through OpenAI-compatible APIs. Claude Code is the fallback for units with many flags |
| Approval | The project owner approves alone for now. This already works: an owner who is also a faculty moderator may approve their own question straight from DRAFT (`check_transition` in `services/questions/service.py`), and bulk transitions exist since #86. No authorization change is needed; the pilot course's owner account must hold the faculty moderator role |
| Lessons | One lesson per course unit |
| Pilot | PPJ rebuilt from scratch, Sigurnost računalnih sustava (SRS) or Arhitektura računala |

**Pilot recommendation.** Rebuild PPJ first as a calibration run. Its 469 hand-checked
questions are a reference set: the studio's output can be measured against them for
coverage, duplicates and, most usefully, how many seeded wrong keys the verifier
catches. Then run SRS for real; its ten lecture decks, question lists and practice
papers are already in the local workspace. Arhitektura računala follows once its
materials are collected.

## 3. Shape of the tool

- **Code** lives in this repository under `tools/studio/`, so it can import the
  application's Pydantic import schemas and CI keeps the two formats from drifting.
- **Content** (PDFs, intermediate files, outputs) lives outside the repository, per
  course, for example `faks/srs/studio/`. Source material is never committed.
- It is a Python CLI with plain files between stages. Every stage can be rerun alone,
  and a stage skips units whose inputs have not changed (content hash).

```text
faks/<course>/studio/
  course.yaml               # units, page ranges, exam cycles; confirmed by the owner
  studio.toml               # providers and per-stage settings (API keys come from env)
  build/pages/<pdf>.json    # extracted text per page
  build/units/<nn>/
    lesson.md               # stage 2
    questions.json          # stage 3, with per-question source citations
    checks.json             # stage 4
    verify.json             # stage 5
    review.json             # stage 6, the owner's decisions
  out/                      # import files (today) or one course pack (later)
```

## 4. Pipeline

| # | Stage | Runs on | Output |
| --- | --- | --- | --- |
| 1 | **Ingest** | code | Page-level text per PDF (page numbers are needed for citations). A proposed `course.yaml` from PDF bookmarks and headings, mapping page ranges to units, which the owner confirms once |
| 2 | **Lesson** | generator | Short lesson per unit: key concepts, definitions, one worked example, common traps, a five-point summary. Statements carry page references `[p. N]` |
| 3 | **Questions** | generator | Questions to a per-unit blueprint (count, type mix, difficulty spread). Each carries `source: {pdf, page, quote}` and the lesson section it belongs to |
| 4 | **Checks** | code | See below. Produces flags, never silent fixes |
| 5 | **Verify** | verifier | Answers each question without its key, from the cited pages only. Disagreement with the key, or "not answerable from the source", becomes a flag |
| 6 | **Review** | owner | A local HTML page: question, key and source quote side by side, flagged items first, keyboard accept / reject / edit. Flagged items get careful review; the rest are sampled |
| 7 | **Publish** | code | Accepted items only, as today's `quiz-import-v2` files per unit (no app change needed), later as one course pack. Optional `studio push` uploads through the existing API |

### Deterministic checks (stage 4)

- The application's own import schema, per question.
- Duplicate stems: normalized-exact and near-duplicate, within the unit, across units
  and against questions already in the course bank.
- **Grounding:** the cited quote must appear (fuzzy match) on the cited page. This is
  the cheapest defence against invented content.
- Distractor quality: the correct option is the longest one too often, "all of the
  above" or "none of the above", options that differ only in punctuation, negated stems.
- Balance: share of TRUE in true/false items, position of the correct option, difficulty
  distribution against the blueprint.
- Coverage: every lesson section and page range has at least the blueprint's minimum.

### Agents and providers

- Each AI stage is a prompt file plus a bounded input (only that unit's pages and its
  lesson, never the whole document again), returning JSON validated with Pydantic.
  This keeps the tool provider-independent, as AGENTS.md requires.
- Providers are configured per stage in `studio.toml` as OpenAI-compatible endpoints
  (the same transport as the app's `openai_compatible` adapter): an aggregator such as
  OpenRouter, or a vendor API (DeepSeek, Qwen on Alibaba Cloud, Kimi). The generator
  and verifier must be different model families, so their mistakes are less correlated.
- Free and low-cost tiers come with request limits, changing availability and data
  terms that may allow training on prompts. Stages are therefore resumable and cached,
  calls are paced, and only material the course staff permits may be sent.
- Every call records provider, model, prompt version and token counts in the unit's
  build folder, mirroring the app's `AIJob` audit idea.
- Agreement between two models is not proof of correctness. The owner's review stays
  the gate, as for every imported question.

## 5. Exams

- **Mock papers:** assembled from approved questions with the exam cycle's blueprint
  (MI covers units 1–7 for PPJ), using the same item counts, points and wrong-answer
  penalty as the real paper.
- **Past papers:** transcription of past midterms and exam terms into questions plus a
  paper definition (order, points, penalty) as described in [past exams](PAST_EXAMS.md).
  This is probably the most valuable content, but only for papers the course staff
  published. Papers reference approved bank questions, so the questions are imported and
  approved first.

## 6. Lessons in the application

Planned after the winter midterms; this needs a migration and new UI.

- **Model:** `lessons` with course, unit, title, Markdown body, status
  (DRAFT / PUBLISHED) and version. Course managers (owner and faculty moderators)
  publish directly, as with past papers.
- **Rendering:** a safe Markdown subset (headings, lists, tables, code, KaTeX formulas,
  "watch out" callouts), no raw HTML. Diagrams start as tables or text; images or
  diagram syntax come later if needed.
- **Study flow:** unit → lesson → two or three checks with immediate feedback after
  each section (reusing tutor practice) → "Practice this unit". "Mark as read" feeds unit
  progress. A mistake links to the lesson section its question belongs to.
- **Content rule:** lessons are short summaries in our own words with page references,
  not copies of slides.
- **Phases:** L1 read-only lessons, import and read state; L2 in-lesson checks and links
  from mistakes; L3 editing and correction suggestions in the app.

## 7. Application changes and timing

| When | Change |
| --- | --- |
| Now (no app change) | Studio stages 1, 3–7 for questions; publish as per-unit `quiz-import-v2` files with `unit_ids`, approve in bulk |
| After the winter midterms | `course-pack-v1` import: units, exam cycles, questions and section links in one upload |
| Then | Lessons L1 (migration), L2; studio stage 2 output imported through the pack |
| Later | Mock and past-paper definitions in the pack |

## 8. Build order for the tool

1. **S0** skeleton, ingest and `course.yaml` proposal. *Done.* First runs on 3 November:
   SRS (14 decks, 743 pages) ingests in about 3 seconds into 14 proposed units, with the
   repeated deck header removed from every page. PPJ's single 1061-page PDF has no
   outline and 783 OCR-damaged pages (`■` for č/ć/đ), so its twelve units need page
   ranges by hand and quote grounding there will be weaker. The SRS scripts
   (`ultskripte/`) are scans without text and cannot be sources without OCR. The
   OpenRouter account enforces zero data retention, which rules out models without ZDR
   endpoints; the defaults are `deepseek/deepseek-v4-flash` (generator) and
   `qwen/qwen3.8-27b` (verifier). The verifier reasons before answering (536 output
   tokens for a two-word ping), which S2 must budget for.
2. **S1** question generation with blueprints and stage 4 checks.
3. **S2** verifier and flags.
4. **S3** local review page.
5. **S4** publish and `studio push`.
6. **S5** lessons.
7. **S6** mock papers and past-paper transcription.

Measure S1–S3 on the PPJ calibration run before the SRS pilot: time per unit, share
of flagged items, verifier catch rate on seeded wrong keys and the owner's rejection rate.
