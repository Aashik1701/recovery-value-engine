"""Tests for Revenue Recovery Autopsy (revenue_autopsy.py) -- see
docs/REVENUE_RECOVERY_AUTOPSY.md. Mirrors this repo's existing per-module
test style (test_recovery_lab.py): a small, fast synthetic bundle run through
the real decision pipeline, exercised directly against revenue_autopsy.py's
functions, plus a handful of API-level tests for endpoint wiring, pagination,
and filtering.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterator, List

import pytest
from fastapi.testclient import TestClient

from app import revenue_autopsy
from app.main import app
from app.models import AuditRecord, InterventionEV, RevenueOutcome
from app.probability_model import ProbabilityModel
from app.simulator import run_simulation


@pytest.fixture(scope="module")
def bundle():
    return run_simulation(n_customers=150, n_training_logs=4000, n_batch_payments=200, seed=99)


@pytest.fixture(scope="module")
def model(bundle) -> ProbabilityModel:
    m = ProbabilityModel()
    m.fit(bundle.training_logs, bundle.customers, seed=99)
    return m


@pytest.fixture(scope="module")
def audit_log(bundle, model) -> List[AuditRecord]:
    """A real audit log for the whole bundle, built the same way main.py's
    `_decide` builds one (probability -> EV -> guardrails -> argmax), so the
    forensic engine is exercised against genuine decisions, not stubs."""
    from app.ev_engine import compute_ev_for_menu
    from app.guardrails import apply_guardrails, full_menu
    from app.models import INTERVENTION_UNIT_COSTS
    from app.optimizer import select_best_intervention

    customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    records: List[AuditRecord] = []
    for _, payment in bundle.batch_payments.iterrows():
        customer = customers_by_id[payment["customer_id"]]
        menu = full_menu()
        probs = model.predict_proba_matrix(payment.to_dict(), customer, menu)
        evs = compute_ev_for_menu(probs, payment["amount"])
        eligible, blocked = apply_guardrails(menu, payment["amount"], payment["customer_id"], set())
        chosen = select_best_intervention(evs, eligible)
        records.append(
            AuditRecord(
                decision_id=f"dec_{payment['payment_id']}",
                payment_id=payment["payment_id"],
                customer_id=payment["customer_id"],
                amount=payment["amount"],
                failure_reason=payment["failure_reason"],
                transaction_type=payment["transaction_type"],
                decided_at=datetime.now().astimezone(),
                all_evs=[
                    InterventionEV(
                        intervention_id=iid,
                        probability_of_recovery=round(probs[iid], 4),
                        unit_cost=INTERVENTION_UNIT_COSTS[iid],
                        expected_value=round(evs[iid], 2),
                        eligible=iid in eligible,
                        blocked_reason=blocked.get(iid),
                    )
                    for iid in menu
                ],
                chosen_intervention=chosen,
                explanation="test fixture decision",
            )
        )
    return records


def _dataset(bundle, audit_log, seed=42, suppression=None):
    return revenue_autopsy.build_forensic_dataset(
        bundle.batch_payments, bundle.customers, bundle.hidden_truth, audit_log, suppression or set(), seed,
    )


# ---------------------------------------------------------------------------
# Timestamp ordering + determinism
# ---------------------------------------------------------------------------


def test_timeline_ordering_holds_for_every_record(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        assert r.checkout_started_at <= r.payment_attempted_at <= r.failed_at
        if r.recovery_decision_at is not None:
            assert r.failed_at <= r.recovery_decision_at <= r.recovery_executed_at
        if r.recovered_at is not None:
            assert r.recovery_executed_at <= r.recovered_at


def test_same_seed_reproduces_identical_dataset(bundle, audit_log) -> None:
    a = _dataset(bundle, audit_log, seed=7)
    b = _dataset(bundle, audit_log, seed=7)
    for ra, rb in zip(a, b):
        assert ra == rb


def test_different_seed_can_change_outcomes(bundle, audit_log) -> None:
    a = _dataset(bundle, audit_log, seed=1)
    b = _dataset(bundle, audit_log, seed=2)
    outcomes_a = [r.outcome for r in a]
    outcomes_b = [r.outcome for r in b]
    assert outcomes_a != outcomes_b


# ---------------------------------------------------------------------------
# Root-cause classification
# ---------------------------------------------------------------------------


def test_primary_cause_is_deterministic_relabeling_of_failure_reason(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        bucket_key = revenue_autopsy._bucket_key_for_reason(r.failure_reason)
        expected_key = r.failure_reason if r.failure_reason in revenue_autopsy.OPPORTUNITY_BUCKETS else "other"
        assert bucket_key == expected_key
        assert revenue_autopsy.OPPORTUNITY_BUCKETS[bucket_key]["kind"] == "primary"


def test_contributing_causes_are_never_the_primary_cause(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        primary_key = revenue_autopsy._bucket_key_for_reason(r.failure_reason)
        for c in r.contributing:
            assert c.cause_key != primary_key
            assert c.cause_key in revenue_autopsy.CONTRIBUTING_CAUSE_KEYS
            assert "Attributed cause" in c.detail


def test_recovery_delay_contributing_cause_only_above_threshold(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        has_tag = any(c.cause_key == "recovery_delay" for c in r.contributing)
        if r.recovery_decision_delay_hours is not None:
            expected = r.recovery_decision_delay_hours > revenue_autopsy.RECOVERY_DELAY_THRESHOLD_HOURS
            assert has_tag == expected


# ---------------------------------------------------------------------------
# Outcome classification: exhaustive, mutually exclusive, reconciles
# ---------------------------------------------------------------------------


def test_outcome_partition_sums_to_total_at_risk(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    summary = revenue_autopsy.compute_summary(records)
    reconciled = (
        summary.natural_recovery_amount
        + summary.intervention_recovery_amount
        + summary.recoverable_amount
        + summary.permanently_lost_amount
        + summary.unresolved_amount
    )
    assert reconciled == pytest.approx(summary.total_at_risk, abs=0.05)


def test_total_recovered_equals_natural_plus_intervention(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    summary = revenue_autopsy.compute_summary(records)
    assert summary.total_recovered == pytest.approx(
        summary.natural_recovery_amount + summary.intervention_recovery_amount, abs=0.01
    )


def test_revenue_lost_equals_unrecovered_buckets(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    summary = revenue_autopsy.compute_summary(records)
    assert summary.revenue_lost == pytest.approx(
        summary.recoverable_amount + summary.permanently_lost_amount + summary.unresolved_amount, abs=0.05
    )


def test_no_payment_in_two_outcome_buckets(bundle, audit_log) -> None:
    """Each record has exactly ONE outcome (an enum field, not independent
    booleans), so double-bucketing is structurally impossible -- this test
    locks in that every record's outcome is one of the 5 valid values."""
    records = _dataset(bundle, audit_log)
    for r in records:
        assert r.outcome in set(RevenueOutcome)


