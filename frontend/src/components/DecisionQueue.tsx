import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Decision, FailureReason, InterventionId } from "../api/types";
import { FAILURE_REASON_LABELS, formatCurrency, formatRelative } from "../lib/format";
import { InterventionBadge } from "./InterventionBadge";
import { Card } from "./Card";
import { PageHeader } from "./PageHeader";
import { Table, TableHeaderRow, Td, Th, Tr } from "./Table";
import { LoadingState, ErrorState, TableStateRow } from "./PageState";

export function DecisionQueue() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<FailureReason | "all">("all");
  const [interventionFilter, setInterventionFilter] = useState<InterventionId | "all">("all");
  const navigate = useNavigate();

  const [loadSeq, setLoadSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
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
  }, [loadSeq]);

  const filtered = useMemo(() => {
    if (!decisions) return [];
    return decisions.filter((d) => {
      if (reasonFilter !== "all" && d.failure_reason !== reasonFilter) return false;
      if (interventionFilter !== "all" && d.chosen_intervention !== interventionFilter) return false;
      return true;
    });
  }, [decisions, reasonFilter, interventionFilter]);

  if (error) {
    return (
      <ErrorState
        title="Unable to load decisions"
        detail={error}
        reassurance="Check that the backend is running and try again."
        onRetry={() => setLoadSeq((n) => n + 1)}
      />
    );
  }

  if (!decisions) {
    return <LoadingState label="Loading decisions…" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Decision queue"
        description={`${filtered.length} of ${decisions.length} decisions shown`}
        action={
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
        }
      />

      <Card padded={false}>
        <Table>
          <thead>
            <TableHeaderRow>
              <Th>Payment</Th>
              <Th>Customer</Th>
              <Th align="right">Amount</Th>
              <Th>Failure reason</Th>
              <Th>Chosen intervention</Th>
              <Th align="right">Decided</Th>
            </TableHeaderRow>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <Tr key={d.decision_id} onClick={() => navigate(`/dashboard/decisions/${d.payment_id}`)}>
                <Td mono>{d.payment_id}</Td>
                <Td mono>{d.customer_id}</Td>
                <Td align="right" mono>
                  {formatCurrency(d.amount)}
                </Td>
                <Td>{FAILURE_REASON_LABELS[d.failure_reason]}</Td>
                <Td>
                  <InterventionBadge interventionId={d.chosen_intervention} />
                </Td>
                <Td align="right" style={{ color: "var(--color-text-muted)" }}>
                  {formatRelative(d.decided_at)}
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && (
              <TableStateRow colSpan={6}>No decisions match the current filters.</TableStateRow>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
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
        borderRadius: "var(--radius-md)",
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
