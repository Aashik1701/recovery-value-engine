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

from app import evaluator, simulator
from app.ev_engine import compute_ev_for_menu
from app.explain import generate_explanation
from app.guardrails import apply_guardrails, full_menu
from app.razorpay_client import create_payment_link
from app.models import (
    INTERVENTION_UNIT_COSTS,
    NON_CONTACT_INTERVENTIONS,
    AuditRecord,
    DecideResponse,
    DecisionsResponse,
    EvaluateResponse,
    InterventionEV,
    MetricsResponse,
    PSSConditions,
    PSSMethodScore,
    PSSScoreResponse,
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
        self.hidden_truth: Optional[pd.DataFrame] = None  # only ever passed to evaluator.py
        self.training_logs: Optional[pd.DataFrame] = None
        self.model: Optional[ProbabilityModel] = None
        self.suppression_list: Set[str] = set()
        self.audit_log: List[AuditRecord] = []
        # Payment Success Score (v2, CLAUDE.md Section 20) -- an entirely
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

    model = ProbabilityModel()
    model.fit(bundle.training_logs, bundle.customers, seed=req.seed)
    state.model = model

    # Run the decision pipeline over the whole fresh batch immediately, so
    # /decisions (the dashboard's queue) is populated right after /simulate
    # rather than requiring a separate /decide call per payment_id first.
    for payment_id in bundle.batch_payments["payment_id"]:
        _decide(payment_id, live=False)

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


def _decide(payment_id: str, live: bool) -> DecideResponse:
    payment_rows = state.batch_payments[state.batch_payments["payment_id"] == payment_id]
    if payment_rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown payment_id: {payment_id}")
    payment = payment_rows.iloc[0].to_dict()

    customer_rows = state.customers[state.customers["customer_id"] == payment["customer_id"]]
    if customer_rows.empty:
        raise HTTPException(status_code=404, detail=f"Unknown customer_id for payment: {payment_id}")
    customer = customer_rows.iloc[0].to_dict()

    menu = full_menu()
    probabilities = state.model.predict_proba_matrix(payment, customer, menu)
    ev_by_intervention = compute_ev_for_menu(probabilities, payment["amount"])

    # How many contact-requiring interventions this payment has already had,
    # per the audit log -- previously this was never computed and the
    # contact-frequency cap guardrail (CLAUDE.md Section 9) could never
    # actually trigger through the live API despite being correctly
    # unit-tested in isolation. Found during failure-recovery testing.
    prior_contact_count = sum(
        1
        for r in state.audit_log
        if r.payment_id == payment_id and r.chosen_intervention not in NON_CONTACT_INTERVENTIONS
    )

    eligible_ids, blocked_reasons = apply_guardrails(
        menu,
        payment["amount"],
        payment["customer_id"],
        state.suppression_list,
        prior_contact_count=prior_contact_count,
    )
    chosen_intervention = select_best_intervention(ev_by_intervention, eligible_ids)

    all_evs = [
        InterventionEV(
            intervention_id=iid,
            probability_of_recovery=round(probabilities[iid], 4),
            unit_cost=INTERVENTION_UNIT_COSTS[iid],
            expected_value=round(ev_by_intervention[iid], 2),
            eligible=iid in eligible_ids,
            blocked_reason=blocked_reasons.get(iid),
        )
        for iid in menu
    ]

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

    # The one intervention that hits a real external API (CLAUDE.md Section
    # 14 Phase 5). Skipped during the bulk auto-decide pass in
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
        # Timezone-AWARE UTC, not the naive datetime.utcnow(). A naive
        # timestamp serializes without a UTC offset/'Z' suffix, and
        # JavaScript's `new Date(...)` parses a timezone-less date-time
        # string as LOCAL time -- so a browser outside UTC would silently
        # misread every decided_at by its own UTC offset (discovered as
        # freshly-created decisions showing "6h ago" in IST, UTC+5:30).
        decided_at=datetime.now(timezone.utc),
        all_evs=all_evs,
        chosen_intervention=chosen_intervention,
        explanation=explanation,
        payment_link_url=payment_link_url,
        payment_link_error=payment_link_error,
    )
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
# Payment Success Score (v2, see CLAUDE.md Section 20) -- pre-failure
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
