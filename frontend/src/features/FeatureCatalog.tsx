import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FEATURES_LIST } from "./featuresData";
import { FeatureDiagramView } from "./FeatureDiagramView";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  CodeFileIcon,
  CrossIcon,
  ExternalLinkIcon,
  LayersIcon,
  SearchIcon,
  ShieldCheckIcon,
  TableIcon,
} from "../components/icons";

interface FeatureCatalogProps {
  onClose?: () => void;
  isModal?: boolean;
}

const CATEGORIES = [
  "All Features",
  "Core Decision Engine",
  "Guardrails & Risk Policy",
  "AI Reliability & Safety",
  "Payment Intelligence",
  "Negotiation & Settlement",
  "Strategic Simulation",
  "Loss Forensics",
  "Execution & Verification",
] as const;

export function FeatureCatalog({ onClose, isModal = false }: FeatureCatalogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("All Features");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(FEATURES_LIST.slice(0, 3).map((f) => f.sNo)),
  );
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  const filteredFeatures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return FEATURES_LIST.filter((item) => {
      const matchesCategory =
        selectedCategory === "All Features" || item.category === selectedCategory;
      if (!matchesCategory) return false;

      if (!q) return true;
      return (
        item.sNo.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.codeRef.toLowerCase().includes(q) ||
        (item.endpoint && item.endpoint.toLowerCase().includes(q)) ||
        item.howItWorks.some((h) => h.toLowerCase().includes(q))
      );
    });
  }, [selectedCategory, searchQuery]);

  const toggleExpand = (sNo: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sNo)) next.delete(sNo);
      else next.add(sNo);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedIds(new Set(FEATURES_LIST.map((f) => f.sNo)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full">
      {/* Hero / Header Section */}
      <div
        className="p-6 rounded-2xl border relative overflow-hidden flex flex-col gap-4 shadow-sm"
        style={{
          background: "linear-gradient(135deg, var(--color-card-bg) 0%, var(--color-bg) 100%)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold tracking-wider uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                System Specification & Technical Blueprint
              </span>
              <span className="text-xs text-muted-foreground font-mono">Buildathon Track 3 Architecture</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--color-text-primary)" }}>
              Recovery Value Engine: Subsystem Architecture
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              Formal specification of the 16 intelligence and execution subsystems. Every recovery decision is
              deterministic, guardrail-constrained, and fully auditable with counterfactual ground-truth validation.
            </p>
          </div>

          {isModal && onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              <CrossIcon size={12} />
              <span>Close</span>
            </button>
          )}
        </div>

        {/* Quick Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>Total Subsystems</span>
            <span className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400">16 Architectures</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>Financial Optimization</span>
            <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">100% Deterministic</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>Generative Boundary</span>
            <span className="text-lg font-bold font-mono text-purple-600 dark:text-purple-400">1 LLM Touchpoint</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>Benchmark Rigor</span>
            <span className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">4-Policy Analytical</span>
          </div>
        </div>
      </div>

      {/* Control Bar: Search, Category Filters, & View Toggle */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by subsystem, model, code, or keyword..."
              className="w-full pl-9 pr-8 py-2 rounded-xl text-xs border outline-none transition-all duration-150 focus:ring-2 focus:ring-blue-500/30"
              style={{
                background: "var(--color-card-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon size={14} />
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <CrossIcon size={12} />
              </button>
            )}
          </div>

          {/* Action controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="px-2.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-2.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            >
              Collapse All
            </button>
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1" />
            <button
              onClick={() => setViewMode(viewMode === "cards" ? "table" : "cards")}
              className="px-2.5 py-1.5 rounded-lg border text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
            >
              {viewMode === "cards" ? (
                <>
                  <TableIcon size={14} />
                  <span>Matrix View</span>
                </>
              ) : (
                <>
                  <LayersIcon size={14} />
                  <span>Card View</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const count =
              cat === "All Features"
                ? FEATURES_LIST.length
                : FEATURES_LIST.filter((f) => f.category === cat).length;
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${active
                    ? "bg-blue-600 text-white shadow-sm font-semibold"
                    : "border hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                style={
                  active
                    ? {}
                    : {
                      borderColor: "var(--color-border)",
                      background: "var(--color-card-bg)",
                      color: "var(--color-text-secondary)",
                    }
                }
              >
                <span>{cat}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${active ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-text-muted)" }}>
        <span>
          Displaying <strong style={{ color: "var(--color-text-primary)" }}>{filteredFeatures.length}</strong> of{" "}
          {FEATURES_LIST.length} specifications
          {selectedCategory !== "All Features" && ` under ${selectedCategory}`}
          {searchQuery && ` matching "${searchQuery}"`}
        </span>
      </div>

      {/* Main Content Area */}
      {viewMode === "table" ? (
        /* Summary Matrix Table Mode */
        <div
          className="rounded-2xl border overflow-hidden shadow-sm"
          style={{ background: "var(--color-card-bg)", borderColor: "var(--color-border)" }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b bg-slate-50/50 dark:bg-slate-900/50" style={{ borderColor: "var(--color-border)" }}>
                  <th className="py-3 px-4 font-mono font-bold w-14">Ref</th>
                  <th className="py-3 px-4 font-semibold w-56">Subsystem Name</th>
                  <th className="py-3 px-4 font-semibold w-44">Domain</th>
                  <th className="py-3 px-4 font-semibold">Architectural Function</th>
                  <th className="py-3 px-4 font-semibold w-36">Technical Core</th>
                  <th className="py-3 px-4 font-semibold w-28 text-right">Route</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {filteredFeatures.map((item) => (
                  <tr
                    key={item.sNo}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                      #{item.sNo}
                    </td>
                    <td className="py-3 px-4 font-semibold" style={{ color: "var(--color-text-primary)" }}>
                      {item.name}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium border" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                      {item.summary}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                        {item.badge}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {item.route ? (
                        <Link
                          to={item.route}
                          onClick={onClose}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all no-underline inline-flex items-center gap-1.5 shadow-sm hover:brightness-110"
                          style={{
                            backgroundColor: "var(--color-primary, #305eff)",
                            color: "#ffffff",
                          }}
                        >
                          <span style={{ color: "#ffffff" }}>{item.routeLabel ?? "Inspect"}</span>
                          <span style={{ color: "#ffffff" }}>
                            <ExternalLinkIcon size={10} />
                          </span>
                        </Link>
                      ) : (
                        <span className="text-[11px] opacity-40 font-mono">Service</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Detailed Card Flow View */
        <div className="flex flex-col gap-4">
          {filteredFeatures.map((item) => {
            const isExpanded = expandedIds.has(item.sNo);
            return (
              <div
                key={item.sNo}
                className="rounded-2xl border transition-all duration-200 overflow-hidden shadow-sm hover:border-blue-500/40"
                style={{
                  background: "var(--color-card-bg)",
                  borderColor: isExpanded ? "var(--color-primary-subtle, #3b82f640)" : "var(--color-border)",
                }}
              >
                {/* Card Summary Header (Always Visible) */}
                <div
                  onClick={() => toggleExpand(item.sNo)}
                  className="p-5 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors select-none"
                >
                  <div className="flex items-start gap-4 min-w-0">
                    {/* S.No Badge */}
                    <div
                      className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl font-mono text-sm font-bold border shadow-inner"
                      style={{
                        background: "linear-gradient(135deg, var(--color-bg) 0%, var(--color-card-bg) 100%)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-primary, #305eff)",
                      }}
                    >
                      #{item.sNo}
                    </div>

                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold" style={{ color: "var(--color-text-primary)" }}>
                          {item.name}
                        </h2>
                        <span
                          className="px-2 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wider border"
                          style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-text-secondary)",
                            background: "var(--color-bg)",
                          }}
                        >
                          {item.category}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                        {item.summary}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2.5">
                    {item.route && (
                      <Link
                        to={item.route}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onClose) onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all no-underline inline-flex items-center gap-1.5 shadow-sm hover:brightness-110 cursor-pointer"
                        style={{
                          backgroundColor: "var(--color-primary, #305eff)",
                          color: "#ffffff",
                        }}
                        title={`Navigate to ${item.name}`}
                      >
                        <span style={{ color: "#ffffff" }}>{item.routeLabel ?? "Inspect Live"}</span>
                        <span style={{ color: "#ffffff" }}>
                          <ArrowRightIcon size={12} />
                        </span>
                      </Link>
                    )}
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 hidden sm:inline">
                      {isExpanded ? "Hide Spec" : "View Spec"}
                    </span>
                    <ChevronDownIcon size={14} open={isExpanded} />
                  </div>
                </div>

                {/* Expanded Architectural & Engineering Details */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 border-t flex flex-col gap-4" style={{ borderColor: "var(--color-border)" }}>
                    {/* How It Works List */}
                    <div className="flex flex-col gap-2 pt-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--color-text-primary)" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                        <span>Execution Logic & Processing Pipeline</span>
                      </h4>
                      <div className="grid grid-cols-1 gap-2">
                        {item.howItWorks.map((step, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-2.5 text-xs p-2.5 rounded-lg border"
                            style={{
                              background: "var(--color-bg)",
                              borderColor: "var(--color-border)",
                              color: "var(--color-text-secondary)",
                            }}
                          >
                            <span className="shrink-0 w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-bold flex items-center justify-center text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="leading-relaxed">{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Architecture / Data Flow Diagram */}
                    <FeatureDiagramView diagram={item.diagram} />

                    {/* AI Judgment & Engineering Rationale Box */}
                    <div
                      className="p-3.5 rounded-xl border text-xs flex flex-col gap-1.5"
                      style={{
                        background: "rgba(139, 92, 246, 0.04)",
                        borderColor: "rgba(139, 92, 246, 0.2)",
                      }}
                    >
                      <div className="flex items-center gap-2 font-semibold text-xs text-purple-700 dark:text-purple-300">
                        <ShieldCheckIcon size={14} />
                        <span>AI Judgment & Deterministic Safety Boundary</span>
                      </div>
                      <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                        {item.aiJudgment}
                      </p>
                    </div>

                    {/* Footer Meta & Direct Live Link */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t text-xs" style={{ borderColor: "var(--color-border)" }}>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5" style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                          <CodeFileIcon size={12} />
                          <span>{item.codeRef}</span>
                        </span>
                        {item.endpoint && (
                          <span className="font-mono text-[11px] px-2.5 py-1 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>{item.endpoint}</span>
                          </span>
                        )}
                      </div>

                      {item.route && (
                        <Link
                          to={item.route}
                          onClick={onClose}
                          className="px-3.5 py-1.5 rounded-xl font-semibold text-xs transition-all no-underline inline-flex items-center gap-1.5 shadow-sm hover:brightness-110 cursor-pointer"
                          style={{
                            backgroundColor: "var(--color-primary, #305eff)",
                            color: "#ffffff",
                          }}
                        >
                          <span style={{ color: "#ffffff" }}>{item.routeLabel ?? "Inspect in Dashboard"}</span>
                          <span style={{ color: "#ffffff" }}>
                            <ArrowRightIcon size={12} />
                          </span>
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
