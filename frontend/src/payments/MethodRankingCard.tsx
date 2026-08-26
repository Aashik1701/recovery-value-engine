import type { PSSMethodScore, PaymentMethod } from "../api/types";
import { StatusBadge, type StatusTone } from "../components/StatusBadge";

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
};

export function scoreBand(score: number): { label: string; tone: StatusTone } {
  if (score >= 90) return { label: "Excellent", tone: "success" };
  if (score >= 75) return { label: "Good", tone: "success" };
  if (score >= 65) return { label: "Moderate", tone: "pending" };
  return { label: "At risk", tone: "danger" };
}

/**
 * One row of the payment-method ranking. The recommended flag and the
 * score both come straight from the backend's /pss/score response
 * (score.methods[i].recommended / .score) -- this component never
 * recomputes a ranking, it only renders one.
 */
export function MethodRankingCard({
  method,
  selected,
  onSelect,
  disabled,
}: {
  method: PSSMethodScore;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const band = scoreBand(method.score);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className="w-full text-left transition-colors"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px 12px",
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
        background: selected ? "var(--color-primary-subtle)" : "var(--card-bg)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !selected ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="font-medium"
          style={{ color: selected ? "var(--color-primary)" : "var(--color-text-primary)", fontSize: 14 }}
        >
          {METHOD_LABELS[method.method]}
        </span>
        {method.recommended && <StatusBadge tone="success">Recommended</StatusBadge>}
      </div>
      <div className="flex items-center gap-3">
        <span style={{ fontFamily: "var(--font-family-data)", fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          {method.score}/100
        </span>
        <StatusBadge tone={band.tone}>{band.label}</StatusBadge>
      </div>
    </button>
  );
}
