import type { LossChainStage } from "../api/types";
import { Card } from "../components/Card";
import { formatCurrency } from "../lib/format";

/**
 * The forensic "loss chain" -- built entirely from aggregated backend/mock
 * numbers, not a decorative flowchart. CUSTOMER/CHECKOUT/PAYMENT_ATTEMPT
 * stages are always 100% pass-through by dataset construction (RVE's unit
 * of analysis is an already-attempted failed payment) -- the stage notes
 * say so plainly rather than implying a funnel loss
 * that isn't observable in this data. METHOD/GATEWAY/FAILURE/RECOVERY/
 * OUTCOME carry the real breakdowns.
 */
export function LossChain({ stages }: { stages: LossChainStage[] }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Revenue loss chain
        </h2>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Reconstructed from the current synthetic batch
        </span>
      </div>
      <div className="flex flex-col">
        {stages.map((stage, i) => (
          <div key={stage.stage}>
            <StageRow stage={stage} />
            {i < stages.length - 1 && (
              <div className="flex justify-center py-1" aria-hidden="true">
                <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>↓</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function StageRow({ stage }: { stage: LossChainStage }) {
  const maxAmount = Math.max(1, ...stage.breakdown.map((b) => b.amount));
  return (
    <div
      className="rounded border px-3.5 py-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg-surface)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--color-text-secondary)", letterSpacing: "0.08em" }}
        >
          {stage.label}
        </p>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {stage.count.toLocaleString("en-IN")} {stage.stage === "customer" ? "customers" : "payments"} ·{" "}
          {formatCurrency(stage.amount)}
        </p>
      </div>
      {stage.note && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          {stage.note}
        </p>
      )}
      {stage.breakdown.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2.5">
          {stage.breakdown.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5">
              <span className="text-xs w-40 shrink-0 truncate" style={{ color: "var(--color-text-primary)" }} title={item.label}>
                {item.label}
              </span>
              <div className="flex-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)", height: 6 }}>
                <div
                  style={{
                    width: `${Math.max(2, (item.amount / maxAmount) * 100)}%`,
                    height: "100%",
                    background: "var(--color-primary)",
                    borderRadius: 999,
                  }}
                />
              </div>
              <span
                className="text-xs shrink-0 w-32 text-right"
                style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-secondary)" }}
              >
                {formatCurrency(item.amount)} · {item.percentage_of_total.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