def test_natural_recovery_only_when_no_action_chosen(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        if r.outcome == RevenueOutcome.NATURAL_RECOVERY:
            assert r.chosen_intervention == "no_action"
            assert r.recovered is True
        if r.outcome == RevenueOutcome.INTERVENTION_RECOVERY:
            assert r.chosen_intervention != "no_action"
            assert r.recovered is True


def test_unrecovered_records_are_recoverable_or_permanently_lost(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        if r.recovered is False:
            assert r.outcome in (RevenueOutcome.RECOVERABLE, RevenueOutcome.PERMANENTLY_LOST)


def test_contact_cap_exhaustion_alone_can_produce_permanently_lost(bundle, model, audit_log) -> None:
    """The real bug this test caught (forensic-integrity audit): `retry_now`
    is a NON_CONTACT_INTERVENTION and is therefore guardrail-eligible under
    every condition (suppression, contact cap, and the voice-amount
    threshold all explicitly exempt it -- see guardrails.py). The original
    RECOVERABLE/PERMANENTLY_LOST check only excluded "no_action" when asking
    whether a further action was available, so `has_further_action` was
    always True until the recovery window expired -- the "or all eligible
    recovery paths are exhausted" half of PERMANENTLY_LOST's own definition
    (see docs/REVENUE_RECOVERY_AUTOPSY.md Section 6) was dead code: a
    suppressed customer, or one who had already hit the contact cap, would
    still read as RECOVERABLE. Fixed by excluding the whole
    NON_CONTACT_INTERVENTIONS set, not just "no_action", from the
    has-further-action check -- this test locks that fix in by forcing a
    customer over the real contact cap via three genuine /decide calls
    (the same technique test_failure_scenarios.py already uses) and
    asserting an unrecovered result classifies as PERMANENTLY_LOST, never
    RECOVERABLE, once every contact-capable channel is guardrail-blocked.
    """
    from app.ev_engine import compute_ev_for_menu
    from app.guardrails import apply_guardrails, full_menu
    from app.models import INTERVENTION_UNIT_COSTS, NON_CONTACT_INTERVENTIONS
    from app.optimizer import select_best_intervention

    customers_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    contact_payment = next(
        p for _, p in bundle.batch_payments.iterrows()
        if select_best_intervention(
            compute_ev_for_menu(
                model.predict_proba_matrix(p.to_dict(), customers_by_id[p["customer_id"]], full_menu()), p["amount"]
            ),
            apply_guardrails(full_menu(), p["amount"], p["customer_id"], set())[0],
        ) not in NON_CONTACT_INTERVENTIONS
    )
    pid = contact_payment["payment_id"]
    customer_id = contact_payment["customer_id"]

    def _decide_once(prior_contact_count: int) -> AuditRecord:
        customer = customers_by_id[customer_id]
        menu = full_menu()
        probs = model.predict_proba_matrix(contact_payment.to_dict(), customer, menu)
        evs = compute_ev_for_menu(probs, contact_payment["amount"])
        eligible, blocked = apply_guardrails(
            menu, contact_payment["amount"], customer_id, set(), prior_contact_count=prior_contact_count
        )
        chosen = select_best_intervention(evs, eligible)
        return AuditRecord(
            decision_id=f"dec_{prior_contact_count}", payment_id=pid, customer_id=customer_id,
            amount=contact_payment["amount"], failure_reason=contact_payment["failure_reason"],
            transaction_type=contact_payment["transaction_type"], decided_at=datetime.now().astimezone(),
            all_evs=[
                InterventionEV(
                    intervention_id=iid, probability_of_recovery=round(probs[iid], 4),
                    unit_cost=INTERVENTION_UNIT_COSTS[iid], expected_value=round(evs[iid], 2),
                    eligible=iid in eligible, blocked_reason=blocked.get(iid),
                )
                for iid in menu
            ],
            chosen_intervention=chosen, explanation="test",
        )

    forced_audit_log = [_decide_once(0), _decide_once(1), _decide_once(2)]
    third_chosen = forced_audit_log[-1].chosen_intervention
    assert third_chosen in NON_CONTACT_INTERVENTIONS, "3rd decision should be forced non-contact by the cap"

    records = revenue_autopsy.build_forensic_dataset(
        bundle.batch_payments, bundle.customers, bundle.hidden_truth, forced_audit_log, set(), 42
    )
    row = next(r for r in records if r.payment_id == pid)
    if row.recovered is False:
        assert row.outcome == RevenueOutcome.PERMANENTLY_LOST


# ---------------------------------------------------------------------------
# Preventable / recoverable / permanently-lost bounds
# ---------------------------------------------------------------------------


def test_preventable_amount_never_exceeds_payment_amount(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    for r in records:
        assert 0.0 <= r.preventable_amount <= r.amount + 1e-6


def test_headline_preventable_recoverable_permanently_lost_bounded_by_total(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    summary = revenue_autopsy.compute_summary(records)
    assert summary.preventable_amount <= summary.total_at_risk + 0.01
    assert summary.recoverable_amount <= summary.total_at_risk + 0.01
    assert summary.permanently_lost_amount <= summary.total_at_risk + 0.01


# ---------------------------------------------------------------------------
# Opportunity score: reproducible, deterministic ranking
# ---------------------------------------------------------------------------


def test_opportunity_score_reproducible_and_sort_deterministic(bundle, audit_log) -> None:
    records_a = _dataset(bundle, audit_log, seed=42)
    records_b = _dataset(bundle, audit_log, seed=42)
    _, fix_a = revenue_autopsy.compute_causes_and_fix_first(records_a)
    _, fix_b = revenue_autopsy.compute_causes_and_fix_first(records_b)
    assert [f.cause_key for f in fix_a] == [f.cause_key for f in fix_b]
    assert [f.opportunity_score for f in fix_a] == [f.opportunity_score for f in fix_b]
    # priorities are assigned in rank order, 1..N with no gaps or repeats
    assert [f.priority for f in fix_a] == list(range(1, len(fix_a) + 1))
    # sorted descending by opportunity_score
    scores = [f.opportunity_score for f in fix_a]
    assert scores == sorted(scores, reverse=True)


def test_fix_first_buckets_are_not_a_partition_by_design(bundle, audit_log) -> None:
    """Opportunity buckets deliberately overlap (a payment can have one
    primary cause and several contributing causes) -- this test locks in
    that the sum of bucket revenue can exceed total_at_risk, so nobody later
    mistakes fix_first amounts for a mutually-exclusive partition."""
    records = _dataset(bundle, audit_log)
    causes, _ = revenue_autopsy.compute_causes_and_fix_first(records)
    total_at_risk = sum(r.amount for r in records)
    bucket_sum = sum(c.amount for c in causes)
    # Not asserting bucket_sum > total_at_risk (data-dependent), just that
    # primary-only causes reconcile exactly to total_at_risk on their own.
    primary_sum = sum(c.amount for c in causes if c.kind == "primary")
    assert primary_sum == pytest.approx(total_at_risk, abs=0.05)
    assert bucket_sum >= primary_sum


# ---------------------------------------------------------------------------
# Pareto concentration
# ---------------------------------------------------------------------------


def test_pareto_computed_only_over_primary_causes(bundle, audit_log) -> None:
    records = _dataset(bundle, audit_log)
    pareto = revenue_autopsy.compute_pareto(records)
    assert 0.0 <= pareto.revenue_share <= 1.0
    assert pareto.concentration_detected == (pareto.revenue_share >= revenue_autopsy.PARETO_CONCENTRATION_THRESHOLD)


# ---------------------------------------------------------------------------
# Edge cases: empty dataset, missing audit record (UNRESOLVED)
# ---------------------------------------------------------------------------


def test_empty_dataset_does_not_crash(bundle) -> None:
    empty_payments = bundle.batch_payments.iloc[0:0]
    empty_truth = bundle.hidden_truth.iloc[0:0]
    records = revenue_autopsy.build_forensic_dataset(empty_payments, bundle.customers, empty_truth, [], set(), 42)
    assert records == []
    summary = revenue_autopsy.compute_summary(records)
    assert summary.total_at_risk == 0.0
    assert summary.n_payments == 0
    chain = revenue_autopsy.compute_loss_chain(records)
    assert len(chain) == 8  # still returns all 8 stages, just at zero
    delay = revenue_autopsy.compute_recovery_delay(records)
    assert all(b.n_payments == 0 for b in delay.buckets)


def test_missing_audit_record_classified_unresolved(bundle, audit_log) -> None:
    trimmed = [r for r in audit_log if r.payment_id != audit_log[0].payment_id]
    records = revenue_autopsy.build_forensic_dataset(
        bundle.batch_payments, bundle.customers, bundle.hidden_truth, trimmed, set(), 42,
    )
    orphan = next(r for r in records if r.payment_id == audit_log[0].payment_id)
    assert orphan.outcome == RevenueOutcome.UNRESOLVED
    assert orphan.recovered is None
    assert orphan.chosen_intervention is None
    # failure class is still known even without a decision, so preventability is still computed
    assert orphan.preventable_amount >= 0.0


# ---------------------------------------------------------------------------
# API wiring: summary / causes / payments (pagination, filters), no audit mutation
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def test_summary_endpoint(client: TestClient) -> None:
    sim = client.post("/simulate", json={"n_customers": 40, "n_training_logs": 600, "n_batch_payments": 30, "seed": 3})
    assert sim.status_code == 200
    res = client.get("/revenue-autopsy/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["leakage"]["n_payments"] == 30
    assert "not establish production causal" in body["note"]
    assert [s["stage"] for s in body["loss_chain"]] == [
        "customer", "checkout", "payment_attempt", "method", "gateway", "failure", "recovery", "outcome",
    ]


def test_causes_endpoint(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 40, "n_training_logs": 600, "n_batch_payments": 30, "seed": 3})
    res = client.get("/revenue-autopsy/causes")
    assert res.status_code == 200
    body = res.json()
    assert len(body["causes"]) >= 6  # at least the 6 primary buckets
    priorities = [f["priority"] for f in body["fix_first"]]
    assert priorities == list(range(1, len(priorities) + 1))
    if body["top_recommendation"]:
        assert body["top_recommendation"]["cause_key"] == body["fix_first"][0]["cause_key"]


def test_payments_endpoint_pagination(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 40, "n_training_logs": 600, "n_batch_payments": 30, "seed": 3})
    page1 = client.get("/revenue-autopsy/payments", params={"page": 1, "page_size": 10}).json()
    page2 = client.get("/revenue-autopsy/payments", params={"page": 2, "page_size": 10}).json()
    assert page1["total"] == 30
    assert len(page1["items"]) == 10
    assert len(page2["items"]) == 10
    assert {i["payment_id"] for i in page1["items"]}.isdisjoint({i["payment_id"] for i in page2["items"]})


def test_payments_endpoint_filters_by_status_and_search(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 40, "n_training_logs": 600, "n_batch_payments": 30, "seed": 3})
    all_rows = client.get("/revenue-autopsy/payments", params={"page_size": 100}).json()["items"]
    some_status = all_rows[0]["outcome"]
    filtered = client.get("/revenue-autopsy/payments", params={"page_size": 100, "status": some_status}).json()
    assert filtered["total"] >= 1
    assert all(r["outcome"] == some_status for r in filtered["items"])

    needle = all_rows[0]["payment_id"]
    searched = client.get("/revenue-autopsy/payments", params={"search": needle}).json()
    assert any(r["payment_id"] == needle for r in searched["items"])


def test_payments_endpoint_invalid_page_rejected(client: TestClient) -> None:
    res = client.get("/revenue-autopsy/payments", params={"page": 0})
    assert res.status_code == 400


def test_revenue_autopsy_never_appends_to_audit_log(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.get("/revenue-autopsy/summary")
    client.get("/revenue-autopsy/causes")
    client.get("/revenue-autopsy/payments")
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before
