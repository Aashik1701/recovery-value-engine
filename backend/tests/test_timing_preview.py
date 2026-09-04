"""Optimal Recovery Timing -- heuristic PREVIEW only (see
docs/Timing preview brief.md, docs/ROADMAP.md).

Independent of the default pinned batch and the trained model -- this
feature is pure heuristic-table lookup + arithmetic, so these tests never
touch default_startup_model/default_startup_bundle and never assert against
any pinned economic number from test_recovery_lab.py or test_evaluator.py.

Also asserts the hard boundary from the brief: this feature is never
imported by main._run_decision, optimizer.py, evaluator.py, or
recovery_lab.py.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app import timing_preview
from app.main import app
from app.models import INTERVENTION_UNIT_COSTS

APP_DIR = Path(__file__).resolve().parent.parent / "app"


# ---------------------------------------------------------------------------
# The hard boundary (brief Section 7 / acceptance checklist item 4): this
# module must never be imported by the live decision path.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("protected_file", ["optimizer.py", "evaluator.py", "recovery_lab.py"])
def test_timing_preview_not_referenced_by_protected_modules(protected_file: str) -> None:
    text = (APP_DIR / protected_file).read_text()
    assert "timing_preview" not in text


def test_run_decision_body_does_not_reference_timing_preview() -> None:
    """main.py DOES import timing_preview (for its own standalone route --
    that's expected and required), but the shared `_run_decision` pipeline
    function itself must not reference it anywhere in its body."""
    main_src = (APP_DIR / "main.py").read_text()
    start = main_src.index("def _run_decision(")
    # _run_decision is followed by _decide_demo_low_confidence's sibling
    # helper / end of file in practice; take a generous slice and stop at
    # the next top-level `def ` / `@app.` at column 0 after the signature.
    body_and_after = main_src[start:]
    next_def = body_and_after.index("\ndef ", 1)
    next_route = body_and_after.find("\n@app.", 1)
    end = min(x for x in (next_def, next_route) if x != -1)
    run_decision_body = body_and_after[:end]
    assert "timing_preview" not in run_decision_body


# ---------------------------------------------------------------------------
# Heuristic table -- exact values from the brief (Section 2), not rounded or
# adjusted.
# ---------------------------------------------------------------------------


def test_heuristic_table_matches_brief_exactly() -> None:
    expected = {
        "insufficient_funds": {
            "now": 0.12, "plus_30min": 0.14, "plus_2h": 0.18,
            "plus_6h": 0.25, "tomorrow_am": 0.45, "tomorrow_pm": 0.55,
        },
        "bank_timeout": {
            "now": 0.70, "plus_30min": 0.65, "plus_2h": 0.55,
            "plus_6h": 0.45, "tomorrow_am": 0.35, "tomorrow_pm": 0.30,
        },
        "network_error": {
            "now": 0.68, "plus_30min": 0.63, "plus_2h": 0.52,
            "plus_6h": 0.42, "tomorrow_am": 0.32, "tomorrow_pm": 0.28,
        },
        "card_expired": {
            "now": 0.02, "plus_30min": 0.02, "plus_2h": 0.02,
            "plus_6h": 0.02, "tomorrow_am": 0.02, "tomorrow_pm": 0.02,
        },
        "other": {
            "now": 0.30, "plus_30min": 0.30, "plus_2h": 0.28,
            "plus_6h": 0.26, "tomorrow_am": 0.24, "tomorrow_pm": 0.22,
        },
    }
    assert timing_preview.HEURISTIC_TIMING_CURVES == expected


def test_fraud_block_excluded_from_heuristic_table() -> None:
    assert "fraud_block" not in timing_preview.HEURISTIC_TIMING_CURVES


def test_all_bucket_ids_present_in_every_curve() -> None:
    for reason, curve in timing_preview.HEURISTIC_TIMING_CURVES.items():
        assert set(curve.keys()) == set(timing_preview.TIMING_BUCKET_IDS), reason


# ---------------------------------------------------------------------------
# build_timing_preview -- pure computation, no model/state.
# ---------------------------------------------------------------------------


def test_insufficient_funds_scenario_recommends_waiting() -> None:
    """The 'wait' story: probability rises with time, so the argmax should
    land on a later bucket, not 'now'."""
    result = timing_preview.build_timing_preview("insufficient_funds_wait")
    assert result["failure_reason"] == "insufficient_funds"
    assert result["recommended_bucket_id"] != "now"
    assert result["timing_lever_relevant"] is True
    assert result["timing_not_the_lever_note"] is None


def test_bank_timeout_scenario_recommends_now() -> None:
    """The 'act now' story -- required so the demo doesn't only know how to
    say 'wait' (brief Section 3)."""
    result = timing_preview.build_timing_preview("bank_timeout_now")
    assert result["failure_reason"] == "bank_timeout"
    assert result["recommended_bucket_id"] == "now"
    assert result["timing_lever_relevant"] is True
    assert result["timing_not_the_lever_note"] is None


def test_card_expired_scenario_flags_timing_not_the_lever() -> None:
    result = timing_preview.build_timing_preview("card_expired_flat")
    assert result["failure_reason"] == "card_expired"
    assert result["timing_lever_relevant"] is False
    assert result["timing_not_the_lever_note"] == (
        "timing has negligible effect for this failure reason — the decision "
        "that matters here is which action, not when."
    )


def test_ev_uses_the_real_intervention_menu_cost_not_invented_logic() -> None:
    for scenario_id in timing_preview.list_scenario_ids():
        result = timing_preview.build_timing_preview(scenario_id)
        expected_cost = INTERVENTION_UNIT_COSTS[result["action_intervention_id"]]
        assert result["action_unit_cost"] == expected_cost
        for candidate in result["candidates"]:
            expected_ev = candidate["probability_of_recovery"] * result["amount"] - expected_cost
            assert candidate["expected_value"] == pytest.approx(expected_ev)


def test_recommended_bucket_is_the_true_argmax() -> None:
    for scenario_id in timing_preview.list_scenario_ids():
        result = timing_preview.build_timing_preview(scenario_id)
        best = max(result["candidates"], key=lambda c: c["expected_value"])
        assert result["recommended_bucket_id"] == best["bucket_id"]
        assert best["is_recommended"] is True
        assert sum(1 for c in result["candidates"] if c["is_recommended"]) == 1


def test_every_response_is_flagged_as_a_heuristic_preview_with_the_exact_note() -> None:
    for scenario_id in timing_preview.list_scenario_ids():
        result = timing_preview.build_timing_preview(scenario_id)
        assert result["is_heuristic_preview"] is True
        assert result["note"] == "Illustrative timing curves, not fitted from data — see ROADMAP.md"


def test_unknown_scenario_raises() -> None:
    with pytest.raises(timing_preview.UnknownTimingScenario):
        timing_preview.build_timing_preview("does_not_exist")


def test_at_least_one_wait_and_one_act_now_scenario_exist() -> None:
    scenarios = timing_preview.list_scenario_ids()
    assert "insufficient_funds_wait" in scenarios
    assert "bank_timeout_now" in scenarios


# ---------------------------------------------------------------------------
# The standalone endpoint, end to end.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def test_endpoint_returns_200_for_every_scenario(client: TestClient) -> None:
    for scenario_id in timing_preview.list_scenario_ids():
        resp = client.get(f"/decide/demo/timing-preview/{scenario_id}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["is_heuristic_preview"] is True
        assert "see roadmap.md" in body["note"].lower()
        assert body["scenario"] == scenario_id


def test_endpoint_unknown_scenario_returns_404(client: TestClient) -> None:
    resp = client.get("/decide/demo/timing-preview/not_a_real_scenario")
    assert resp.status_code == 404


def test_endpoint_response_never_appears_in_decisions_list(client: TestClient) -> None:
    """This preview must never be appended to the audit log -- confirm the
    demo payment ids it uses never show up in /decisions."""
    for scenario_id in timing_preview.list_scenario_ids():
        client.get(f"/decide/demo/timing-preview/{scenario_id}")

    resp = client.get("/decisions?page=1&page_size=500")
    assert resp.status_code == 200
    payment_ids = {d["payment_id"] for d in resp.json()["decisions"]}
    for scenario_id in timing_preview.list_scenario_ids():
        result = timing_preview.build_timing_preview(scenario_id)
        assert result["payment_id"] not in payment_ids
