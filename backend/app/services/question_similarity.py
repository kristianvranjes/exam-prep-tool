"""Deterministic text similarity between a question and the course's approved bank (23d).

No AI: the stems become sets of normalized words and are compared by Jaccard overlap. It is a hint
for a moderator before accepting a proposal, not a duplicate rule.
"""

import re
import unicodedata
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from app.models.question import Question
from app.services.unit_moderation import access

# Short function words carry no meaning for the overlap (Croatian and English).
STOP_WORDS = frozenset(
    (
        "a i u na je se da li od do za iz ili su ne to sto koji koja koje kako "
        "the of is to in and or an"
    ).split()
)
MAX_CANDIDATES = 2000
LIMIT = 3


class SimilarQuestion(BaseModel):
    id: UUID
    stem: str
    # Jaccard overlap of the two stems' words, 0..1.
    similarity: float


def words(text: str) -> frozenset[str]:
    """Lower-case words without diacritics (đ as d), stop words and one-letter tokens."""
    folded = unicodedata.normalize("NFKD", text.replace("đ", "d").replace("Đ", "D").lower())
    plain = "".join(char for char in folded if not unicodedata.combining(char))
    return frozenset(
        token
        for token in re.findall(r"[a-z0-9]+", plain)
        if len(token) > 1 and token not in STOP_WORDS
    )


def jaccard(first: frozenset[str], second: frozenset[str]) -> float:
    if not first or not second:
        return 0.0
    return len(first & second) / len(first | second)


def similar_questions(db: Session, user: User, question_id: UUID) -> list[SimilarQuestion]:
    """The approved questions of the same course whose stems overlap this one most."""
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(404, "Question not found")
    access(db, user, question.course_id)
    own = words(question.stem)
    candidates = db.execute(
        select(Question.id, Question.stem)
        .where(
            Question.course_id == question.course_id,
            Question.status == "APPROVED",
            Question.id != question.id,
        )
        .order_by(Question.created_at.desc(), Question.id)
        .limit(MAX_CANDIDATES)
    ).all()
    scored = [
        SimilarQuestion(id=candidate_id, stem=stem, similarity=round(jaccard(own, words(stem)), 4))
        for candidate_id, stem in candidates
    ]
    best = sorted(
        (item for item in scored if item.similarity > 0), key=lambda item: -item.similarity
    )
    return best[:LIMIT]
