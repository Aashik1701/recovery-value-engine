/**
 * Deterministic mock engine for the Recovery Negotiation Engine (see
 * docs/RECOVERY_NEGOTIATION_ENGINE.md). Mirrors negotiation_engine.py's
 * formulas exactly -- same incentive-response curve parameters, same
 * eligibility-before-economics ordering, same three-outcome/margin-protected
 * definitions -- over the SAME mock decision population the rest of the
 * dashboard's mock mode uses (`mockDecisions`), so a payment's negotiation
 * analysis stays internally consistent with its RVE decision card elsewhere
 * in mock mode. Never calls the real backend.
 */
import type {
  FailureReason,
  InterventionEvaluation,
  NegotiationAnalyzeRequest,
  NegotiationAnalyzeResponse,
  NegotiationCandidate,
} from "../api/types";
import { mockDecisions } from "./fixtures";

const MAX_CANDIDATES = 200;
const MAX_INCENTIVE_POLICY = 500;

interface IncentiveResponseParams {
  maxUplift: number;
  halfSaturation: number;
}

// EXPLICITLY SYNTHETIC assumptions, identical to negotiation_engine.py's
// INCENTIVE_RESPONSE_PARAMS -- never real customer discount-response data.
const INCENTIVE_RESPONSE_PARAMS: Record<FailureReason, IncentiveResponseParams> = {
  insufficient_funds: { maxUplift: 0.35, halfSaturation: 80 },
  other: { maxUplift: 0.15, halfSaturation: 150 },
  bank_timeout: { maxUplift: 0.05, halfSaturation: 300 },
  network_error: { maxUplift: 0.05, halfSaturation: 300 },
  card_expired: { maxUplift: 0.03, halfSaturation: 400 },
  fraud_block: { maxUplift: 0, halfSaturation: 1 },
};

function incentiveResponseProbability(baseProbability: number, failureReason: FailureReason, incentive: number): number {
  if (incentive <= 0) return Math.max(0, Math.min(1, baseProbability));
  const params = INCENTIVE_RESPONSE_PARAMS[failureReason];
  const uplift = (params.maxUplift * incentive) / (incentive + params.halfSaturation);
  return Math.max(0, Math.min(1, baseProbability + uplift));
}

function generateIncentiveLadder(minIncentive: number, maxIncentive: number, step: number): number[] {
  if (minIncentive < 0) throw new Error("min_incentive must be >= 0.");
  if (maxIncentive < minIncentive) throw new Error("max_incentive must be >= min_incentive.");
  if (step <= 0) throw new Error("step must be > 0.");
  const n = Math.floor((maxIncentive - minIncentive) / step + 1e-9) + 1;
  if (n > MAX_CANDIDATES) throw new Error(`Requested ladder has ${n} levels, exceeding the maximum of ${MAX_CANDIDATES}.`);
  return Array.from({ length: n }, (_, i) => Math.round((minIncentive + i * step) * 100) / 100);
}

function determineBlockedReason(
  incentive: number,
  baseEligible: boolean,
  baseBlockedReason: string | undefined,
  failureReason: FailureReason,
): string | null {
  if (!baseEligible) return baseBlockedReason ?? "Blocked: base intervention is not eligible for this payment.";
  if (failureReason === "fraud_block") {
    // Hard fraud-risk policy: every incentive level, including ₹0, is
    // ineligible — the Negotiation Engine cannot reach incentive
    // optimization for a fraud-flagged payment (mirrors the backend's
    // guardrails.recovery_suppression_policy).
    return "Blocked by risk policy (fraud_block): recovery is suppressed for fraud-flagged payments.";
  }
  if (incentive > MAX_INCENTIVE_POLICY) {
    return `Blocked: merchant policy does not allow this incentive (maximum ₹${MAX_INCENTIVE_POLICY.toLocaleString("en-IN")}).`;
  }
  return null;
}

