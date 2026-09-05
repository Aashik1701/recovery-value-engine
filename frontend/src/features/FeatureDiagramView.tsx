import type { DiagramNode, FeatureItem } from "./featuresData";
import { ShieldCheckIcon } from "../components/icons";

interface FeatureDiagramViewProps {
  diagram: FeatureItem["diagram"];
}

const nodeTypeStyles: Record<
  DiagramNode["type"],
  { border: string; bg: string; badgeBg: string; badgeText: string; label: string }
> = {
  input: {
    border: "border-sky-500/30 dark:border-sky-400/30",
    bg: "bg-sky-50/50 dark:bg-sky-950/20",
    badgeBg: "bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300",
    badgeText: "INPUT",
    label: "text-sky-950 dark:text-sky-100",
  },
  process: {
    border: "border-blue-500/30 dark:border-blue-400/30",
    bg: "bg-blue-50/50 dark:bg-blue-950/20",
    badgeBg: "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300",
    badgeText: "ENGINE",
    label: "text-blue-950 dark:text-blue-100",
  },
  ml: {
    border: "border-indigo-500/30 dark:border-indigo-400/30",
    bg: "bg-indigo-50/50 dark:bg-indigo-950/20",
    badgeBg: "bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300",
    badgeText: "ML INFERENCE",
    label: "text-indigo-950 dark:text-indigo-100",
  },
  decision: {
    border: "border-purple-500/30 dark:border-purple-400/30",
    bg: "bg-purple-50/50 dark:bg-purple-950/20",
    badgeBg: "bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300",
    badgeText: "DECISION",
    label: "text-purple-950 dark:text-purple-100",
  },
  guardrail: {
    border: "border-amber-500/40 dark:border-amber-400/30",
    bg: "bg-amber-50/50 dark:bg-amber-950/20",
    badgeBg: "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200",
    badgeText: "GUARDRAIL",
    label: "text-amber-950 dark:text-amber-100",
  },
  output: {
    border: "border-emerald-500/40 dark:border-emerald-400/30",
    bg: "bg-emerald-50/50 dark:bg-emerald-950/20",
    badgeBg: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
    badgeText: "OUTPUT",
    label: "text-emerald-950 dark:text-emerald-100",
  },
};

export function FeatureDiagramView({ diagram }: FeatureDiagramViewProps) {
  return (
    <div
      className="p-4 rounded-xl border flex flex-col gap-3 my-2"
      style={{
        background: "var(--color-bg)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b pb-2.5" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          <h4 className="text-xs font-semibold tracking-wide uppercase" style={{ color: "var(--color-text-secondary)" }}>
            Architecture & Data Flow: <span style={{ color: "var(--color-text-primary)" }}>{diagram.title}</span>
          </h4>
        </div>
        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded border" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-border)" }}>
          {diagram.flowType} flow
        </span>
      </div>

      {/* Nodes Container */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 py-1">
        {diagram.nodes.map((node, idx) => {
          const style = nodeTypeStyles[node.type];
          return (
            <div
              key={node.id}
              className={`relative flex flex-col justify-between p-3 rounded-lg border transition-all duration-200 hover:shadow-sm ${style.border} ${style.bg}`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className={`text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded ${style.badgeBg}`}>
                  {style.badgeText}
                </span>
                <span className="text-[10px] font-mono opacity-50 font-medium">#{idx + 1}</span>
              </div>

              <div className="min-w-0">
                <p className={`text-xs font-bold leading-snug truncate ${style.label}`} title={node.label}>
                  {node.label}
                </p>
                {node.sublabel && (
                  <p className="text-[11px] leading-tight mt-0.5 opacity-80" style={{ color: "var(--color-text-secondary)" }}>
                    {node.sublabel}
                  </p>
                )}
              </div>

              {/* Step indicator arrow for desktop layout */}
              {idx < diagram.nodes.length - 1 && (
                <div className="hidden xl:block absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-[10px] text-blue-500/50 font-mono font-bold">
                  →
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Flow Sequence / Connectors description */}
      {diagram.connections.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          <span className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
            Sequence:
          </span>
          {diagram.connections.map((conn, cIdx) => (
            <span key={`${conn.from}-${conn.to}`} className="inline-flex items-center gap-1">
              <span className="font-mono font-semibold" style={{ color: "var(--color-text-primary)" }}>
                {conn.from}
              </span>
              <span className="text-blue-500 font-bold">→</span>
              <span className="font-mono font-semibold" style={{ color: "var(--color-text-primary)" }}>
                {conn.to}
              </span>
              {conn.label && (
                <span className="text-[10px] px-1 py-0.2 rounded bg-slate-200/50 dark:bg-slate-800/50">
                  ({conn.label})
                </span>
              )}
              {cIdx < diagram.connections.length - 1 && <span className="opacity-40 ml-1">•</span>}
            </span>
          ))}
        </div>
      )}

      {/* Takeaway / Guarantee */}
      {diagram.takeaway && (
        <div
          className="mt-1 px-3 py-2 rounded-lg border text-xs flex items-start gap-2.5"
          style={{
            background: "var(--color-card-bg)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          <span className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400">
            <ShieldCheckIcon size={14} />
          </span>
          <span>
            <strong className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
              System Specification:
            </strong>{" "}
            {diagram.takeaway}
          </span>
        </div>
      )}
    </div>
  );
}
