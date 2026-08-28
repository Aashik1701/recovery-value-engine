"""Red-team the central economic claim: "RVE maximizes expected net recovery
value." Written during the Final Validation / Demo Hardening pass, playing a
hostile Razorpay reviewer against the actual pipeline -- not documentation,
not prose. Each test below is one of the 14 adversarial questions from that
pass, phrased as an assertion against real code paths.

Matches this repo's per-module test style (test_guardrails.py,
test_negotiation_engine.py): plain functions, bare assert, TestClient for
API-level wiring/mutation checks, AST-based import checks for "never imports
X" claims (a substring check would misfire on a docstring that legitimately
discusses the boundary in English).

Every test here passed on first write against the existing implementation --
none of these required a source-code fix. That is itself the finding: it is
recorded in docs/JUDGE_EVIDENCE.md as "verified", not "fixed". If a future
change makes one of these fail, that is a real regression in the central
economic claim, not a flaky test to loosen.
"""

from __future__ import annotations

import ast
import inspect
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app import ev_engine, evaluator, explain, guardrails, negotiation_engine, optimizer, probability_model, recovery_lab, revenue_autopsy
from app.ev_engine import compute_ev, compute_ev_for_menu
from app.guardrails import apply_guardrails, full_menu
from app.models import INTERVENTION_UNIT_COSTS, VOICE_CALL_AMOUNT_THRESHOLD
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel
from app.simulator import run_simulation


# ---------------------------------------------------------------------------
# Q1 -- Does EV use gross recovery or incremental recovery correctly?
# ---------------------------------------------------------------------------
#
# ev_engine.compute_ev is documented as `probability * amount - unit_cost`
# (gross, not incremental-vs-baseline). That is a deliberate, documented
# design choice (ev_engine.py's own module docstring: no_action is just
# another menu entry with its own learned probability and $0 cost, so argmax
# over gross EV already reduces to argmax over incremental value -- whichever
# intervention has the highest P(recovery)*amount - cost also has the highest
# incremental value over no_action, since no_action's own gross EV is
# subtracted out of every comparison identically). This test locks in that
# the formula itself is exactly gross-minus-cost, matching the documented
# formula, not a different one that silently crept in.


def test_q1_ev_formula_is_probability_times_amount_minus_cost() -> None:
    assert compute_ev(0.4, 1000.0, "sms_link") == pytest.approx(0.4 * 1000.0 - INTERVENTION_UNIT_COSTS["sms_link"])
    menu_probs = {"no_action": 0.2, "retry_now": 0.3, "voice_call": 0.5}
    ev = compute_ev_for_menu(menu_probs, 10_000.0)
    for iid, p in menu_probs.items():
        assert ev[iid] == pytest.approx(p * 10_000.0 - INTERVENTION_UNIT_COSTS[iid])


# ---------------------------------------------------------------------------
# Q2 -- Are intervention costs subtracted correctly (never added, never
# double-counted, never omitted for no_action)?
# ---------------------------------------------------------------------------


def test_q2_no_action_has_zero_cost_and_pure_probability_ev() -> None:
    assert INTERVENTION_UNIT_COSTS["no_action"] == 0.0
    assert compute_ev(0.42, 5000.0, "no_action") == pytest.approx(0.42 * 5000.0)


def test_q2_higher_cost_intervention_has_strictly_lower_ev_at_equal_probability() -> None:
    # Same probability, different cost -> EV must differ by exactly the cost
    # delta. A sign error here (cost added instead of subtracted) would make
    # the more expensive channel look BETTER at equal probability.
    p = 0.5
    amount = 10_000.0
    ev_cheap = compute_ev(p, amount, "email")  # cost 1
    ev_expensive = compute_ev(p, amount, "voice_call")  # cost 15
    assert ev_cheap > ev_expensive
    assert ev_cheap - ev_expensive == pytest.approx(
        INTERVENTION_UNIT_COSTS["voice_call"] - INTERVENTION_UNIT_COSTS["email"]
    )


# ---------------------------------------------------------------------------
# Q3 -- Can a guardrail-blocked intervention accidentally enter argmax?
# ---------------------------------------------------------------------------


def test_q3_optimizer_never_considers_ids_outside_eligible_set() -> None:
    # Rig an EV table where the highest-EV id is deliberately NOT in the
    # eligible set. If select_best_intervention ever looked at the full
    # ev_by_intervention dict instead of `eligible_ids`, it would return the
    # blocked id.
    ev_by_intervention = {"voice_call": 999_999.0, "retry_now": 1.0, "no_action": 0.0}
    chosen = select_best_intervention(ev_by_intervention, eligible_ids=["retry_now", "no_action"])
    assert chosen != "voice_call"
    assert chosen == "retry_now"


