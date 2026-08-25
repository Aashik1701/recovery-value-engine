import type { CSSProperties } from "react";
import { useTheme } from "../theme";

/** Sun/moon toggle. Shared between the dashboard header and the landing nav, one theme, one localStorage key, either page can flip it. */
export function ThemeToggle({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const [theme, setTheme] = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`inline-flex items-center justify-center rounded transition-colors ${className}`}
      style={{ width: 30, height: 30, ...style }}
    >
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="3.4" strokeWidth="1.4" />
          <path
            d="M8 1.2v1.6M8 13.2v1.6M14.8 8h-1.6M2.8 8H1.2M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <path
            d="M13.8 9.6A6 6 0 1 1 6.4 2.2a4.7 4.7 0 0 0 7.4 7.4Z"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
