import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

const TAGS = { div: motion.div, h2: motion.h2, p: motion.p, ul: motion.ul } as const;

/** Fades a section up into place, spring-eased, once it's scrolled into view. Purely decorative, content is present and readable before it fires. */
export function Reveal({
  children,
  delayMs = 0,
  as = "div",
  className = "",
  style,
}: {
  children: ReactNode;
  delayMs?: number;
  as?: keyof typeof TAGS;
  className?: string;
  style?: CSSProperties;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    const StaticTag = as;
    return (
      <StaticTag className={className} style={style}>
        {children}
      </StaticTag>
    );
  }

  const MotionTag = TAGS[as];
  return (
    <MotionTag
      className={className}
      style={style}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, delay: delayMs / 1000, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </MotionTag>
  );
}
