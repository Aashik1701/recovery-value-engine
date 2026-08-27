import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatusBadge, type StatusTone } from "./StatusBadge";

/**
 * The one page-header shape every route uses. Before this component, six
 * pages each hand-rolled a slightly different title/subtitle block (drift:
 * text-lg vs text-xl, mt-1 present/absent, max-w-2xl present/absent,
 * eyebrow present/absent, badge present/absent) -- this is the merge of
 * those into a single, consistent pattern: optional back-link, optional
 * eyebrow/section label, title, one-sentence description, optional status
 * badge, optional trailing action.
 */
export function PageHeader({
  backTo,
  eyebrow,
  title,
  description,
  badge,
  badgeTone = "neutral",
  action,
}: {
  backTo?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  badge?: string;
  badgeTone?: StatusTone;
  action?: ReactNode;
}) {
  return (
    <div>
      {backTo}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {eyebrow && (
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-1"
              style={{ color: "var(--color-primary)" }}
            >
              {eyebrow}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {title}
            </h1>
            {badge && <StatusBadge tone={badgeTone}>{badge}</StatusBadge>}
          </div>
          {description && (
            <p className="text-sm mt-1 max-w-2xl" style={{ color: "var(--color-text-secondary)" }}>
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

/** Standard "← Back to X" link, styled identically wherever a detail page
 * needs one -- the shared other half of the previous six-shapes drift
 * (DecisionDrillDown, PaymentDetail each hand-rolled their own). */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-sm inline-flex items-center gap-1 mb-2 no-underline"
      style={{ color: "var(--color-text-secondary)" }}
    >
      ← {label}
    </Link>
  );
}
