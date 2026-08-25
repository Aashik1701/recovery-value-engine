import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const REDUCED_MOTION =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fades a section in once it's scrolled into view. Purely decorative — content is present and readable before it fires. */
export function Reveal({
  children,
  delayMs = 0,
  as: Tag = "div",
  className = "",
  style,
}: {
  children: ReactNode;
  delayMs?: number;
  as?: "div" | "h2" | "p";
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const [isIn, setIsIn] = useState(REDUCED_MOTION);

  useEffect(() => {
    if (REDUCED_MOTION || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIn(true);
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // @ts-expect-error -- ref typing across the small set of tags we use is fine at runtime
      ref={ref}
      className={`lp-reveal ${isIn ? "is-in" : ""} ${className}`}
      style={{ ...style, transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </Tag>
  );
}
