"""Regression tests for natural-language search.

Three things are worth testing here and one is not:

- **Query understanding** is tested on the *model's output shape*, not by
  calling the model. What breaks in production is a response wrapped in prose,
  a null where a string was promised, or a filter the query never asked for --
  all reproducible from a string.
- **Filter construction** is tested because a `where` clause that is subtly
  wrong returns plausible results, which is the worst failure mode available.
- **Ranking and snippets** are pure functions over dicts.

No network, no API keys, no embedding model. `parse_intent` (the one function
that calls Groq) is deliberately not tested -- it is a thin wrapper whose only
logic is "degrade on exception", and mocking a chat model to prove that would
test the mock.
"""

from datetime import datetime, timezone

import pytest

from rag.search import (
    _parse_created,
    _snippet,
    build_where,
    coerce_intent,
    post_filter,
    rank,
)

NOW = datetime(2026, 8, 21, tzinfo=timezone.utc)


# --- stage 1: reading the model's answer ------------------------------------


def test_a_clean_response_is_read_in_full():
    raw = """{
      "semantic_query": "slow performance latency timeout",
      "state": "open",
      "created_after": "2026-05-21",
      "created_before": null,
      "labels": ["Bug", "perf"],
      "author": "octocat",
      "unanswered": true,
      "min_reactions": 3,
      "sort": "recency"
    }"""
    intent = coerce_intent(raw, fallback="orig")
    assert intent["semantic_query"] == "slow performance latency timeout"
    assert intent["state"] == "open"
    assert intent["created_after"] == "2026-05-21"
    assert intent["created_before"] is None
    assert intent["labels"] == ["bug", "perf"]          # lowercased
    assert intent["author"] == "octocat"
    assert intent["unanswered"] is True
    assert intent["min_reactions"] == 3
    assert intent["sort"] == "recency"
    assert intent["understood"] is True


def test_json_wrapped_in_prose_or_fences_is_still_read():
    raw = 'Sure! Here is the plan:\n```json\n{"semantic_query": "memory leak"}\n```\nHope that helps.'
    intent = coerce_intent(raw, fallback="orig")
    assert intent["semantic_query"] == "memory leak"
    assert intent["understood"] is True


def test_an_unreadable_response_searches_the_text_as_typed():
    for raw in ("", "I cannot help with that.", "{not json at all}"):
        intent = coerce_intent(raw, fallback="crash on startup")
        assert intent["semantic_query"] == "crash on startup"
        assert intent["understood"] is False
        assert intent["state"] is None
        assert intent["labels"] == []
        # The UI needs to distinguish "no filter matched" from "no filter ran".
        assert intent["note"]


def test_an_empty_semantic_query_falls_back_to_the_question():
    """Otherwise the search embeds "" and returns an arbitrary k nearest."""
    intent = coerce_intent('{"semantic_query": "   ", "state": "open"}', fallback="auth bugs")
    assert intent["semantic_query"] == "auth bugs"
    assert intent["state"] == "open"


@pytest.mark.parametrize("value", ["OPEN", "Closed", "merged", "", None, 7])
def test_only_real_states_survive(value):
    intent = coerce_intent('{"semantic_query": "x", "state": %r}' % (value,), fallback="x")
    assert intent["state"] in ("open", "closed", None)


@pytest.mark.parametrize("bad", ["last week", "2026-13-99x", "21-08-2026", "2026/08/21", ""])
def test_malformed_dates_are_dropped_not_guessed(bad):
    intent = coerce_intent('{"semantic_query": "x", "created_after": "%s"}' % bad, fallback="x")
    assert intent["created_after"] is None


def test_a_hallucinated_sort_falls_back_to_relevance():
    intent = coerce_intent('{"semantic_query": "x", "sort": "by_vibes"}', fallback="x")
    assert intent["sort"] == "relevance"


def test_labels_are_capped_so_one_query_cannot_demand_everything():
    many = ", ".join('"l%d"' % i for i in range(20))
    intent = coerce_intent('{"semantic_query": "x", "labels": [%s]}' % many, fallback="x")
    assert len(intent["labels"]) == 6


def test_a_nonsense_min_reactions_becomes_none():
    for value in ('"lots"', "-4", "0", "null"):
        intent = coerce_intent('{"semantic_query": "x", "min_reactions": %s}' % value, fallback="x")
        assert intent["min_reactions"] is None


# --- stage 2a: the Chroma where clause --------------------------------------


