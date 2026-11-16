# Material ingestion (Phase 3)

PDF is the only accepted format: a .pdf filename, application/pdf MIME type and
%PDF- signature are required. Empty files return 400, unsupported types/signatures
415, and oversized files 413. The default file limit is 20 MiB (20971520 bytes).
The ASGI upload guard additionally bounds total multipart request bytes to the file
limit plus 64 KiB of overhead, including requests without Content-Length.

Only the course OWNER or a moderator of the course's faculty may upload: another
member gets 403 and a non-member 404. Members keep read access to the list, details
and chunks through the API; the web interface shows materials to owners and
moderators only.

## Storage and configuration

Host development reads MATERIAL_STORAGE_DIR (default ./data/materials, relative to
the backend process working directory). Use an absolute private directory for a
custom location. Runtime data/ is ignored by Git and the backend Docker build.
For custom locations outside data/, keep that directory outside the repository or
add an explicit ignore rule. Do not place storage under frontend/public.

Compose mounts the material_data named volume at /app/data/materials and sets
MATERIAL_STORAGE_DIR to that container path. Source files survive container rebuilds.
The host setting does not change the Compose volume mount; edit the mount explicitly
if a bind mount is preferred. Back up this volume together with PostgreSQL.

- MATERIAL_MAX_UPLOAD_BYTES=20971520
- MATERIAL_CHUNK_TARGET_CHARS=2500
- MATERIAL_CHUNK_OVERLAP_CHARS=250

Target must be at least 2 and overlap must be nonnegative and smaller than target.
Each source uses a generated UUID key with .pdf suffix; original names are stripped
of path components and kept only as metadata. Storage keys are validated and
resolved paths must stay inside the configured root. The storage abstraction has
save/path/delete operations; domain code does not construct file paths.

## Extraction and derived content

