import type { FailureReason, InterventionId } from "../api/types";

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  insufficient_funds: "Insufficient funds",
  bank_timeout: "Bank timeout",
  network_error: "Network error",
  card_expired: "Card expired",
  fraud_block: "Fraud block",
  other: "Other",
};

export const INTERVENTION_LABELS: Record<InterventionId, string> = {
  no_action: "No action",
  retry_now: "Retry now",
  retry_later: "Retry later",
  sms_link: "SMS link",
  whatsapp_nudge: "WhatsApp nudge",
  email: "Email",
  voice_call: "Voice call",
};