function computeCandidates(
  levels: number[],
  baseEligible: boolean,
  baseBlockedReason: string | undefined,
  baseProbability: number,
  failureReason: FailureReason,
  amount: number,
  interventionCost: number,
): NegotiationCandidate[] {
  return levels.map((incentive) => {
    const blockedReason = determineBlockedReason(incentive, baseEligible, baseBlockedReason, failureReason);
    if (blockedReason) {
      return {
        incentive,
        eligible: false,
        blocked_reason: blockedReason,
        recovery_probability: null,
        incremental_recovery: null,
        incentive_cost: null,
        intervention_cost: null,
        expected_gross_recovery: null,
        expected_net_value: null,
      };
    }
    const p = incentiveResponseProbability(baseProbability, failureReason, incentive);
    const gross = p * amount;
    const net = gross - incentive - interventionCost;
    const incremental = (p - baseProbability) * amount;
    return {
      incentive,
      eligible: true,
      blocked_reason: null,
      recovery_probability: Math.round(p * 10000) / 10000,
      incremental_recovery: Math.round(incremental * 100) / 100,
      incentive_cost: incentive,
      intervention_cost: interventionCost,
      expected_gross_recovery: Math.round(gross * 100) / 100,
      expected_net_value: Math.round(net * 100) / 100,
    };
  });
}

/** Three DISTINCT outcomes over the eligible candidate set -- exported so
 * the live page can recompute minimum_effective_intervention/margin_protected
 * client-side when the tolerance control changes, without a new network
 * call, in BOTH mock and real mode (the candidate curve is already fetched
 * in full either way). */
export function selectOutcomes(
  candidates: NegotiationCandidate[],
  tolerance: number,
): { maxRecoveryProbability: number | null; optimum: number | null; minimumEffectiveIntervention: number | null } {
  const eligible = candidates.filter((c) => c.eligible);
  if (eligible.length === 0) return { maxRecoveryProbability: null, optimum: null, minimumEffectiveIntervention: null };

  const maxProb = eligible.reduce((best, c) =>
    (c.recovery_probability ?? -Infinity) > (best.recovery_probability ?? -Infinity) ? c : best,
  );
  const optimumC = eligible.reduce((best, c) =>
    (c.expected_net_value ?? -Infinity) > (best.expected_net_value ?? -Infinity) ? c : best,
  );
  const threshold = tolerance * (optimumC.expected_net_value ?? 0);
  const meiCandidates = eligible.filter((c) => (c.expected_net_value ?? -Infinity) >= threshold);
  const mei = meiCandidates.reduce((best, c) => (c.incentive < best.incentive ? c : best));

  return { maxRecoveryProbability: maxProb.incentive, optimum: optimumC.incentive, minimumEffectiveIntervention: mei.incentive };
}

export function computeMarginProtected(candidates: NegotiationCandidate[], minimumEffectiveIntervention: number | null): number | null {
  if (minimumEffectiveIntervention === null) return null;
  const eligible = candidates.filter((c) => c.eligible).sort((a, b) => a.incentive - b.incentive);
  const idx = eligible.findIndex((c) => c.incentive === minimumEffectiveIntervention);
  if (idx === -1 || idx + 1 >= eligible.length) return null;
  const diff = (eligible[idx].expected_net_value ?? 0) - (eligible[idx + 1].expected_net_value ?? 0);
  return diff >= 0 ? Math.round(diff * 100) / 100 : null;
}

/** Deterministic explanation template -- no LLM. Exported so the live page
 * can regenerate this text client-side whenever the tolerance control
 * changes, in BOTH mock and real mode, so the displayed sentence never goes
 * stale relative to the displayed tolerance/outcomes (the candidate curve
 * itself is fetched once; only the tolerance-dependent read of it changes). */
