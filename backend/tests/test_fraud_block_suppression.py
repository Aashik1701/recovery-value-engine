"""P0 safety regression: hard `fraud_block` recovery suppression.

For any payment classified `fraud_block`, the system must never initiate a
revenue-recovery contact, retry, incentive, escalation, or Razorpay call --
the risk policy (guardrails.recovery_suppression_policy) takes precedence
over the probability model, the EV optimizer, the Negotiation Engine, and
every execution path. The only permitted outcome is `no_action`.

Coverage map (from the P0 brief):
  A. RVE decision: fraud_block -> no_action
  B. Paid channel suppression (sms_link / whatsapp_nudge / email / voice_call)
  C. Retry suppression (retry_now / retry_later)
  D. Incentive suppression (Rs.0)
  E. Direct Negotiation API respects the policy independently
  F. Execution boundary: no Razorpay payment link is created
  G. Audit: the suppression decision is recorded (risk_policy set)
  H. Opportunity queue: fraud_block rows are not actionable recovery opportunities
  I. Recovery Lab: fraud_block payments cannot consume recovery/contact capacity
  (J. regression = the full suite; run separately)
  + the dataset-level invariant the audit's "30 fraud / 23 contacted" finding
    motivated: across the whole synthetic startup batch,
    fraud_block contacts / retries / incentives / executions / escalations == 0.
"""

from __future__ import annotations

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app import negotiation_engine, recovery_lab
from app.guardrails import (
    FRAUD_BLOCK_RECOVERY_SUPPRESSION,
    apply_guardrails,
    full_menu,
    recovery_suppression_policy,
)
from app.main import app
from app.models import NON_CONTACT_INTERVENTIONS

CONTACT_CHANNELS = {"sms_link", "whatsapp_nudge", "email", "voice_call"}
RETRY_ACTIONS = {"retry_now", "retry_later"}
RECOVERY_ACTIONS = CONTACT_CHANNELS | RETRY_ACTIONS


# ---------------------------------------------------------------------------
# The canonical policy object itself
# ---------------------------------------------------------------------------


def test_canonical_policy_only_fires_for_fraud_block() -> None:
    assert recovery_suppression_policy("fraud_block") == FRAUD_BLOCK_RECOVERY_SUPPRESSION
    for reason in ("insufficient_funds", "bank_timeout", "network_error", "card_expired", "other", None):
        assert recovery_suppression_policy(reason) is None


def test_apply_guardrails_collapses_fraud_block_to_no_action_only() -> None:
    eligible, blocked = apply_guardrails(
        full_menu(), amount=25_000.0, customer_id="c1", suppression_list=set(), failure_reason="fraud_block"
    )
    # B + C: nothing but no_action survives -- no paid channel, no retry.
    assert eligible == ["no_action"]
    for iid in full_menu():
        if iid == "no_action":
            assert iid not in blocked
        else:
            assert iid in blocked
            assert "risk policy" in blocked[iid].lower()


def test_apply_guardrails_leaves_legitimate_failure_reasons_untouched() -> None:
    """Regression guard for the P0 brief's "do not turn the system into
    all-risky -> no_action" requirement: only the explicit fraud_block
    policy hard-suppresses. insufficient_funds still flows normally."""
    # Amount above the voice-call threshold so the only thing that could
    # remove an option here is the (absent) risk policy.
    eligible, blocked = apply_guardrails(
        full_menu(), amount=25_000.0, customer_id="c1", suppression_list=set(), failure_reason="insufficient_funds"
    )
    assert set(eligible) == set(full_menu())  # nothing risk-suppressed
    assert blocked == {}

    # And below the voice threshold, only voice_call is blocked -- by the
    # amount threshold, not the risk policy (the P0 fix must not over-reach).
    eligible_low, blocked_low = apply_guardrails(
        full_menu(), amount=3_013.68, customer_id="c1", suppression_list=set(), failure_reason="insufficient_funds"
    )
    assert set(blocked_low) == {"voice_call"}
    assert "risk policy" not in blocked_low["voice_call"].lower()


# ---------------------------------------------------------------------------
# D + E: Recovery Negotiation Engine independently respects the policy
# ---------------------------------------------------------------------------


def test_negotiation_eligibility_blocks_every_incentive_for_fraud_block() -> None:
    reasons = negotiation_engine.determine_candidate_eligibility(
        levels=[0.0, 50.0, 100.0, 250.0, 500.0],
        base_intervention_id="no_action",
        base_eligible=True,
        base_blocked_reason=None,
        failure_reason="fraud_block",
        policy=negotiation_engine.DEFAULT_GUARDRAIL_POLICY,
    )
    assert all(reasons[c] is not None for c in reasons)  # NOTHING eligible, not even Rs.0
    assert all("risk policy" in reasons[c].lower() for c in reasons)