def test_no_filters_produces_no_clause():
    """None, not {} -- an empty dict matches nothing on some Chroma versions."""
    intent = coerce_intent('{"semantic_query": "x"}', fallback="x")
    assert build_where(intent, dates_in_query=False) is None


def test_a_single_filter_is_not_wrapped_in_and():
    intent = coerce_intent('{"semantic_query": "x", "state": "open"}', fallback="x")
    assert build_where(intent, dates_in_query=False) == {"state": {"$eq": "open"}}


def test_unanswered_means_no_comments_at_all():
    """The weaker, checkable claim: the index has no collaborators list, so
    "no maintainer replied" cannot be distinguished from "nobody replied"."""
    intent = coerce_intent('{"semantic_query": "x", "unanswered": true}', fallback="x")
    assert build_where(intent, dates_in_query=False) == {"comments": {"$eq": 0}}


def test_several_filters_combine_with_and():
    intent = coerce_intent(
        '{"semantic_query": "x", "state": "open", "unanswered": true, "min_reactions": 2}',
        fallback="x",
    )
    where = build_where(intent, dates_in_query=False)
    assert "$and" in where
    assert {"state": {"$eq": "open"}} in where["$and"]
    assert {"comments": {"$eq": 0}} in where["$and"]
    assert {"reactions": {"$gte": 2}} in where["$and"]


def test_dates_enter_the_query_only_when_the_index_supports_it():
    """Chroma rejects range operators on the ISO string field, so a date window
    is only expressible against a collection carrying numeric `created_ts`."""
    intent = coerce_intent(
        '{"semantic_query": "x", "created_after": "2026-01-01"}', fallback="x"
    )
    assert build_where(intent, dates_in_query=False) is None

    where = build_where(intent, dates_in_query=True)
    assert where == {"created_ts": {"$gte": 1767225600}}


def test_labels_never_enter_the_query():
    """Labels are stored comma-joined, so $eq would only match an issue whose
    entire label set is exactly that one label."""
    intent = coerce_intent('{"semantic_query": "x", "labels": ["bug"]}', fallback="x")
    assert build_where(intent, dates_in_query=False) is None


# --- stage 2b: what Chroma cannot express -----------------------------------


def hit(number, **kw):
    base = {
        "number": number,
        "title": f"Issue {number}",
        "state": "open",
        "labels": [],
        "author": "a",
        "created_at": "2026-06-01T00:00:00Z",
        "comments": 0,
        "reactions": 0,
        "score": 0.5,
        "snippet": "",
        "agent": None,
    }
    base.update(kw)
    return base


def test_the_date_window_is_applied_when_the_query_could_not():
    hits = [
        hit(1, created_at="2026-01-15T00:00:00Z"),
        hit(2, created_at="2026-07-15T00:00:00Z"),
    ]
    intent = coerce_intent('{"semantic_query": "x", "created_after": "2026-06-01"}', fallback="x")
    kept = post_filter(hits, intent, dates_in_query=False)
    assert [h["number"] for h in kept] == [2]


def test_the_date_window_is_not_applied_twice():
    hits = [hit(1, created_at="2026-01-15T00:00:00Z")]
    intent = coerce_intent('{"semantic_query": "x", "created_after": "2026-06-01"}', fallback="x")
    # Chroma already excluded non-matching rows; re-applying would be harmless
    # here but wrong in general, since the query fetched exactly k.
    assert post_filter(hits, intent, dates_in_query=True) == hits


def test_an_undated_issue_cannot_satisfy_a_date_filter():
    hits = [hit(1, created_at=""), hit(2, created_at="2026-07-01T00:00:00Z")]
    intent = coerce_intent('{"semantic_query": "x", "created_after": "2026-06-01"}', fallback="x")
    kept = post_filter(hits, intent, dates_in_query=False)
    assert [h["number"] for h in kept] == [2]


def test_a_label_matches_a_member_of_the_set_not_the_whole_set():
    hits = [
        hit(1, labels=["bug", "performance"]),
        hit(2, labels=["docs"]),
        hit(3, labels=[]),
    ]
    intent = coerce_intent('{"semantic_query": "x", "labels": ["bug"]}', fallback="x")
    kept = post_filter(hits, intent, dates_in_query=False)
    assert [h["number"] for h in kept] == [1]


