# Failure-recovery testing

This project's build plan calls for deliberate failure scenarios — not the happy path — to be tested and documented, because "what broke, and what we did about it" is one of the four judging axes for this track. This is that documentation. All three scenarios are implemented as real, passing tests in [backend/tests/test_failure_scenarios.py](../backend/tests/test_failure_scenarios.py), not described-but-untested.

## Scenario 1: external API failure (timeout / network / auth)

Both external calls in this system — the explanation LLM call (`app/explain.py`) and the Razorpay payment-link call (`app/razorpay_client.py`) — sit on the edge of the pipeline and can fail for reasons entirely outside this codebase's control.

**Test:** force each client to raise (`TimeoutError`, `ConnectionError`) via monkeypatching, and confirm the decision pipeline doesn't crash.

**Result:** both already degrade correctly by design —
- `generate_explanation()` catches any exception from the Anthropic call and falls back to the deterministic template.
- `create_payment_link()` catches any exception from the Razorpay call and returns `PaymentLinkResult(error=...)` instead of raising; the caller in `main.py` stores that error on the audit record rather than failing the whole `/decide` call.

No change needed here — this scenario mainly served to *lock in* behavior that was designed correctly the first time, with a real test rather than a read-through of the code.

## Scenario 2: unresolvable payment reference

**Test:** (a) call `/decide/{payment_id}` with a payment_id that was never generated, and (b) simulate a data-integrity gap — a payment whose `customer_id` has been removed from the customers table (e.g. an upstream sync issue) — and confirm both fail as a clean, informative 404 rather than an unhandled exception.

**Result:** both already worked correctly — `main.py` explicitly checks for an empty lookup on both the payment and the customer and raises `HTTPException(404, ...)` with the offending ID in the message. No change needed.

## Scenario 3: exceeded contact/retry limit — the stopping rule

This is the one that actually found a bug.

**Test:** run a small batch through `/simulate`, find a payment whose decision picked a contact-requiring intervention (`sms_link`, `whatsapp_nudge`, `email`, or `voice_call`), then call `/decide` on that *same* payment_id repeatedly and check whether the contact-frequency cap (this project's guardrail rules: max 2 contacts per customer per payment) actually engages on the third contact.

**What broke:** `guardrails.py`'s `apply_guardrails()` has always correctly implemented the cap and was correctly unit-tested in isolation (`test_guardrails.py`) — but `main.py`'s `_decide()` never actually computed or passed a real `prior_contact_count`. It always defaulted to `0`, meaning **the contact-frequency cap could never trigger through the live API**, no matter how many times a customer was actually contacted. A guardrail that's correct in isolation but never wired to real state is, in practice, no guardrail at all — this is exactly the kind of gap that only shows up when you test the deployed behavior, not the unit.

**What we did about it:** `main.py`'s `_decide()` now computes `prior_contact_count` from the actual audit log — counting how many past decisions for this `payment_id` chose a contact-requiring intervention — and passes that into `apply_guardrails()`. The new test asserts the cap engages on the third contact and that the pipeline falls back to a non-contact intervention (`no_action` or `retry_now`), and it currently passes against the fixed code.

**A note on scope:** `prior_contact_count` is tracked per `payment_id`, matching this project's "per failed payment" framing for its guardrails. A customer with multiple different failed payments can still be contacted up to the cap on each one independently — that's the documented scope, not an oversight; tracking a cap across a customer's entire history would be a different (and larger) guardrail than the one specified.

## Scenario 4: a fraud-flagged payment must never be pursued for recovery (P0 risk policy)

Not a "the outside world misbehaved" scenario — a "the system must not misbehave" one. An audit of the seed-42 batch found that ~23 of 30 `fraud_block` payments were being routed to a paid recovery channel (`email` / `sms_link` / `whatsapp_nudge`), because the EV optimizer saw a small positive expected value (the synthetic `fraud_block` uplift is near-zero but not exactly zero) and nothing stopped it.

**What broke:** there was no risk policy above the EV math. `fraud_block` was treated as just another failure reason.

**What we did about it:** added a hard recovery-suppression policy (`guardrails.recovery_suppression_policy`) enforced at candidate-eligibility time — for a `fraud_block` payment the eligible set is `[no_action]` before the optimizer runs, so an unsafe action is never scored, never selected, and never executed. It is one canonical rule consumed by the live `/decide` path, the Recovery Lab's RVE policy, the offline evaluator's RVE policy, the Recovery Negotiation Engine (a direct `POST /recovery-negotiation/analyze` is independently suppressed), and the Razorpay execution boundary. Every suppressed decision is still fully auditable (`risk_policy: "fraud_block_recovery_suppression"`, `chosen_intervention: "no_action"`, every recovery action shown as blocked-by-policy in the "why not this action?" panel).

**Regression coverage:** `backend/tests/test_fraud_block_suppression.py` — 13 tests including a dataset-level invariant (across the whole synthetic batch: fraud-block contacts / retries / incentives / executions / escalations all zero) and an explicit counter-check that legitimate failure reasons (`insufficient_funds`, `bank_timeout`, …) still flow through the normal pipeline.

## Running these tests

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/test_failure_scenarios.py -v
```

Slower than the rest of the suite (~20-25s) because the module-scoped `TestClient` fixture runs one real startup simulation; individual tests then call `/simulate` with small batch sizes for speed and a clean, known state.
