import type { InterventionEvaluation, InterventionId } from "../api/types";
import { INTERVENTION_LABELS } from "../lib/format";
import { StatusBadge, type StatusTone } from "./StatusBadge";

export function toneForEvaluationStatus(status: InterventionEvaluation["status"]): StatusTone {
  switch (status) {
    case "chosen":
      return "success";
    case "blocked_by_guardrail":
      return "danger";
    case "rejected":
      return "pending";
  }
}

/** Chosen-intervention badge for the decision queue — always the EV winner, shown in success green. */
export function InterventionBadge({ interventionId }: { interventionId: InterventionId }) {
  return <StatusBadge tone="success">{INTERVENTION_LABELS[interventionId]}</StatusBadge>;
}