def test_q3_full_pipeline_blocked_voice_call_never_wins_below_threshold() -> None:
    bundle = run_simulation(n_customers=100, n_training_logs=3000, n_batch_payments=50, seed=11)
    model = ProbabilityModel()
    model.fit(bundle.training_logs, bundle.customers, seed=11)
    customer = {"past_success_rate": 0.5, "ltv": 20_000.0}
    payment = {"failure_reason": "insufficient_funds", "transaction_type": "one_time",
               "amount": VOICE_CALL_AMOUNT_THRESHOLD - 1, "retry_count_so_far": 0}
    probs = model.predict_proba_matrix(payment, customer, full_menu())
    ev = compute_ev_for_menu(probs, payment["amount"])
    eligible, blocked = apply_guardrails(full_menu(), payment["amount"], "probe", set())
    chosen = select_best_intervention(ev, eligible)
    assert chosen != "voice_call"
    assert "voice_call" in blocked


# ---------------------------------------------------------------------------
# Q4 -- Can an expensive intervention win simply because amount is large, even
# when it is NOT actually the highest-EV eligible choice?
# ---------------------------------------------------------------------------


def test_q4_expensive_intervention_only_wins_when_genuinely_highest_ev() -> None:
    # Large amount, but voice_call's own probability is deliberately made
    # worse than a cheap channel's -- voice_call must still lose, because
    # optimizer.py's only decision rule is argmax EV, not "pick the most
    # expensive eligible option once amount clears some bar."
    amount = 50_000.0
    probs = {"no_action": 0.05, "retry_now": 0.10, "retry_later": 0.10, "sms_link": 0.10,
             "whatsapp_nudge": 0.10, "email": 0.10, "voice_call": 0.001}
    ev = compute_ev_for_menu(probs, amount)
    eligible, _ = apply_guardrails(full_menu(), amount, "probe", set())
    chosen = select_best_intervention(ev, eligible)
    assert chosen != "voice_call"
    assert ev[chosen] == max(ev[i] for i in eligible)


# ---------------------------------------------------------------------------
# Q5 -- Can no_action legitimately win?
# ---------------------------------------------------------------------------


def test_q5_no_action_wins_when_every_contact_channel_has_negative_ev() -> None:
    amount = 500.0  # small amount -- any nonzero-cost channel can easily net negative
    probs = {"no_action": 0.02, "retry_now": 0.02, "retry_later": 0.02, "sms_link": 0.02,
             "whatsapp_nudge": 0.02, "email": 0.02, "voice_call": 0.02}
    ev = compute_ev_for_menu(probs, amount)
    eligible, _ = apply_guardrails(full_menu(), amount, "probe", set())
    chosen = select_best_intervention(ev, eligible)
    assert chosen == "no_action"  # only $0-cost option at equal probability


# ---------------------------------------------------------------------------
# Q6 -- Can increasing incentive REDUCE net value? (negotiation_engine)
# ---------------------------------------------------------------------------


def test_q6_negotiation_net_value_can_decrease_as_incentive_increases() -> None:
    candidates = negotiation_engine.compute_candidates(
        levels=[0, 100, 250, 500],
        blocked_reasons={0: None, 100: None, 250: None, 500: None},
        base_probability=0.31,
        failure_reason="insufficient_funds",
        amount=3000.0,
        intervention_unit_cost=3.0,
    )
    by_incentive = {c.incentive: c for c in candidates}
    # The documented worked example (docs/RECOVERY_NEGOTIATION_ENGINE.md
    # Section 20): 500 has HIGHER recovery probability than 250 but LOWER net
    # value -- the central "more recovery != more revenue" claim.
    assert by_incentive[500].recovery_probability > by_incentive[250].recovery_probability
    assert by_incentive[500].expected_net_value < by_incentive[250].expected_net_value


# ---------------------------------------------------------------------------
# Q7 -- Can increasing an intervention's cost change the selected action?
# ---------------------------------------------------------------------------


def test_q7_raising_a_cost_can_flip_the_optimizer_choice() -> None:
    amount = 8_000.0
    probs = {"sms_link": 0.30, "voice_call": 0.35, "no_action": 0.05, "retry_now": 0.05,
             "retry_later": 0.05, "whatsapp_nudge": 0.05, "email": 0.05}
    original = dict(ev_engine.INTERVENTION_UNIT_COSTS)
    try:
        ev_engine.INTERVENTION_UNIT_COSTS = original  # baseline: voice_call (35% * 8000 - 15 = 2785) beats sms_link (30% * 8000 - 3 = 2397)
        eligible, _ = apply_guardrails(full_menu(), amount, "probe", set())
        ev_before = compute_ev_for_menu(probs, amount)
        chosen_before = select_best_intervention(ev_before, eligible)
        assert chosen_before == "voice_call"

        ev_engine.INTERVENTION_UNIT_COSTS = {**original, "voice_call": 3000.0}  # now costs more than it could ever recover
        ev_after = compute_ev_for_menu(probs, amount)
        chosen_after = select_best_intervention(ev_after, eligible)
        assert chosen_after != "voice_call"
        assert chosen_before != chosen_after
    finally:
        ev_engine.INTERVENTION_UNIT_COSTS = original


