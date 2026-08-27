/**
 * Standard loading / empty / error states. Before this, every page wrote
 * its own text ("Loading X…", narrative "Analyzing… reconstructing…"
 * copy, a bare <p> vs a <Card>-wrapped one), one page's error text was
 * colored red and every other page's wasn't, and PaymentQueue had no empty
 * state at all -- a genuine gap where a zero-row result silently showed an
 * empty table with no explanation.
 */
import { Button } from "./Button";
import { Card } from "./Card";

export function LoadingState({ label }: { label: string }) {
  return (
    <Card>
      <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </p>
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Card>
      <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
        {title}
      </p>
      {description && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </p>
      )}
    </Card>
  );
}

export function ErrorState({
  title,
  detail,
  onRetry,
  reassurance,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  reassurance?: string;
}) {
  return (
    <Card>
      <p className="text-sm font-medium" style={{ color: "var(--color-status-danger-text)" }}>
        {title}
      </p>
      {detail && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
          {detail}
        </p>
      )}
      {reassurance && (
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          {reassurance}
        </p>
      )}
      {onRetry && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Same three states, sized for a table body row (colSpan) rather than a
 * standalone Card -- for tables that render their own loading/empty text
 * inside <tbody> instead of swapping the whole page. */
export function TableStateRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
        {children}
      </td>
    </tr>
  );
}
