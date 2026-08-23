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
from datetime import datetime
from typing import Dict, List, Optional, Set

import pandas as pd
from fastapi import FastAPI, HTTPException

from app import evaluator, simulator
from app.ev_engine import compute_ev_for_menu
from app.explain import generate_explanation
from app.guardrails import apply_guardrails, full_menu
from app.models import (
    INTERVENTION_UNIT_COSTS,
    AuditRecord,
    DecideResponse,
    DecisionsResponse,
    EvaluateResponse,
    InterventionEV,
    MetricsResponse,
    SimulateRequest,
    SimulateResponse,
)
from app.optimizer import select_best_intervention
from app.probability_model import ProbabilityModel

app = FastAPI(title="Recovery Value Engine", version="0.1.0")


class _AppState:
    def __init__(self) -> None:
        self.customers: Optional[pd.DataFrame] = None
        self.batch_payments: Optional[pd.DataFrame] = None
        self.hidden_truth: Optional[pd.DataFrame] = None  # only ever passed to evaluator.py
        self.training_logs: Optional[pd.DataFrame] = None
        self.model: Optional[ProbabilityModel] = None
        self.suppression_list: Set[str] = set()
        self.audit_log: List[AuditRecord] = []

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
        _decide(payment_id)

    return SimulateResponse(
        seed=req.seed,
        n_customers=len(bundle.customers),
        n_training_logs=len(bundle.training_logs),
        n_batch_payments=len(bundle.batch_payments),
        message="Simulation generated, probability model trained, and full batch decided.",
    )


@app.on_event("startup")
def _startup() -> None:
    _seed_initial_simulation()


@app.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    return _run_simulation_and_train(req)


@app.post("/decide/{payment_id}", response_model=DecideResponse)
def decide(payment_id: str) -> DecideResponse:
    if not state.is_ready():
        raise HTTPException(status_code=503, detail="Simulation not initialized yet.")
    return _decide(payment_id)


def _decide(payment_id: str) -> DecideResponse:
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
    eligible_ids, blocked_reasons = apply_guardrails(
        menu, payment["amount"], payment["customer_id"], state.suppression_list
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

    record = AuditRecord(
        decision_id=uuid.uuid4().hex,
        payment_id=payment_id,
        customer_id=payment["customer_id"],
        decided_at=datetime.utcnow(),
        all_evs=all_evs,
        chosen_intervention=chosen_intervention,
        explanation=explanation,
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
    return DecisionsResponse(
        total=len(state.audit_log),
        page=page,
        page_size=page_size,
        decisions=state.audit_log[start:end],
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
