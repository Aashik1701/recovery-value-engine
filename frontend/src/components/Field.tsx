/**
 * A labelled value in a description-list layout (dt/dd) -- the small
 * "label above value" unit used throughout decision/payment/negotiation
 * detail pages. Previously copy-pasted verbatim in three files
 * (DecisionDrillDown, PaymentDetail, RecoveryNegotiation); this is the merge.
 */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd className="mt-0.5 text-sm" style={{ color: "var(--color-text-primary)" }}>
        {children}
      </dd>
    </div>
  );
}
