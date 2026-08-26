import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases toward a new target every time it changes, not just once on first
 * render -- the score can change after a method switch or a fresh
 * /pss/score response, so it needs to animate on every update.
 */
function useAnimatedNumber(target: number, durationMs = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    // Reduced motion: skip the animation loop entirely rather than
    // sync-setting state to a value it's already converging toward --
    // avoids an unnecessary extra render on every target change.
    if (REDUCED_MOTION) return;

    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (to - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  if (REDUCED_MOTION) return target;

  return value;
}

const SIZE = 208;
const STROKE = 12;

/**
 * A big radial score, not a gauge/speedometer -- deliberately: a
 * speedometer implies a physical dial with a needle and a "redline",
 * borrowed styling that reads as generic dashboard chrome. A clean ring +
 * number is closer to what this actually is, a single calibrated
 * probability, not an instrument reading.
 *
 * Colors are passed in rather than hardcoded to a token namespace so this
 * one component works in both the landing page (--lp-* tokens) and the
 * dashboard (--color-* tokens) without a duplicate implementation --
 * callers pick their own accent/track/danger colors from their own token
 * set.
 */
export function SuccessScoreDial({
  score,
  degraded,
  size = SIZE,
  accentColor,
  dangerColor,
  trackColor,
  centerValueColor,
  centerMaxColor,
}: {
  score: number;
  degraded: boolean;
  size?: number;
  accentColor: string;
  dangerColor: string;
  trackColor: string;
  centerValueColor: string;
  centerMaxColor: string;
}) {
  const animated = useAnimatedNumber(score);
  const clamped = Math.max(0, Math.min(100, animated));
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - clamped / 100);
  const color = degraded ? dangerColor : accentColor;

  return (
    <div
      className="rve-score-dial"
      style={{ width: size, height: size, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
      role="img"
      aria-label={`Payment success score: ${Math.round(score)} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={STROKE} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke 0.3s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-family-data, var(--lp-font-mono))",
            fontSize: size * 0.25,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: centerValueColor,
          }}
        >
          {Math.round(animated)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-family-data, var(--lp-font-mono))",
            fontSize: size * 0.067,
            color: centerMaxColor,
            marginTop: 4,
          }}
        >
          /100
        </span>
      </div>
    </div>
  );
}