export function buildExplanation(
  candidates: NegotiationCandidate[],
  optimum: number | null,
  minimumEffectiveIntervention: number | null,
  tolerance: number,
): string {
  if (optimum === null || minimumEffectiveIntervention === null) {
    const blocked = candidates.find((c) => !c.eligible && c.blocked_reason)?.blocked_reason;
    return `No incentive level is eligible for this payment${blocked ? `: ${blocked}` : "."}`;
  }
  const byIncentive = new Map(candidates.map((c) => [c.incentive, c]));
  const optimumC = byIncentive.get(optimum)!;

  let sentence: string;
  if (minimumEffectiveIntervention === 0) {
    sentence =
      "No incentive is recommended: at this payment's failure reason, additional incentive does not generate enough incremental recovery to offset its cost.";
  } else {
    const meiC = byIncentive.get(minimumEffectiveIntervention)!;
    const eligibleSorted = candidates.filter((c) => c.eligible).sort((a, b) => a.incentive - b.incentive);
    const idx = eligibleSorted.findIndex((c) => c.incentive === minimumEffectiveIntervention);
    let tradeoff = "";
    if (idx + 1 < eligibleSorted.length) {
      const next = eligibleSorted[idx + 1];
      const deltaPp = ((next.recovery_probability ?? 0) - (meiC.recovery_probability ?? 0)) * 100;
      const deltaCost = (next.incentive_cost ?? 0) - (meiC.incentive_cost ?? 0);
      const deltaEv = (meiC.expected_net_value ?? 0) - (next.expected_net_value ?? 0);
      if (deltaEv > 0) {
        tradeoff = ` ₹${next.incentive.toLocaleString("en-IN")} increases recovery probability by ${deltaPp.toFixed(
          1,
        )} percentage points, but its additional ₹${deltaCost.toLocaleString(
          "en-IN",
        )} cost reduces expected net value by ₹${deltaEv.toLocaleString("en-IN")}.`;
      }
    }
    sentence = `₹${minimumEffectiveIntervention.toLocaleString("en-IN")} is recommended because it achieves ${(
      tolerance * 100
    ).toFixed(0)}% of the maximum expected net value (₹${(optimumC.expected_net_value ?? 0).toLocaleString(
      "en-IN",
    )}) at the lowest incentive cost.${tradeoff}`;
  }

  const blockedAboveCeiling = candidates.filter((c) => !c.eligible && c.blocked_reason?.includes("merchant policy"));
  if (blockedAboveCeiling.length > 0) {
    const top = blockedAboveCeiling.reduce((best, c) => (c.incentive > best.incentive ? c : best));
    sentence += ` ₹${top.incentive.toLocaleString("en-IN")} is blocked by merchant policy (maximum incentive: ₹${MAX_INCENTIVE_POLICY.toLocaleString(
      "en-IN",
    )}).`;
  }
  return sentence;
}

export function mockNegotiationAnalyze(req: NegotiationAnalyzeRequest): NegotiationAnalyzeResponse {
  const decision = mockDecisions.find((d) => d.payment_id === req.payment_id);
  if (!decision) throw new Error(`Unknown payment_id: ${req.payment_id}`);

  const baseEval: InterventionEvaluation | undefined = decision.evaluations.find((e) => e.status === "chosen");
  if (!baseEval) throw new Error(`No RVE decision exists yet for payment_id: ${req.payment_id}. Call /decide first.`);

  const minIncentive = req.min_incentive ?? 0;
  const maxIncentive = req.max_incentive ?? 500;
  const step = req.step ?? 50;
  const tolerance = req.optimization_tolerance ?? 0.95;
  if (!(tolerance > 0 && tolerance <= 1)) throw new Error("optimization_tolerance must be in (0, 1].");

  // decision.chosen_intervention already won the guardrail-filtered argmax
  // in the mock RVE decision pipeline (see fixtures.ts), so it is always
  // base-eligible here -- there is no separate re-check needed in mock mode.
  const levels = generateIncentiveLadder(minIncentive, maxIncentive, step);
  const candidates = computeCandidates(
    levels,
    true,
    undefined,
    baseEval.probability_recovery,
    decision.failure_reason,
    decision.amount,
    baseEval.unit_cost,
  );

  const { maxRecoveryProbability, optimum, minimumEffectiveIntervention } = selectOutcomes(candidates, tolerance);
  const marginProtected = computeMarginProtected(candidates, minimumEffectiveIntervention);
  const explanation = buildExplanation(candidates, optimum, minimumEffectiveIntervention, tolerance);

  return {
    payment_id: decision.payment_id,
    amount: decision.amount,
    failure_reason: decision.failure_reason,
    customer_id: decision.customer_id,
    base_intervention: baseEval.intervention_id,
    base_probability: Math.round(baseEval.probability_recovery * 10000) / 10000,
    base_expected_value: Math.round(baseEval.expected_value * 100) / 100,
    candidates,
    max_recovery_probability_candidate: maxRecoveryProbability,
    optimum_candidate: optimum,
    minimum_effective_intervention: minimumEffectiveIntervention,
    optimization_tolerance: tolerance,
    margin_protected: marginProtected,
    explanation,
    note:
      "Offline / model-based estimate on synthetic data (mock mode). Baseline (₹0) probability comes from the mock RVE decision; every incentive level above that uses a documented, explicitly synthetic response curve -- not real customer discount-response data.",
  };
}
