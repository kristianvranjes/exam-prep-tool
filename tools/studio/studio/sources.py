"""Questions must never point at where their facts came from.

Students see a question in the app, never the slides it was written from, so "Prema
izvoru, ...", "na slajdu" or "s predavanja" in a stem, an option, an explanation or a
reference answer is always wrong. This module finds such phrases in every text field
and removes the common lead-ins ("Prema izvoru, AES ..." -> "AES ...") without touching
the facts. What it cannot remove safely is reported; `studio rewrite` has the model
rephrase it.
"""

import re
import unicodedata
from collections.abc import Iterator
from typing import Any

FOLD = str.maketrans({"đ": "d", "Đ": "D", "■": None, "�": None})


def fold(text: str) -> str:
    """Lower case, no diacritics, OCR placeholders or LaTeX commands, punctuation as spaces.

    Slides show symbols (∈, ←) that a model may quote as LaTeX (\\in, \\leftarrow); dropping
    the command words lets both spellings meet.
    """
    text = re.sub(r"\\[A-Za-z]+", " ", text)
    decomposed = unicodedata.normalize("NFKD", text.translate(FOLD))
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    return " ".join(re.sub(r"[\W_]+", " ", plain).split())


# Matched against folded text. "Izvor" is also an ordinary word in these courses
# ("izvor prijetnje", "IP adresa izvora", "izvorni program"), so it counts only in a
# phrase that cites a source; slides, lectures and lecturers count in any form.
REFERENCE = re.compile(
    r"\b(?:slajd\w*|predavanj\w*|predavac\w*"
    r"|(?:prema|u|iz|po|sa|na temelju|sukladno)"
    r" (?:navedenom |navedenim |ovom |ovim |danom |danim |prvom )?izvor(?:u|ima|a|om)"
    r"|izvori? (?:izricito |jasno |eksplicitno |takoder |izravno )?"
    r"(?:navod\w*|defini\w*|kaze|kazu|predlaz\w*|razlikuj\w*|opisuj\w*|tvrd\w*|spominj\w*"
    r"|preporuc\w*|naglas\w*|izdvaj\w*)"
    r"|[sp]\d{1,2} (?:navod\w*|defini\w*|kaze|opisuj\w*|tvrd\w*|spominj\w*|prikazuj\w*)"
    r"|jer izvor|izvor\w* [sp]\d{1,2}|potkrijepljen\w* izvor\w*"
    r"|(?:prema|u|iz|na temelju) (?:nastavnim |navedenim |danim )?materijal(?:u|ima|a)"
    r"|(?:u|prema) (?:navedenom|ovom|danom|prilozenom) tekstu|prema tekstu"
    r"|according to the (?:sources?|slides?|lectures?|text)"
    r"|(?:on|in) the (?:sources?|slides?|lectures?)"
    r"|the (?:sources?|slides?|lectures?) (?:says?|states?|mentions?|lists?|defines?))\b"
)
# "(S3)", "(P2, P4)", "(izvor S1)": prompt-local labels the student never sees.
LABEL = re.compile(r"\s*\(\s*(?:izvor\w*\s+)?[SP]\d{1,2}(?:\s*(?:,|i|and)\s*[SP]\d{1,2})*\s*\)")

