import json

from app.services.ai.base import Generation


class FakeProvider:
    name = "fake"
    model = "test-model"

    def __init__(self):
        self.calls = []
        self.failure = None
        self.invalid = False
        self.bad_source = False
        self.description = "Supported description"

    def generate_structured(self, system_prompt, user_prompt, response_model):
        self.calls.append((system_prompt, user_prompt))
        if self.failure:
            raise RuntimeError("private endpoint/session-secret")
        if self.invalid and len(self.calls) % 2 == 0:
            return Generation('{"concepts":[{"name":42}]}')
        chunks = json.loads(user_prompt)["chunks"]
        return Generation(
            json.dumps(
                {
                    "concepts": [
                        {
                            "name": "  Linear  Algebra "
                            if len(self.calls) % 2
                            else "linear algebra",
                            "description": self.description,
                            "aliases": ["Algebra"],
                            "importance": "HIGH",
                            "source_chunk_ordinals": [999]
                            if self.bad_source
                            else [c["ordinal"] for c in chunks],
                        }
                    ]
                }
            ),
            prompt_tokens=10,
            completion_tokens=20,
        )
