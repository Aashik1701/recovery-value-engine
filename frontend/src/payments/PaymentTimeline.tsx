import type { TimelineEvent } from "./usePaymentFlow";

/** Real client-observed timestamps for real state transitions -- never a
 * fabricated event. If a stage hasn't happened yet, it simply isn't in
 * this list yet, rather than being pre-rendered as a pending placeholder. */
export function PaymentTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-family-data)",
          textTransform: "uppercase",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          color: "var(--color-text-muted)",
          marginBottom: 12,
        }}
      >
        Payment timeline
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {events.map((e) => (
          <li
            key={e.id}
            style={{
              display: "grid",
              gridTemplateColumns: "76px 1fr",
              gap: 14,
              padding: "8px 0",
              borderTop: "1px solid var(--color-border)",
              fontSize: 13,
            }}
          >
            <time
              style={{ fontFamily: "var(--font-family-data)", fontSize: 12, color: "var(--color-text-muted)" }}
            >
              {new Date(e.at).toLocaleTimeString("en-IN", { hour12: false })}
            </time>
            <div>
              <div style={{ color: "var(--color-text-primary)" }}>{e.label}</div>
              {e.detail && (
                <div style={{ color: "var(--color-text-secondary)", fontSize: 12.5, marginTop: 1 }}>{e.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
