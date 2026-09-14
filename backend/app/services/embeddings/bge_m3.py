import importlib
import json
from hashlib import sha256
from threading import Lock
from typing import Any, cast

from app.services.embeddings.base import EmbeddingError


class BGEM3Provider:
    """Dense CPU inference only. No model import/load until explicitly requested."""

    def __init__(self, model: str, revision: str, max_tokens: int, batch_size: int):
        self.model = model
        self.revision = revision
        self.max_tokens = max_tokens
        self.batch_size = batch_size
        self.signature = sha256(
            json.dumps(
                {
                    "provider": "sentence-transformers-bge-m3",
                    "model": model,
                    "revision": revision,
                    "max_tokens": max_tokens,
                    "dimension": 1024,
                    "normalization": "l2",
                    "version": 1,
                    "precision": "float32",
                    "device": "cpu",
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        self._model: Any = None
        self._lock = Lock()

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts or len(texts) > self.batch_size:
            raise EmbeddingError("INPUT_LIMIT")
        try:
            with self._lock:
                if self._model is None:
                    module = importlib.import_module("sentence_transformers")
                    model = module.SentenceTransformer(
                        self.model,
                        revision=self.revision,
                        device="cpu",
                        local_files_only=True,
                        trust_remote_code=False,
                    )
                    model.max_seq_length = self.max_tokens
                    model.float().eval()
                    self._model = model
                # Do not silently truncate persisted chunk content to fit the tokenizer.
                tokens = self._model.tokenizer(texts, truncation=False, padding=False)["input_ids"]
                if any(len(ids) > self.max_tokens for ids in tokens):
                    raise EmbeddingError("INPUT_LIMIT")
                vectors = self._model.encode(
                    texts,
                    batch_size=self.batch_size,
                    show_progress_bar=False,
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    precision="float32",
                )
                return cast(list[list[float]], vectors.tolist())
        except EmbeddingError:
            raise
        except Exception:
            raise EmbeddingError("UNAVAILABLE") from None
