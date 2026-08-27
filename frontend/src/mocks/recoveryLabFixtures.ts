/**
 * Deterministic mock engine for the Recovery Lab ("Revenue Recovery Digital
 * Twin"). Runs the same four-policy / resource-constraint logic as the real
 * backend's recovery_lab.py (guardrail-style eligibility, voice-capacity and
 * budget rationing by priority, natural-vs-gross-vs-incremental accounting)
 * entirely client-side, over the SAME synthetic population the rest of the
 * dashboard's mock mode already uses (`mockDecisions`), so exposure figures
 * stay internally consistent across mock views. Different policies/configs
 * produce genuinely different numbers -- this is a simulation, not one
 * hardcoded result behind a delay.
 */
import type {
  ContactIntensity,
  FailureReason,
  InterventionId,
  RecoveryLabExposureResponse,
  RecoveryLabPolicyId,
  RecoveryLabPolicyMetrics,
  RecoveryLabSensitivityPoint,
  RecoveryLabSensitivityRequest,
  RecoveryLabSensitivityResponse,
  RecoveryLabSimulateRequest,
  RecoveryLabSimulateResponse,
} from "../api/types";
import { mockDecisions } from "./fixtures";

export const RECOVERY_LAB_NOTE =
  "Offline / synthetic simulation using the existing synthetic failed-payment population and a client-side stand-in for the trained RVE model (mock mode). This is a policy-testing environment, not a production forecast -- no real payment, customer, or recovery action is executed.";

const POLICY_LABELS: Record<RecoveryLabPolicyId, string> = {
  no_intervention: "No intervention",
  always_retry: "Always retry",
  aggressive_recovery: "Aggressive recovery",
  rve_adaptive: "RVE Adaptive",
};

const MENU: InterventionId[] = ["no_action", "retry_now", "retry_later", "sms_link", "whatsapp_nudge", "email", "voice_call"];

const UNIT_COST: Record<InterventionId, number> = {
  no_action: 0,
  retry_now: 2,
  retry_later: 1,
  sms_link: 3,
  whatsapp_nudge: 5,
  email: 1,
  voice_call: 15,
};

const NON_CONTACT = new Set<InterventionId>(["no_action", "retry_now"]);
const VOICE_THRESHOLD = 5000;

const BASE_PROB_BY_REASON: Record<FailureReason, number> = {
  bank_timeout: 0.35,
  network_error: 0.3,
  insufficient_funds: 0.15,
  card_expired: 0.1,
  fraud_block: 0.02,
  other: 0.18,
};

const UPLIFT_BY_REASON: Record<FailureReason, Partial<Record<InterventionId, number>>> = {
  insufficient_funds: { retry_now: 0.03, retry_later: 0.15, sms_link: 0.08, whatsapp_nudge: 0.1, email: 0.04, voice_call: 0.18 },
  bank_timeout: { retry_now: 0.25, retry_later: 0.1, sms_link: 0.05, whatsapp_nudge: 0.06, email: 0.02, voice_call: 0.12 },
  network_error: { retry_now: 0.22, retry_later: 0.09, sms_link: 0.05, whatsapp_nudge: 0.06, email: 0.02, voice_call: 0.1 },
  card_expired: { retry_now: 0.01, retry_later: 0.02, sms_link: 0.12, whatsapp_nudge: 0.15, email: 0.06, voice_call: 0.2 },
  fraud_block: { retry_now: 0.0, retry_later: 0.0, sms_link: 0.01, whatsapp_nudge: 0.01, email: 0.01, voice_call: 0.02 },
  other: { retry_now: 0.05, retry_later: 0.05, sms_link: 0.07, whatsapp_nudge: 0.08, email: 0.04, voice_call: 0.1 },
};

const CONTACT_INTENSITY_CHANNELS: Record<ContactIntensity, InterventionId[]> = {
  low: ["email", "retry_later", "retry_now"],
  moderate: ["whatsapp_nudge", "sms_link", "email", "retry_later", "retry_now"],
  high: ["voice_call", "whatsapp_nudge", "sms_link", "retry_later", "retry_now"],
};

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

