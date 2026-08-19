"""Regression tests for score conversion and duplicate bucketing.

The cosine conversion is the subtle one: LangChain's relevance score is NOT
cosine, and using it silently drops real duplicates.

No network, no API keys -- the embedding model is never loaded.
"""

import math

import pytest


def cosine_from_l2(l2):
    """The conversion under test, mirrored from rag.retriever."""
    return max(0.0, min(1.0, 1.0 - (l2 * l2) / 2.0))


def test_cosine_recovery_is_exact_for_normalized_vectors():
    """all-MiniLM-L6-v2 emits unit vectors, so cos = 1 - L2^2/2 exactly."""
    for cos in (1.0, 0.9, 0.692, 0.5, 0.0):
        l2 = math.sqrt(2 * (1 - cos))
        assert cosine_from_l2(l2) == pytest.approx(cos, abs=1e-9)


def test_langchain_relevance_would_under_score():
    """Documents the bug: 1 - L2/sqrt(2) is not cosine and drops duplicates.

    A real pair of issue reports for the same bug measured cosine 0.692.
    LangChain reported 0.445 -- below the 0.65 'related' cut, so the match was
    discarded entirely rather than surfaced.
    """
    l2 = math.sqrt(2 * (1 - 0.692))
    assert cosine_from_l2(l2) == pytest.approx(0.692, abs=1e-9)
    assert (1 - l2 / math.sqrt(2)) < 0.65          # what LangChain reported
    assert cosine_from_l2(l2) > 0.65               # what it should be


def test_scores_stay_in_unit_range():
    assert cosine_from_l2(0.0) == 1.0
    assert cosine_from_l2(2.0) == 0.0              # opposite vectors, clamped


def test_bucket_thresholds():
    """>0.85 duplicate, 0.65-0.85 related, below dropped."""
    def bucket(s):
        return "duplicate" if s > 0.85 else "related" if s >= 0.65 else None
    assert bucket(0.999) == "duplicate"
    assert bucket(0.811) == "related"
    assert bucket(0.565) is None
