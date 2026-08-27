import { Fragment, useState } from "react";
import type { RootCauseDetail } from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { ChevronDownIcon } from "../components/icons";
import { Table, TableHeaderRow, Td, Th } from "../components/Table";
import { INTERVENTION_LABELS, formatCurrency, formatPercent } from "../lib/format";
import { CATEGORY_LABELS, formatHours } from "./autopsyFormat";

/**
 * Failure category breakdown, sorted by economic impact (not event count) --
 * each row expands in place for cause detail, the drawer-equivalent this
 * codebase's design system already uses (see `<details>` in RecoveryLab's
 * MethodologyPanel/SimulationControls) rather than introducing a new modal
 * primitive. Primary causes (a direct relabeling of `failure_reason`) and
 * contributing-cause tags (deterministic, attributed) are both shown, with
 * kind badges so a merchant never confuses one for the other.
 */
export function RootCauseBreakdown({ causes, note }: { causes: RootCauseDetail[]; note: string }) {
  const [expanded, setExpanded] = useState<string | null>(causes[0]?.cause_key ?? null);

  return (
    <Card padded={false}>
      <div className="px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Root cause analysis
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
          Sorted by revenue affected. Primary causes are a direct relabeling of the recorded failure reason;
          contributing causes are attributed under documented deterministic rules, not proven.
        </p>
      </div>
      <Table>
        <thead>
          <TableHeaderRow>
            <Th>Cause</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Payments</Th>
            <Th align="right">Recovery rate</Th>
            <Th align="right">Potentially preventable</Th>
          </TableHeaderRow>
        </thead>
        <tbody>
          {causes.map((cause) => {
            const isOpen = expanded === cause.cause_key;
            return (
              <Fragment key={cause.cause_key}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : cause.cause_key)}
                  className="cursor-pointer border-t"
                  style={{ borderColor: "var(--table-border-color)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--table-row-hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  aria-expanded={isOpen}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <span style={{ color: "var(--color-text-muted)" }}>
                        <ChevronDownIcon size={11} open={isOpen} />
                      </span>
                      <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                        {cause.label}
                      </span>
                      <StatusBadge tone={cause.kind === "primary" ? "neutral" : "pending"}>
                        {cause.kind === "primary" ? "Primary cause" : "Attributed cause"}
                      </StatusBadge>
                    </div>
                  </Td>
                  <Td align="right" mono className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                    {formatCurrency(cause.amount)}
                  </Td>
                  <Td align="right" mono>
                    {cause.n_payments.toLocaleString("en-IN")}
                  </Td>
                  <Td align="right" mono>
                    {formatPercent(cause.recovery_rate)}
                  </Td>
                  <Td align="right" mono>
                    {formatCurrency(cause.preventable_amount)}
                  </Td>
                </tr>
                {isOpen && (
                  <tr style={{ borderColor: "var(--table-border-color)" }} className="border-t">
                    <td colSpan={5} className="px-3 pb-4 pt-1" style={{ background: "var(--color-bg-surface)" }}>
                      <CauseDetail cause={cause} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
      <p className="text-xs px-4 py-3 border-t" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
        {note}
      </p>
    </Card>
  );
}

function CauseDetail({ cause }: { cause: RootCauseDetail }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 max-w-2xl">
      <Field label="Category">{CATEGORY_LABELS[cause.category]}</Field>
      <Field label="Recovery delay (mean)">{formatHours(cause.mean_recovery_delay_hours)}</Field>
      <Field label="Top intervention">{cause.top_intervention ? INTERVENTION_LABELS[cause.top_intervention] : "—"}</Field>
      <Field label="Preventability factor">{(cause.preventability_factor * 100).toFixed(0)}% (illustrative assumption)</Field>
      {cause.note && (
        <p className="col-span-2 sm:col-span-4 text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          {cause.note}
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p className="text-sm mt-0.5" style={{ color: "var(--color-text-primary)" }}>
        {children}
      </p>
    </div>
  );
}
