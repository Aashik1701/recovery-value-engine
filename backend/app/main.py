"""FastAPI app for the Recovery Value Engine.

State storage note: the audit log (past /decide results) is kept as a
simple in-memory list, not SQLite. For a hackathon-scope demo this keeps
setup to zero extra dependencies/files and is fast to iterate on; the trade
off is state resets on process restart and there's no persistence across
runs. Swapping in SQLite (e.g. via sqlalchemy) later is a localized change
confined to this module's store functions, should persistence become
necessary.

The hidden ``_simulator_truth`` table is held in this module's in-memory
state only so it can be handed to evaluator.py for /evaluate -- no other
route or module reads it. /decide and /metrics never touch it.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Resolved relative to this file (backend/app/main.py -> backend/.env),
# not the process's current working directory. `load_dotenv()` with no
# path searches upward from os.getcwd(), which silently finds nothing --
# no error, keys just never load -- when uvicorn is launched from outside
# backend/ (a process manager, a different shell, this repo's own preview
# tooling). That failure mode is indistinguishable from "no keys configured"
# at runtime, so it's worth being explicit here instead.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app import demo_cases, evaluator, negotiation_engine, recovery_lab, revenue_autopsy, simulator
from app.ev_engine import compute_ev_for_menu
from app.explain import escalation_note, generate_explanation
from app.formatting import format_inr
from app.guardrails import apply_guardrails, full_menu
from app.razorpay_client import create_payment_link
from app.models import (
    ESCALATE,
    INTERVENTION_UNIT_COSTS,
    NON_CONTACT_INTERVENTIONS,
    AuditRecord,
    DecideResponse,
    DecisionsResponse,
    EvaluateResponse,
    InterventionEV,
    MetricsResponse,
    NegotiationAnalyzeRequest,
    NegotiationAnalyzeResponse,
    PSSConditions,
    PSSMethodScore,
    PSSScoreResponse,
    RecoveryLabExposureResponse,
    RecoveryLabPolicyMetrics,
    RecoveryLabSensitivityRequest,
    RecoveryLabSensitivityResponse,
    RecoveryLabSimulateRequest,
    RecoveryLabSimulateResponse,
    RevenueAutopsyCausesResponse,
    RevenueAutopsyPaymentsResponse,
    RevenueAutopsySummaryResponse,
    SimulateRequest,
    SimulateResponse,
)
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel
from app.pss_model import PSSModel
from app.pss_scorer import score_methods
from app.pss_simulator import run_pss_simulation

app = FastAPI(title="Recovery Value Engine", version="0.1.0")

# Local dev only: the React dashboard (Vite, localhost:5173) runs on a
# different origin than this API (localhost:8000). No auth/cookies cross
# this boundary, so a permissive local-origin allowlist is fine for a
# buildathon demo -- tighten if this is ever deployed beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class _AppState:
    def __init__(self) -> None:
        self.customers: Optional[pd.DataFrame] = None
        self.batch_payments: Optional[pd.DataFrame] = None
        self.hidden_truth: Optional[pd.DataFrame] = None  # only ever passed to evaluator.py / recovery_lab.py / revenue_autopsy.py
        self.training_logs: Optional[pd.DataFrame] = None
        self.model: Optional[ProbabilityModel] = None
        self.suppression_list: Set[str] = set()
        self.audit_log: List[AuditRecord] = []
        # The current batch's simulation seed, so read-only analysis layers
        # (revenue_autopsy.py) can derive their own deterministic synthetic
        # fields (forensic timestamps, realized outcomes) reproducibly for
        # a given seed, without re-deriving it from the request each time.
        self.seed: int = 42
        # Payment Success Score (v2, see docs/PAYMENT_PAGE.md) -- an entirely
        # separate pipeline from the RVE simulation above; trained once at
        # startup, not re-trained on every POST /simulate (that endpoint is
        # about the RVE batch, not this one).
        self.pss_model: Optional[PSSModel] = None

    def is_ready(self) -> bool:
        return self.customers is not None and self.batch_payments is not None and self.model is not None


state = _AppState()


def _seed_initial_simulation() -> None:
    """Run a default simulation at startup so /decide etc. work out of the
    box without requiring the client to call /simulate first."""
    _run_simulation_and_train(SimulateRequest())


def _run_simulation_and_train(req: SimulateRequest) -> SimulateResponse:
    bundle = simulator.run_simulation(
        n_customers=req.n_customers,
        n_training_logs=req.n_training_logs,
        n_batch_payments=req.n_batch_payments,
        seed=req.seed,
    )
    state.customers = bundle.customers
    state.batch_payments = bundle.batch_payments
    state.hidden_truth = bundle.hidden_truth
    state.training_logs = bundle.training_logs
    state.suppression_list = set()
    state.audit_log = []
    state.seed = req.seed

    model = ProbabilityModel()
    # The confidence ensemble (20 members) adds ~60-90s to a fit. The real
    # server always wants it (the demo + live escalation need it); the test
    # suite sets RVE_FAST_STARTUP=1 so its many TestClient app-startups stay
    # quick -- /decide then degrades gracefully to no-confidence-data, and
    # the escalation path is covered directly in test_confidence_escalation.py.
    train_ensemble = os.environ.get("RVE_FAST_STARTUP") != "1"
    model.fit(bundle.training_logs, bundle.customers, seed=req.seed, train_ensemble=train_ensemble)
    state.model = model

    # Run the decision pipeline over the whole fresh batch immediately, so
    # /decisions (the dashboard's queue) is populated right after /simulate
    # rather than requiring a separate /decide call per payment_id first.
    # The ensemble spread for all 500 payments is computed in ONE vectorized
    # pass here, not per-payment -- otherwise 500 x 20-member predict calls
    # add minutes to startup.
    menu = full_menu()
    spread_batch = (
        model.predict_spread_batch_matrix(bundle.batch_payments, bundle.customers, menu)
        if model.spread_p95 is not None
        else None
    )
    cust_by_id = bundle.customers.set_index("customer_id").to_dict(orient="index")
    for row_idx, (_, prow) in enumerate(bundle.batch_payments.iterrows()):
        payment = prow.to_dict()
        customer = {**cust_by_id[payment["customer_id"]], "customer_id": payment["customer_id"]}
        # Each payment_id is unique in a fresh batch, so prior_contact_count is 0.
        spreads = (
            {iid: float(spread_batch[iid][row_idx]) for iid in menu} if spread_batch is not None else None
        )
        _run_decision(
            payment,
            customer,
            payment["payment_id"],
            prior_contact_count=0,
            live=False,
            spread_by_intervention=spreads,
        )

    return SimulateResponse(
        seed=req.seed,
        n_customers=len(bundle.customers),
        n_training_logs=len(bundle.training_logs),
        n_batch_payments=len(bundle.batch_payments),
        message="Simulation generated, probability model trained, and full batch decided.",
    )


def _train_pss_model() -> None:
    bundle = run_pss_simulation()
    model = PSSModel()
    model.fit(bundle.training_logs, seed=bundle.seed)
    state.pss_model = model


@app.on_event("startup")
def _startup() -> None:
    _seed_initial_simulation()
    _train_pss_model()


@app.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    return _run_simulation_and_train(req)


@app.post("/decide/{payment_id}", response_model=DecideResponse)
def decide(payment_id: str) -> DecideResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    return _decide(payment_id, live=True)


@app.get("/decide/demo/low-confidence", response_model=DecideResponse)
def decide_demo_low_confidence() -> DecideResponse:
    """A deliberately-constructed out-of-distribution context (see
    demo_cases.py) that reliably trips the confidence gate -- so the pitch's
    "watch it escalate" beat doesn't depend on the live batch happening to
    contain one. Runs the exact same pipeline as /decide/{payment_id}; not
    a real payment, so it is not appended to the audit log and does not
    affect any pinned number."""
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    payment, customer = demo_cases.build_low_confidence_demo()
    return _run_decision(
        payment,
        customer,
        payment["payment_id"],
        prior_contact_count=0,
        live=False,
        append_to_log=False,
    )


def _decide(payment_id: str, live: bool) -> DecideResponse:
    payment_rows = state.batch_payments[state.batch_payments["payment_id"] == payment_id]
    if payment_rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown payment_id: {payment_id}")
    payment = payment_rows.iloc[0].to_dict()

    customer_rows = state.customers[state.customers["customer_id"] == payment["customer_id"]]
    if customer_rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown customer_id for payment: {payment_id}")
    customer = customer_rows.iloc[0].to_dict()

    # How many contact-requiring interventions this payment has already had,
    # per the audit log -- previously this was never computed and the
    # contact-frequency cap guardrail could never
    # actually trigger through the live API despite being correctly
    # unit-tested in isolation. Found during failure-recovery testing.
    prior_contact_count = sum(
        1
        for r in state.audit_log
        if r.payment_id == payment_id and r.chosen_intervention not in NON_CONTACT_INTERVENTIONS
    )
    return _run_decision(payment, customer, payment_id, prior_contact_count, live)


def _run_decision(
    payment: dict,
    customer: dict,
    payment_id: str,
    prior_contact_count: int,
    live: bool,
    append_to_log: bool = True,
    spread_by_intervention: Optional[Dict[str, float]] = None,
) -> DecideResponse:
    """Full decision pipeline for one (payment, customer) context. Shared by
    the batch-lookup /decide/{payment_id} route and the deliberately-
    constructed low-confidence demo case (demo_cases.py). No batch/state
    lookups happen here -- the caller supplies the context and prior contact
    count.

    ``spread_by_intervention`` lets the startup batch pass in pre-computed
    ensemble spreads (one vectorized ``predict_spread_batch_matrix`` call for
    the whole batch, instead of 500 per-payment calls x 20 members) -- the
    single-payment routes just leave it None and pay the per-call cost."""
    menu = full_menu()
    probabilities = state.model.predict_proba_matrix(payment, customer, menu)
    ev_by_intervention = compute_ev_for_menu(probabilities, payment["amount"])

    eligible_ids, blocked_reasons = apply_guardrails(
        menu,
        payment["amount"],
        payment["customer_id"],
        state.suppression_list,
        prior_contact_count=prior_contact_count,
    )
    # Top-ranked action by the primary model's EV -- unchanged. The confidence
    # gate below is a check on committing THIS action, run after the argmax
    # and before anything is executed, the same ordering as the guardrails.
    candidate_intervention = select_best_intervention(ev_by_intervention, eligible_ids)

    # Bootstrap-ensemble disagreement (std dev) per intervention -- the
    # confidence signal. Never replaces the point estimate above. Degrades
    # gracefully when the ensemble wasn't trained (fast-startup test runs,
    # see RVE_FAST_STARTUP): no spread data, nothing escalates -- identical
    # to the pre-feature behaviour. Same pattern as recovery_lab.py.
    has_ensemble = state.model.spread_p95 is not None
    if has_ensemble:
        spreads = spread_by_intervention or state.model.predict_spread_matrix(payment, customer, menu)
        chosen_spread = spreads[candidate_intervention]
        tier = state.model.confidence_tier(chosen_spread)
    else:
        spreads = {iid: 0.0 for iid in menu}
        chosen_spread = 0.0
        tier = "high"

    all_evs = [
        InterventionEV(
            intervention_id=iid,
            probability_of_recovery=round(probabilities[iid], 4),
            probability_spread=round(spreads[iid], 4),
            confidence_tier=state.model.confidence_tier(spreads[iid]) if has_ensemble else "high",
            unit_cost=INTERVENTION_UNIT_COSTS[iid],
            expected_value=round(ev_by_intervention[iid], 2),
            eligible=iid in eligible_ids,
            blocked_reason=blocked_reasons.get(iid),
        )
        for iid in menu
    ]

    escalated = has_ensemble and state.model.should_escalate(chosen_spread)
    if escalated:
        # Uncertainty reduces autonomy: hand it to a human instead of acting
        # on a number the ensemble doesn't agree on. Deterministic note, no
        # LLM call -- so the "exactly one LLM call" claim still holds.
        chosen_intervention = ESCALATE
        explanation = escalation_note(
            candidate=candidate_intervention,
            spread=chosen_spread,
            threshold=state.model.spread_p95,
        )
    else:
        chosen_intervention = candidate_intervention
        explanation = generate_explanation(
            chosen_intervention=chosen_intervention,
            probability=probabilities[chosen_intervention],
            unit_cost=INTERVENTION_UNIT_COSTS[chosen_intervention],
            expected_value=ev_by_intervention[chosen_intervention],
            amount=payment["amount"],
            failure_reason=payment["failure_reason"],
            transaction_type=payment["transaction_type"],
            retry_count_so_far=int(payment["retry_count_so_far"]),
        )

    decision_id = uuid.uuid4().hex

    # The one intervention that hits a real external API. Skipped during
    # the bulk auto-decide pass in
    # `_run_simulation_and_train` (`live=False`) -- firing ~500 real HTTP
    # calls to Razorpay on every /simulate would make startup slow and
    # flaky; it fires on an explicit /decide/{payment_id} call instead,
    # which is the actual demo path for "one real API call verified."
    payment_link_url: Optional[str] = None
    payment_link_error: Optional[str] = None
    if live and chosen_intervention == "sms_link":
        result = create_payment_link(payment_id, payment["amount"], payment["customer_id"], decision_id)
        payment_link_url = result.url
        payment_link_error = result.error

    record = AuditRecord(
        decision_id=decision_id,
        payment_id=payment_id,
        customer_id=payment["customer_id"],
        amount=payment["amount"],
        failure_reason=payment["failure_reason"],
        transaction_type=payment["transaction_type"],
        retry_count_so_far=int(payment["retry_count_so_far"]),
        # Timezone-AWARE UTC, not the naive datetime.utcnow(). A naive
        # timestamp serializes without a UTC offset/'Z' suffix, and
        # JavaScript's `new Date(...)` parses a timezone-less date-time
        # string as LOCAL time -- so a browser outside UTC would silently
        # misread every decided_at by its own UTC offset (discovered as
        # freshly-created decisions showing "6h ago" in IST, UTC+5:30).
        decided_at=datetime.now(timezone.utc),
        all_evs=all_evs,
        chosen_intervention=chosen_intervention,
        chosen_probability_spread=round(chosen_spread, 4),
        confidence_tier=tier,
        escalated=escalated,
        explanation=explanation,
        payment_link_url=payment_link_url,
        payment_link_error=payment_link_error,
    )
    if append_to_log:
        state.audit_log.append(record)

    return DecideResponse(
        chosen_intervention=chosen_intervention,
        explanation=explanation,
        audit_record=record,
    )


@app.get("/decisions", response_model=DecisionsResponse)
def decisions(page: int = 1, page_size: int = 20) -> DecisionsResponse:
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="page and page_size must be >= 1")
    start = (page - 1) * page_size
    end = start + page_size
    # Most-recent-first, not insertion order: audit_log.append() means the
    # oldest entries (the initial /simulate batch) sit at the front of the
    # list. Without reversing here, a decision made just now via an
    # explicit /decide call lands on whatever page comes after the full
    # batch, not page 1 -- indistinguishable from having failed to persist
    # at all when the dashboard is the only thing you're looking at.
    ordered = list(reversed(state.audit_log))
    return DecisionsResponse(
        total=len(state.audit_log),
        page=page,
        page_size=page_size,
        decisions=ordered[start:end],
    )


@app.get("/evaluate", response_model=EvaluateResponse)
def evaluate() -> EvaluateResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")

    results = evaluator.run_policy_comparison(
        state.batch_payments, state.customers, state.hidden_truth, state.model, state.suppression_list
    )
    return EvaluateResponse(n_payments_evaluated=len(state.batch_payments), policies=results)


@app.get("/metrics", response_model=MetricsResponse)
def metrics() -> MetricsResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    return state.model.get_metrics()


# ---------------------------------------------------------------------------
# Payment Success Score (v2, see docs/PAYMENT_PAGE.md) -- pre-failure
# prediction, entirely separate from the RVE decision pipeline above. Reads
# state.pss_model only; never touches state.model, state.audit_log, or
# anything the RVE routes use.
# ---------------------------------------------------------------------------


@app.post("/pss/score", response_model=PSSScoreResponse)
def pss_score(conditions: PSSConditions = PSSConditions()) -> PSSScoreResponse:
    if state.pss_model is None:
        raise HTTPException(status_code=503, detail="Payment Success Score model not initialized yet.")

    result = score_methods(state.pss_model, conditions.model_dump())

    return PSSScoreResponse(
        conditions=conditions,
        methods=[
            PSSMethodScore(
                method=m.method,
                success_probability=m.success_probability,
                score=m.score,
                recommended=m.recommended,
            )
            for m in result.methods
        ],
        recommended_method=result.recommended_method,
        healthy_baseline_score=result.healthy_baseline_score,
        delta_from_healthy=result.delta_from_healthy,
    )


@app.get("/pss/metrics", response_model=MetricsResponse)
def pss_metrics() -> MetricsResponse:
    if state.pss_model is None:
        raise HTTPException(status_code=503, detail="Payment Success Score model not initialized yet.")
    return state.pss_model.get_metrics()


# ---------------------------------------------------------------------------
# Recovery Lab -- "Revenue Recovery Digital Twin" (see recovery_lab.py and
# docs/RECOVERY_DIGITAL_TWIN.md). Merchant-level strategy simulation built on
# TOP of the RVE pipeline above: reads the same state.batch_payments /
# state.customers / state.hidden_truth / state.model, never mutates them,
# never calls Razorpay, and never appends to state.audit_log. Purely a
# read-and-compute layer, same architectural boundary as /evaluate.
# ---------------------------------------------------------------------------


@app.get("/recovery-lab/exposure", response_model=RecoveryLabExposureResponse)
def recovery_lab_exposure() -> RecoveryLabExposureResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    exposure = recovery_lab.compute_exposure(state.batch_payments)
    return RecoveryLabExposureResponse(**exposure)


@app.post("/recovery-lab/simulate", response_model=RecoveryLabSimulateResponse)
def recovery_lab_simulate(req: RecoveryLabSimulateRequest) -> RecoveryLabSimulateResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")

    policies, n_in_scope, total_at_risk, example_payment_id = recovery_lab.run_recovery_lab_simulation(
        state.batch_payments,
        state.customers,
        state.hidden_truth,
        state.model,
        state.suppression_list,
        primary_policy_id=req.policy.value,
        contact_intensity=req.contact_intensity.value,
        discount_budget=req.discount_budget,
        voice_capacity=req.voice_capacity,
        max_contacts_per_customer=req.max_contacts_per_customer,
        recovery_window_hours=req.recovery_window_hours,
        n_simulation_runs=req.n_simulation_runs,
        seed=req.seed,
    )
    insight = recovery_lab.build_insight(policies, req.policy.value)

    return RecoveryLabSimulateResponse(
        seed=req.seed,
        n_simulation_runs=req.n_simulation_runs,
        primary_policy_id=req.policy.value,
        n_payments_in_scope=n_in_scope,
        total_at_risk=round(total_at_risk, 2),
        policies=[policies[pid] for pid in ["no_intervention", "always_retry", "aggressive_recovery", "rve_adaptive"]],
        insight=insight,
        example_payment_id=example_payment_id,
    )


@app.post("/recovery-lab/sensitivity", response_model=RecoveryLabSensitivityResponse)
def recovery_lab_sensitivity(req: RecoveryLabSensitivityRequest) -> RecoveryLabSensitivityResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    if req.dimension not in ("voice_capacity", "discount_budget", "max_contacts_per_customer"):
        raise HTTPException(status_code=400, detail=f"Unknown sensitivity dimension: {req.dimension}")

    points, optimal_level, optimal_net_value = recovery_lab.run_sensitivity_sweep(
        state.batch_payments,
        state.customers,
        state.hidden_truth,
        state.model,
        state.suppression_list,
        policy_id=req.policy.value,
        dimension=req.dimension,
        contact_intensity=req.contact_intensity.value,
        discount_budget=req.discount_budget,
        voice_capacity=req.voice_capacity,
        max_contacts_per_customer=req.max_contacts_per_customer,
        recovery_window_hours=req.recovery_window_hours,
        seed=req.seed,
        levels=req.levels,
    )

    peak_index = next(i for i, p in enumerate(points) if p.level == optimal_level)
    is_interior_peak = 0 < peak_index < len(points) - 1
    insight = (
        f"Net value peaks around {optimal_level:,.0f} on this batch "
        f"({format_inr(optimal_net_value)}); additional capacity beyond this point stops adding net value."
        if is_interior_peak
        else f"Net value is still increasing at the highest tested level ({optimal_level:,.0f}) on this batch -- "
        "try a wider sweep to find where it turns over."
    )

    return RecoveryLabSensitivityResponse(
        dimension=req.dimension,
        policy_id=req.policy.value,
        points=points,
        optimal_level=optimal_level,
        optimal_net_value=optimal_net_value,
        insight=insight,
    )


# ---------------------------------------------------------------------------
# Revenue Recovery Autopsy (see revenue_autopsy.py and
# docs/REVENUE_RECOVERY_AUTOPSY.md). Forensic root-cause layer built on TOP
# of the existing synthetic batch and the existing RVE audit log: reads
# state.batch_payments / state.customers / state.hidden_truth / state.audit_log
# / state.suppression_list / state.seed, never mutates them, never touches
# state.model, never calls Razorpay, never appends to the audit log -- same
# read-only architectural boundary as /evaluate and /recovery-lab/*.
# ---------------------------------------------------------------------------


@app.get("/revenue-autopsy/summary", response_model=RevenueAutopsySummaryResponse)
def revenue_autopsy_summary() -> RevenueAutopsySummaryResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    return revenue_autopsy.get_summary_response(
        state.batch_payments, state.customers, state.hidden_truth, state.audit_log, state.suppression_list, state.seed,
    )


@app.get("/revenue-autopsy/causes", response_model=RevenueAutopsyCausesResponse)
def revenue_autopsy_causes() -> RevenueAutopsyCausesResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    return revenue_autopsy.get_causes_response(
        state.batch_payments, state.customers, state.hidden_truth, state.audit_log, state.suppression_list, state.seed,
    )


@app.get("/revenue-autopsy/payments", response_model=RevenueAutopsyPaymentsResponse)
def revenue_autopsy_payments(
    page: int = 1,
    page_size: int = 20,
    cause: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
) -> RevenueAutopsyPaymentsResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    if page < 1 or page_size < 1:
        raise HTTPException(status_code=400, detail="page and page_size must be >= 1")
    return revenue_autopsy.get_payments_response(
        state.batch_payments, state.customers, state.hidden_truth, state.audit_log, state.suppression_list, state.seed,
        page=page, page_size=page_size, cause=cause, status=status, search=search,
    )


# ---------------------------------------------------------------------------
# Recovery Negotiation Engine (see negotiation_engine.py and
# docs/RECOVERY_NEGOTIATION_ENGINE.md). A higher-level layer over RVE's own
# per-payment decision: RVE picks WHICH intervention; this answers HOW MUCH
# incentive is worth attaching to it. Reads state.batch_payments /
# state.customers / state.audit_log / state.model / state.suppression_list,
# never mutates them, never calls Razorpay, and never appends to
# state.audit_log -- same read-only architectural boundary as /evaluate,
# /recovery-lab/*, and /revenue-autopsy/*.
# ---------------------------------------------------------------------------


@app.post("/recovery-negotiation/analyze", response_model=NegotiationAnalyzeResponse)
def recovery_negotiation_analyze(req: NegotiationAnalyzeRequest) -> NegotiationAnalyzeResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")

    payment_rows = state.batch_payments[state.batch_payments["payment_id"] == req.payment_id]
    if payment_rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown payment_id: {req.payment_id}")
    payment = payment_rows.iloc[0].to_dict()

    customer_rows = state.customers[state.customers["customer_id"] == payment["customer_id"]]
    if customer_rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown customer_id for payment: {req.payment_id}")
    customer = customer_rows.iloc[0].to_dict()

    # RVE remains the source of truth for WHICH intervention -- this reads
    # the most recent decision already made for this payment (every payment
    # in state.batch_payments has one, since _run_simulation_and_train
    # decides the whole batch at /simulate time) rather than deciding
    # anything itself or calling _decide (which would append to the audit
    # log, violating this endpoint's read-only boundary).
    existing_decisions = [r for r in state.audit_log if r.payment_id == req.payment_id]
    if not existing_decisions:
        raise HTTPException(
            status_code=404,
            detail=f"No RVE decision exists yet for payment_id: {req.payment_id}. Call /decide first.",
        )
    base_intervention_id = existing_decisions[-1].chosen_intervention

    prior_contact_count = sum(
        1
        for r in state.audit_log
        if r.payment_id == req.payment_id and r.chosen_intervention not in NON_CONTACT_INTERVENTIONS
    )

    try:
        return negotiation_engine.analyze_negotiation(
            payment,
            customer,
            base_intervention_id=base_intervention_id,
            model=state.model,
            suppression_list=state.suppression_list,
            prior_contact_count=prior_contact_count,
            min_incentive=req.min_incentive,
            max_incentive=req.max_incentive,
            step=req.step,
            optimization_tolerance=req.optimization_tolerance,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
