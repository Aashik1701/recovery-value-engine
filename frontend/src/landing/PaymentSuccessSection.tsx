import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { PSSMethodScore, PaymentMethod } from "../api/types";
import { SuccessScoreDial } from "../components/SuccessScoreDial";
import { Reveal } from "./Reveal";

/**
 * "Before the payment fails" -- Payment Success Score (v2, CLAUDE.md
 * Section 20). A different question from the rest of this page: RVE
 * (below) decides what to do about a payment that has already failed;
 * this estimates, before an attempt happens, how likely it is to succeed
 * on each available method, and lets a visitor perturb live conditions
 * and watch a real trained model respond -- every slider move calls the
 * actual /pss/score endpoint (or the equivalent deterministic mock
 * function in mock mode), not a scripted animation. See CLAUDE.md Section
 * 20 for the full honesty boundary: offline/synthetic, and unlike
 * `sms_link`, this pipeline never executes anything real.
 */

const METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
};

const DEGRADED_THRESHOLD = 65;

const CHECKOUT_AMOUNT = 2999;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function PaymentSuccessSection() {
  const [trafficLoadIndex, setTrafficLoadIndex] = useState(1.0);
  const [gatewayLatencyMs, setGatewayLatencyMs] = useState(100);
  const [gatewayErrorRate, setGatewayErrorRate] = useState(0.01);

  const debouncedTraffic = useDebounced(trafficLoadIndex, 150);
  const debouncedLatency = useDebounced(gatewayLatencyMs, 150);
  const debouncedErrorRate = useDebounced(gatewayErrorRate, 150);

  const [methods, setMethods] = useState<PSSMethodScore[] | null>(null);
  const [recommended, setRecommended] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow earlier response landing after a faster later
  // one and clobbering fresher state -- the same stale-response problem
  // DecisionDrillDown.tsx solved for its non-idempotent /decide call, here
  // for a rapid-fire idempotent one instead (debounce reduces the volume
  // but doesn't guarantee response order under real network jitter).
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    api
      .pssScore({
        traffic_load_index: debouncedTraffic,
        gateway_latency_ms: debouncedLatency,
        gateway_error_rate: debouncedErrorRate,
        amount: CHECKOUT_AMOUNT,
        transaction_type: "one_time",
      })
      .then((res) => {
        if (seq !== requestSeq.current) return;
        setMethods(res.methods);
        setRecommended(res.recommended_method);
        setError(null);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to score payment methods");
      });
  }, [debouncedTraffic, debouncedLatency, debouncedErrorRate]);

  const recommendedScore = methods?.find((m) => m.method === recommended)?.score ?? null;
  const degraded = recommendedScore !== null && recommendedScore < DEGRADED_THRESHOLD;

  return (
    <section className="lp-section" id="prevention">
      <div className="lp-wrap">
        <Reveal as="p" className="lp-eyebrow">04, Before the failure</Reveal>
        <Reveal delayMs={80} className="lp-statement" style={{ maxWidth: "26ch" }}>
          What if we could see the failure <span className="gold">coming</span>?
        </Reveal>
        <Reveal delayMs={160} className="lp-lede">
          Recovery is the second half of the story. The first half is a live estimate of how
          likely a payment is to succeed, before it's attempted -- and which method gives it the
          best odds.
        </Reveal>

        <div className="grid md:grid-cols-[0.95fr_1.05fr] gap-12 items-start" style={{ marginTop: 52 }}>
          <Reveal delayMs={80}>
            <div className="lp-txn">
              <div className="p-6 pb-[18px] border-b" style={{ borderColor: "var(--lp-hairline)" }}>
                <p className="lp-mono uppercase tracking-[0.16em]" style={{ fontSize: 10.5, color: "var(--lp-muted)" }}>
                  Checkout
                </p>
                <p style={{ marginTop: 6, fontSize: 14.5, color: "var(--lp-muted)" }}>Pro Annual Plan</p>
                <p className="lp-txn__amount">₹{CHECKOUT_AMOUNT.toLocaleString("en-IN")}</p>
              </div>
              <div className="px-6 py-5">
                {error && (
                  <p style={{ fontSize: 13.5, color: "var(--lp-danger)" }}>Could not load a live score: {error}</p>
                )}
                {!error && !methods && (
                  <p style={{ fontSize: 13.5, color: "var(--lp-muted)" }}>Scoring payment methods…</p>
                )}
                {!error && methods && (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {methods.map((m) => (
                      <li
                        key={m.method}
                        className="lp-txn__row"
                        style={{ opacity: m.recommended ? 1 : 0.65 }}
                      >
                        <span style={{ color: m.recommended ? "var(--lp-ink)" : "var(--lp-muted)", fontWeight: m.recommended ? 500 : 400 }}>
                          {METHOD_LABELS[m.method]}
                          {m.recommended && <span className="lp-tag" style={{ color: "var(--lp-accent)" }}>Recommended</span>}
                        </span>
                        <span className="lp-mono">{m.score}/100</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="lp-txn__foot">
                <div>
                  <p className="lp-mono uppercase" style={{ fontSize: 10.5, color: "var(--lp-muted)" }}>
                    Best route
                  </p>
                  <p className="lp-mono font-medium" style={{ fontSize: 15, color: "var(--lp-accent)", letterSpacing: "0.02em" }}>
                    {recommended ? METHOD_LABELS[recommended] : "…"}
                  </p>
                </div>
                <button className="lp-btn lp-btn--primary" disabled aria-disabled="true" title="Demo only -- not a real checkout">
                  Pay ₹{CHECKOUT_AMOUNT.toLocaleString("en-IN")}
                </button>
              </div>
            </div>
          </Reveal>

          <Reveal delayMs={160}>
            <div className="flex flex-col items-center" style={{ gap: 8 }}>
              <SuccessScoreDial
                score={recommendedScore ?? 0}
                degraded={degraded}
                accentColor="var(--lp-accent)"
                dangerColor="var(--lp-danger)"
                trackColor="var(--lp-hairline-strong)"
                centerValueColor="var(--lp-ink)"
                centerMaxColor="var(--lp-muted)"
              />
              <p className="lp-mono uppercase" style={{ fontSize: 10.5, color: "var(--lp-muted)", letterSpacing: "0.14em" }}>
                Payment success score
              </p>
              {degraded && (
                <p style={{ fontSize: 13.5, color: "var(--lp-danger)", textAlign: "center", maxWidth: "32ch" }}>
                  Conditions have degraded. This estimate is now well below a healthy baseline.
                </p>
              )}
            </div>

            <div style={{ marginTop: 36 }}>
              <p className="lp-mono uppercase" style={{ fontSize: 10.5, color: "var(--lp-muted)", letterSpacing: "0.14em", marginBottom: 18 }}>
                Simulate conditions
              </p>

              <PSSSlider
                label="Traffic load"
                valueLabel={`${trafficLoadIndex.toFixed(1)}× normal`}
                min={0.5}
                max={2.2}
                step={0.1}
                value={trafficLoadIndex}
                onChange={setTrafficLoadIndex}
              />
              <PSSSlider
                label="Gateway latency"
                valueLabel={`${Math.round(gatewayLatencyMs)}ms`}
                min={80}
                max={500}
                step={10}
                value={gatewayLatencyMs}
                onChange={setGatewayLatencyMs}
              />
              <PSSSlider
                label="Gateway failure rate"
                valueLabel={`${(gatewayErrorRate * 100).toFixed(1)}%`}
                min={0}
                max={0.3}
                step={0.01}
                value={gatewayErrorRate}
                onChange={setGatewayErrorRate}
              />
            </div>
          </Reveal>
        </div>

        <Reveal delayMs={80} className="lp-caption" style={{ marginTop: 36 }}>
          Offline / simulator-based, same as every other number on this page: a synthetic
          model estimating from synthetic conditions, not a live gateway signal, and it never
          executes a real payment routing decision.
        </Reveal>

        <Reveal delayMs={160} className="lp-lede" style={{ marginTop: 28 }}>
          {degraded
            ? "But prediction isn't prevention. Push conditions far enough and a payment still fails, which is exactly where Recovery Value Engine picks up."
            : "But prediction isn't prevention. Even a healthy score doesn't guarantee success. When a payment fails anyway, Recovery Value Engine picks up from there."}
        </Reveal>
      </div>
    </section>
  );
}

function PSSSlider({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="pss-slider">
      <div className="pss-slider__head">
        <span>{label}</span>
        <span className="lp-mono" style={{ color: "var(--lp-accent)" }}>{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}
