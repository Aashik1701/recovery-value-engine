/**
 * One stat-tile component for the "4 numbers in a row" pattern that
 * PaymentQueue (as `SummaryTile`) and MetricsPanel (inline Cards)
 * previously implemented separately. Deliberately plain -- a label, a
 * value, an optional one-line context note -- per the instruction that not
 * every metric needs its own decorated card.
 */
export function StatTile({
  label,
  value,
  context,
  tone,
}: {
  label: string;
  value: string;
  context?: string;
  tone?: "success" | "danger" | "pending";
}) {
  const valueColor = tone ? `var(--color-status-${tone}-text)` : "var(--color-text-primary)";
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p
        className="text-2xl font-semibold mt-0.5"
        style={{ color: valueColor, fontFamily: "var(--font-family-data)" }}
      >
        {value}
      </p>
      {context && (
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
          {context}
        </p>
      )}
    </div>
  );
}

/** Grid wrapper with the responsive step-down every stat-tile row needs
 * (2 columns narrow, up to `cols` wide) -- previously several stat grids
 * hardcoded a fixed `grid-cols-N` with no mobile fallback at all. */
export function StatTileGrid({ cols = 4, children }: { cols?: 3 | 4 | 5; children: React.ReactNode }) {
  const wideClass = cols === 3 ? "sm:grid-cols-3" : cols === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4";
  return <div className={`grid grid-cols-2 ${wideClass} gap-4`}>{children}</div>;
}
