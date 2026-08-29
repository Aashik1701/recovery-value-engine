/**
 * Deterministic mock fixtures matching the API response shapes in
 * ../api/types.ts, so the dashboard is fully navigable and demonstrable
 * without a live backend. Swap USE_MOCKS to false in ../api/client.ts once
 * the FastAPI service is running.
 *
 * Generation is seeded (mulberry32) so the fixture set is stable across
 * reloads within a session, mirroring the real simulator's reproducibility
 * requirement.
 */
import type {
  Decision,
  DecisionsListResponse,
  EvaluateResponse,
  FailureReason,
  InterventionEvaluation,
  InterventionId,
  MetricsResponse,
  PSSConditions,
  PSSMethodScore,
  PSSScoreResponse,
  PaymentMethod,
  PolicyResult,
  SimulateResponse,
  TransactionType,
} from "../api/types";

// ---- seeded PRNG -----------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260823);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randAmount(): number {
  // Skew toward smaller amounts with a long tail, roughly matching a
  // typical failed-payment distribution: mostly a few hundred to a few
  // thousand rupees, occasionally much larger.
  const base = Math.pow(rand(), 2.2) * 48000 + 150;
  return Math.round(base);
}

// ---- reference data ----------------------------------------------------

export const INTERVENTION_MENU: Record<InterventionId, { label: string; unitCost: number }> = {
  no_action: { label: "No action", unitCost: 0 },
  retry_now: { label: "Retry now", unitCost: 2 },
  retry_later: { label: "Retry later", unitCost: 1 },
  sms_link: { label: "SMS link", unitCost: 3 },
  whatsapp_nudge: { label: "WhatsApp nudge", unitCost: 5 },
  email: { label: "Email", unitCost: 1 },
  voice_call: { label: "Voice call", unitCost: 15 },
};

const FAILURE_REASONS: FailureReason[] = [
  "insufficient_funds",
  "bank_timeout",
  "network_error",
  "card_expired",
  "fraud_block",
  "other",
];

const TRANSACTION_TYPES: TransactionType[] = ["one_time", "subscription"];

const CUSTOMER_IDS = Array.from({ length: 400 }, (_, i) => `cust_${(i + 1).toString().padStart(5, "0")}`);

// Customers who opted out (suppression list) and are never contacted.
const SUPPRESSED_CUSTOMERS = new Set(
  Array.from({ length: 20 }, () => pick(CUSTOMER_IDS)),
);

const VOICE_CALL_THRESHOLD = 5000;
const CONTACT_FREQUENCY_CAP = 2;

// ---- decision generation ------------------------------------------------

/**
 * Builds one plausible EV breakdown across the full intervention menu for a
 * given context, applying the same guardrails this project documents
 * elsewhere, then picks the argmax-EV survivor as the chosen intervention.
 * This mirrors ev_engine.py + optimizer.py + guardrails.py closely enough
 * for a believable, internally-consistent demo dataset.
 */
