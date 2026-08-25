"""Deliberate failure-recovery scenarios (CLAUDE.md Phase 7): what happens
when the outside world misbehaves, not just the happy path.

Three scenarios, each mapped to a real boundary in this codebase rather than
a generic what-if:

1. External API failure (timeout/auth/network) during explanation
   generation or Razorpay payment-link creation -- must degrade to the
   documented fallback, never crash the decision pipeline.
2. An unresolvable payment reference -- unknown payment_id, or a payment
   whose customer record is missing -- must fail as a clean 404, not a
   raw exception.
3. Exceeded contact/retry limit -- the contact-frequency cap "stopping
   rule" must actually engage after repeated decisions on the same
   payment, not just pass in isolated unit tests.

See docs/FAILURE_MODES.md for what these tests found and what changed as a
result -- most notably, scenario 3 caught a real bug: the contact-frequency
cap was correctly implemented in guardrails.py but never actually wired to
live state in main.py, so it could never trigger through the API.
"""

from __future__ import annotations

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import NON_CONTACT_INTERVENTIONS

CONTACT_INTERVENTIONS = {"sms_link", "whatsapp_nudge", "email", "voice_call"}


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    # Module-scoped: the app's startup event runs one full (slow) default
    # simulation when the TestClient context opens. Individual tests that
    # need a specific small/known batch call POST /simulate themselves,
    # which is fast and resets audit_log -- see CLAUDE.md Section 13.
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Scenario 1: external API failure degrades gracefully
# ---------------------------------------------------------------------------


def test_explanation_falls_back_when_anthropic_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    import anthropic

    from app import explain

    def _raise_timeout(*args: object, **kwargs: object) -> None:
        raise TimeoutError("simulated Anthropic API timeout")

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-for-this-test-only")
    monkeypatch.setattr(anthropic.Anthropic, "__init__", lambda self, **kw: None)
    monkeypatch.setattr(
        anthropic.Anthropic,
        "messages",
        property(lambda self: type("M", (), {"create": staticmethod(_raise_timeout)})()),
    )

    text = explain.generate_explanation(
        chosen_intervention="sms_link",
        probability=0.3,
        unit_cost=3.0,
        expected_value=100.0,
        amount=1000.0,
        failure_reason="bank_timeout",
        transaction_type="one_time",
        retry_count_so_far=0,
    )

    # Must fall back to the deterministic template, not raise and not return
    # an empty/garbage string.
    assert "sms_link" in text
    assert "1,000.00" in text


def test_payment_link_reports_error_when_razorpay_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    import razorpay

    from app import razorpay_client

    class _FailingPaymentLink:
        def create(self, *args: object, **kwargs: object) -> None:
            raise ConnectionError("simulated network timeout talking to Razorpay")

    def _fake_init(self: object, **kw: object) -> None:
        self.payment_link = _FailingPaymentLink()  # type: ignore[attr-defined]

    monkeypatch.setenv("RAZORPAY_KEY_ID", "test_id")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "test_secret")
    monkeypatch.setattr(razorpay.Client, "__init__", _fake_init)

    result = razorpay_client.create_payment_link(
        payment_id="pay_test123", amount=1234.0, customer_id="cust_test", decision_id="dec_test"
    )

    assert result.url is None
    assert result.error is not None
    assert "timeout" in result.error.lower()


