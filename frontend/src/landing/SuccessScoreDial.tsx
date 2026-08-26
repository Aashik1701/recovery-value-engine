import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases toward a new target every time it changes (not just once on
 * scroll-into-view, unlike useCountUp.ts) -- the score keeps changing as
 * sliders move, so it needs to animate on every update, not just the
 * first. Same rAF/cubic-ease shape as useCountUp for a consistent feel.
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
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A big radial score, not a gauge/speedometer -- deliberately: a
 * speedometer implies a physical dial with a needle and a "redline",
 * borrowed styling that reads as generic dashboard chrome. A clean ring +
 * number is closer to what this actually is, a single calibrated
 * probability, not an instrument reading.
 */
export function SuccessScoreDial({ score, degraded }: { score: number; degraded: boolean }) {
  const animated = useAnimatedNumber(score);
  const clamped = Math.max(0, Math.min(100, animated));
  const dashoffset = CIRCUMFERENCE * (1 - clamped / 100);
  const color = degraded ? "var(--lp-danger)" : "var(--lp-accent)";

  return (
    <div
      className="pss-dial"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={`Payment success score: ${Math.round(score)} out of 100`}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--lp-hairline-strong)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashoffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: "stroke 0.3s ease" }}
        />
      </svg>
      <div className="pss-dial__center">
        <span className="pss-dial__value">{Math.round(animated)}</span>
        <span className="pss-dial__max">/100</span>
      </div>
    </div>
  );
}
