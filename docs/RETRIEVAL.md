# Phase 5: dense embeddings and semantic retrieval

Generation remains AIProvider -> Ollama / FreeLLMAPI. Embeddings use an independent
EmbeddingProvider -> BGEM3Provider. An embedding maps text to a numeric vector;
it is not generated prose and does not use the concept schema or generation prompts.
There is no RAG prompt, question generation, sparse/hybrid retrieval or reranking.

## Model and installation

[BGE-M3](https://huggingface.co/BAAI/bge-m3) produces 1024-dimensional dense vectors.
We keep that native dimension without truncation, matching vector(1024) in PostgreSQL.
Sentence Transformers is the optional integration; its CPU model loads lazily once
per process under a lock. Evaluation uses float32, L2 normalization, no progress
output or query instruction prefix. The adapter rejects token overflow instead of
silently truncating text. The same adapter handles query and chunk vectors.

The normal backend image/test dependencies include only the small pgvector Python
integration (and its NumPy dependency, already used by PDF extraction). Torch and
Sentence Transformers belong to the optional `embeddings` extra. Neither the base
Docker build nor CI installs that extra or downloads a model. Without the extra/cache,
embedding refresh/search operations safely return 503; the read-only READY material
status remains available and the base application still starts normally.

Recommended real local path: Python 3.12 native backend plus the Compose database.
From the root, copy `.env.example` to `.env` if needed, then:

```sh
docker compose up -d db
python -m venv backend/.venv
# PowerShell: .\backend\.venv\Scripts\Activate.ps1
# Linux/macOS: source backend/.venv/bin/activate
cd backend
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e ".[dev,embeddings]"
python -m alembic upgrade head
```

Explicit optional download (internet required once; do not run in CI):

```sh
python -c "from sentence_transformers import SentenceTransformer; from app.config import Settings; s=Settings(); SentenceTransformer(s.embedding_model, revision=s.embedding_revision, device='cpu', trust_remote_code=False)"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Stop the Compose backend first if port 8000 is occupied: `docker compose stop backend`.
Weights use the normal Hugging Face user cache, outside this repository. Runtime
loading always uses `local_files_only=True` and `trust_remote_code=False`; serving
requests never downloads weights or uses paid endpoints. Use trusted model artifacts.
No live model smoke test runs automatically. The authenticated calls below serve as
the optional real smoke test after download.

CPU inference can be slow and requires several GB of RAM/cache space. Batch size
defaults to 4, total batch characters to 12000, per-text characters to 6000, and
per-material chunks to 128. The tokenizer limit defaults to 8192 tokens. Limits
are configurable through EMBEDDING_*; oversized work returns 422. A batch size of
1 may help low-memory machines. A signature change invalidates prior vectors.

## Fingerprints and transactions

The fingerprint has two parts:

- SHA-256 of exact UTF-8 chunk content (no lossy whitespace normalization).
- SHA-256 of provider implementation/version, model identifier, pinned model
  revision, dimension, float32 CPU precision, max token limit and L2 normalization.

The default revision is `5617a9f61b028005a4858fdac845db406aefb181`; a 40-character
commit SHA is required instead of mutable `main`. Changing model/revision or compatible
encoding settings recomputes vectors. Batch size is a scheduling setting, so it does
not invalidate vectors. Bump the implementation signature version when changing the
encoding algorithm; replacing local model artifacts without updating the configured
revision is unsupported. Unchanged chunks are skipped without calling the provider.

An embedding request authorizes membership, locks the material and bounded chunk
rows in ordinal order, validates all batches, then writes all vectors/metadata in
one transaction. A competing refresh gets 409 (NOWAIT). Content edits/deletes wait
for those locks. Any provider or persistence failure rolls back the whole refresh;
existing vectors and timestamps are retained, but stale vectors cannot be searched.
The tradeoff is holding row locks during synchronous local inference; there is no
worker/queue or automatic retry. Process termination causes transaction rollback.

## Search and authorization

OWNER and MEMBER can read status, embed and search their own courses. Unauthenticated requests
return 401; outsiders receive 404 before inference. No operation here is owner-only.

In the course Materials section, open a READY material to see its semantic source
status and current/stale/total chunk counts. Use Prepare semantic sources or Refresh
semantic sources explicitly when needed. A successful refresh updates the status
without reloading the page; a failed refresh leaves the prior status for retry.
Status reads do not load the model or run inference. An empty READY material is not
current. There is no automatic embedding, retry or polling. The optional local model
is needed only when preparing sources for internal AI generation; manual question
creation and JSON import continue to work without it.

Search embeds the query once and uses a parameterized pgvector cosine-distance
expression in PostgreSQL. The SQL query filters by requested course, READY material,
nonnull embedding, matching model signature, and a SHA-256 of the current content.
Unembedded/stale rows are excluded; search does not regenerate them. Ordering is
distance ascending, then material UUID, chunk ordinal and chunk UUID. Similarity
is 1 - cosine distance (it can be negative). top_k defaults to 5 and is capped at 20;
query length is 1-1000 characters after trimming. Exact search is appropriate for
small course datasets; existing material/course indexes filter candidates before
ranking. No approximate index is justified yet.

## Authenticated local calls

The normal user workflow is the in-app READY material control above. For developer
diagnostics, copy course and READY material IDs from API responses or `/docs`.
The following requests use
the same cookie; replace the sample account and IDs with yours. Keep the temporary
cookie file outside the repository and delete it afterwards.

```sh
curl -c /tmp/examprep-cookies -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"your-password"}' http://localhost:8000/auth/login
curl -b /tmp/examprep-cookies http://localhost:8000/materials/MATERIAL_ID/embeddings
curl -b /tmp/examprep-cookies -X POST http://localhost:8000/materials/MATERIAL_ID/embeddings
curl -b /tmp/examprep-cookies -H 'Content-Type: application/json' -d '{"query":"Kako radi binarno stablo pretrazivanja?","top_k":5}' http://localhost:8000/courses/COURSE_ID/retrieval/search
```

PowerShell equivalent (keeps the cookie in memory):

```powershell
Invoke-RestMethod http://localhost:8000/auth/login -Method Post -ContentType 'application/json' -Body '{"email":"you@example.com","password":"your-password"}' -SessionVariable session
Invoke-RestMethod http://localhost:8000/materials/MATERIAL_ID/embeddings -WebSession $session
Invoke-RestMethod http://localhost:8000/materials/MATERIAL_ID/embeddings -Method Post -WebSession $session
Invoke-RestMethod http://localhost:8000/courses/COURSE_ID/retrieval/search -Method Post -WebSession $session -ContentType 'application/json' -Body '{"query":"Kako radi binarno stablo pretrazivanja?","top_k":5}'
```

## Checks and migrations

Normal tests inject deterministic fake vectors; adapter tests mock SentenceTransformer.
No external model credentials, downloads, GPU or live inference are used. Follow
README's full checks with RUN_DB_TESTS=1 and a **disposable** PostgreSQL database.
Revision 0005 upgrades from 0004, adds embedding columns, and leaves existing data
unembedded. On a disposable database:

```sh
python -m alembic upgrade head
python -m alembic downgrade 0004
python -m alembic upgrade head
python -m alembic downgrade base
python -m alembic upgrade head
```

The Phase 5 ORM/parity check covers material_chunks. Existing unrelated identity
schema redundancy (both a unique email constraint and unique index in migrations)
is outside this phase. There is no frontend semantic search UI; use the API or `/docs`
for search diagnostics.