def test_payment_link_reports_error_for_real_invalid_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unlike the two tests above (which mock the SDK/network away entirely),
    this one hits Razorpay's REAL test-mode API with syntactically valid but
    wrong credentials, so the failure is a genuine 401 from the real service,
    not a simulated one. Requires outbound network access; this is the
    closest thing to Flow E from a controlled, repeatable test (see
    docs/INTEGRATION_VERIFICATION.md for the equivalent manual check against
    a running server)."""
    from app import razorpay_client

    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_invalid_0000000000")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "invalid_secret_0000000000")

    try:
        result = razorpay_client.create_payment_link(
            payment_id="pay_flowE_test", amount=1234.0, customer_id="cust_flowE_test", decision_id="dec_flowE_test"
        )
    except Exception as exc:  # pragma: no cover - only if create_payment_link regresses to not catching
        pytest.fail(f"create_payment_link raised instead of degrading to a reported error: {exc!r}")

    assert result.url is None
    assert result.error is not None


def test_payment_link_reports_missing_keys_without_raising() -> None:
    """Baseline: no keys configured at all -- the most common real-world case."""
    import os

    from app import razorpay_client

    # Explicitly absent for this test, regardless of the developer's shell.
    saved = {k: os.environ.pop(k, None) for k in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET")}
    try:
        result = razorpay_client.create_payment_link("pay_x", 500.0, "cust_x", "dec_x")
        assert result.url is None
        assert result.error is not None
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


# ---------------------------------------------------------------------------
# Scenario 2: unresolvable payment reference
# ---------------------------------------------------------------------------


def test_decide_unknown_payment_id_returns_clean_404(client: TestClient) -> None:
    resp = client.post("/decide/pay_does_not_exist")
    assert resp.status_code == 404
    assert "pay_does_not_exist" in resp.json()["detail"]


def test_decide_payment_with_missing_customer_record_returns_clean_404(client: TestClient) -> None:
    """Data-integrity edge case: a payment references a customer_id that
    isn't in the customers table (e.g. a customer record purged after their
    payment failed, or an upstream sync gap). Must not crash the pipeline."""
    import app.main as main_module

    resp = client.post("/simulate", json={"n_customers": 20, "n_training_logs": 500, "n_batch_payments": 5})
    assert resp.status_code == 200

    orphan_payment_id = main_module.state.batch_payments.iloc[0]["payment_id"]
    orphan_customer_id = main_module.state.batch_payments.iloc[0]["customer_id"]

    original_customers = main_module.state.customers
    try:
        main_module.state.customers = original_customers[
            original_customers["customer_id"] != orphan_customer_id
        ]
        resp = client.post(f"/decide/{orphan_payment_id}")
        assert resp.status_code == 404
        assert "customer" in resp.json()["detail"].lower()
    finally:
        main_module.state.customers = original_customers


# ---------------------------------------------------------------------------
# Scenario 3: exceeded contact/retry limit -- the stopping rule
# ---------------------------------------------------------------------------


def test_contact_frequency_cap_engages_after_repeated_decisions(client: TestClient) -> None:
    """The real bug this test caught: prior_contact_count was never wired
    from the audit log into apply_guardrails() in main.py, so this guardrail
    could never actually trigger through the live API despite being
    correctly unit-tested in isolation (test_guardrails.py). Fixed in
    main.py's `_decide` -- this test locks the fix in."""
    resp = client.post("/simulate", json={"n_customers": 30, "n_training_logs": 800, "n_batch_payments": 15})
    assert resp.status_code == 200

    decisions = client.get("/decisions?page=1&page_size=15").json()["decisions"]
    contact_decision = next(
        (d for d in decisions if d["chosen_intervention"] in CONTACT_INTERVENTIONS), None
    )
    assert contact_decision is not None, "expected at least one contact-based decision in a 15-payment batch"
    payment_id = contact_decision["payment_id"]
    chosen_channel = contact_decision["chosen_intervention"]

    # The bulk /simulate pass already logged one contact for this payment.
    # A second explicit decide is contact #2 -- still at the cap, not over
    # it, so guardrails shouldn't have changed yet.
    second = client.post(f"/decide/{payment_id}").json()["audit_record"]
    second_ev = {e["intervention_id"]: e for e in second["all_evs"]}
    assert second_ev[chosen_channel]["eligible"] is True

    # A third explicit decide is contact #3: over the cap. Every
    # contact-requiring intervention must now be blocked, and the winner
    # must fall back to a non-contact option.
    third = client.post(f"/decide/{payment_id}").json()["audit_record"]
    third_ev = {e["intervention_id"]: e for e in third["all_evs"]}

    for intervention_id in CONTACT_INTERVENTIONS:
        assert third_ev[intervention_id]["eligible"] is False, (
            f"{intervention_id} should be blocked (by the contact cap, or another guardrail) on the 3rd contact"
        )

    # voice_call can independently be blocked by the amount threshold
    # regardless of contact count (guardrails.py checks that one first), so
    # only assert the contact-cap wording specifically for channels with no
    # other applicable guardrail in this test (no suppression list is set).
    for intervention_id in CONTACT_INTERVENTIONS - {"voice_call"}:
        assert "contact-frequency cap" in (third_ev[intervention_id]["blocked_reason"] or "")

    assert third["chosen_intervention"] in NON_CONTACT_INTERVENTIONS
