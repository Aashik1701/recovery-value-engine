import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Decision queue", end: true, icon: QueueIcon },
  { to: "/recovery-lab", label: "Recovery Lab", end: false, icon: FlaskIcon },
  { to: "/dashboard/policy-comparison", label: "Policy comparison", end: false, icon: ChartIcon },
  { to: "/dashboard/metrics", label: "Model metrics", end: false, icon: GaugeIcon },
  { to: "/payments", label: "Payment Intelligence", end: false, icon: PulseIcon },
  { to: "/revenue-autopsy", label: "Revenue Autopsy", end: false, icon: AutopsyIcon },
];

const COLLAPSE_STORAGE_KEY = "rve-sidebar-collapsed";
const NARROW_VIEWPORT_QUERY = "(max-width: 640px)";

export function Layout() {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true",
  );
  // Auto-collapse on narrow viewports, on top of (not instead of) the
  // user's persisted desktop preference -- at 375px the full 236px
  // sidebar leaves under 140px for content, which is unusable for a
  // payment flow that needs the amount/score/CTA to stay legible. Not
  // persisted to localStorage: resizing back up to desktop restores
  // whatever the user actually chose there.
  const [isNarrow, setIsNarrow] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
  );

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const mql = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const onChange = () => setIsNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const effectiveCollapsed = collapsed || isNarrow;

  return (
    <div className="min-h-full flex flex-col">
      <header
        className="flex items-center justify-between border-b px-5 shrink-0"
        style={{
          height: "var(--app-header-height)",
          background: "var(--app-nav-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        <Link to="/" className="flex items-center gap-2.5 no-underline" title="Back to the overview">
          <Logomark />
          <span className="font-semibold text-[15px]" style={{ color: "var(--color-text-primary)" }}>
            Recovery Value Engine
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Overview
          </Link>
          <ThemeToggle style={{ color: "var(--color-text-secondary)" }} />
          <StatusPill />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav
          className="shrink-0 border-r py-4 flex flex-col transition-[width] duration-150 ease-out"
          style={{
            width: effectiveCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
            background: "var(--sidebar-bg)",
            borderColor: "var(--sidebar-border)",
          }}
        >
          <div className={`flex-1 flex flex-col gap-0.5 ${effectiveCollapsed ? "px-2" : "px-3"}`}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={(state) => navLinkClass(state, effectiveCollapsed)}
                title={effectiveCollapsed ? item.label : undefined}
              >
                <item.icon />
                {!effectiveCollapsed && item.label}
              </NavLink>
            ))}
          </div>

          {/* Manually expanding doesn't make sense below the auto-collapse
              breakpoint -- there isn't room to honor it -- so the toggle
              only appears once the viewport is wide enough for it to do
              something visible. */}
          {!isNarrow && (
            <div className={collapsed ? "px-2" : "px-3"}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--sidebar-item-hover-bg)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <CollapseIcon collapsed={collapsed} />
                {!collapsed && "Collapse"}
              </button>
            </div>
          )}
        </nav>

        <main className="flex-1 px-8 py-6 overflow-y-auto" style={{ background: "var(--color-bg)" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }, collapsed: boolean): string {
  return [
    "flex items-center gap-2.5 py-2 rounded text-sm font-medium transition-colors border-l-[3px] whitespace-nowrap",
    collapsed ? "justify-center px-2" : "px-3",
    isActive
      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)] border-l-[var(--sidebar-active-border)]"
      : "text-[var(--sidebar-item-text)] border-l-transparent hover:bg-[var(--sidebar-item-hover-bg)] hover:text-[var(--color-text-primary)]",
  ].join(" ");
}

/** A quiet, permanent reminder that every number on this dashboard is offline/simulator-derived, not a live A/B result. */
function StatusPill() {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded border"
      style={{
        color: "var(--color-text-muted)",
        borderColor: "var(--color-border)",
        fontFamily: "var(--font-family-data)",
      }}
      title="All figures on this dashboard come from an offline synthetic simulator, not live production traffic."
    >
      offline simulator
    </span>
  );
}

function Logomark() {
  return (
    <span
      className="inline-flex items-center justify-center rounded font-bold text-xs shrink-0"
      style={{
        width: 22,
        height: 22,
        background: "var(--color-primary)",
        color: "var(--color-text-on-primary)",
      }}
      aria-hidden="true"
    >
      R
    </span>
  );
}

function iconProps() {
  return { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor" } as const;
}

function QueueIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="2" y="3" width="12" height="2.5" rx="0.5" strokeWidth="1.3" />
      <rect x="2" y="7" width="12" height="2.5" rx="0.5" strokeWidth="1.3" />
      <rect x="2" y="11" width="8" height="2.5" rx="0.5" strokeWidth="1.3" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6.5 2.5v3.8L2.8 12a1.2 1.2 0 0 0 1 1.8h8.4a1.2 1.2 0 0 0 1-1.8L9.5 6.3V2.5" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.2 2.5h5.6" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 10.2h6" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M2 13.5V2.5" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="4" y="8" width="2.4" height="5.5" strokeWidth="1.3" />
      <rect x="8" y="5" width="2.4" height="8.5" strokeWidth="1.3" />
      <rect x="12" y="2.5" width="2.4" height="11" strokeWidth="1.3" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M2.5 12.5a5.5 5.5 0 1 1 11 0" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8 12.5 10.5 8" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M1.5 8h3l1.5-4 3 8 1.5-4h3.5" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AutopsyIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="6.5" cy="6.5" r="4" strokeWidth="1.3" />
      <path d="M9.4 9.4 13.5 13.5" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 6.5h3M6.5 5v3" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" className="shrink-0">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" strokeWidth="1.3" />
      <path d="M6.5 2.5V13.5" strokeWidth="1.3" />
      {collapsed ? (
        <path d="M8.5 6 10.5 8 8.5 10" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4.5 6 2.5 8 4.5 10" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
