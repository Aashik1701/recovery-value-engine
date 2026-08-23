export type StatusTone = "success" | "pending" | "danger" | "neutral";

const TONE_STYLE: Record<StatusTone, React.CSSProperties> = {
  success: {
    color: "var(--color-status-success-text)",
    background: "var(--color-status-success-bg)",
    borderColor: "var(--color-status-success-border)",
  },
  pending: {
    color: "var(--color-status-pending-text)",
    background: "var(--color-status-pending-bg)",
    borderColor: "var(--color-status-pending-border)",
  },
  danger: {
    color: "var(--color-status-danger-text)",
    background: "var(--color-status-danger-bg)",
    borderColor: "var(--color-status-danger-border)",
  },
  neutral: {
    color: "var(--color-status-neutral-text)",
    background: "var(--color-status-neutral-bg)",
    borderColor: "var(--color-status-neutral-border)",
  },
};

export function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: StatusTone;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap"
      style={{
        ...TONE_STYLE[tone],
        fontSize: "var(--badge-font-size)",
        paddingBlock: "var(--badge-padding-y)",
        paddingInline: "var(--badge-padding-x)",
        borderRadius: "var(--badge-radius)",
      }}
    >
      {children}
    </span>
  );
}
