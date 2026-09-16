# External AI quiz import (Phase 6.6)

PDF/study material → external AI using our prompt → `quiz-import-v1` JSON →
application import → DRAFT → human review → APPROVED.

This is a temporary staging bypass. The internal provider-based AI architecture,
concept extraction, embeddings and retrieval remain intact for future production-quality
integration. Import never calls a provider or requires concepts, PDFs or embeddings
in the application. Set `AI_PROVIDER=disabled` to start locally or in staging without
AI credentials; internal AI endpoints then return 503. Other hosted security settings
(HTTPS, secure cookies, trusted Origin, database TLS and persistent storage) still apply.
To restore internal generation, explicitly select and configure an existing provider.

## Using the Question Bank

1. As the course OWNER, open Question bank → Import external quiz drafts.
2. Open **External AI prompt and example** and copy the prompt (or select its text).
   Supply only study material you are permitted to share with your chosen external tool.
3. Ask that tool to use only that material. Save its response as a UTF-8 `.json` file,
   containing only the JSON object, without Markdown fences.
4. Select the file and click **Import drafts**. On success, the bank switches to DRAFT,
   clears type/page filters and opens the first imported question. All imported drafts
   remain in the normal paginated bank. Errors save nothing; correct the file and retry.
5. Check answers and explanations against the original material, edit as needed,
   submit for review, then explicitly approve or reject each question. Rejected questions
   can be edited and resubmitted. Import cannot approve content. MEMBER users cannot
   import or view drafts and see only the existing answer-free approved representation.

The copyable prompt is maintained in
[`quiz-import-prompt.ts`](../frontend/src/lib/quiz-import-prompt.ts).
Download the [example JSON](../frontend/public/quiz-import-v1.example.json) in the UI
or use this repository file. It contains all three supported types.

## Version 1 format

Top level: `{"version":"quiz-import-v1","questions":[...]}`. Unknown fields and
versions are rejected, including status, creator IDs, course IDs and approval claims.
The existing strict question-content schemas validate each item:

| Field | Rule |
| --- | --- |
| `type` | `MULTIPLE_CHOICE`, `SHORT_ANSWER` or `TRUE_FALSE` |
| `stem` | Required nonblank text, up to 400 characters |
| `explanation` | Optional null or nonblank text, up to 2000 characters |
| `difficulty` | Optional null or integer 1–5, never a boolean/string |
| MCQ `options` | 2–6 objects with `text` (1–400 characters) and boolean `is_correct`; distinct normalized text and exactly one correct answer |
| Short answer `reference_answer` | Required nonblank text, up to 2000 characters |
| True/false `correct_answer` | Required JSON boolean |

Only the answer fields for the selected type are allowed. There is no free-form
source/reference field in v1: existing source references identify verified database
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
membership rules: 401 anonymous, 403 non-owner member, 404 unavailable course.

`QUESTION_IMPORT_MAX_BYTES` defaults to 262144 (256 KiB) and
`QUESTION_IMPORT_MAX_COUNT` defaults to 50. Operators may lower them; these are also
hard maxima. Both are forwarded by Compose. The stream is bounded before JSON parsing,
including without Content-Length. No file is saved or executed. Text is rendered
through existing React text output. Validation returns 422 with up to five field-path
errors without echoing the document; wrong content type is 415 and oversize is 413.

All content is validated before writes. Questions, options and initial history are
committed together. Duplicate normalized stems within a file are rejected; an active
stem already in the course causes 409 and rolls back the entire import. Repeated
imports do not silently create duplicates. Database failures return a safe 503 and
roll back all writes. There is no automatic retry or partial import.

No schema migration is needed. Run targeted backend tests `test_quiz_import.py` and
`test_quiz_import_database.py` (the latter against disposable PostgreSQL with
`RUN_DB_TESTS=1`), plus frontend quiz-import/question-bank/question-api tests. The full
README gates retain existing migration, provider and question lifecycle coverage.