def test_any_requested_label_is_enough():
    hits = [hit(1, labels=["docs"]), hit(2, labels=["nothing"])]
    intent = coerce_intent('{"semantic_query": "x", "labels": ["bug", "docs"]}', fallback="x")
    assert [h["number"] for h in post_filter(hits, intent, dates_in_query=False)] == [1]


# --- stage 3: ranking -------------------------------------------------------


def test_similarity_dominates_relevance_ranking():
    hits = [hit(1, score=0.2), hit(2, score=0.9)]
    intent = coerce_intent('{"semantic_query": "x"}', fallback="x")
    assert [h["number"] for h in rank(hits, intent, now=NOW)] == [2, 1]


def test_engagement_breaks_a_similarity_tie():
    hits = [hit(1, score=0.5, comments=0), hit(2, score=0.5, comments=40)]
    intent = coerce_intent('{"semantic_query": "x"}', fallback="x")
    assert [h["number"] for h in rank(hits, intent, now=NOW)] == [2, 1]


def test_agent_confidence_breaks_a_tie():
    hits = [
        hit(1, score=0.5),
        hit(2, score=0.5, agent={"decision": "escalate", "confidence": 0.95}),
    ]
    intent = coerce_intent('{"semantic_query": "x"}', fallback="x")
    assert [h["number"] for h in rank(hits, intent, now=NOW)] == [2, 1]


def test_asking_for_the_newest_sorts_by_date_not_by_blend():
    """Someone who asked for recency meant it; quietly re-mixing similarity
    back in answers a question they did not ask."""
    hits = [
        hit(1, score=0.99, created_at="2020-01-01T00:00:00Z"),
        hit(2, score=0.10, created_at="2026-08-01T00:00:00Z"),
    ]
    intent = coerce_intent('{"semantic_query": "x", "sort": "recency"}', fallback="x")
    assert [h["number"] for h in rank(hits, intent, now=NOW)] == [2, 1]


def test_asking_for_the_most_discussed_sorts_by_engagement():
    hits = [hit(1, score=0.99, comments=0), hit(2, score=0.10, comments=5, reactions=30)]
    intent = coerce_intent('{"semantic_query": "x", "sort": "engagement"}', fallback="x")
    assert [h["number"] for h in rank(hits, intent, now=NOW)] == [2, 1]


def test_an_undated_issue_does_not_crash_recency_sorting():
    hits = [hit(1, created_at=""), hit(2, created_at="2026-08-01T00:00:00Z")]
    intent = coerce_intent('{"semantic_query": "x", "sort": "recency"}', fallback="x")
    assert len(rank(hits, intent, now=NOW)) == 2


def test_rank_scores_stay_in_unit_range():
    hits = [hit(1, score=1.0, comments=999, reactions=999,
                created_at=NOW.isoformat(), agent={"confidence": 1.0})]
    intent = coerce_intent('{"semantic_query": "x"}', fallback="x")
    assert 0.0 <= rank(hits, intent, now=NOW)[0]["rank_score"] <= 1.0


# --- snippets and timestamps ------------------------------------------------


def test_the_snippet_is_the_passage_that_matches_the_query():
    body = (
        "Steps to reproduce are below.\n\n"
        "The server allocates memory on every request and never frees it.\n\n"
        "My editor theme is solarized."
    )
    assert "memory" in _snippet(body, "memory leak allocation")


def test_the_snippet_falls_back_to_the_opening_passage():
    body = "First paragraph.\n\nSecond paragraph."
    assert _snippet(body, "zzz nothing matches") == "First paragraph."
    assert _snippet("", "anything") == ""


def test_the_snippet_is_bounded():
    assert len(_snippet("word " * 500, "word")) <= 320


@pytest.mark.parametrize(
    "value",
    ["2026-08-21T02:14:07Z", "2026-02-21", "2026-08-21T02:14:07+05:30"],
)
def test_every_parsed_timestamp_is_timezone_aware(value):
    """The bug this pins: `fromisoformat("2026-02-21")` returns a *naive*
    datetime, and comparing it to an aware issue timestamp raises
    "can't compare offset-naive and offset-aware datetimes" -- which took out
    every dated query until it was normalised here."""
    parsed = _parse_created(value)
    assert parsed is not None
    assert parsed.tzinfo is not None
    assert (parsed - NOW) is not None      # the comparison that used to raise


def test_an_unparseable_timestamp_is_none_not_an_exception():
    assert _parse_created("") is None
    assert _parse_created("yesterday") is None
