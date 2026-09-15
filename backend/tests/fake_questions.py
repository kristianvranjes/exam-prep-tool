import json

from app.services.ai.base import Generation


class FakeQuestions:
    name = "fake"
    model = "questions"

    def __init__(self):
        self.mode = "valid"
        self.calls = []
        self.suffix = ""

    def generate_structured(self, system, prompt, response_model):
        self.calls.append((system, prompt))
        payload = json.loads(prompt)
        if self.mode == "failure":
            raise RuntimeError("private-provider-url secret-key raw response")
        rows = []
        for i in range(payload["count"]):
            type_ = payload["types"][i % len(payload["types"])]
            row = {
                "type": type_,
                "stem": f"Pitanje {i}{self.suffix}?",
                "explanation": "Grounded answer explanation",
                "difficulty": 2,
                "concept_refs": ["C1"],
                "source_refs": ["S1"],
            }
            if type_ == "MULTIPLE_CHOICE":
                row["options"] = [
                    {"text": "Correct option", "is_correct": True},
                    {"text": "Wrong option", "is_correct": False},
                ]
            elif type_ == "TRUE_FALSE":
                row["correct_answer"] = False
            else:
                row["reference_answer"] = "Private reference answer"
            rows.append(row)
        if self.mode == "invalid":
            rows[-1]["status"] = "APPROVED"
        if self.mode == "type":
            rows[-1]["type"] = "FILL_BLANK"
        if self.mode == "concept":
            rows[-1]["concept_refs"] = ["C99"]
        if self.mode == "source":
            rows[-1]["source_refs"] = ["S99"]
        if self.mode == "duplicate" and len(rows) > 1:
            rows[-1]["stem"] = rows[0]["stem"].upper()
        if self.mode == "count":
            rows.append(dict(rows[0]))
        return Generation(
            json.dumps({"questions": rows}) if self.mode != "json" else "raw-secret-output",
            prompt_tokens=20,
            completion_tokens=30,
        )
