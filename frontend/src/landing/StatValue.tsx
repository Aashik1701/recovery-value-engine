import type { CSSProperties, RefObject } from "react";
import { useCountUp } from "./useCountUp";

/** A `.lp-stat__value` that counts up from 0 once scrolled into view. */
export function StatValue({
  target,
  format,
  style,
}: {
  target: number;
  format: (n: number) => string;
  style?: CSSProperties;
}) {
  const { ref, value } = useCountUp(target);
  return (
    <span ref={ref as RefObject<HTMLSpanElement>} className="lp-stat__value" style={style}>
      {format(value)}
    </span>
  );
}
