import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Decision, FailureReason, InterventionId } from "../api/types";
import { FAILURE_REASON_LABELS, formatCurrency, formatRelative } from "../lib/format";
import { InterventionBadge } from "./InterventionBadge";
import { Card } from "./Card";

export function DecisionQueue() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<FailureReason | "all">("all");
  const [interventionFilter, setInterventionFilter] = useState<InterventionId | "all">("all");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .listDecisions(1, 200)
      .then((res) => {
        if (!cancelled) setDecisions(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load decisions");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!decisions) return [];
    return decisions.filter((d) => {
      if (reasonFilter !== "all" && d.failure_reason !== reasonFilter) return false;
      if (interventionFilter !== "all" && d.chosen_intervention !== interventionFilter) return false;
      return true;
    });
  }, [decisions, reasonFilter, interventionFilter]);

  if (error) {
    return <Card>Could not load decisions: {error}</Card>;
  }

  if (!decisions) {
    return <Card>Loading decisions…</Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Decision queue
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            {filtered.length} of {decisions.length} decisions shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FilterSelect
            value={reasonFilter}
            onChange={(v) => setReasonFilter(v as FailureReason | "all")}
            options={[
              { value: "all", label: "All failure reasons" },
              ...(Object.keys(FAILURE_REASON_LABELS) as FailureReason[]).map((r) => ({
                value: r,
                label: FAILURE_REASON_LABELS[r],
              })),
            ]}
          />
          <FilterSelect
            value={interventionFilter}
            onChange={(v) => setInterventionFilter(v as InterventionId | "all")}
            options={[
              { value: "all", label: "All interventions" },
              { value: "no_action", label: "No action" },
              { value: "retry_now", label: "Retry now" },
              { value: "retry_later", label: "Retry later" },
              { value: "sms_link", label: "SMS link" },
              { value: "whatsapp_nudge", label: "WhatsApp nudge" },
              { value: "email", label: "Email" },
              { value: "voice_call", label: "Voice call" },
            ]}
          />
        </div>
      </div>

      <Card padded={false}>
        <table style={{ fontSize: "var(--table-font-size)" }}>
          <thead>
            <tr
              style={{
                background: "var(--table-header-bg)",
                color: "var(--color-text-secondary)",
              }}
            >
              <Th>Payment</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Failure reason</Th>
              <Th>Chosen intervention</Th>
              <Th align="right">Decided</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr
                key={d.decision_id}
                onClick={() => navigate(`/decisions/${d.payment_id}`)}
                className="cursor-pointer border-t"
                style={{
                  height: "var(--table-row-height)",
                  borderColor: "var(--table-border-color)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--table-row-hover-bg)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <Td mono>{d.payment_id}</Td>
                <Td mono>{d.customer_id}</Td>
                <Td align="right" mono>
                  {formatCurrency(d.amount)}
                </Td>
                <Td>{FAILURE_REASON_LABELS[d.failure_reason]}</Td>
                <Td>
                  <InterventionBadge interventionId={d.chosen_intervention} />
                </Td>
                <Td align="right" muted>
                  {formatRelative(d.decided_at)}
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8" style={{ color: "var(--color-text-muted)" }}>
                  No decisions match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
  muted = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-3 ${align === "right" ? "text-right" : "text-left"}`}
      style={{
        fontFamily: mono ? "var(--font-family-data)" : undefined,
        color: muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
      }}
    >
      {children}
    </td>
  );
}

function FilterSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-sm rounded border px-2 py-1.5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
        color: "var(--color-text-primary)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