_PLACE = (
    r"(?:navedenom\s+|navedenim\s+|ovom\s+|ovim\s+|danom\s+|danim\s+)?"
    r"(?:izvoru|izvorima|slajdu|slajdovima|predavanju|predavanjima|materijalima)"
)
_SAYS = r"(?:izričito\s+|jasno\s+)?(?:navodi|kaže|tvrdi|naglašava|opisuje|ističe)"
_WHO = r"(?:izvor|izvori|predavanje|slajd|slajdovi|predavač)"
# Lead-ins that only say where the rest of the sentence comes from.
_LEAD = (
    rf"(?:(?:Prema|Sukladno|Po)\s+{_PLACE}\s*,"
    rf"|(?:U|Na)\s+{_PLACE}\s*(?:,|(?:je|su)\s+(?:navedeno|prikazano|opisano|definirano|rečeno)"
    r"\s*(?:da\b|:|,)?)"
    rf"|Kao\s+što\s+(?:je|su)\s+(?:navedeno|prikazano|opisano)\s+(?:u|na)\s+{_PLACE}\s*,"
    rf"|Kako\s+{_SAYS}\s+{_WHO}\s*,"
    rf"|{_WHO}\s+{_SAYS}\s+da\b)\s*"
)
# After a dropped "... da" the clause must not open with a clitic ("da je X" -> "Je X").
_CLITIC = r"(?:je|se|su|sam|si|smo|ste|ga|mu|ih|im|joj|bi|li|će|ćemo)\b"
LEAD = re.compile(rf"(^|[.!?:]\s+){_LEAD}(?!{_CLITIC})(\S)", re.IGNORECASE)
BECAUSE = re.compile(rf"\b(jer|budući da)\s+{_WHO}\s+{_SAYS}\s+da\s+", re.IGNORECASE)
ASIDE = re.compile(
    rf"\s*\(\s*(?:prema|vidi|v\.|kako\s+navodi|kao\s+u)\s+{_PLACE}[^()]*\)", re.IGNORECASE
)
BETWEEN = re.compile(rf",\s*(?:prema|kako\s+navodi)\s+{_PLACE}\s*,", re.IGNORECASE)
TRAILING = re.compile(
    r",?\s+(?:prema|kao\s+u|kako\s+(?:je|su)\s+(?:navedeno|prikazano|opisano)\s+(?:u|na))"
    rf"\s+{_PLACE}\s*(?=[.;!?]|$)",
    re.IGNORECASE,
)


def text_fields(content: dict[str, Any]) -> Iterator[tuple[str, str]]:
    """(field, text) for every free-text field of a question; options as options.<i>."""
    for name in ("stem", "explanation", "reference_answer"):
        value = content.get(name)
        if isinstance(value, str) and value:
            yield name, value
    for index, option in enumerate(content.get("options") or []):
        if isinstance(option, dict) and isinstance(option.get("text"), str):
            yield f"options.{index}", option["text"]


def phrase(text: str) -> str | None:
    """The first phrase of text that points at a source, slide or lecture, if any."""
    label = LABEL.search(text)
    if label:
        return label.group(0)
    match = REFERENCE.search(fold(text))
    return match.group(0) if match else None


def references(content: dict[str, Any]) -> dict[str, str]:
    """{field: phrase} for every text field that points at a source."""
    return {name: found for name, text in text_fields(content) if (found := phrase(text))}


def strip_references(text: str) -> str:
    """text without the lead-ins and asides that only say where a fact came from."""
    out = LABEL.sub("", text)
    out = ASIDE.sub("", out)
    out = BETWEEN.sub(" ", out)
    out = TRAILING.sub("", out)
    out = BECAUSE.sub(lambda m: f"{m.group(1)} ", out)
    while (new := LEAD.sub(lambda m: m.group(1) + m.group(2).upper(), out)) != out:
        out = new
    if out == text:
        return text
    return re.sub(r" {2,}", " ", out).strip()


def strip_content(content: dict[str, Any]) -> dict[str, Any]:
    """A copy of the question with reference phrases removed from every text field."""
    cleaned = dict(content)
    for name in ("stem", "explanation", "reference_answer"):
        value = cleaned.get(name)
        if isinstance(value, str) and value:
            cleaned[name] = strip_references(value) or value
    if isinstance(cleaned.get("options"), list):
        cleaned["options"] = [
            {**option, "text": strip_references(option["text"]) or option["text"]}
            if isinstance(option, dict) and isinstance(option.get("text"), str)
            else option
            for option in cleaned["options"]
        ]
    return cleaned
