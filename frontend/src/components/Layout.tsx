import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Decision queue", end: true, icon: QueueIcon },
  { to: "/policy-comparison", label: "Policy comparison", end: false, icon: ChartIcon },
  { to: "/metrics", label: "Model metrics", end: false, icon: GaugeIcon },
];

export function Layout() {
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
        <div className="flex items-center gap-2.5">
          <Logomark />
          <span className="font-semibold text-[15px]" style={{ color: "var(--color-text-primary)" }}>
            Recovery Value Engine
          </span>
        </div>
        <StatusPill />
      </header>

      <div className="flex flex-1 min-h-0">
        <nav
          className="shrink-0 border-r py-4 px-3 flex flex-col gap-0.5"
          style={{
            width: "var(--sidebar-width)",
            background: "var(--sidebar-bg)",
            borderColor: "var(--sidebar-border)",
          }}
        >
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 px-8 py-6 overflow-y-auto" style={{ background: "var(--color-bg)" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors border-l-[3px]",
    isActive
      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-text)] border-l-[var(--sidebar-active-border)]"
      : "text-[var(--sidebar-item-text)] border-l-transparent hover:bg-[var(--sidebar-item-hover-bg)] hover:text-[var(--color-text-primary)]",
  ].join(" ");
}

/** A quiet, permanent reminder that every number on this dashboard is offline/simulator-derived — not a live A/B result. */
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
      className="inline-flex items-center justify-center rounded font-bold text-xs"
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
