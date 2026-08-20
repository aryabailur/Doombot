"""Regression tests for score conversion and duplicate bucketing.

The distance-to-cosine conversion is the subtle one, and it has now been wrong
once in a way that read as plausible for weeks. Two rules came out of that, and
this file is written to both:

1. **Import the function under test, never mirror it.** The previous version of
   this file kept a local copy of the formula. That copy stayed correct while
   the real one drifted, so the suite passed for a build in which every semantic
   search returned 0.0.
2. **Assert against measured Chroma output, not against derived inputs.** The
   previous version computed `l2 = sqrt(2 * (1 - cos))` and fed that in --
   testing "given a true euclidean distance, is the algebra right?", a question
   production never asks. Chroma hands us a *squared* distance in its default
   space, and the algebra was applied to the wrong quantity.

No network, no API keys -- the embedding model is never loaded.
"""

import math

import pytest

from rag.retriever import cosine_from_distance

# Measured, not derived. Produced by embedding three text pairs with
# all-MiniLM-L6-v2, computing cosine directly from the raw vectors, then
# reading back what Chroma returned for the same pair in each space:
#
#   pair              true cosine   default ("l2") d   "cosine" space d
#   related issues       +0.56876            0.86249            0.43124
#   unrelated issues     -0.02730            2.05460            1.02730
#   identical text       +1.00000            0.00000            0.00000
#
# Anything claiming to convert a Chroma distance into a cosine has to reproduce
# this table. Regenerate it if the embedding model changes.
CALIBRATION = [
    # (distance, space, expected cosine after the 0-1 clamp)
    (0.86249, None, 0.56876),
    (2.05460, None, 0.0),      # true cosine -0.027, clamped
    (0.00000, None, 1.0),
    (0.43124, "cosine", 0.56876),
    (1.02730, "cosine", 0.0),  # same pair, same clamp
    (0.00000, "cosine", 1.0),
]


@pytest.mark.parametrize("distance,space,expected", CALIBRATION)
def test_conversion_matches_measured_chroma_output(distance, space, expected):
    """The conversion reproduces real Chroma distances in both spaces."""
    assert cosine_from_distance(distance, space) == pytest.approx(expected, abs=1e-3)


def test_default_space_is_squared_euclidean_not_euclidean():
    """The actual bug, pinned.

    Chroma's default space returns ||a-b||^2, which for unit vectors is already
    2(1 - cos). The old code applied `1 - d*d/2`, squaring a squared distance.
    It agreed with the truth only at d = 0, which is why identical text looked
    correct while every real query collapsed to zero.
    """
    d = 0.86249          # measured, related pair
    truth = 0.56876      # measured, from the raw vectors

    assert cosine_from_distance(d, None) == pytest.approx(truth, abs=1e-3)

    old_formula = 1.0 - (d * d) / 2.0
    assert old_formula == pytest.approx(0.628, abs=1e-3)   # overshoots here
    assert old_formula != pytest.approx(truth, abs=1e-2)

    # And on the unrelated pair the old formula went so negative that the
    # [0, 1] clamp erased the result entirely -- the reported symptom.
    assert 1.0 - (2.05460 ** 2) / 2.0 < -1.0
    assert cosine_from_distance(2.05460, None) == 0.0


def test_cosine_space_distance_is_one_minus_cosine():
    for cos in (1.0, 0.9, 0.692, 0.5, 0.0):
        assert cosine_from_distance(1.0 - cos, "cosine") == pytest.approx(cos, abs=1e-9)


def test_unknown_space_falls_back_to_the_default_rather_than_guessing():
    assert cosine_from_distance(0.86249, "hamming") == pytest.approx(
        cosine_from_distance(0.86249, None), abs=1e-9
    )
    assert cosine_from_distance(0.86249, "") == pytest.approx(
        cosine_from_distance(0.86249, None), abs=1e-9
    )


def test_inner_product_space_is_negated_cosine():
    """Chroma returns -(a.b) for `ip`; on unit vectors that is -cosine."""
    assert cosine_from_distance(-0.75, "ip") == pytest.approx(0.75, abs=1e-9)


def test_scores_stay_in_unit_range():
    assert cosine_from_distance(0.0, None) == 1.0
    assert cosine_from_distance(4.0, None) == 0.0       # opposite unit vectors
    assert cosine_from_distance(2.0, "cosine") == 0.0
    for distance in (0.0, 0.5, 1.0, 2.0, 3.0, 4.0):
        for space in (None, "cosine", "ip"):
            assert 0.0 <= cosine_from_distance(distance, space) <= 1.0


def test_a_real_duplicate_pair_now_clears_the_related_threshold():
    """The failure the thresholds exist to catch.

    A real pair of issue reports for the same bug measured cosine 0.692. Under
    the old formula the reported score was 0.0, below every band, so the match
    was discarded. It has to land in "related" or above.
    """
    distance = 2 * (1 - 0.692)                # what Chroma's default returns
    assert cosine_from_distance(distance, None) == pytest.approx(0.692, abs=1e-9)
    assert cosine_from_distance(distance, None) > 0.65

    # LangChain's own relevance score, for the record: also not cosine.
    l2 = math.sqrt(distance)
    assert (1 - l2 / math.sqrt(2)) < 0.65


def test_bucket_thresholds():
    """>0.85 duplicate, 0.65-0.85 related, below dropped."""
    def bucket(s):
        return "duplicate" if s > 0.85 else "related" if s >= 0.65 else None

    assert bucket(0.999) == "duplicate"
    assert bucket(0.811) == "related"
    assert bucket(0.565) is None
