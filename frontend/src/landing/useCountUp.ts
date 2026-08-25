import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Animates a number counting up from 0 once it scrolls into view. Purely
 * decorative polish for the stat callouts, the real value (`target`) is
 * what's in the DOM at rest, this just makes it land with some weight.
 */
export function useCountUp(target: number, durationMs = 900) {
  const ref = useRef<HTMLElement>(null);
  const [value, setValue] = useState(REDUCED_MOTION ? target : 0);

  useEffect(() => {
    if (REDUCED_MOTION || !ref.current) return;
    const el = ref.current;
    let raf = 0;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / durationMs, 1);
          const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
          setValue(target * eased);
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);

  return { ref, value };
}
