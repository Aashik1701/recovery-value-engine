/**
 * The one button component every action in this app uses. Before this,
 * primary actions had two independent implementations (one using Tailwind's
 * `rounded` default 4px radius and `py-2.5`, the other using inline
 * `var(--radius-md)` and `padding: 14px 20px`), plus four more small
 * bordered-chip families with slightly different padding scattered across
 * SimulationControls, ResourceSensitivityPanel, and ForensicPaymentTable's
 * pagination. This consolidates all of them into one component with a
 * `variant` prop -- the visual states (default/hover/active/disabled) are
 * defined once.
 */
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "tertiary" | "danger";
type Size = "md" | "sm";

const VARIANT_STYLE: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--color-primary)",
    color: "var(--color-text-on-primary)",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--color-bg-surface)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border)",
  },
  tertiary: {
    background: "transparent",
    color: "var(--color-primary)",
    border: "1px solid transparent",
  },
  danger: {
    background: "var(--color-status-danger)",
    color: "var(--color-text-on-primary)",
    border: "1px solid transparent",
  },
};

const VARIANT_HOVER_BG: Record<Variant, string> = {
  primary: "var(--color-primary-hover)",
  secondary: "var(--color-bg-hover)",
  tertiary: "var(--color-bg-hover)",
  danger: "var(--red-700)",
};

const SIZE_STYLE: Record<Size, React.CSSProperties> = {
  md: { padding: "8px 16px", fontSize: 13.5 },
  sm: { padding: "5px 10px", fontSize: 12.5 },
};

export function Button({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  busy = false,
  className = "",
  style,
  children,
  disabled,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  busy?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const isDisabled = disabled || busy;
  return (
    <button
      type="button"
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors ${fullWidth ? "w-full" : ""} ${className}`}
      style={{
        ...VARIANT_STYLE[variant],
        ...SIZE_STYLE[size],
        borderRadius: "var(--radius-md)",
        opacity: isDisabled ? 0.55 : 1,
        cursor: isDisabled ? "default" : "pointer",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) e.currentTarget.style.background = VARIANT_HOVER_BG[variant];
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) e.currentTarget.style.background = VARIANT_STYLE[variant].background as string;
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