function buildEvaluations(
  amount: number,
  failureReason: FailureReason,
  retryCount: number,
  isSuppressed: boolean,
  contactsAlreadyUsed: number,
): InterventionEvaluation[] {
  // Base organic recovery probability varies by failure reason.
  const baseProbByReason: Record<FailureReason, number> = {
    bank_timeout: 0.42,
    network_error: 0.38,
    insufficient_funds: 0.18,
    card_expired: 0.08,
    fraud_block: 0.03,
    other: 0.15,
  };

  const uplift: Record<InterventionId, number> = {
    no_action: 0,
    retry_now:
      failureReason === "bank_timeout" || failureReason === "network_error" ? 0.22 : 0.05,
    retry_later: failureReason === "insufficient_funds" ? 0.28 : 0.08,
    sms_link: 0.15,
    whatsapp_nudge: 0.24,
    email: 0.09,
    voice_call: 0.33,
  };

  const retryPenalty = Math.min(retryCount * 0.05, 0.2);
  const base = Math.max(0.01, baseProbByReason[failureReason] - retryPenalty);

  const evaluations: InterventionEvaluation[] = (Object.keys(INTERVENTION_MENU) as InterventionId[]).map(
    (id) => {
      const { unitCost } = INTERVENTION_MENU[id];
      const noiseFactor = 0.9 + rand() * 0.2;
      const prob = Math.min(0.95, Math.max(0.01, (base + uplift[id]) * noiseFactor));
      const ev = prob * amount - unitCost;

      let status: InterventionEvaluation["status"] = "rejected";
      let rejectionReason: string | undefined;

      const requiresContact = id !== "no_action" && id !== "retry_now";

      if (id === "voice_call" && amount < VOICE_CALL_THRESHOLD) {
        status = "blocked_by_guardrail";
        rejectionReason = `Blocked: amount below the ₹${VOICE_CALL_THRESHOLD.toLocaleString(
          "en-IN",
        )} voice-call threshold`;
      } else if (isSuppressed && requiresContact) {
        status = "blocked_by_guardrail";
        rejectionReason = "Blocked: customer is on the suppression list (opted out)";
      } else if (requiresContact && contactsAlreadyUsed >= CONTACT_FREQUENCY_CAP) {
        status = "blocked_by_guardrail";
        rejectionReason = `Blocked: contact-frequency cap reached (${CONTACT_FREQUENCY_CAP} per payment)`;
      }

      return {
        intervention_id: id,
        probability_recovery: Math.round(prob * 1000) / 1000,
        amount,
        unit_cost: unitCost,
        expected_value: Math.round(ev * 100) / 100,
        status,
        rejection_reason: rejectionReason,
      };
    },
  );

  // Determine the winner among non-blocked options by EV, then mark it
  // "chosen" and give every other non-blocked option a comparative reason.
  const eligible = evaluations.filter((e) => e.status !== "blocked_by_guardrail");
  const winner = eligible.reduce((best, cur) => (cur.expected_value > best.expected_value ? cur : best));

  for (const e of evaluations) {
    if (e.status === "blocked_by_guardrail") continue;
    if (e.intervention_id === winner.intervention_id) {
      e.status = "chosen";
      e.rejection_reason = undefined;
    } else {
      e.status = "rejected";
      const diff = winner.expected_value - e.expected_value;
      e.rejection_reason =
        diff > 0
          ? `Rejected: lower expected value (₹${e.expected_value.toFixed(2)} vs ₹${winner.expected_value.toFixed(
              2,
            )} for the chosen action)`
          : "Rejected: lower expected value than the chosen action";
    }
  }

  return evaluations.sort((a, b) => b.expected_value - a.expected_value);
}

const EXPLANATION_TEMPLATES: Record<InterventionId, (amount: number, reason: FailureReason) => string> = {
  no_action: (_amount, reason) =>
    `Organic recovery odds already outweigh the cost of contacting this customer for a ${reason.replace(
      "_",
      " ",
    )} failure. No intervention is recommended at this time.`,
  retry_now: (_amount, reason) =>
    `The failure reason (${reason.replace(
      "_",
      " ",
    )}) looks transient, so an immediate retry has the highest expected value at minimal cost.`,
  retry_later: () =>
    `Insufficient funds suggests a timing problem rather than an intent problem, a delayed retry gives the balance time to refresh and carries low cost.`,
  sms_link: (amount) =>
    `A direct payment-link SMS balances reach and cost for a ₹${amount.toLocaleString(
      "en-IN",
    )} payment, with the best expected value among contact channels available for this customer.`,
  whatsapp_nudge: (amount) =>
    `WhatsApp's higher engagement rate justifies its cost for this ₹${amount.toLocaleString(
      "en-IN",
    )} payment, expected recovery value clears the higher channel cost.`,
  email: () => `A low-cost email nudge is sufficient here; higher-cost channels don't clear their extra cost in expected value.`,
  voice_call: (amount) =>
    `At ₹${amount.toLocaleString(
      "en-IN",
    )}, this payment clears the voice-call threshold, and the channel's higher recovery uplift outweighs its ₹15 cost.`,
};

function generateDecision(index: number): Decision {
  const paymentId = `pay_${(index + 1).toString().padStart(6, "0")}`;
  const customerId = pick(CUSTOMER_IDS);
  const amount = randAmount();
  const failureReason = pick(FAILURE_REASONS);
  const transactionType = pick(TRANSACTION_TYPES);
  const retryCount = randInt(0, 3);
  const isSuppressed = SUPPRESSED_CUSTOMERS.has(customerId);
  const contactsAlreadyUsed = randInt(0, 1);

  const daysAgo = randInt(0, 21);
  const hoursAgo = randInt(0, 23);
  const decidedAt = new Date(Date.now() - (daysAgo * 24 + hoursAgo) * 3600_000).toISOString();

  const evaluations = buildEvaluations(amount, failureReason, retryCount, isSuppressed, contactsAlreadyUsed);
  const chosen = evaluations.find((e) => e.status === "chosen")!;

  return {
    decision_id: `dec_${(index + 1).toString().padStart(6, "0")}`,
    payment_id: paymentId,
    customer_id: customerId,
    amount,
    failure_reason: failureReason,
    transaction_type: transactionType,
    retry_count_so_far: retryCount,
    chosen_intervention: chosen.intervention_id,
    decided_at: decidedAt,
    evaluations,
    explanation: EXPLANATION_TEMPLATES[chosen.intervention_id](amount, failureReason),
  };
}