interface Row {
  payment_id: string;
  customer_id: string;
  amount: number;
  base_prob: number;
  uplift: Partial<Record<InterventionId, number>>;
  suppressed: boolean;
  hours_ago: number;
}

// Built once from the same fixture population the rest of the dashboard's
// mock mode uses, so a Recovery Lab exposure figure and the decision queue
// agree on "how many failed payments exist." Each row additionally gets a
// deterministic hidden base/uplift profile (mirrors simulator.py's
// `_simulator_truth`) via a per-payment seeded RNG -- fixed forever for a
// given payment_id, never re-rolled on render.
const POPULATION: Row[] = mockDecisions.map((d) => {
  const rand = mulberry32(hashString(d.payment_id));
  const base = Math.max(0.01, Math.min(0.9, BASE_PROB_BY_REASON[d.failure_reason] + (rand() - 0.5) * 0.06));
  const upliftBase = UPLIFT_BY_REASON[d.failure_reason];
  const uplift: Partial<Record<InterventionId, number>> = {};
  (Object.keys(upliftBase) as InterventionId[]).forEach((id) => {
    uplift[id] = Math.max(0, (upliftBase[id] ?? 0) + (rand() - 0.5) * 0.03);
  });
  return {
    payment_id: d.payment_id,
    customer_id: d.customer_id,
    amount: d.amount,
    base_prob: base,
    uplift,
    suppressed: hashString(d.customer_id) % 20 === 0, // ~5% suppression list, deterministic
    hours_ago: hashString(d.payment_id) % (24 * 14),
  };
});

function trueProb(row: Row, intervention: InterventionId): number {
  const u = intervention === "no_action" ? 0 : (row.uplift[intervention] ?? 0);
  return Math.max(0, Math.min(1, row.base_prob + u));
}

function ev(row: Row, intervention: InterventionId): number {
  return trueProb(row, intervention) * row.amount - UNIT_COST[intervention];
}

/** Best achievable EV across the whole menu, ignoring guardrails -- a
 * priority heuristic for row-processing order, not the guardrail-filtered
 * decision itself (see runPolicy's use of this for rve_adaptive). */
function bestEv(row: Row): number {
  return MENU.reduce((best, id) => Math.max(best, ev(row, id)), -Infinity);
}

function argmax(ids: InterventionId[], score: (id: InterventionId) => number): InterventionId {
  return ids.reduce((best, id) => (score(id) > score(best) ? id : best), ids[0]);
}

function selectAggressive(eligible: InterventionId[], channels: InterventionId[]): InterventionId {
  const candidates = channels.filter((c) => eligible.includes(c));
  if (candidates.length === 0) return "no_action";
  return candidates.reduce((best, c) => (UNIT_COST[c] > UNIT_COST[best] ? c : best));
}

function eligibleFor(row: Row, maxContacts: number, priorContactCount: number): InterventionId[] {
  return MENU.filter((id) => {
    if (id === "voice_call" && row.amount < VOICE_THRESHOLD) return false;
    if (row.suppressed && !NON_CONTACT.has(id)) return false;
    if (priorContactCount >= maxContacts && !NON_CONTACT.has(id)) return false;
    return true;
  });
}

function scopeRows(recoveryWindowHours: number): Row[] {
  return POPULATION.filter((row) => row.hours_ago <= recoveryWindowHours);
}

interface PolicyRunResult {
  metrics: RecoveryLabPolicyMetrics;
  finalMap: Map<string, InterventionId>;
}

