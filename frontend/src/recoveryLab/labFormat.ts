import type { ContactIntensity, RecoveryLabPolicyId } from "../api/types";

export const POLICY_ORDER: RecoveryLabPolicyId[] = [
  "no_intervention",
  "always_retry",
  "aggressive_recovery",
  "rve_adaptive",
];

export const POLICY_LABELS: Record<RecoveryLabPolicyId, string> = {
  no_intervention: "No intervention",
  always_retry: "Always retry",
  aggressive_recovery: "Aggressive recovery",
  rve_adaptive: "RVE Adaptive",
};

export const POLICY_DESCRIPTIONS: Record<RecoveryLabPolicyId, string> = {
  no_intervention: "No recovery action. Organic recovery only -- the floor baseline.",
  always_retry: "Retries every eligible payment, uniformly, regardless of context.",
  aggressive_recovery: "Uses the highest-intensity channel available within contact/voice/budget limits, not the highest-EV one.",
  rve_adaptive: "Uses the existing RVE decision engine: EV-optimized per payment, subject to the same guardrails.",
};

export const CONTACT_INTENSITY_LABELS: Record<ContactIntensity, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

export const RECOVERY_WINDOW_OPTIONS: { label: string; hours: number }[] = [
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "72h", hours: 72 },
  { label: "7 days", hours: 24 * 7 },
];

export const SIMULATION_RUNS_OPTIONS = [1000, 5000, 10000];

export const MAX_CONTACTS_OPTIONS = [1, 2, 3];

export const DISCOUNT_BUDGET_OPTIONS = [0, 10_000, 25_000, 50_000, 100_000];

export const VOICE_CAPACITY_OPTIONS = [0, 100, 250, 500, 1000, 2000];

export function formatLevel(dimension: string, level: number): string {
  if (dimension === "discount_budget") return `₹${level.toLocaleString("en-IN")}`;
  return level.toLocaleString("en-IN");
}

export const SENSITIVITY_DIMENSION_LABELS: Record<string, string> = {
  voice_capacity: "Voice capacity",
  discount_budget: "Discount budget",
  max_contacts_per_customer: "Max contacts / customer",
};
