# External AI quiz import (Phase 6.6)

PDF/study material → external AI using our prompt → `quiz-import-v2` JSON →
application import → DRAFT → human review → APPROVED.

This is a temporary staging bypass. The internal provider-based AI architecture,
concept extraction, embeddings and retrieval remain intact for future production-quality
integration. Import never calls a provider or requires concepts, PDFs or embeddings
in the application. Set `AI_PROVIDER=disabled` to start locally or in staging without
AI credentials; internal AI endpoints then return 503. Other hosted security settings
(HTTPS, secure cookies, trusted Origin, database TLS and persistent storage) still apply.
To restore internal generation, explicitly select and configure an existing provider.

## Using the Question Bank

1. As a joined course MEMBER or OWNER, open Question bank → Import external quiz drafts.
2. Open **External AI prompt and example** and copy the prompt (or select its text).
   Supply only study material you are permitted to share with your chosen external tool.
3. Ask that tool to use only that material. Save its response as a UTF-8 `.json` file,
   containing only the JSON object, without Markdown fences.
4. Select the file and click **Import drafts**. On success, the bank switches to DRAFT,
   clears type/page filters and opens the first imported question. All imported drafts
   remain in the normal paginated bank. Errors save nothing; correct the file and retry.
5. Check answers and explanations against the original material, edit as needed,
   submit for a different faculty moderator to approve or reject. Rejected questions
   can be edited and resubmitted. Creators may immediately practice their own DRAFT
   and PENDING_REVIEW questions. Other students see only answer-free approved content.

The copyable prompt is maintained in
[`quiz-import-prompt.ts`](../frontend/src/lib/quiz-import-prompt.ts).
Download the [example JSON](../frontend/public/quiz-import-v2.example.json) in the UI
or use this repository file. It contains all five supported types. The earlier
[v1 example](../frontend/public/quiz-import-v1.example.json) still imports unchanged.

## Format versions 1 and 2

Top level: `{"version":"quiz-import-v2","questions":[...]}`. Version 2 adds
`NUMERIC`, `MULTIPLE_SELECT` (R4) and `MATCH`; `quiz-import-v1` documents stay valid exactly as
before, and a v1 document containing a new type is rejected with a hint to use v2.
Unknown fields and versions are rejected, including status, creator IDs, course IDs and
approval claims. The existing strict question-content schemas validate each item:

| Field | Rule |
| --- | --- |
| `type` | `MULTIPLE_CHOICE`, `SHORT_ANSWER` or `TRUE_FALSE`; v2 also `NUMERIC`, `MULTIPLE_SELECT` and `MATCH` |
| `stem` | Required nonblank text, up to 400 characters |
| `explanation` | Optional null or nonblank text, up to 2000 characters |
| `difficulty` | Optional null or integer 1–5, never a boolean/string |
| `hint` | Optional nonblank text, up to 400 characters: a nudge the student may open before answering |
| `expr` | Optional nonblank text, up to 200 characters: a Boolean or algebraic expression shown apart from the stem |
| MCQ `options` | 2–6 objects with `text` (1–400 characters) and boolean `is_correct`; distinct normalized text and exactly one correct answer |
| Short answer `reference_answer` | Required nonblank text, up to 2000 characters |
| True/false `correct_answer` | Required JSON boolean |
| Multiple-select `options` | As for MCQ, but one or more options are correct; students must choose exactly that set |
| Match `pairs` | 2–6 objects `{"left":"...","right":"..."}` (1–400 characters each); left items distinct and right items distinct after normalizing; students connect each left item with its partner |
| Numeric `correct_value` | Required number, written as a string (`"9.81"`, `"9,81"`, `"1.5e-3"`) or a JSON number |
| Numeric `absolute_tolerance` | Optional number ≥ 0 in the answer's unit |
| Numeric `relative_tolerance` | Optional share of the key's magnitude, 0–1 (`"0.01"` allows 1 %) |
| Numeric `unit` | Optional display unit, 1–20 characters; never converted |

`quiz-import-v2` also accepts an optional `course_unit`: the title of an existing unit of the course
(a quiz), at the top level for the whole file and/or on a question, which wins. (It is not `unit`:
a numeric question uses that for its measurement unit.) Titles are matched
ignoring case and extra spaces. An unknown or archived unit is an error for that question (the
whole import fails unless `skip_invalid` is used). A question without a unit takes the unit
chosen in the request, if any. `quiz-import-v1` rejects `course_unit`.

Text fields may use the [formula and code syntax](QUESTIONS.md#formulas-and-code)
(`$…$`, `$$…$$`, backticks and code fences). It is plain text to the importer; in JSON,
write each backslash twice (`"$\\frac{1}{2}$"`) and line breaks as `\n`. The prompt
asks the external AI for exactly this.

Only the answer fields for the selected type are allowed. There is no free-form
source/reference field in either version: existing source references identify verified database
chunks, which an external AI cannot supply. Human-readable page references may appear
in explanation, but are not verified provenance. Imports use the existing `USER`
source (user-supplied content, even if externally AI-assisted), no AI job, and empty
concept/source associations. A CREATED history snapshot records the importing user.
Internally generated `AI` questions retain mandatory concept/source validation.

## API and limits

`POST /courses/{course_id}/questions/import` accepts the raw JSON document with
`Content-Type: application/json` and the usual session cookie. Hosted calls must also
send the trusted `Origin`. The course comes from the URL, never the file. Success is
201 with the imported owner question representations. The route uses the existing
membership rules: 401 anonymous, MEMBER/OWNER may import, 404 unavailable course.

`QUESTION_IMPORT_MAX_BYTES` defaults to 2097152 (2 MiB) and
`QUESTION_IMPORT_MAX_COUNT` defaults to 500. Operators may lower them; these are also
hard maxima. Both are forwarded by Compose. The stream is bounded before JSON parsing,
including without Content-Length. No file is saved or executed. Text is rendered
through existing React text output. Validation returns 422 with up to five field-path
errors without echoing the document; wrong content type is 415 and oversize is 413.

`POST /courses/{course_id}/questions/import/check` is a dry run: it reports per question
(position, line in the file, status, issues) what the import would do, including unknown units,
duplicates within the file, questions you already have or that are already approved, and
missing explanations (warnings). See [API](API.md#course-units-r2) for the options of the
real import: `duplicates` (`REJECT`, `SKIP`, `REPLACE`), `import_as` (`DRAFT`,
`PENDING_REVIEW`) and `skip_invalid`.

All content is validated before writes. Questions, options and initial history are
committed together. Duplicate normalized stems within a file are rejected; an active
stem already owned by the same creator in the course causes 409 and rolls back the entire import. Repeated
imports do not silently create duplicates. Database failures return a safe 503 and
roll back all writes. There is no automatic retry or partial import.

The import format is unchanged; migration 0011 updates community uniqueness and
moderator assignments. Different creators may import identical private stems;
only one may become APPROVED per course. See [community rules](COMMUNITY.md). Run targeted backend tests `test_quiz_import.py` and
`test_quiz_import_database.py` (the latter against disposable PostgreSQL with
`RUN_DB_TESTS=1`), plus frontend quiz-import/question-bank/question-api tests. The full
README gates retain existing migration, provider and question lifecycle coverage.