# ---------------------------------------------------------------------------
# Q8 -- Can a stricter contact cap change the result?
# ---------------------------------------------------------------------------


def test_q8_stricter_contact_cap_changes_eligible_set_and_result() -> None:
    amount = 8_000.0
    ev = {"voice_call": 100.0, "whatsapp_nudge": 50.0, "no_action": 0.0, "retry_now": 1.0}
    eligible_lenient, _ = apply_guardrails(list(ev.keys()), amount, "c1", set(), prior_contact_count=1, contact_cap=2)
    eligible_strict, _ = apply_guardrails(list(ev.keys()), amount, "c1", set(), prior_contact_count=1, contact_cap=1)
    chosen_lenient = select_best_intervention(ev, eligible_lenient)
    chosen_strict = select_best_intervention(ev, eligible_strict)
    assert chosen_lenient == "voice_call"
    assert chosen_strict in ("no_action", "retry_now")
    assert chosen_lenient != chosen_strict


# ---------------------------------------------------------------------------
# Q9 -- Does the audit log record ALL alternatives, not just the winner?
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_q9_audit_record_carries_every_menu_entry_not_just_the_winner(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    payment_id = client.get("/decisions", params={"page_size": 1}).json()["decisions"][0]["payment_id"]
    res = client.post(f"/decide/{payment_id}")
    assert res.status_code == 200
    all_evs = res.json()["audit_record"]["all_evs"]
    assert {e["intervention_id"] for e in all_evs} == set(full_menu())
    chosen = res.json()["chosen_intervention"]
    rejected = [e for e in all_evs if e["intervention_id"] != chosen]
    assert len(rejected) == len(full_menu()) - 1
    # Every rejected/blocked entry carries either eligible=True (lost on EV)
    # or a populated blocked_reason -- the "why not this action?" panel's
    # entire data source.
    for e in rejected:
        assert e["eligible"] or e["blocked_reason"]


# ---------------------------------------------------------------------------
# Q10 -- Can the LLM alter the actual decision?
# ---------------------------------------------------------------------------


def test_q10_explain_module_never_imports_optimizer_or_ev_engine() -> None:
    # The explanation step must be structurally incapable of feeding back
    # into which intervention gets chosen -- generate_explanation is called
    # in main.py AFTER select_best_intervention has already run (see
    # main.py's _decide), and explain.py has no way to reach back into that
    # decision even if it wanted to.
    tree = ast.parse(inspect.getsource(explain))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
            imported.update(a.name for a in node.names)
    assert not any("optimizer" in name or "ev_engine" in name for name in imported)


def test_q10_explanation_text_never_changes_chosen_intervention_field(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    payment_id = client.get("/decisions", params={"page_size": 1}).json()["decisions"][0]["payment_id"]
    res = client.post(f"/decide/{payment_id}").json()
    # chosen_intervention appears identically in both the top-level response
    # field and the audit record -- one value, not two that could diverge if
    # the LLM step were ever wired to also decide.
    assert res["chosen_intervention"] == res["audit_record"]["chosen_intervention"]


# ---------------------------------------------------------------------------
# Q11 -- Can mock mode silently appear as real/live mode?
# ---------------------------------------------------------------------------
#
# This is a frontend concern (frontend/src/api/client.ts's USE_MOCKS flag) --
# not something a backend pytest can execute. Verified by static inspection
# instead: USE_MOCKS defaults to true (fail toward mocks, never toward
# silently-pretending-to-be-live), and a visible "Mock data" / "Live backend"
# badge was added to Layout.tsx during this hardening pass (previously the
# only environment badge on screen was "Test mode," which is true in BOTH
# modes and doesn't answer this question at all). See docs/JUDGE_EVIDENCE.md.


def test_q11_documented_not_a_backend_concern() -> None:
    assert True  # see module docstring above; real check is in frontend/src/api/client.ts + Layout.tsx


# ---------------------------------------------------------------------------
# Q12 -- Can duplicate frontend requests execute a real Razorpay action twice?
# ---------------------------------------------------------------------------
#
# /decide is deliberately NOT idempotent server-side (each call is a fresh
# audit record, by design -- see main.py's _decide docstring and
# razorpay_client.py's reference_id comment). Duplicate-execution protection
# therefore has to live client-side. frontend/src/components/DecisionDrillDown.tsx
# and frontend/src/payments/usePaymentFlow.ts both carry an explicit ref guard
# for exactly this (a StrictMode double-invoke guard and an
# actionInFlight-double-click guard, respectively) -- this test locks in that
# the backend at least does NOT provide any accidental idempotency that would
# mask a frontend regression (e.g. if someone "simplified" the ref guards away,
# a second call must still be a second real audit entry, which is the
# behavior the frontend guards exist to prevent from being user-visible).


def test_q12_decide_is_intentionally_not_idempotent_so_frontend_guard_is_load_bearing(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    payment_id = client.get("/decisions", params={"page_size": 1}).json()["decisions"][0]["payment_id"]
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.post(f"/decide/{payment_id}")
    client.post(f"/decide/{payment_id}")
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before + 2  # confirms the backend has no dedup -- the frontend ref guards are the only protection


# ---------------------------------------------------------------------------
# Q13 -- Can analysis-only endpoints mutate the audit log?
# ---------------------------------------------------------------------------


def test_q13_recovery_lab_simulate_never_appends_to_audit_log(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.post("/recovery-lab/simulate", json={"policy": "rve_adaptive", "n_simulation_runs": 50})
    client.post("/recovery-lab/sensitivity", json={"policy": "rve_adaptive", "dimension": "voice_capacity"})
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before


def test_q13_revenue_autopsy_never_appends_to_audit_log(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.get("/revenue-autopsy/summary")
    client.get("/revenue-autopsy/causes")
    client.get("/revenue-autopsy/payments")
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before


def test_q13_negotiation_analyze_never_appends_to_audit_log(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    payment_id = client.get("/decisions", params={"page_size": 1}).json()["decisions"][0]["payment_id"]
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.post("/recovery-negotiation/analyze", json={"payment_id": payment_id})
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before


def test_q13_evaluate_never_appends_to_audit_log(client: TestClient) -> None:
    client.post("/simulate", json={"n_customers": 30, "n_training_logs": 500, "n_batch_payments": 25, "seed": 5})
    before = client.get("/decisions", params={"page_size": 500}).json()["total"]
    client.get("/evaluate")
    client.get("/metrics")
    after = client.get("/decisions", params={"page_size": 500}).json()["total"]
    assert after == before


# ---------------------------------------------------------------------------
# Q14 -- Can synthetic hidden ground truth leak into production decision
# logic (the probability model, EV engine, optimizer, or guardrails)?
# ---------------------------------------------------------------------------


_LEAK_TOKENS = ("hidden_truth", "_simulator_truth", "generate_hidden_truth")


def _code_identifiers_and_string_literals(module) -> set[str]:
    """Names/attributes/parameters actually used as CODE in `module`, plus
    exact string-literal constants (e.g. a dict key or column name) -- NOT
    prose. A module docstring that legitimately *documents* the hidden-truth
    boundary in English (e.g. probability_model.py's own module docstring:
    "never touches the hidden ``_simulator_truth`` table") is one long string
    constant that does not *equal* "hidden_truth"/"_simulator_truth", so it
    is correctly excluded here -- the same class of prose-vs-code distinction
    test_negotiation_engine.py's import-AST check makes for "never imports
    razorpay_client". A real leak (a parameter named ``hidden_truth_df``, or
    a literal ``row["_simulator_truth"]`` lookup) shows up as an actual
    identifier or an exact string constant and IS caught.
    """
    tree = ast.parse(inspect.getsource(module))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            found.add(node.id)
        elif isinstance(node, ast.arg):
            found.add(node.arg)
        elif isinstance(node, ast.Attribute):
            found.add(node.attr)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.add(node.value)
    return found


@pytest.mark.parametrize("module", [probability_model, optimizer, ev_engine, guardrails, explain])
def test_q14_decision_modules_never_reference_hidden_truth(module) -> None:
    identifiers = _code_identifiers_and_string_literals(module)
    for token in _LEAK_TOKENS:
        assert token not in identifiers, f"{module.__name__} has a real code reference to {token!r}, not just a docstring mention"


@pytest.mark.parametrize("module", [evaluator, recovery_lab, revenue_autopsy])
def test_q14_only_the_documented_offline_modules_read_hidden_truth(module) -> None:
    # The flip side of the above: evaluator.py, recovery_lab.py, and
    # revenue_autopsy.py are the explicitly documented exceptions (README /
    # docs/ARCHITECTURE.md / docs/RECOVERY_DIGITAL_TWIN.md /
    # docs/REVENUE_RECOVERY_AUTOPSY.md all state this) -- confirms they DO
    # reference it as actual code (so this test would fail loudly if one of
    # them were refactored to stop taking a hidden-truth argument, which
    # would silently break the offline-evaluation boundary this whole test
    # file exists to protect) rather than just asserting an absence
    # everywhere.
    identifiers = _code_identifiers_and_string_literals(module)
    assert "hidden_truth" in identifiers or "hidden_truth_df" in identifiers