def test_negotiation_analyze_end_to_end_produces_no_incentive_for_fraud_block() -> None:
    """Even called directly with a paid base intervention, analyze_negotiation
    cannot recommend an incentive for a fraud-flagged payment."""

    class _StubModel:
        def predict_proba_for_intervention(self, payment, customer, intervention_id):
            return 0.20  # a real, nonzero modeled probability -- policy still wins

    payment = {"payment_id": "pay_fraud", "customer_id": "c1", "amount": 9_000.0, "failure_reason": "fraud_block"}
    result = negotiation_engine.analyze_negotiation(
        payment, {"ltv": 5000.0, "past_success_rate": 0.4}, "sms_link", _StubModel(), set(), 0,
    )
    assert result.optimum_candidate is None
    assert result.minimum_effective_intervention is None
    assert result.max_recovery_probability_candidate is None
    assert all(not c.eligible for c in result.candidates)
    assert all((c.expected_net_value is None and c.recovery_probability is None) for c in result.candidates)


# ---------------------------------------------------------------------------
# I: Recovery Lab -- fraud_block cannot consume recovery/contact capacity
# ---------------------------------------------------------------------------


def test_recovery_lab_rve_adaptive_row_suppresses_fraud_block() -> None:
    fraud_payment = {"payment_id": "p1", "customer_id": "c1", "amount": 8_000.0, "failure_reason": "fraud_block"}
    # A model that would love to contact -- high probability on every channel.
    probs = {iid: 0.9 for iid in full_menu()}
    choice, raw_ideal, eligible_ids, _ = recovery_lab._decide_row(
        "rve_adaptive", fraud_payment, {"customer_id": "c1"}, probs,
        intensity_channels=recovery_lab.CONTACT_INTENSITY_CHANNELS["high"],
        suppression_list=set(), prior_contact_count=0, max_contacts_per_customer=2,
    )
    assert choice == "no_action"
    assert eligible_ids == ["no_action"]


def test_recovery_lab_naive_always_retry_row_is_left_naive() -> None:
    """The naive archetype baselines deliberately model "no RVE guardrails",
    so always_retry still retries a fraud_block payment in the Lab -- the P0
    fix is scoped to RVE's own decision path, not to redefining the
    competitors it is measured against."""
    fraud_payment = {"payment_id": "p1", "customer_id": "c1", "amount": 8_000.0, "failure_reason": "fraud_block"}
    choice, _, _, _ = recovery_lab._decide_row(
        "always_retry", fraud_payment, {"customer_id": "c1"}, None,
        intensity_channels=recovery_lab.CONTACT_INTENSITY_CHANNELS["moderate"],
        suppression_list=set(), prior_contact_count=0, max_contacts_per_customer=2,
    )
    assert choice == "retry_now"


# ---------------------------------------------------------------------------
# A/B/C/F/G/H + the dataset-level invariant, against the real startup batch
# (RVE_FAST_STARTUP=1 from conftest -> no ensemble; suppression lives in
# apply_guardrails, which does not need one).
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def fraud_decisions(client: TestClient):
    """Every fraud_block audit record from a decided batch. Uses a seed known
    to contain several fraud_block payments."""
    client.post("/simulate", json={"n_customers": 200, "n_training_logs": 4000, "n_batch_payments": 300, "seed": 42})
    decisions = client.get("/decisions", params={"page_size": 500}).json()["decisions"]
    fraud = [d for d in decisions if d["failure_reason"] == "fraud_block"]
    assert len(fraud) > 0, "seed 42 / 300-payment batch is expected to contain fraud_block payments"
    return fraud


def test_dataset_invariant_no_fraud_block_recovery_anywhere_in_the_batch(fraud_decisions) -> None:
    for d in fraud_decisions:
        pid = d["payment_id"]
        # A: chosen action is no_action.
        assert d["chosen_intervention"] == "no_action", pid
        # G: the suppression is recorded on the audit trail.
        assert d["risk_policy"] == FRAUD_BLOCK_RECOVERY_SUPPRESSION, pid
        # No escalation.
        assert d["escalated"] is False, pid
        # F: no Razorpay payment link was created (or attempted).
        assert d["payment_link_url"] is None and d["payment_link_error"] is None, pid
        # B + C: every recovery action is on the audit record but marked ineligible.
        evs = {e["intervention_id"]: e for e in d["all_evs"]}
        assert set(evs) == set(full_menu()), pid
        for iid in RECOVERY_ACTIONS:
            assert evs[iid]["eligible"] is False, f"{pid}/{iid} must be ineligible"
            assert "risk policy" in (evs[iid]["blocked_reason"] or "").lower(), f"{pid}/{iid}"
        assert evs["no_action"]["eligible"] is True, pid
        # The explanation names the policy, not a channel.
        assert "risk policy" in d["explanation"].lower(), pid
        assert "no_action" in d["explanation"].lower(), pid


