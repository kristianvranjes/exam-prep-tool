class FakeEmbeddingProvider:
    signature = "a" * 64

    def __init__(self):
        self.calls = []
        self.fail_on = None

    def embed(self, texts):
        self.calls.append(list(texts))
        if self.fail_on == len(self.calls):
            raise RuntimeError("private model path and source text")
        directions = {"alpha": [2.0, 0.0], "beta": [0.0, 3.0], "mixed": [1.0, 1.0]}
        return [directions.get(text, [1.0, 0.0]) + [0.0] * 1022 for text in texts]
