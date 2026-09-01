import type { ConfidenceTier } from "../api/types";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/**
 * A High / Medium / Low pill for a P(recovery) estimate's confidence, where
 * "confidence" is bootstrap-ensemble agreement (low spread = high
 * confidence), NOT distance from 0.5. Reuses StatusBadge so it inherits the
 * dashboard's existing status palette — no new colors.
 */
const TIER: Record<ConfidenceTier, { tone: StatusTone; label: string }> = {
  high: { tone: "success", label: "High confidence" },
  medium: { tone: "neutral", label: "Medium confidence" },
  low: { tone: "pending", label: "Low confidence" },
};

export function ConfidenceTag({
  tier,
  compact = false,
}: {
  tier: ConfidenceTier;
  compact?: boolean;
}) {
  const { tone, label } = TIER[tier];
  return <StatusBadge tone={tone}>{compact ? label.replace(" confidence", "") : label}</StatusBadge>;
}