The synchronous upload request stores the source, commits UPLOADED metadata, then
commits PROCESSING. A dedicated extraction service calls Microsoft's MarkItDown
PDF converter directly through its Python API. It does not use the general format
classifier, URL converters, plugins, OCR, LLM clients or external services.
See [MarkItDown](https://github.com/microsoft/markitdown).

Normalization changes CRLF/CR to LF and trims outer whitespace. Markdown headings
of levels 1–6 start sections; preamble text becomes an untitled section. Fenced code
headings are ignored. Heading lines remain in section content. With no headings,
the document is one section. Section ordinals are zero-based.

Chunks stay inside their section, with stable document-wide zero-based ordinals.
A short section stays whole. Longer sections prefer paragraph, newline, then space
boundaries in the latter portion of the target window, falling back to character
cuts. The next window starts overlap characters before the previous end; trimming
outer chunk whitespace may reduce visible overlap. No empty chunks are stored.
Character counts measure Python Unicode characters and are checked by PostgreSQL.
No embeddings or vector columns are added.

Sections, chunks, extracted Markdown and READY status commit atomically. If parsing
or derived-row persistence fails, those writes roll back and status becomes FAILED
with a fixed safe error message. The source remains for inspection. If initial
metadata creation fails, the source is deleted. Calling internal processing again
on an already processed material is a no-op, so it cannot duplicate chunks.

## Failed upload cleanup

`DELETE /materials/{material_id}` is the explicit cleanup path for a material that
failed processing. The delete operation is restricted to the uploader and only for a
row currently in FAILED status. A non-member or missing material returns 404; a
member who did not upload it returns 403; and READY, UPLOADED or PROCESSING rows
return 409. READY deletion remains intentionally out of scope.

Deletion is DB-first: the request locks/revalidates the material, inserts a durable
`material_storage_cleanups` intent for its source key, deletes the Material, and
commits all database changes together. A pre-commit DB failure rolls back the
deletion and intent, returns safe 503, and leaves both the row and PDF intact.
No filesystem deletion occurs before this commit.

Deleting the entire course is a separate OWNER-only lifecycle action. It locks the
course and its materials in deterministic order, queues every source regardless of
processing status, then commits course deletion and existing database cascades in
the same transaction. On rollback, every source PDF and domain row remains.

After either deletion commits, the API attempts physical cleanup and returns 204
for successful logical deletion even if storage cleanup fails. Deleted sources
cannot be accessed through domain APIs. Failed or interrupted cleanup remains
durable for retry; it does not resurrect deleted rows or return a misleading 503.
Failures record only a bounded attempt count and last-attempt timestamp, never raw
errors. Normal API responses expose neither cleanup state nor storage keys/paths.

From `backend/`, with the existing DB settings and the same private material volume:

```sh
python -m app.storage_cleanup
python -m app.storage_cleanup --batch-size 100
```

Each run processes at most the batch size (default 100, allowed 1-1000), ordered by
`created_at, id`. Only committed intents authorize deletion; concurrent processors
skip locked intents. Missing PDFs count as success. Successful cleanup removes its
intent only after storage deletion succeeds. If the process stops or that DB commit
fails after physical deletion, a later missing-safe retry clears the stale intent.
Repeated runs are idempotent and never scan or remove unrelated files. Output
contains counts/status only; exit status is nonzero on failure or remaining work.
Run again until the queue is empty. There is no automatic worker or public cleanup API.

## Limits

Scanned/image-only or encrypted PDFs may fail; this phase does not add OCR.
PDF visual headings may be plain text in extraction, yielding one logical section.
The parser runs synchronously in the API worker and is not a sandbox; the size
limit is not a CPU/memory/time limit for malformed compressed PDFs. Keep this
local development stack private. Process termination can leave PROCESSING rows
and a crash between file save and metadata commit can leave an orphan file.
There is still no automatic retry, reprocess endpoint, standalone READY-material
deletion lifecycle or garbage collector. FAILED uploader-owned cleanup exists via
`DELETE /materials/{material_id}`; OWNER course deletion removes all course sources.
Material list/detail/chunk APIs are unpaginated for this
local foundation.

## Verification

Use a disposable PostgreSQL database: integration fixtures truncate application
tables. Do not point RUN_DB_TESTS at a database containing data you need.

From backend/ with its virtual environment active:

~~~sh
python -m ruff format --check .
python -m ruff check .
python -m mypy app
python -m pytest
python -m alembic upgrade head
# With DATABASE_URL pointing to the disposable database:
RUN_DB_TESTS=1 python -m pytest
~~~

PowerShell: set $env:DATABASE_URL to the disposable PostgreSQL URL, then
$env:RUN_DB_TESTS="1" before python -m pytest. On Windows, 127.0.0.1 avoids
localhost/IPv6 connection delays.

Complete PowerShell example from the repository root with Compose running:

~~~powershell
docker compose exec -T db createdb -U examprep examprep_test
$env:DATABASE_URL="postgresql+psycopg://examprep:examprep@127.0.0.1:5432/examprep_test?connect_timeout=3"
Set-Location backend
.venv/Scripts/python -m alembic upgrade head
$env:RUN_DB_TESTS="1"
.venv/Scripts/python -m pytest
Set-Location ..
docker compose exec -T db dropdb -U examprep examprep_test
Remove-Item Env:RUN_DB_TESTS
Remove-Item Env:DATABASE_URL
~~~

Use a new disposable database name if examprep_test already exists. Adjust sample
credentials if your local database settings differ.

tests/pdf_fixture.py generates an original tiny text PDF without a binary fixture
or additional dependency. Tests exercise real extraction, membership, upload
validation, safe parser errors, rollback, idempotence, parsing and chunking.

From frontend/: npm run lint, npm run typecheck, npm test, npm run build.
From root: docker compose config --quiet and docker compose up --build -d --wait.
For a manual check, open a course, choose a PDF, upload, and open its material row
to inspect status, section count, chunk count and extracted text.
