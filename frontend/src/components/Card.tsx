export function Card({
  children,
  padded = true,
  className = "",
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
  /** Merged over the card's base styles — for the occasional tinted card
   *  (e.g. an escalated decision) without a new component. */
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`overflow-x-auto ${padded ? "p-4" : ""} ${className}`}
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--card-radius)",
        boxShadow: "var(--card-shadow)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
