/**
 * Shared table primitives. Six files hand-rolled their own <table>/<thead>
 * with three different Th/Td helpers (two near-identical twins missing
 * vertical padding, one with it) and three more skipping the helper
 * entirely to inline Tailwind classes. This is the merge: one Th, one Td,
 * one header row, all payment/decision/root-cause/opportunity tables in the
 * app import from here instead of redefining the same cell.
 */
import type { HTMLAttributes, KeyboardEvent, ReactNode, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";

export function Table({ children, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table style={{ fontSize: "var(--table-font-size)" }} {...rest}>
      {children}
    </table>
  );
}

export function TableHeaderRow({ children }: { children: ReactNode }) {
  return (
    <tr style={{ background: "var(--table-header-bg)", color: "var(--color-text-secondary)" }}>
      {children}
    </tr>
  );
}

export function Th({
  align = "left",
  className = "",
  children,
  ...rest
}: { align?: "left" | "right" } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-3 py-2 font-medium whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  align = "left",
  mono = false,
  className = "",
  style,
  children,
  ...rest
}: { align?: "left" | "right"; mono?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} ${className}`}
      style={{ ...(mono ? { fontFamily: "var(--font-family-data)" } : undefined), ...style }}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Row with the app's one hover treatment (a JS-driven CSS var swap -- no
 * component in this codebase uses a Tailwind `hover:` pseudo-class, so this
 * matches the existing convention rather than introducing a second one).
 * When `onClick` is given the row is also keyboard-operable (Tab to focus,
 * Enter/Space to activate) -- previously only a mouse could ever trigger a
 * clickable row across every table in the app. */
export function Tr({
  onClick,
  children,
  className = "",
  style,
  ...rest
}: {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  /** Merged over the row's base height/border (e.g. a winner-row tint) --
   *  never replaces them. */
  style?: React.CSSProperties;
} & Omit<HTMLAttributes<HTMLTableRowElement>, "onClick" | "className" | "children" | "style" | "onMouseEnter" | "onMouseLeave">) {
  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onClick?.();
  }
  return (
    <tr
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`border-t ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{ height: "var(--table-row-height)", borderColor: "var(--table-border-color)", ...style }}
      onMouseEnter={(e) => onClick && (e.currentTarget.style.background = "var(--table-row-hover-bg)")}
      onMouseLeave={(e) => onClick && (e.currentTarget.style.background = "")}
      {...rest}
    >
      {children}
    </tr>
  );
}
