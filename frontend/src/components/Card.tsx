export function Card({
  children,
  padded = true,
  className = "",
}: {
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-x-auto ${padded ? "p-4" : ""} ${className}`}
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        borderRadius: "var(--card-radius)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      {children}
    </div>
  );
}
