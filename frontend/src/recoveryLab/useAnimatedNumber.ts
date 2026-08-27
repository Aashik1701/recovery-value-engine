import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animates a displayed number toward `target` whenever it changes (e.g. a
 * fresh simulation result landing) -- unlike landing/useCountUp.ts, which
 * triggers once on scroll-into-view, this re-triggers on every new value.
 * Subtle by design (this project's stated intent: "not
 * casino-style counters") -- short duration, eased, and a no-op under
 * prefers-reduced-motion.
 */
export function useAnimatedNumber(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    if (REDUCED_MOTION) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
