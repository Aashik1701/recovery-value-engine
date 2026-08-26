/**
 * Deterministic mock engine for Revenue Recovery Autopsy. Ports the same
 * classification logic as the real backend's revenue_autopsy.py (primary /
 * contributing cause tagging, the 5-way outcome partition, preventability,
 * the Fix-First opportunity formula) entirely client-side, built on top of
 * the SAME synthetic population the rest of the dashboard's mock mode
 * already uses (`mockDecisions`), so figures stay internally consistent
 * across mock views and genuinely vary across causes/outcomes/delays rather
 * than being one static canned response.
 *
 * Simplification (documented, not hidden): `mockDecisions` doesn't expose a
 * `retry_count_so_far` field, so the "repeated retries" contributing-cause
 * tag from the real backend is not reproduced here -- mock mode shows the
 * other three contributing-cause tags plus all six primary causes. This
 * mirrors recoveryLabFixtures.ts's own precedent of being a faithful-but-
 * simplified port, not a byte-identical replica of the backend.
 */
import type {
  ContributingCause,
  Decision,
  FixFirstOpportunity,
  ForensicPaymentRecord,
  LossChainBreakdownItem,
  LossChainStage,
  ParetoResult,
  RecoveryDelayAnalysis,
  RecoveryDelayBucket,
  RevenueAutopsyCausesResponse,
  RevenueAutopsyPaymentsParams,
  RevenueAutopsyPaymentsResponse,
  RevenueAutopsySummaryResponse,
  RevenueLeakageSummary,
  RevenueOutcome,
  RootCauseCategory,
  RootCauseDetail,
} from "../api/types";
import { mockDecisions } from "./fixtures";

