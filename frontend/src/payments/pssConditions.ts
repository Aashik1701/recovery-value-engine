import type { PSSConditions, PSSScoreResponse, TransactionType } from "../api/types";

/**
 * Deterministic per-payment "current conditions" for /pss/score, derived
 * from the payment_id itself (mulberry32, same seeded-PRNG approach
 * mocks/fixtures.ts already uses) -- not sourced from any live signal.
 * Without this, every payment would score under the identical PSSConditions
 * defaults and the queue would show the same number 500 times, which isn't
 * a meaningful "payment intelligence" view. This is still fully synthetic
 * and reproducible, consistent with CLAUDE.md Section 3/20: same
 * payment_id always produces the same conditions, nothing is randomized
 * per render or per request.
 */
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
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function conditionsForPayment(
  paymentId: string,
  amount: number,
  transactionType: TransactionType,
): Partial<PSSConditions> {
  const rand = mulberry32(hashString(paymentId));
  // Skewed toward healthy (most payments should look fine), with a long
  // tail into "elevated"/"degraded" territory so the queue shows real
  // variety -- same shape of assumption as simulator.py's own documented,
  // hand-picked distributions, just implemented in TS for this view.
  const badness = Math.pow(rand(), 2.4); // 0 = healthy, 1 = worst case

  return {
    gateway_latency_ms: Math.round(100 + badness * 350),
    gateway_error_rate: Math.round((0.01 + badness * 0.22) * 1000) / 1000,
    traffic_load_index: Math.round((1.0 + badness * 1.1) * 100) / 100,
    merchant_uptime_pct: Math.round((99.8 - badness * 7) * 100) / 100,
    amount,
    transaction_type: transactionType,
  };
}

export type SignalLevel = "healthy" | "elevated" | "degraded";

export interface QualitativeSignal {
  label: string;
  level: SignalLevel;
  detail: string;
}

/**
 * Turns the real numbers in a PSSScoreResponse into qualitative signals
 * ("Gateway health: Healthy") instead of raw feature weights -- there's no
 * SHAP/feature-importance data to show even if we wanted to (pss_scorer.py
 * doesn't compute per-feature attribution, only the healthy-baseline delta),
 * so these thresholds are the honest ceiling of what can be shown without
 * fabricating precision the model doesn't actually report.
 */
export function deriveQualitativeSignals(score: PSSScoreResponse, selectedMethod: string): QualitativeSignal[] {
  const c = score.conditions;
  const selected = score.methods.find((m) => m.method === selectedMethod);

  const latencyLevel: SignalLevel = c.gateway_latency_ms < 180 ? "healthy" : c.gateway_latency_ms < 320 ? "elevated" : "degraded";
  const errorLevel: SignalLevel = c.gateway_error_rate < 0.05 ? "healthy" : c.gateway_error_rate < 0.15 ? "elevated" : "degraded";
  const trafficLevel: SignalLevel = c.traffic_load_index < 1.3 ? "healthy" : c.traffic_load_index < 1.8 ? "elevated" : "degraded";
  const uptimeLevel: SignalLevel = c.merchant_uptime_pct >= 98.5 ? "healthy" : c.merchant_uptime_pct >= 96 ? "elevated" : "degraded";
  const methodLevel: SignalLevel = !selected ? "elevated" : selected.score >= 80 ? "healthy" : selected.score >= 65 ? "elevated" : "degraded";

  return [
    {
      label: "Gateway health",
      level: latencyLevel === "degraded" || errorLevel === "degraded" ? "degraded" : latencyLevel === "elevated" || errorLevel === "elevated" ? "elevated" : "healthy",
      detail: `${Math.round(c.gateway_latency_ms)}ms latency, ${(c.gateway_error_rate * 100).toFixed(1)}% error rate`,
    },
    {
      label: "Merchant stability",
      level: uptimeLevel,
      detail: `${c.merchant_uptime_pct.toFixed(1)}% recent uptime`,
    },
    {
      label: "Traffic",
      level: trafficLevel,
      detail: `${c.traffic_load_index.toFixed(1)}× normal load`,
    },
    {
      label: "Payment method",
      level: methodLevel,
      detail: selected ? `${selected.score}/100 for this method under current conditions` : "No method selected",
    },
  ];
}
