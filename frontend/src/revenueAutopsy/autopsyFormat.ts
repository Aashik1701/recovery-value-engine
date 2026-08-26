import type { RevenueOutcome, RootCauseCategory } from "../api/types";
import type { StatusTone } from "../components/StatusBadge";

export const OUTCOME_LABELS: Record<RevenueOutcome, string> = {
  natural_recovery: "Natural recovery",
  intervention_recovery: "Intervention recovery",
  recoverable: "Recoverable",
  permanently_lost: "Permanently lost",
  unresolved: "Unresolved",
};

export const OUTCOME_TONE: Record<RevenueOutcome, StatusTone> = {
  natural_recovery: "success",
  intervention_recovery: "success",
  recoverable: "pending",
  permanently_lost: "danger",
  unresolved: "neutral",
};

export const CATEGORY_LABELS: Record<RootCauseCategory, string> = {
  payment_infrastructure: "Payment infrastructure",
  customer: "Customer",
  checkout: "Checkout",
  recovery: "Recovery",
  policy: "Policy",
  unknown_multi_factor: "Unknown / multi-factor",
};

export function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatDelay(hours: number | null): string {
  if (hours === null) return "Not yet decided";
  return formatHours(hours);
}
