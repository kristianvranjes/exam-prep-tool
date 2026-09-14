import sys
from types import SimpleNamespace

import numpy as np
import pytest
from fake_embeddings import FakeEmbeddingProvider
from fastapi import HTTPException

from app.config import Settings
from app.services.embeddings.base import EmbeddingError, content_hash, embed_validated
from app.services.embeddings.bge_m3 import BGEM3Provider
from app.services.embeddings.service import batch_texts


def test_order_normalization_and_batches():
    provider = FakeEmbeddingProvider()
    settings = Settings(embedding_batch_size=2, embedding_batch_chars=1000)
    batches = batch_texts(["alpha", "beta", "mixed"], settings)
    assert batches == [["alpha", "beta"], ["mixed"]]
    vectors = embed_validated(provider, batches[0])
    assert vectors[0][:2] == [1, 0]
    assert vectors[1][:2] == [0, 1]
    assert batch_texts(["a" * 600, "b" * 600], settings) == [["a" * 600], ["b" * 600]]
    with pytest.raises(HTTPException):
        batch_texts(["x" * 1001], settings)
    assert content_hash("Čisto") != content_hash("cisto")


@pytest.mark.parametrize(
    "value",
    [
        [],
        [[1.0]],
        [[0.0] * 1024],
        [[float("nan")] + [0.0] * 1023],
        [[float("inf")] + [0.0] * 1023],
        [[True] + [0.0] * 1023],
        [["1"] + [0.0] * 1023],
        [[1e100] + [0.0] * 1023],
        None,
    ],
)
def test_invalid_vectors(value):
    provider = SimpleNamespace(embed=lambda texts: value)
    with pytest.raises(EmbeddingError, match="INVALID_VECTOR"):
        embed_validated(provider, ["alpha"])


def test_safe_provider_error():
    provider = FakeEmbeddingProvider()
    provider.fail_on = 1
    with pytest.raises(EmbeddingError) as error:
        embed_validated(provider, ["private source"])
    assert str(error.value) == "UNAVAILABLE"
    assert "private" not in repr(error.value)


def test_bge_lazy_offline_cpu_loading_and_bounds(monkeypatch):
    loads, calls = [], []

    class Model:
        def __init__(self, model, **kwargs):
            loads.append((model, kwargs))

        def float(self):
            return self

        def eval(self):
            return self

        def tokenizer(self, texts, **kwargs):
            assert kwargs == {"truncation": False, "padding": False}
            return {"input_ids": [[1] * len(t) for t in texts]}

        def encode(self, texts, **kwargs):
            calls.append((texts, kwargs))
            return np.array([[1.0] + [0.0] * 1023 for _ in texts])

    monkeypatch.setitem(
        sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=Model)
    )
    provider = BGEM3Provider("BAAI/bge-m3", "a" * 40, 16, 2)
    assert loads == []
    assert len(embed_validated(provider, ["alpha", "beta"])) == 2
    provider.embed(["mixed"])
    assert len(loads) == 1
    assert loads[0][1] == {
        "revision": "a" * 40,
        "device": "cpu",
        "local_files_only": True,
        "trust_remote_code": False,
    }
    assert calls[0][0] == ["alpha", "beta"]
    assert calls[0][1]["show_progress_bar"] is False
    assert calls[0][1]["normalize_embeddings"] is True
    with pytest.raises(EmbeddingError, match="INPUT_LIMIT"):
        provider.embed(["x" * 17])
    with pytest.raises(EmbeddingError, match="INPUT_LIMIT"):
        provider.embed(["a", "b", "c"])
    assert len(calls) == 2


def test_bge_signature_and_safe_load_failure(monkeypatch):
    provider = BGEM3Provider("BAAI/bge-m3", "a" * 40, 8192, 2)
    assert provider.signature == BGEM3Provider("BAAI/bge-m3", "a" * 40, 8192, 4).signature
    for changed in [
        BGEM3Provider("different", "a" * 40, 8192, 2),
        BGEM3Provider("BAAI/bge-m3", "b" * 40, 8192, 2),
        BGEM3Provider("BAAI/bge-m3", "a" * 40, 1024, 2),
    ]:
        assert provider.signature != changed.signature

    def fail(*args, **kwargs):
        raise RuntimeError("private/path source")

    monkeypatch.setitem(
        sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=fail)
    )
    with pytest.raises(EmbeddingError, match="UNAVAILABLE"):
        provider.embed(["source"])
