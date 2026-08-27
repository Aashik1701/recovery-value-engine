import type { LossChainStage } from "../api/types";
import { Card } from "../components/Card";
import { ArrowDownIcon } from "../components/icons";
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
      <div className="flex items-baseline justify-between flex-wrap gap-x-4 mb-3">
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
              <div className="flex justify-center py-1" aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>
                <ArrowDownIcon size={13} />
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
        <div className="flex flex-col gap-2 mt-2.5">
          {/* Label+amount on one line (both free to truncate/shrink), the
              bar full-width on its own line below -- fixed w-40/w-32 pixel
              columns here previously summed past a 375px viewport's
              available width with nothing to absorb the overflow, silently
              clipping the amount off-screen rather than wrapping or
              scrolling to it. */}
          {stage.breakdown.map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs truncate" style={{ color: "var(--color-text-primary)" }} title={item.label}>
                  {item.label}
                </span>
                <span
                  className="text-xs shrink-0"
                  style={{ fontFamily: "var(--font-family-data)", color: "var(--color-text-secondary)" }}
                >
                  {formatCurrency(item.amount)} · {item.percentage_of_total.toFixed(0)}%
                </span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ background: "var(--color-border)", height: 6 }}>
                <div
                  style={{
                    width: `${Math.max(2, (item.amount / maxAmount) * 100)}%`,
                    height: "100%",
                    background: "var(--color-primary)",
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