const DECISION_COUNT = 120;

export const mockDecisions: Decision[] = Array.from({ length: DECISION_COUNT }, (_, i) => generateDecision(i)).sort(
  (a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime(),
);

// ---- API response fixtures ----------------------------------------------

export const mockSimulateResponse: SimulateResponse = {
  batch_id: "batch_20260823_seed",
  n_customers: CUSTOMER_IDS.length,
  n_failed_payments: DECISION_COUNT,
  generated_at: new Date().toISOString(),
};

export function mockDecisionsListResponse(page = 1, pageSize = 50): DecisionsListResponse {
  const start = (page - 1) * pageSize;
  const items = mockDecisions.slice(start, start + pageSize);
  return {
    items,
    total: mockDecisions.length,
    page,
    page_size: pageSize,
  };
}

export function getMockDecideResponse(paymentId: string): { decision: Decision } {
  const existing = mockDecisions.find((d) => d.payment_id === paymentId);
  if (existing) return { decision: existing };
  // Fall back to generating a fresh one deterministically from the id so a
  // drill-down never 404s in the mock environment.
  const idx = Number.parseInt(paymentId.replace(/\D/g, ""), 10) || 0;
  return { decision: generateDecision(idx) };
}

// Aggregate the mock decisions into rough always-do-nothing / always-retry
// baselines so the four numbers move together plausibly, then hand-tune the
// EV-optimized and rule-based rows to be clearly best/second-best, this is
// mock data for UI development, not a claimed result (see docs/EVALUATION.md
// for the real methodology once the backend evaluator lands).
function sumEv(policyPick: (d: Decision) => InterventionEvaluation | undefined): { revenue: number; cost: number } {
  let revenue = 0;
  let cost = 0;
  for (const d of mockDecisions) {
    const picked = policyPick(d);
    if (!picked) continue;
    revenue += picked.probability_recovery * picked.amount;
    cost += picked.unit_cost;
  }
  return { revenue, cost };
}

const doNothing = sumEv((d) => d.evaluations.find((e) => e.intervention_id === "no_action"));
const alwaysRetry = sumEv((d) => d.evaluations.find((e) => e.intervention_id === "retry_now"));
const evOptimized = sumEv((d) => d.evaluations.find((e) => e.status === "chosen"));
// Rule-based heuristic: transient -> retry_now, insufficient_funds -> retry_later, else -> sms_link.
const ruleBased = sumEv((d) => {
  const target: InterventionId =
    d.failure_reason === "bank_timeout" || d.failure_reason === "network_error"
      ? "retry_now"
      : d.failure_reason === "insufficient_funds"
        ? "retry_later"
        : "sms_link";
  return d.evaluations.find((e) => e.intervention_id === target);
});

function toPolicyResult(
  id: PolicyResult["policy_id"],
  label: string,
  { revenue, cost }: { revenue: number; cost: number },
): PolicyResult {
  const net = revenue - cost;
  return {
    policy_id: id,
    policy_label: label,
    total_expected_revenue_recovered: Math.round(revenue * 100) / 100,
    total_intervention_cost: Math.round(cost * 100) / 100,
    net_revenue: Math.round(net * 100) / 100,
    net_revenue_per_rupee: cost > 0 ? Math.round((net / cost) * 100) / 100 : 0,
  };
}

export const mockEvaluateResponse: EvaluateResponse = {
  evaluated_at: new Date().toISOString(),
  batch_size: mockDecisions.length,
  policies: [
    toPolicyResult("always_do_nothing", "Always do nothing", doNothing),
    toPolicyResult("always_retry_now", "Always retry now", alwaysRetry),
    toPolicyResult("rule_based_heuristic", "Rule-based heuristic", ruleBased),
    toPolicyResult("ev_optimized", "EV-optimized policy (this project)", evOptimized),
  ],
};

// ---------------------------------------------------------------------------
// /pss/score (v2, see docs/PAYMENT_PAGE.md) -- a client-side approximation
// of backend/app/pss_simulator.py's true_success_prob() so mock mode's
// what-if sliders behave qualitatively like the real model (worse
// conditions -> lower scores, ranking can change) without needing a
// backend. Deliberately deterministic (no noise term) unlike the real
// model's synthetic ground truth -- a jittery score while dragging a
// slider would read as broken, not as realistic variance.
// ---------------------------------------------------------------------------

const PSS_METHODS: PaymentMethod[] = ["upi", "card", "netbanking", "wallet"];

const PSS_BASE_SUCCESS_PROB: Record<PaymentMethod, number> = {
  upi: 0.94,
  card: 0.89,
  netbanking: 0.82,
  wallet: 0.86,
};

const PSS_SENSITIVITY: Record<PaymentMethod, { latency: number; errorRate: number; traffic: number; uptime: number }> = {
  upi: { latency: 0.35, errorRate: 2.0, traffic: 0.12, uptime: 0.5 },
  card: { latency: 0.15, errorRate: 1.2, traffic: 0.08, uptime: 0.6 },
  netbanking: { latency: 0.25, errorRate: 1.6, traffic: 0.10, uptime: 0.7 },
  wallet: { latency: 0.10, errorRate: 0.8, traffic: 0.05, uptime: 0.3 },
};

const PSS_HEALTHY_LATENCY_MS = 100;
const PSS_BAD_LATENCY_MS = 450;

const PSS_DEFAULT_CONDITIONS: PSSConditions = {
  gateway_latency_ms: 100,
  gateway_error_rate: 0.01,
  traffic_load_index: 1.0,
  merchant_uptime_pct: 99.8,
  amount: 1999,
  transaction_type: "one_time",
};

function pssSuccessProb(method: PaymentMethod, conditions: PSSConditions): number {
  const base = PSS_BASE_SUCCESS_PROB[method];
  const sens = PSS_SENSITIVITY[method];

  const latencyBadness = Math.min(
    1,
    Math.max(0, (conditions.gateway_latency_ms - PSS_HEALTHY_LATENCY_MS) / (PSS_BAD_LATENCY_MS - PSS_HEALTHY_LATENCY_MS)),
  );
  const trafficBadness = Math.max(0, conditions.traffic_load_index - 1.0);
  const uptimeBadness = (100 - conditions.merchant_uptime_pct) / 100;

  const penalty =
    sens.latency * latencyBadness +
    sens.errorRate * conditions.gateway_error_rate +
    sens.traffic * trafficBadness +
    sens.uptime * uptimeBadness;

  return Math.min(0.995, Math.max(0.01, base - penalty));
}

function pssToScore(prob: number): number {
  return Math.round(prob * 100);
}

export function mockPSSScore(partialConditions: Partial<PSSConditions>): PSSScoreResponse {
  const conditions: PSSConditions = { ...PSS_DEFAULT_CONDITIONS, ...partialConditions };

  const ranked = [...PSS_METHODS].sort(
    (a, b) => pssSuccessProb(b, conditions) - pssSuccessProb(a, conditions),
  );
  const recommended = ranked[0];

  const methods: PSSMethodScore[] = ranked.map((method) => {
    const prob = pssSuccessProb(method, conditions);
    return {
      method,
      success_probability: Math.round(prob * 10000) / 10000,
      score: pssToScore(prob),
      recommended: method === recommended,
    };
  });

  const healthyProb = pssSuccessProb(recommended, PSS_DEFAULT_CONDITIONS);
  const healthyScore = pssToScore(healthyProb);
  const currentScore = pssToScore(pssSuccessProb(recommended, conditions));

  return {
    conditions,
    methods,
    recommended_method: recommended,
    healthy_baseline_score: healthyScore,
    delta_from_healthy: currentScore - healthyScore,
  };
}

export const mockMetricsResponse: MetricsResponse = {
  auc: 0.812,
  brier_score: 0.147,
  trained_at: new Date(Date.now() - 3600_000 * 6).toISOString(),
  n_training_rows: 32000,
  calibration_curve: Array.from({ length: 10 }, (_, i) => {
    const start = i / 10;
    const end = (i + 1) / 10;
    const mid = (start + end) / 2;
    const jitter = (rand() - 0.5) * 0.06;
    return {
      bucket_start: Math.round(start * 100) / 100,
      bucket_end: Math.round(end * 100) / 100,
      predicted_mean: Math.round(mid * 1000) / 1000,
      observed_mean: Math.round(Math.min(1, Math.max(0, mid + jitter)) * 1000) / 1000,
      n: randInt(200, 900),
    };
  }),
};