export const AUTOPSY_NOTE =
  "Offline / synthetic analysis using the existing synthetic failed-payment population and a client-side stand-in for the RVE audit log (mock mode). This does not establish production causal relationships and is not live gateway or bank diagnosis -- root causes are attributed under documented deterministic rules, not proven.";

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Exponential-ish draw via inverse CDF, matching the shape (not the exact
// numpy implementation) of the backend's rng.exponential(scale).
function expDraw(rand: () => number, scale: number): number {
  return -Math.log(1 - rand()) * scale;
}

// ---------------------------------------------------------------------------
// Same documented, hand-picked assumptions as backend/app/revenue_autopsy.py
// (base recovery probability + uplift by failure reason -- duplicated here,
// not imported, to keep this fixture file self-contained; see
// recoveryLabFixtures.ts for the same duplication pattern already in use).
// ---------------------------------------------------------------------------

type Bucket = {
  label: string;
  kind: "primary" | "contributing";
  category: RootCauseCategory;
  preventability: number;
  feasibility: number;
  fixCost: number;
};

const OPPORTUNITY_BUCKETS: Record<string, Bucket> = {
  bank_timeout: { label: "Bank / issuer timeout", kind: "primary", category: "payment_infrastructure", preventability: 0.55, feasibility: 0.4, fixCost: 500_000 },
  network_error: { label: "Gateway network error", kind: "primary", category: "payment_infrastructure", preventability: 0.55, feasibility: 0.4, fixCost: 450_000 },
  fraud_block: { label: "Issuer fraud block", kind: "primary", category: "payment_infrastructure", preventability: 0.05, feasibility: 0.15, fixCost: 300_000 },
  insufficient_funds: { label: "Insufficient funds", kind: "primary", category: "customer", preventability: 0.15, feasibility: 0.3, fixCost: 150_000 },
  card_expired: { label: "Expired card", kind: "primary", category: "customer", preventability: 0.7, feasibility: 0.6, fixCost: 200_000 },
  other: { label: "Unclassified / multi-factor", kind: "primary", category: "unknown_multi_factor", preventability: 0.2, feasibility: 0.2, fixCost: 100_000 },
  recovery_delay: { label: "Recovery delay", kind: "contributing", category: "recovery", preventability: 0.6, feasibility: 0.9, fixCost: 50_000 },
  guardrail_blocking: { label: "Guardrail-blocked higher-value action", kind: "contributing", category: "policy", preventability: 0.5, feasibility: 0.7, fixCost: 100_000 },
  checkout_latency: { label: "Elevated checkout latency (simulated)", kind: "contributing", category: "checkout", preventability: 0.35, feasibility: 0.5, fixCost: 150_000 },
};

const PRIMARY_KEYS = Object.keys(OPPORTUNITY_BUCKETS).filter((k) => OPPORTUNITY_BUCKETS[k].kind === "primary");
const RECOVERY_WINDOW_HOURS = 168;
const RECOVERY_DELAY_THRESHOLD_HOURS = 2;
const CHECKOUT_LATENCY_THRESHOLD_SECONDS = 8;
const PARETO_THRESHOLD = 0.5;

const PAYMENT_METHODS = ["upi", "card", "netbanking", "wallet"] as const;
const PAYMENT_METHOD_WEIGHTS = [0.42, 0.33, 0.15, 0.1];
const GATEWAYS = ["gateway_primary", "gateway_secondary", "bank_direct"] as const;
const GATEWAY_WEIGHTS = [0.55, 0.3, 0.15];
export const GATEWAY_LABELS: Record<string, string> = {
  gateway_primary: "Primary gateway",
  gateway_secondary: "Secondary gateway",
  bank_direct: "Direct bank debit",
};

function weightedPick<T extends string>(rand: () => number, items: readonly T[], weights: number[]): T {
  const r = rand();
  let cum = 0;
  for (let i = 0; i < items.length; i++) {
    cum += weights[i];
    if (r <= cum) return items[i];
  }
  return items[items.length - 1];
}

interface MockForensicRow {
  decision: Decision;
  paymentMethod: string;
  gateway: string;
  checkoutStartedAt: Date;
  paymentAttemptedAt: Date;
  failedAt: Date;
  decisionDelayHours: number;
  recoveryDecisionAt: Date;
  recoveryExecutedAt: Date;
  recoveredAt: Date | null;
  recovered: boolean;
  outcome: RevenueOutcome;
  contributing: ContributingCause[];
  preventableAmount: number;
  timeToRecoveryHours: number | null;
}

function bucketKeyForReason(reason: string): string {
  return reason in OPPORTUNITY_BUCKETS ? reason : "other";
}

function buildRow(decision: Decision): MockForensicRow {
  const rand = mulberry32(hashString(decision.payment_id));
  const failedAt = new Date(decision.decided_at);

  const checkoutGapS = clip(2 + rand() * 10, 0.5, 30);
  const attemptGapS = clip(1 + rand() * 6, 0.3, 15);
  const paymentAttemptedAt = new Date(failedAt.getTime() - attemptGapS * 1000);
  const checkoutStartedAt = new Date(paymentAttemptedAt.getTime() - checkoutGapS * 1000);

  const paymentMethod = weightedPick(rand, PAYMENT_METHODS, PAYMENT_METHOD_WEIGHTS);
  const gateway = weightedPick(rand, GATEWAYS, GATEWAY_WEIGHTS);

  const decisionDelayHours = clip(expDraw(rand, 6), 0.02, 120);
  const recoveryDecisionAt = new Date(failedAt.getTime() + decisionDelayHours * 3600_000);
  const executionGapMin = 1 + Math.floor(rand() * 14);
  const recoveryExecutedAt = new Date(recoveryDecisionAt.getTime() + executionGapMin * 60_000);

  const chosen = decision.evaluations.find((e) => e.status === "chosen")!;
  const bucketKey = bucketKeyForReason(decision.failure_reason);
  const bucket = OPPORTUNITY_BUCKETS[bucketKey];

  // Same recovery-timeliness decay assumption as the real backend: the
  // longer the decision is delayed, the less effective it is.
  const delayDecay = clip(1 - 0.02 * decisionDelayHours, 0.35, 1.0);
  const trueProb = clip(chosen.probability_recovery * delayDecay + (rand() - 0.5) * 0.06, 0, 1);
  const recovered = rand() < trueProb;

  let recoveredAt: Date | null = null;
  let timeToRecoveryHours: number | null = null;
  if (recovered) {
    const completionDelayHours = clip(expDraw(rand, 6), 0.05, 120);
    recoveredAt = new Date(recoveryExecutedAt.getTime() + completionDelayHours * 3600_000);
    timeToRecoveryHours = (recoveredAt.getTime() - failedAt.getTime()) / 3600_000;
  }

  let outcome: RevenueOutcome;
  if (chosen.intervention_id === "no_action" && recovered) {
    outcome = "natural_recovery";
  } else if (chosen.intervention_id !== "no_action" && recovered) {
    outcome = "intervention_recovery";
  } else {
    const hoursSinceFailure = (Date.now() - failedAt.getTime()) / 3600_000;
    // Simplified guardrail-eligibility proxy: is there still a genuine
    // CONTACT-based alternative (not blocked) from the ORIGINAL decision?
    // Excludes "retry_now" as well as "no_action" -- found during the
    // forensic-integrity audit: retry_now is a non-contact action that's
    // essentially never guardrail-blocked, so checking only "!= no_action"
    // made this always true until the window expired, which would make a
    // suppressed/contact-capped customer read as "recoverable" when nothing
    // further will actually be attempted on them.
    const hasFurtherAction = decision.evaluations.some(
      (e) => e.intervention_id !== "no_action" && e.intervention_id !== "retry_now" && e.status !== "blocked_by_guardrail",
    );
    outcome = hoursSinceFailure <= RECOVERY_WINDOW_HOURS && hasFurtherAction ? "recoverable" : "permanently_lost";
  }

  const contributing: ContributingCause[] = [];
  if (decisionDelayHours > RECOVERY_DELAY_THRESHOLD_HOURS) {
    contributing.push({
      cause_key: "recovery_delay",
      label: "Recovery delay",
      detail: `Attributed cause (simulated root-cause attribution): recovery decision made ${decisionDelayHours.toFixed(1)}h after failure.`,
    });
  }
  const blockedHigher = decision.evaluations.filter((e) => e.status === "blocked_by_guardrail" && e.expected_value > chosen.expected_value);
  if (blockedHigher.length > 0) {
    const best = blockedHigher.reduce((b, e) => (e.expected_value > b.expected_value ? e : b));
    contributing.push({
      cause_key: "guardrail_blocking",
      label: "Guardrail-blocked higher-value action",
      detail: `Attributed cause (simulated root-cause attribution): ${best.intervention_id} had a higher expected value (₹${best.expected_value.toFixed(2)}) but was blocked (${best.rejection_reason ?? "guardrail"}).`,
    });
  }
  if (checkoutGapS > CHECKOUT_LATENCY_THRESHOLD_SECONDS) {
    contributing.push({
      cause_key: "checkout_latency",
      label: "Elevated checkout latency (simulated)",
      detail: `Attributed cause (simulated root-cause attribution): checkout-to-attempt gap of ${checkoutGapS.toFixed(1)}s, above the ${CHECKOUT_LATENCY_THRESHOLD_SECONDS}s reference.`,
    });
  }

  return {
    decision, paymentMethod, gateway, checkoutStartedAt, paymentAttemptedAt, failedAt,
    decisionDelayHours, recoveryDecisionAt, recoveryExecutedAt, recoveredAt, recovered, outcome,
    contributing, preventableAmount: decision.amount * bucket.preventability, timeToRecoveryHours,
  };
}

const POPULATION: MockForensicRow[] = mockDecisions.map(buildRow);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Summary: leakage, loss chain, recovery delay, pareto
// ---------------------------------------------------------------------------

const DEFINITIONS: Record<string, string> = {
  revenue_lost: "Amount that ultimately remained unrecovered (revenue at risk minus natural and intervention recovery).",
  recovered: "Amount recovered after failure, whether organically (no intervention) or after an RVE intervention.",
  preventable: "Amount associated with a failure class that this analysis' documented, hand-picked assumptions treat as plausibly preventable -- potentially preventable, not a guarantee, and not restricted to unrecovered payments.",
  recoverable: `Amount still eligible for a valid recovery intervention under the existing RVE guardrails and the ${RECOVERY_WINDOW_HOURS / 24}-day recovery window, but not yet recovered.`,
  permanently_lost: "Amount for which the recovery window has expired or every eligible recovery path is exhausted.",
  unresolved: "Amount for which no RVE decision record could be found -- insufficient evidence to classify.",
};

function computeLeakage(rows: MockForensicRow[]): RevenueLeakageSummary {
  const sumWhere = (pred: (r: MockForensicRow) => boolean) => rows.filter(pred).reduce((s, r) => s + r.decision.amount, 0);
  const countWhere = (pred: (r: MockForensicRow) => boolean) => rows.filter(pred).length;

  const totalAtRisk = rows.reduce((s, r) => s + r.decision.amount, 0);
  const natural = sumWhere((r) => r.outcome === "natural_recovery");
  const intervention = sumWhere((r) => r.outcome === "intervention_recovery");
  const recoverable = sumWhere((r) => r.outcome === "recoverable");
  const permanentlyLost = sumWhere((r) => r.outcome === "permanently_lost");
  const totalRecovered = natural + intervention;
  const preventable = rows.reduce((s, r) => s + r.preventableAmount, 0);

  return {
    total_at_risk: round2(totalAtRisk),
    total_recovered: round2(totalRecovered),
    natural_recovery_amount: round2(natural),
    intervention_recovery_amount: round2(intervention),
    revenue_lost: round2(totalAtRisk - totalRecovered),
    recoverable_amount: round2(recoverable),
    permanently_lost_amount: round2(permanentlyLost),
    unresolved_amount: 0,
    preventable_amount: round2(preventable),
    n_payments: rows.length,
    n_natural_recovery: countWhere((r) => r.outcome === "natural_recovery"),
    n_intervention_recovery: countWhere((r) => r.outcome === "intervention_recovery"),
    n_recoverable: countWhere((r) => r.outcome === "recoverable"),
    n_permanently_lost: countWhere((r) => r.outcome === "permanently_lost"),
    n_unresolved: 0,
    definitions: DEFINITIONS,
  };
}

function computeLossChain(rows: MockForensicRow[]): LossChainStage[] {
  const total = rows.reduce((s, r) => s + r.decision.amount, 0) || 1;
  const n = rows.length;
  const nCustomers = new Set(rows.map((r) => r.decision.customer_id)).size;
  const pct = (amt: number) => round2((amt / total) * 100);

  function breakdown(keyFn: (r: MockForensicRow) => string, labels?: Record<string, string>): LossChainBreakdownItem[] {
    const buckets = new Map<string, MockForensicRow[]>();
    for (const r of rows) {
      const k = keyFn(r);
      buckets.set(k, [...(buckets.get(k) ?? []), r]);
    }
    return [...buckets.entries()]
      .map(([key, group]) => {
        const amt = group.reduce((s, r) => s + r.decision.amount, 0);
        return { label: labels?.[key] ?? key, count: group.length, amount: round2(amt), percentage_of_total: pct(amt) };
      })
      .sort((a, b) => b.amount - a.amount);
  }

  const recoveredAmt = rows.filter((r) => r.outcome === "natural_recovery" || r.outcome === "intervention_recovery").reduce((s, r) => s + r.decision.amount, 0);

  return [
    { stage: "customer", label: "Customer", count: nCustomers, amount: round2(total), percentage_of_total: 100, note: "Distinct customers with at least one failed payment in this batch.", breakdown: [] },
    { stage: "checkout", label: "Checkout", count: n, amount: round2(total), percentage_of_total: 100, note: "Every record in this dataset already reached checkout -- abandoned-checkout revenue prior to an attempt is not observable here and is not estimated.", breakdown: [] },
    { stage: "payment_attempt", label: "Payment attempt", count: n, amount: round2(total), percentage_of_total: 100, note: null, breakdown: [] },
    { stage: "method", label: "Method", count: n, amount: round2(total), percentage_of_total: 100, note: "Share of failed-payment revenue by payment method (synthetic attribution, not a loss point).", breakdown: breakdown((r) => r.paymentMethod) },
    { stage: "gateway", label: "Gateway / bank", count: n, amount: round2(total), percentage_of_total: 100, note: "Share of failed-payment revenue by gateway/bank route (synthetic attribution, not a loss point).", breakdown: breakdown((r) => r.gateway, GATEWAY_LABELS) },
    { stage: "failure", label: "Failure", count: n, amount: round2(total), percentage_of_total: 100, note: "Every payment here has already failed; the breakdown is by primary cause.", breakdown: breakdown((r) => OPPORTUNITY_BUCKETS[bucketKeyForReason(r.decision.failure_reason)].label) },
    {
      stage: "recovery", label: "Recovery", count: n, amount: round2(total), percentage_of_total: 100, note: null,
      breakdown: [
        { label: "Recovered", count: rows.filter((r) => r.outcome === "natural_recovery" || r.outcome === "intervention_recovery").length, amount: round2(recoveredAmt), percentage_of_total: pct(recoveredAmt) },
        { label: "Not yet recovered", count: rows.filter((r) => !(r.outcome === "natural_recovery" || r.outcome === "intervention_recovery")).length, amount: round2(total - recoveredAmt), percentage_of_total: pct(total - recoveredAmt) },
      ],
    },
    { stage: "outcome", label: "Outcome", count: n, amount: round2(total), percentage_of_total: 100, note: null, breakdown: breakdown((r) => OUTCOME_LABELS[r.outcome]) },
  ];
}

const OUTCOME_LABELS: Record<RevenueOutcome, string> = {
  natural_recovery: "Natural recovery",
  intervention_recovery: "Intervention recovery",
  recoverable: "Recoverable",
  permanently_lost: "Permanently lost",
  unresolved: "Unresolved",
};

const DELAY_BUCKETS: [number, number, string][] = [
  [0, 1, "<1h"], [1, 4, "1-4h"], [4, 12, "4-12h"], [12, 24, "12-24h"], [24, Infinity, ">24h"],
];

function computeRecoveryDelay(rows: MockForensicRow[]): RecoveryDelayAnalysis {
  const buckets: RecoveryDelayBucket[] = DELAY_BUCKETS.map(([lo, hi, label]) => {
    const inBucket = rows.filter((r) => r.decisionDelayHours >= lo && r.decisionDelayHours < hi);
    const recovered = inBucket.filter((r) => r.recovered).length;
    return { label, n_payments: inBucket.length, n_recovered: recovered, recovery_rate: inBucket.length ? round2((recovered / inBucket.length) * 100) / 100 : 0 };
  });
  const meanDecision = rows.length ? rows.reduce((s, r) => s + r.decisionDelayHours, 0) / rows.length : null;
  const recoveredRows = rows.filter((r) => r.timeToRecoveryHours !== null);
  const meanRecovery = recoveredRows.length ? recoveredRows.reduce((s, r) => s + (r.timeToRecoveryHours ?? 0), 0) / recoveredRows.length : null;
  return {
    buckets,
    mean_time_to_first_intervention_hours: meanDecision !== null ? round2(meanDecision) : null,
    mean_time_to_recovery_hours: meanRecovery !== null ? round2(meanRecovery) : null,
    disclaimer: "Association observed in simulation, not a proven causal relationship. Recovery appears to decline as delay increases in this synthetic batch; this does not establish that delay causes recovery failure.",
  };
}

function computePareto(rows: MockForensicRow[]): ParetoResult {
  const total = rows.reduce((s, r) => s + r.decision.amount, 0) || 1;
  const byCause = new Map<string, number>();
  for (const r of rows) {
    const key = bucketKeyForReason(r.decision.failure_reason);
    byCause.set(key, (byCause.get(key) ?? 0) + r.decision.amount);
  }
  const nCategories = byCause.size || 1;
  const topN = Math.max(1, Math.round(0.2 * nCategories));
  const ranked = [...byCause.values()].sort((a, b) => b - a);
  const revenueShare = ranked.slice(0, topN).reduce((a, b) => a + b, 0) / total;
  const detected = revenueShare >= PARETO_THRESHOLD;
  const statement = detected
    ? `The top ${topN} of ${nCategories} failure categories account for ${Math.round(revenueShare * 100)}% of revenue at risk.`
    : `No dominant concentration detected -- the top ${topN} of ${nCategories} failure categories account for only ${Math.round(revenueShare * 100)}% of revenue at risk.`;
  return { top_share_of_causes: round2(topN / nCategories), revenue_share: round2(revenueShare), concentration_detected: detected, statement };
}

export function mockRevenueAutopsySummary(): RevenueAutopsySummaryResponse {
  return {
    leakage: computeLeakage(POPULATION),
    loss_chain: computeLossChain(POPULATION),
    recovery_delay: computeRecoveryDelay(POPULATION),
    pareto: computePareto(POPULATION),
    note: AUTOPSY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Causes + Fix-First
// ---------------------------------------------------------------------------

export function mockRevenueAutopsyCauses(): RevenueAutopsyCausesResponse {
  const total = POPULATION.reduce((s, r) => s + r.decision.amount, 0) || 1;
  const bucketRows = new Map<string, MockForensicRow[]>();
  for (const r of POPULATION) {
    const primary = bucketKeyForReason(r.decision.failure_reason);
    bucketRows.set(primary, [...(bucketRows.get(primary) ?? []), r]);
    for (const c of r.contributing) {
      bucketRows.set(c.cause_key, [...(bucketRows.get(c.cause_key) ?? []), r]);
    }
  }

  const causes: RootCauseDetail[] = [];
  const fixFirst: FixFirstOpportunity[] = [];

  for (const [key, meta] of Object.entries(OPPORTUNITY_BUCKETS)) {
    const rows = bucketRows.get(key) ?? [];
    const amount = rows.reduce((s, r) => s + r.decision.amount, 0);
    const recoveredN = rows.filter((r) => r.outcome === "natural_recovery" || r.outcome === "intervention_recovery").length;
    const preventable = amount * meta.preventability;
    const delays = rows.map((r) => r.decisionDelayHours);
    const interventions = rows.map((r) => r.decision.chosen_intervention);
    const topIntervention = interventions.length
      ? interventions.sort((a, b) => interventions.filter((v) => v === a).length - interventions.filter((v) => v === b).length).pop() ?? null
      : null;

    if (rows.length > 0 || meta.kind === "primary") {
      causes.push({
        cause_key: key, category: meta.category, label: meta.label, kind: meta.kind,
        n_payments: rows.length, amount: round2(amount), percentage_of_total: round2((amount / total) * 100),
        recovery_rate: rows.length ? round2(recoveredN / rows.length) : 0,
        preventable_amount: round2(preventable), preventability_factor: meta.preventability,
        mean_recovery_delay_hours: delays.length ? round2(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
        top_intervention: topIntervention, note: key === "checkout_latency" ? "Contributing-cause tag only; this dataset has no observable pre-attempt checkout population." : null,
      });
    }

    // A bucket with zero affected payments has nothing to rank -- ₹0
    // opportunity is not a priority, and showing it would just clutter the
    // Fix-First ranking (it can still appear in `causes` as a primary row).
    if (rows.length === 0) continue;

    const opportunityScore = meta.fixCost > 0 ? (preventable * meta.feasibility) / meta.fixCost : 0;
    fixFirst.push({
      priority: 0, cause_key: key, category: meta.category, label: meta.label,
      revenue_affected: round2(amount), preventable_amount: round2(preventable),
      feasibility: meta.feasibility, estimated_fix_cost: meta.fixCost,
      opportunity_score: Math.round(opportunityScore * 1e6) / 1e6, expected_value_of_fix: round2(preventable * meta.feasibility),
      why: `₹${Math.round(preventable).toLocaleString("en-IN")} potentially preventable across ${rows.length.toLocaleString("en-IN")} payments, feasibility ${meta.feasibility.toFixed(1)} and estimated fix cost ₹${Math.round(meta.fixCost).toLocaleString("en-IN")}.`,
    });
  }

  causes.sort((a, b) => b.amount - a.amount || a.cause_key.localeCompare(b.cause_key));
  fixFirst.sort((a, b) => b.opportunity_score - a.opportunity_score || a.cause_key.localeCompare(b.cause_key));
  fixFirst.forEach((f, i) => (f.priority = i + 1));

  return {
    causes, fix_first: fixFirst, top_recommendation: fixFirst[0] ?? null,
    formula_note: "Preventable revenue = category revenue x preventability factor. Opportunity score = preventable revenue x feasibility / estimated fix cost. Feasibility and fix-cost figures are illustrative, hand-picked assumptions, not derived from real implementation-cost data. Opportunity buckets are not mutually exclusive, so bucket amounts should not be summed as a partition of total revenue.",
    note: AUTOPSY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Paginated / filterable payment-level forensic table
// ---------------------------------------------------------------------------

function toForensicRecord(r: MockForensicRow): ForensicPaymentRecord {
  const bucketKey = bucketKeyForReason(r.decision.failure_reason);
  const bucket = OPPORTUNITY_BUCKETS[bucketKey];
  const chosen = r.decision.evaluations.find((e) => e.status === "chosen")!;
  return {
    payment_id: r.decision.payment_id, customer_id: r.decision.customer_id, amount: round2(r.decision.amount),
    failure_reason: r.decision.failure_reason, transaction_type: r.decision.transaction_type,
    payment_method: r.paymentMethod, gateway: r.gateway,
    checkout_started_at: r.checkoutStartedAt.toISOString(), payment_attempted_at: r.paymentAttemptedAt.toISOString(),
    failed_at: r.failedAt.toISOString(), recovery_decision_at: r.recoveryDecisionAt.toISOString(),
    recovery_executed_at: r.recoveryExecutedAt.toISOString(), recovered_at: r.recoveredAt?.toISOString() ?? null,
    chosen_intervention: chosen.intervention_id, probability_of_recovery: round2(chosen.probability_recovery * 10000) / 10000,
    expected_value: round2(chosen.expected_value), recovered: r.recovered, outcome: r.outcome,
    primary_cause_key: bucketKey, primary_cause_category: bucket.category, primary_cause_label: bucket.label,
    contributing_causes: r.contributing,
    recovery_decision_delay_hours: round2(r.decisionDelayHours), time_to_recovery_hours: r.timeToRecoveryHours !== null ? round2(r.timeToRecoveryHours) : null,
    preventable_amount: round2(r.preventableAmount),
  };
}

export function mockRevenueAutopsyPayments(params: RevenueAutopsyPaymentsParams): RevenueAutopsyPaymentsResponse {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 20;

  let filtered = POPULATION;
  if (params.cause) {
    filtered = filtered.filter((r) => bucketKeyForReason(r.decision.failure_reason) === params.cause || r.contributing.some((c) => c.cause_key === params.cause));
  }
  if (params.status) {
    filtered = filtered.filter((r) => r.outcome === params.status);
  }
  if (params.search) {
    const needle = params.search.trim().toLowerCase();
    filtered = filtered.filter((r) => r.decision.payment_id.toLowerCase().includes(needle) || r.decision.customer_id.toLowerCase().includes(needle));
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map(toForensicRecord);

  return { total, page, page_size: pageSize, items, note: AUTOPSY_NOTE };
}

export { PRIMARY_KEYS };