function runPolicy(
  policyId: RecoveryLabPolicyId,
  rows: Row[],
  config: {
    contact_intensity: ContactIntensity;
    discount_budget: number;
    voice_capacity: number;
    max_contacts_per_customer: number;
  },
): PolicyRunResult {
  // Row-processing order determines who wins a scarce per-customer contact
  // slot when a customer has multiple in-scope payments. For policies with
  // no EV concept (no_intervention/always_retry/aggressive_recovery), raw
  // amount is the only value signal available. For rve_adaptive, ordering
  // by amount was a real bug (mirrors the same fix in the backend's
  // recovery_lab.py): a customer's high-amount-but-low-recovery-odds
  // payment could consume the contact slot ahead of a low-amount-but-high-
  // recovery-odds sibling, contradicting "EV-optimized per payment."
  // Ranking by each row's best achievable menu-wide EV fixes that.
  const order =
    policyId === "rve_adaptive"
      ? [...rows].sort((a, b) => bestEv(b) - bestEv(a))
      : [...rows].sort((a, b) => b.amount - a.amount);
  const intensityChannels = CONTACT_INTENSITY_CHANNELS[config.contact_intensity];

  const desired = new Map<string, InterventionId>();
  const eligibleMap = new Map<string, InterventionId[]>();
  const evMap = new Map<string, Partial<Record<InterventionId, number>>>();
  const guardrailBlocked = new Set<string>();
  const contactCounts = new Map<string, number>();

  for (const row of order) {
    const priorCount = contactCounts.get(row.customer_id) ?? 0;
    const eligible = eligibleFor(row, config.max_contacts_per_customer, priorCount);
    let choice: InterventionId;
    let rawIdeal: InterventionId;
    const evForRow: Partial<Record<InterventionId, number>> = {};

    if (policyId === "no_intervention") {
      choice = "no_action";
      rawIdeal = "no_action";
    } else if (policyId === "always_retry") {
      choice = "retry_now";
      rawIdeal = "retry_now";
    } else if (policyId === "aggressive_recovery") {
      rawIdeal = selectAggressive(MENU, intensityChannels);
      choice = selectAggressive(eligible, intensityChannels);
    } else {
      MENU.forEach((id) => (evForRow[id] = ev(row, id)));
      rawIdeal = argmax(MENU, (id) => evForRow[id] ?? -Infinity);
      choice = argmax(eligible, (id) => evForRow[id] ?? -Infinity);
    }

    desired.set(row.payment_id, choice);
    eligibleMap.set(row.payment_id, eligible);
    evMap.set(row.payment_id, evForRow);
    if (choice !== rawIdeal) guardrailBlocked.add(row.payment_id);
    if (!NON_CONTACT.has(choice)) contactCounts.set(row.customer_id, priorCount + 1);
  }

  const final = new Map(desired);
  const capacityBlocked = new Set<string>();

  // Global resource constraint: voice capacity, highest-value/EV first.
  const voiceRows = order.filter((r) => final.get(r.payment_id) === "voice_call");
  if (voiceRows.length > config.voice_capacity) {
    const ranked = [...voiceRows].sort(
      (a, b) => (evMap.get(b.payment_id)?.voice_call ?? b.amount) - (evMap.get(a.payment_id)?.voice_call ?? a.amount),
    );
    for (const row of ranked.slice(config.voice_capacity)) {
      const remaining = (eligibleMap.get(row.payment_id) ?? []).filter((id) => id !== "voice_call");
      let replacement: InterventionId = "no_action";
      if (policyId === "rve_adaptive" && remaining.length) {
        replacement = argmax(remaining, (id) => evMap.get(row.payment_id)?.[id] ?? -Infinity);
      } else if (policyId === "aggressive_recovery") {
        replacement = selectAggressive(remaining, intensityChannels);
      }
      final.set(row.payment_id, replacement);
      capacityBlocked.add(row.payment_id);
    }
  }

  // Global resource constraint: discount/spend budget, highest-value/EV first.
  const spendRows = order.filter((r) => final.get(r.payment_id) !== "no_action");
  const ranked = [...spendRows].sort(
    (a, b) =>
      (evMap.get(b.payment_id)?.[final.get(b.payment_id)!] ?? b.amount) -
      (evMap.get(a.payment_id)?.[final.get(a.payment_id)!] ?? a.amount),
  );
  let spend = 0;
  for (const row of ranked) {
    const chosen = final.get(row.payment_id)!;
    const cost = UNIT_COST[chosen];
    if (spend + cost > config.discount_budget) {
      final.set(row.payment_id, "no_action");
      capacityBlocked.add(row.payment_id);
      continue;
    }
    spend += cost;
  }

  let natural = 0;
  let gross = 0;
  let cost = 0;
  let intervened = 0;
  let contacted = 0;
  let expectedRecoveriesFromIntervention = 0;
  const totalAtRisk = order.reduce((s, r) => s + r.amount, 0);

  for (const row of order) {
    const chosen = final.get(row.payment_id)!;
    natural += trueProb(row, "no_action") * row.amount;
    const gp = trueProb(row, chosen);
    gross += gp * row.amount;
    cost += UNIT_COST[chosen];
    if (chosen !== "no_action") {
      intervened += 1;
      expectedRecoveriesFromIntervention += gp;
    }
    if (!NON_CONTACT.has(chosen)) contacted += 1;
  }

  const incremental = gross - natural;
  const net = incremental - cost;

  const metrics: RecoveryLabPolicyMetrics = {
    policy_id: policyId,
    policy_label: POLICY_LABELS[policyId],
    n_payments_in_scope: order.length,
    total_at_risk: round2(totalAtRisk),
    natural_recovery: round2(natural),
    gross_recovery: round2(gross),
    incremental_recovery: round2(incremental),
    intervention_cost: round2(cost),
    net_value_created: round2(net),
    recovery_rate: totalAtRisk > 0 ? round4(gross / totalAtRisk) : 0,
    incremental_recovery_rate: totalAtRisk > 0 ? round4(incremental / totalAtRisk) : 0,
    number_intervened: intervened,
    number_contacted: contacted,
    number_blocked_by_guardrail: [...guardrailBlocked].length,
    number_blocked_by_capacity: [...capacityBlocked].length,
    number_blocked: new Set([...guardrailBlocked, ...capacityBlocked]).size,
    average_cost_per_recovery: expectedRecoveriesFromIntervention > 0 ? round2(cost / expectedRecoveriesFromIntervention) : 0,
    net_value_low: null,
    net_value_high: null,
  };

  return { metrics, finalMap: final };
}