def test_dataset_invariant_direct_decide_call_also_suppresses(client: TestClient, fraud_decisions) -> None:
    """A fresh, explicit POST /decide/{id} on a fraud payment (live=True path,
    the one that can hit Razorpay) is suppressed exactly the same way."""
    pid = fraud_decisions[0]["payment_id"]
    body = client.post(f"/decide/{pid}").json()
    assert body["chosen_intervention"] == "no_action"
    rec = body["audit_record"]
    assert rec["risk_policy"] == FRAUD_BLOCK_RECOVERY_SUPPRESSION
    assert rec["escalated"] is False
    assert rec["payment_link_url"] is None and rec["payment_link_error"] is None


def test_execution_boundary_never_calls_razorpay_for_a_fraud_block_payment(
    client: TestClient, fraud_decisions, monkeypatch: pytest.MonkeyPatch
) -> None:
    """F, defense-in-depth: even if create_payment_link were reachable, it is
    never invoked for a fraud_block decision."""
    import app.main as main_module

    calls: list = []
    monkeypatch.setattr(
        main_module, "create_payment_link", lambda *a, **k: calls.append((a, k)) or (_ for _ in ()).throw(AssertionError("create_payment_link called for a fraud_block payment")),
    )
    pid = fraud_decisions[0]["payment_id"]
    body = client.post(f"/decide/{pid}").json()
    assert body["chosen_intervention"] == "no_action"
    assert calls == []


def test_opportunity_queue_marks_fraud_block_as_suppressed_not_actionable(fraud_decisions) -> None:
    """H: the queue is driven by the audit records. A fraud_block row carries
    risk_policy set + chosen_intervention == no_action, which the dashboard
    renders as "Recovery suppressed / Risk policy" rather than an actionable
    recommendation. The net-value contribution of such a row is zero
    incremental (no_action vs no_action)."""
    for d in fraud_decisions:
        assert d["risk_policy"] == FRAUD_BLOCK_RECOVERY_SUPPRESSION
        assert d["chosen_intervention"] == "no_action"
        chosen = next(e for e in d["all_evs"] if e["intervention_id"] == "no_action")
        no_action_ev = chosen["expected_value"]
        # Incremental value over no_action is 0 by construction -> not an
        # actionable "recover N rupees" opportunity.
        assert no_action_ev == max(
            e["expected_value"] for e in d["all_evs"] if e["eligible"]
        )


def test_negotiation_endpoint_independently_suppresses_fraud_block(client: TestClient, fraud_decisions) -> None:
    """E: POST /recovery-negotiation/analyze on a fraud payment cannot return
    an incentive recommendation, regardless of what RVE chose."""
    pid = fraud_decisions[0]["payment_id"]
    res = client.post("/recovery-negotiation/analyze", json={"payment_id": pid})
    assert res.status_code == 200
    body = res.json()
    assert body["optimum_candidate"] is None
    assert body["minimum_effective_intervention"] is None
    assert body["max_recovery_probability_candidate"] is None
    assert all(c["eligible"] is False for c in body["candidates"])
    assert "No incentive level is eligible" in body["explanation"]


def test_legitimate_failure_reasons_still_recover_normally(client: TestClient) -> None:
    """The counter-check: a non-fraud batch still produces real recovery
    actions -- the fix did not over-suppress."""
    client.post("/simulate", json={"n_customers": 120, "n_training_logs": 2500, "n_batch_payments": 120, "seed": 7})
    decisions = client.get("/decisions", params={"page_size": 500}).json()["decisions"]
    non_fraud = [d for d in decisions if d["failure_reason"] != "fraud_block"]
    assert any(d["chosen_intervention"] in RECOVERY_ACTIONS for d in non_fraud), (
        "a non-fraud batch should still choose real recovery actions"
    )
    assert all(d["risk_policy"] is None for d in non_fraud), (
        "risk_policy must never be set for a non-fraud failure reason"
    )
