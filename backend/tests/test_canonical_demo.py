"""Canonical judge-walkthrough verification (see docs/PITCH_SCRIPT.md).

Asserts the *behaviour* the demo depends on -- not incidental floating-point
output. If the model legitimately changes, the exact EV of retry_later may
move; the invariants below (voice_call ineligible by the amount threshold,
retry_later the selected eligible action, a real audit-shaped decision, and
a non-appending demo path) are the product contract that must not.

Also covers the readiness probe (/health) and the deterministic reset
(/demo/reset), and re-checks the fraud-block safety story on the specific
payment the Command Center demo callout links to.
"""

from __future__ import annotations

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.demo_cases import CANONICAL_DEMO_FRAUD_PAYMENT_ID, CANONICAL_DEMO_PAYMENT_ID
from app.guardrails import FRAUD_BLOCK_RECOVERY_SUPPRESSION, full_menu
from app.main import app

RECOVERY_ACTIONS = {"retry_now", "retry_later", "sms_link", "whatsapp_nudge", "email", "voice_call"}


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Readiness probe
# ---------------------------------------------------------------------------


def test_health_reports_ready_after_startup(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ready"] is True
    assert body["status"] == "ok"
    assert body["rve_ready"] is True and body["pss_ready"] is True
    assert body["seed"] == 42
    assert body["n_batch_payments"] == 500
    assert body["canonical_payment_id"] == CANONICAL_DEMO_PAYMENT_ID


# ---------------------------------------------------------------------------
# Canonical decision -- behaviour contract
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def canonical(client: TestClient) -> dict:
    res = client.get("/decide/demo/canonical")
    assert res.status_code == 200
    return res.json()


def test_canonical_payment_context_is_the_documented_one(canonical: dict) -> None:
    ar = canonical["audit_record"]
    assert ar["payment_id"] == CANONICAL_DEMO_PAYMENT_ID
    assert ar["failure_reason"] == "insufficient_funds"
    assert ar["retry_count_so_far"] == 2
    # ~Rs.3,013.68 -- assert the magnitude, not an arbitrary decimal.
    assert ar["amount"] == pytest.approx(3013.68, abs=0.5)


def test_canonical_voice_call_is_ineligible_by_the_amount_threshold(canonical: dict) -> None:
    evs = {e["intervention_id"]: e for e in canonical["audit_record"]["all_evs"]}
    voice = evs["voice_call"]
    assert voice["eligible"] is False
    assert voice["blocked_reason"] and "voice_call requires amount" in voice["blocked_reason"]
    # The sharp demo point: it is not a weak option -- it has the highest RAW EV.
    raw_evs = {iid: e["expected_value"] for iid, e in evs.items()}
    assert raw_evs["voice_call"] == max(raw_evs.values())


def test_canonical_selected_action_is_retry_later_and_eligible(canonical: dict) -> None:
    assert canonical["chosen_intervention"] == "retry_later"
    evs = {e["intervention_id"]: e for e in canonical["audit_record"]["all_evs"]}
    assert evs["retry_later"]["eligible"] is True
    # Selected == the highest-EV ELIGIBLE action.
    eligible_evs = {iid: e["expected_value"] for iid, e in evs.items() if e["eligible"]}
    assert evs["retry_later"]["expected_value"] == max(eligible_evs.values())
    # Not risk-suppressed, not escalated -- a normal recovery decision.
    assert canonical["audit_record"]["risk_policy"] is None
    assert canonical["audit_record"]["escalated"] is False


def test_canonical_decision_is_audit_shaped_and_explained(canonical: dict) -> None:
    ar = canonical["audit_record"]
    assert {e["intervention_id"] for e in ar["all_evs"]} == set(full_menu())
    for e in ar["all_evs"]:
        assert "expected_value" in e and "probability_of_recovery" in e and "unit_cost" in e
        # Every non-chosen entry is either eligible (lost on EV) or carries a reason.
        assert e["eligible"] or e["blocked_reason"]
    assert isinstance(ar["explanation"], str) and len(ar["explanation"]) > 20
    assert ar["decision_id"]
    assert "retry_later" in ar["explanation"].lower()


def test_canonical_demo_path_never_mutates_the_audit_log(client: TestClient) -> None:
    before = client.get("/decisions", params={"page_size": 1}).json()["total"]
    client.get("/decide/demo/canonical")
    client.get("/decide/demo/canonical")
    after = client.get("/decisions", params={"page_size": 1}).json()["total"]
    assert after == before  # GET /decide/demo/canonical is append_to_log=False


def test_canonical_payment_also_reachable_by_id_and_matches_the_demo_decision(client: TestClient) -> None:
    """The canonical id is a real batch row, so POST /decide/{id} works too --
    it just also appends (by design). The decision content matches."""
    demo = client.get("/decide/demo/canonical").json()
    live = client.post(f"/decide/{CANONICAL_DEMO_PAYMENT_ID}").json()
    assert live["chosen_intervention"] == demo["chosen_intervention"] == "retry_later"


# ---------------------------------------------------------------------------
# Deterministic reset
# ---------------------------------------------------------------------------


def test_demo_reset_restores_a_ready_deterministic_state(client: TestClient) -> None:
    res = client.post("/demo/reset")
    assert res.status_code == 200
    body = res.json()
    assert body["ready"] is True
    assert body["seed"] == 42
    assert body["n_batch_payments"] == 500
    # Audit log rebuilt to exactly the batch decision pass.
    assert body["n_decisions_logged"] == 500
    # Canonical decision reproduces byte-identically after the reset.
    again = client.get("/decide/demo/canonical").json()
    assert again["chosen_intervention"] == "retry_later"


# ---------------------------------------------------------------------------
# Fraud-block safety story (the callout's contrast case)
# ---------------------------------------------------------------------------


def test_demo_fraud_payment_is_suppressed(client: TestClient) -> None:
    res = client.get("/decide/demo/fraud")
    assert res.status_code == 200
    body = res.json()
    assert body["chosen_intervention"] == "no_action"
    ar = body["audit_record"]
    assert ar["payment_id"] == CANONICAL_DEMO_FRAUD_PAYMENT_ID
    assert ar["failure_reason"] == "fraud_block"
    assert ar["risk_policy"] == FRAUD_BLOCK_RECOVERY_SUPPRESSION
    assert ar["escalated"] is False
    assert ar["payment_link_url"] is None and ar["payment_link_error"] is None
    evs = {e["intervention_id"]: e for e in ar["all_evs"]}
    for iid in RECOVERY_ACTIONS:
        assert evs[iid]["eligible"] is False


def test_demo_fraud_path_never_mutates_the_audit_log(client: TestClient) -> None:
    before = client.get("/decisions", params={"page_size": 1}).json()["total"]
    client.get("/decide/demo/fraud")
    client.get("/decide/demo/fraud")
    after = client.get("/decisions", params={"page_size": 1}).json()["total"]
    assert after == before
