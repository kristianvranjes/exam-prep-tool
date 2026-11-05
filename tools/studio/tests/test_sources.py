import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from studio.config import Provider, Stage
from studio.llm import ChatClient
from studio.rewrite import rewrite
from studio.sources import phrase, references, strip_content, strip_references


@pytest.mark.parametrize(
    "text",
    [
        "Koje su metode navedene u izvoru?",
        "Koje vrste napada su navedene u izvorima?",
        "Prema izvoru, AES je simetrična šifra.",
        "Izvor navodi tri vrste napada: A, B i C.",
        "Točan odgovor je B jer izvor S2 navodi da je tako.",
        "Što se spominje na slajdu o AES-u?",
        "Što je zloćudna funkcionalnost prema definiciji sa slajda?",
        "Prema savjetu s predavanja, koji smjer odabrati?",
        "Predavanje navodi dvije mogućnosti.",
        "Ostale opcije nisu potkrijepljene izvorom.",
        "Odgovor se temelji na definiciji (S9).",
        "S4 navodi prednosti korisničkog jezika.",
        "According to the slides, DES is broken.",
    ],
)
def test_phrases_that_cite_a_source(text: str) -> None:
    assert phrase(text) is not None


@pytest.mark.parametrize(
    "text",
    [
        "Što leksički analizator čita iz izvornog programa?",
        "Koju uslugu pruža prezentacijski sloj?",
        "Napadač lažira IP adresu izvora paketa.",
        "Unutarnji i vanjski izvori prijetnji razlikuju se po ovlastima.",
        "Botnet je čest izvor napada uskraćivanjem usluge.",
        "Lozinka se ne smije pohraniti u čistom tekstu.",
        "Napad poznatim izvornim tekstom pretpostavlja parove poruka.",
        "Omogućuje pristup .onion stranicama",
        "X := Y + Z",
    ],
)
def test_ordinary_uses_of_the_same_words_pass(text: str) -> None:
    assert phrase(text) is None
    assert strip_references(text) == text


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ("Prema izvoru, klijent prvo šalje DHCPDISCOVER.", "Klijent prvo šalje DHCPDISCOVER."),
        ("Točno. Prema slajdovima, AES ima 10 rundi.", "Točno. AES ima 10 rundi."),
        ("Izvor navodi da DHCP nema zaštite poruka.", "DHCP nema zaštite poruka."),
        (
            "U izvoru je navedeno da LEX gradi leksički analizator.",
            "LEX gradi leksički analizator.",
        ),
        ("Netočno jer izvor navodi da je ključ 56-bitni.", "Netočno jer je ključ 56-bitni."),
        ("LEX gradi analizator, kako je navedeno u izvoru.", "LEX gradi analizator."),
        ("AES je, prema izvoru, simetričan.", "AES je simetričan."),
        ("Nedostaci su sporost i veličina (S4).", "Nedostaci su sporost i veličina."),
    ],
)
def test_lead_ins_and_asides_are_removed(before: str, after: str) -> None:
    assert strip_references(before) == after
    assert phrase(after) is None


def test_a_dropped_da_clause_never_starts_with_a_clitic() -> None:
    # "Je CAPTCHA dobra ..." would be broken Croatian; the model rewrites it instead.
    text = "Izvor navodi da je CAPTCHA dobra protiv automatiziranih napada."
    assert strip_references(text) == text


def test_every_text_field_is_checked_and_cleaned() -> None:
    content = {
        "type": "MULTIPLE_CHOICE",
        "stem": "Koja je duljina ključa AES-a?",
        "options": [
            {"text": "128 bitova (prema izvoru)", "is_correct": True},
            {"text": "56 bitova", "is_correct": False},
        ],
        "explanation": "Prema izvoru, AES koristi 128 bitova.",
    }
    assert set(references(content)) == {"options.0", "explanation"}
    cleaned = strip_content(content)
    assert references(cleaned) == {}
    assert cleaned["options"][0] == {"text": "128 bitova", "is_correct": True}
    assert cleaned["explanation"] == "AES koristi 128 bitova."
    assert content["explanation"].startswith("Prema izvoru")  # the input is not modified


def client(handler: Any, tmp_path: Path) -> ChatClient:
    return ChatClient(
        stage_name="generate",
        provider_name="openrouter",
        provider=Provider(base_url="https://openrouter.ai/api/v1", api_key_env="KEY"),
        stage=Stage(
            provider="openrouter", model="deepseek/deepseek-v4-flash", min_interval_seconds=0
        ),
        log_path=tmp_path / "calls.jsonl",
        env={"KEY": "secret-key-123"},
        transport=httpx.MockTransport(handler),
    )


def answer(questions: list[dict[str, Any]]) -> httpx.Response:
    content = json.dumps({"questions": questions}, ensure_ascii=False)
    return httpx.Response(
        200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}
    )


MCQ = {
    "type": "MULTIPLE_CHOICE",
    "stem": "Koje vrste napada na šifre su navedene u izvorima?",
    "options": [
        {"text": "Napad poznatim izvornim tekstom", "is_correct": True},
        {"text": "Napad odabranim ključem", "is_correct": False},
        {"text": "Napad grubom silom na sažetak", "is_correct": False},
        {"text": "Napad ponavljanjem poruke", "is_correct": False},
    ],
    "explanation": "Izvor navodi tri vrste napada. Napad odabranim ključem se ne spominje.",
    "difficulty": 2,
}


def test_only_flagged_fields_are_rewritten_and_the_key_is_kept(tmp_path: Path) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(json.loads(request.content)["messages"][1]["content"])
        seen.append(payload)
        return answer(
            [
                {
                    "id": "q1",
                    "fields": [
                        {"field": "stem", "text": "Koje vrste napada na šifre postoje?"},
                        # Still cites the source: dropped, the old text stays flagged.
                        {"field": "explanation", "text": "Kako izvor navodi, postoje tri."},
                        # Not asked for: ignored, so the options cannot change.
                        {"field": "options.1", "text": "Napad poznatim izvornim tekstom"},
                    ],
                }
            ]
        )

    outcome = rewrite({"q1": MCQ}, client(handler, tmp_path), "unit 01")

    assert outcome.calls == 1 and outcome.errors == []
    assert seen[0]["questions"][0]["rewrite"] == ["explanation", "stem"]
    assert [o["correct"] for o in seen[0]["questions"][0]["options"]] == [True, False, False, False]
    result = outcome.contents["q1"]
    assert result["stem"] == "Koje vrste napada na šifre postoje?"
    assert result["options"] == MCQ["options"]
    assert result["explanation"] == MCQ["explanation"]
    assert outcome.left == {"q1": ["explanation"]}


def test_without_a_client_only_the_cleanup_runs() -> None:
    question = {
        "type": "TRUE_FALSE",
        "stem": "DHCP poruke nisu zaštićene.",
        "correct_answer": True,
        "explanation": "Prema izvoru, DHCP nema nikakve zaštite poruka.",
    }
    outcome = rewrite({"q": question, "m": MCQ}, None, "unit 01")
    assert outcome.calls == 0
    assert outcome.contents["q"]["explanation"] == "DHCP nema nikakve zaštite poruka."
    assert set(outcome.left) == {"m"}


def test_a_failed_request_keeps_the_text(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    outcome = rewrite({"m": MCQ}, client(handler, tmp_path), "unit 01")
    assert outcome.errors == ["RATE_LIMITED"]
    assert outcome.contents["m"] == MCQ
