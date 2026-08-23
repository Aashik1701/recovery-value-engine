import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "Decision queue", end: true },
  { to: "/policy-comparison", label: "Policy comparison", end: false },
  { to: "/metrics", label: "Model metrics", end: false },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "px-3 py-1.5 rounded text-sm font-medium transition-colors",
    isActive
      ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
  ].join(" ");
}

export function Layout() {
  return (
    <div className="min-h-full flex flex-col">
      <header
        className="flex items-center justify-between border-b px-6 shrink-0"
        style={{
          height: "var(--app-header-height)",
          background: "var(--app-nav-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Recovery Value Engine
          </span>
          <StatusPill />
        </div>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 px-6 py-6" style={{ background: "var(--color-bg)" }}>
        <Outlet />
      </main>
    </div>
  );
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