/** Small, browser-cheap Monte Carlo resampling for the net_value uncertainty
 * range only -- capped well below the requested run count for responsiveness,
 * with the ACTUAL count used reported back rather than the requested one. */
function monteCarloRange(
  rows: Row[],
  finalMap: Map<string, InterventionId>,
  cost: number,
  seed: number,
  requestedRuns: number,
): { low: number | null; high: number | null; used: number } {
  const used = Math.min(requestedRuns, 300);
  if (used <= 0 || rows.length === 0) return { low: null, high: null, used: 0 };
  const rand = mulberry32(seed);
  const netRuns: number[] = [];
  for (let r = 0; r < used; r++) {
    let gross = 0;
    let natural = 0;
    for (const row of rows) {
      const chosen = finalMap.get(row.payment_id)!;
      if (rand() < trueProb(row, chosen)) gross += row.amount;
      if (rand() < trueProb(row, "no_action")) natural += row.amount;
    }
    netRuns.push(gross - natural - cost);
  }
  netRuns.sort((a, b) => a - b);
  const lowIdx = Math.floor(0.025 * (used - 1));
  const highIdx = Math.ceil(0.975 * (used - 1));
  return { low: round2(netRuns[lowIdx]), high: round2(netRuns[highIdx]), used };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
/** Percentage magnitude of (a vs b) plus the correct direction word, so a
 * templated insight sentence stays factually correct regardless of which
 * way a given simulation's numbers actually land -- mirrors
 * recovery_lab.py's `_pct_and_word` (this project's design intent never
 * lets a comparison be forced to read a particular way). */
function pctAndWord(a: number, b: number, moreWord = "more", lessWord = "less"): [string, string] {
  const word = a >= b ? moreWord : lessWord;
  if (b === 0) return ["N/A", word];
  const pct = (Math.abs(a - b) / Math.abs(b)) * 100;
  return [`${pct.toFixed(1)}%`, word];
}

function buildInsight(
  policies: Record<RecoveryLabPolicyId, RecoveryLabPolicyMetrics>,
  primaryId: RecoveryLabPolicyId,
): string {
  const primary = policies[primaryId];
  if (primaryId === "rve_adaptive") {
    const vs = policies.always_retry;
    const aggressive = policies.aggressive_recovery;
    const [netPct, netWord] = pctAndWord(primary.net_value_created, vs.net_value_created);
    const [contactPct, contactWord] = pctAndWord(primary.number_contacted, aggressive.number_contacted, "more", "fewer");
    return (
      `${primary.policy_label} creates ${netPct} ${netWord} net value ` +
      `than Always Retry (${inr(primary.net_value_created)} vs ${inr(vs.net_value_created)}) while contacting ` +
      `${contactPct} ${contactWord} customers than Aggressive Recovery ` +
      `(${primary.number_contacted.toLocaleString("en-IN")} vs ${aggressive.number_contacted.toLocaleString("en-IN")}).`
    );
  }
  if (primaryId === "aggressive_recovery") {
    const vs = policies.rve_adaptive;
    const [grossPct, grossWord] = pctAndWord(primary.gross_recovery, vs.gross_recovery);
    const netDelta = vs.net_value_created - primary.net_value_created;
    const comparison = netDelta >= 0 ? "more" : "less";
    return (
      `${primary.policy_label} recovers ${grossPct} ${grossWord} gross revenue than ` +
      `RVE Adaptive (${inr(primary.gross_recovery)} vs ${inr(vs.gross_recovery)}), but RVE Adaptive creates ` +
      `${inr(Math.abs(netDelta))} ${comparison} net value once intervention cost is netted out ` +
      `(${inr(vs.net_value_created)} vs ${inr(primary.net_value_created)}).`
    );
  }
  if (primaryId === "always_retry") {
    const ratio = primary.intervention_cost > 0 ? primary.net_value_created / primary.intervention_cost : 0;
    return (
      `${primary.policy_label} recovers ${inr(primary.incremental_recovery)} more than doing nothing at a cost of only ` +
      `${inr(primary.intervention_cost)}, ${ratio.toFixed(1)}x net value per rupee spent.`
    );
  }
  const alternatives = (Object.keys(policies) as RecoveryLabPolicyId[])
    .filter((id) => id !== "no_intervention")
    .map((id) => policies[id]);
  const best = alternatives.reduce((b, p) => (p.net_value_created > b.net_value_created ? p : b), alternatives[0]);
  return (
    `${primary.policy_label} recovers only the organic baseline (${inr(primary.natural_recovery)}). ` +
    `${best.policy_label} would add ${inr(best.net_value_created)} in net value on this batch.`
  );
}

const ALL_POLICY_IDS: RecoveryLabPolicyId[] = ["no_intervention", "always_retry", "aggressive_recovery", "rve_adaptive"];

export function mockRecoveryLabExposure(): RecoveryLabExposureResponse {
  const amounts = POPULATION.map((r) => r.amount).sort((a, b) => a - b);
  const total = amounts.reduce((a, b) => a + b, 0);
  const mid = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 === 1 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
  return {
    total_at_risk: round2(total),
    n_failed_payments: POPULATION.length,
    median_payment_value: round2(median),
    suggested_policy_label: "RVE Adaptive",
    note: RECOVERY_LAB_NOTE,
  };
}

export function mockRecoveryLabSimulate(req: RecoveryLabSimulateRequest): RecoveryLabSimulateResponse {
  const rows = scopeRows(req.recovery_window_hours);
  const config = {
    contact_intensity: req.contact_intensity,
    discount_budget: req.discount_budget,
    voice_capacity: req.voice_capacity,
    max_contacts_per_customer: req.max_contacts_per_customer,
  };

  const results = new Map<RecoveryLabPolicyId, PolicyRunResult>();
  for (const pid of ALL_POLICY_IDS) results.set(pid, runPolicy(pid, rows, config));

  let actualRuns = 0;
  if (req.n_simulation_runs > 0) {
    for (const pid of ALL_POLICY_IDS) {
      const { metrics, finalMap } = results.get(pid)!;
      const { low, high, used } = monteCarloRange(
        rows,
        finalMap,
        metrics.intervention_cost,
        req.seed + hashString(pid),
        req.n_simulation_runs,
      );
      metrics.net_value_low = low;
      metrics.net_value_high = high;
      actualRuns = used;
    }
  }

  const policiesByI: Record<RecoveryLabPolicyId, RecoveryLabPolicyMetrics> = {
    no_intervention: results.get("no_intervention")!.metrics,
    always_retry: results.get("always_retry")!.metrics,
    aggressive_recovery: results.get("aggressive_recovery")!.metrics,
    rve_adaptive: results.get("rve_adaptive")!.metrics,
  };

  const totalAtRisk = rows.reduce((s, r) => s + r.amount, 0);
  const examplePaymentId = rows.length
    ? rows.reduce((best, r) => (r.amount > best.amount ? r : best), rows[0]).payment_id
    : null;

  return {
    seed: req.seed,
    n_simulation_runs: actualRuns,
    primary_policy_id: req.policy,
    n_payments_in_scope: rows.length,
    total_at_risk: round2(totalAtRisk),
    policies: ALL_POLICY_IDS.map((pid) => policiesByI[pid]),
    insight: buildInsight(policiesByI, req.policy),
    example_payment_id: examplePaymentId,
    note: RECOVERY_LAB_NOTE,
  };
}

function defaultSensitivityLevels(dimension: string, scopeSize: number): number[] {
  if (dimension === "voice_capacity") {
    return [0, 10, 25, 50, 75, 100, 150, 200].filter((v) => v <= Math.max(scopeSize, 50));
  }
  if (dimension === "discount_budget") {
    return [0, 1000, 2500, 5000, 10000, 25000, 50000];
  }
  return [1, 2, 3];
}

export function mockRecoveryLabSensitivity(req: RecoveryLabSensitivityRequest): RecoveryLabSensitivityResponse {
  const rows = scopeRows(req.recovery_window_hours);
  const levels = req.levels ?? defaultSensitivityLevels(req.dimension, rows.length);

  const points: RecoveryLabSensitivityPoint[] = levels.map((level) => {
    const config = {
      contact_intensity: req.contact_intensity,
      discount_budget: req.dimension === "discount_budget" ? level : req.discount_budget,
      voice_capacity: req.dimension === "voice_capacity" ? level : req.voice_capacity,
      max_contacts_per_customer: req.dimension === "max_contacts_per_customer" ? level : req.max_contacts_per_customer,
    };
    const { metrics } = runPolicy(req.policy, rows, config);
    return {
      level,
      incremental_recovery: metrics.incremental_recovery,
      intervention_cost: metrics.intervention_cost,
      net_value_created: metrics.net_value_created,
    };
  });

  const best = points.reduce((b, p) => (p.net_value_created > b.net_value_created ? p : b), points[0]);
  const peakIndex = points.findIndex((p) => p.level === best.level);
  const interior = peakIndex > 0 && peakIndex < points.length - 1;
  const insight = interior
    ? `Net value peaks around ${best.level.toLocaleString("en-IN")} on this batch (${inr(best.net_value_created)}); additional capacity beyond this point stops adding net value.`
    : `Net value is still increasing at the highest tested level (${best.level.toLocaleString("en-IN")}) on this batch -- try a wider sweep to find where it turns over.`;

  return {
    dimension: req.dimension,
    policy_id: req.policy,
    points,
    optimal_level: best.level,
    optimal_net_value: best.net_value_created,
    insight,
    note: RECOVERY_LAB_NOTE,
  };
}
