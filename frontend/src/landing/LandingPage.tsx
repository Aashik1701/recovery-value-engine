import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ParticleField } from "./ParticleField";
import { FooterArcCanvas } from "./FooterArcCanvas";
import { PaymentSuccessSection } from "./PaymentSuccessSection";
import { Reveal } from "./Reveal";
import { ThemeToggle } from "../components/ThemeToggle";
import { StatValue } from "./StatValue";
import { TiltCard } from "./TiltCard";
import { BUTTON_MOTION, MotionLink } from "./motion-components";
import "./landing-tokens.css";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function useLenis() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let cancelled = false;
    // Lenis attaches its own wheel/touch listeners to the window and calls
    // preventDefault() on them for as long as the instance is alive -- it
    // does NOT stop intercepting scroll input just because its rAF loop is
    // cancelled. Since this is a client-side (HashRouter) route, navigating
    // away from the landing page unmounts this component without a full
    // page reload; without calling lenis.destroy() here, the instance (and
    // its global event listeners) leaked forever, silently blocking mouse
    // wheel/trackpad scrolling on every other page for the rest of the
    // session -- the loop being cancelled just meant scroll position never
    // updated in response to the (still swallowed) wheel events.
    let lenisInstance: { destroy: () => void; raf: (time: number) => void } | undefined;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      const lenis = new Lenis({ duration: 1.05, smoothWheel: true });
      lenisInstance = lenis;
      const loop = (time: number) => {
        lenis.raf(time);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      (window as unknown as { __lenis?: unknown }).__lenis = lenis;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      lenisInstance?.destroy();
      delete (window as unknown as { __lenis?: unknown }).__lenis;
    };
  }, []);
}

function useScrolledNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

/** How far down the page you are, 0-1. Drives the progress bar under the nav, a quiet reinforcement that this is one continuous argument, not a stack of unrelated sections. */
function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(window.scrollY / max, 1) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return progress;
}

export function LandingPage() {
  useLenis();
  const navScrolled = useScrolledNav();
  const scrollProgress = useScrollProgress();

  return (
    <div className="landing-page">
      <ParticleField />

      <div
        className="fixed top-0 left-0 h-[2px] z-[60]"
        style={{
          width: `${scrollProgress * 100}%`,
          background: "var(--lp-accent)",
          transition: "width 0.1s linear",
        }}
        aria-hidden="true"
      />

      <nav className={`lp-nav ${navScrolled ? "is-scrolled" : ""}`}>
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="flex items-center gap-2.5 no-underline"
          style={{ color: "var(--lp-ink)", fontFamily: "var(--lp-font-display)", fontWeight: 600, fontSize: 15 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="22" height="22" rx="3" stroke="var(--lp-noise)" strokeWidth="1.4" />
            <path d="M5 16.5 L9.5 11 L13.5 14 L19 6.5" stroke="var(--lp-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Recovery Value Engine
        </a>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6">
            <button className="lp-nav__link" onClick={() => scrollToId("problem")}>Problem</button>
            <button className="lp-nav__link" onClick={() => scrollToId("decision")}>Decision</button>
            <button className="lp-nav__link" onClick={() => scrollToId("guardrails")}>Guardrails</button>
            <button className="lp-nav__link" onClick={() => scrollToId("evaluation")}>Evidence</button>
          </div>
          <ThemeToggle style={{ color: "var(--lp-muted)" }} />
          <MotionLink to="/dashboard" className="lp-btn lp-btn--primary" {...BUTTON_MOTION}>Open dashboard →</MotionLink>
        </div>
      </nav>

      <div className="relative z-[2]" id="top">
        {/* ===================================================== HERO === */}
        <header className="min-h-[100svh] flex items-center pt-36 pb-24">
          <div className="lp-wrap grid md:grid-cols-[1.05fr_0.95fr] gap-16 items-center">
            <div>
              <Reveal as="p" className="lp-eyebrow">AI Revenue Recovery · Razorpay AI Buildathon · Track 3</Reveal>
              <Reveal as="h2" delayMs={80} className="lp-h1">Every failed payment is not lost revenue.</Reveal>

              <Reveal delayMs={160} className="lp-hero-q mt-8">
                When a payment fails, most systems ask:
                <strong>“How do we retry it?”</strong>
              </Reveal>
              <Reveal delayMs={240} className="lp-hero-q lp-hero-q--live mt-4">
                Recovery Value Engine asks a harder one:
                <strong>“Is this worth recovering, and what is the smartest action?”</strong>
              </Reveal>

              <Reveal delayMs={320} className="flex flex-wrap gap-3.5 mt-10">
                <MotionLink to="/dashboard" className="lp-btn lp-btn--primary lp-btn--lg" {...BUTTON_MOTION}>
                  Explore the engine →
                </MotionLink>
                <motion.button
                  className="lp-btn lp-btn--ghost lp-btn--lg"
                  onClick={() => scrollToId("problem")}
                  {...BUTTON_MOTION}
                >
                  See how it decides ↓
                </motion.button>
              </Reveal>

              <Reveal delayMs={320} className="lp-mono mt-8 text-[12.5px]" style={{ color: "var(--lp-muted)" }}>
                One failed payment. Seven possible actions. One economically optimal decision.
              </Reveal>
            </div>

            {/* A real decision captured from a running batch (not a live fetch --
                this card is static content, same numbers as the "05, one payment,
                seven actions" section below, which quotes the same payment_id). */}
            <Reveal delayMs={160}>
            <TiltCard className="lp-txn">
              <div className="p-6 pb-[18px] border-b" style={{ borderColor: "var(--lp-hairline)" }}>
                <p className="lp-mono uppercase tracking-[0.16em]" style={{ fontSize: 10.5, color: "var(--lp-muted)" }}>
                  Revenue at risk
                </p>
                <p className="lp-txn__amount">₹26,269.61</p>
                <p className="mt-3 text-sm" style={{ color: "var(--lp-muted)" }}>
                  <span style={{ color: "var(--lp-danger)", fontWeight: 500 }}>Payment failed</span> · card expired · one-time
                </p>
              </div>
              <div className="px-6">
                <div className="lp-txn__row">
                  <span style={{ color: "var(--lp-muted)" }}>Recovery probability</span>
                  <span className="lp-mono">37.7%</span>
                </div>
                <div className="lp-txn__row">
                  <span style={{ color: "var(--lp-muted)" }}>Intervention cost</span>
                  <span className="lp-mono">₹15.00</span>
                </div>
                <div className="lp-txn__row">
                  <span style={{ color: "var(--lp-muted)" }}>Rule-based heuristic would pick</span>
                  <span className="lp-mono" style={{ color: "var(--lp-muted)" }}>Email · ₹6,547</span>
                </div>
              </div>
              <div className="lp-txn__foot">
                <div>
                  <p className="lp-mono uppercase" style={{ fontSize: 10.5, color: "var(--lp-muted)" }}>Chosen action</p>
                  <p className="lp-mono font-medium" style={{ fontSize: 15, color: "var(--lp-accent)", letterSpacing: "0.02em" }}>VOICE CALL</p>
                </div>
                <div className="lp-mono text-right" style={{ fontSize: 13, color: "var(--lp-muted)" }}>
                  expected net value
                  <b className="block" style={{ fontSize: 17, color: "var(--lp-accent)", fontWeight: 500 }}>₹9,884.33</b>
                </div>
              </div>
            </TiltCard>
            </Reveal>
          </div>
        </header>

        {/* =================================================== PROBLEM === */}
        <section className="lp-section" id="problem">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">01, The problem</Reveal>
            <Reveal delayMs={80} className="lp-statement" style={{ maxWidth: "24ch" }}>
              Revenue doesn’t disappear all at once. <span className="dim">It leaks.</span>
            </Reveal>
            <Reveal delayMs={160} className="lp-lede">
              A payment failure is not a diagnosis. It is one status code covering completely
              different realities, and a system that treats every <code>payment.failed</code>{" "}
              event the same is leaving both money and customers on the table.
            </Reveal>

            <div className="grid md:grid-cols-3 gap-5 mt-13" style={{ marginTop: 52 }}>
              <Reveal className="lp-card">
                <p className="lp-card__n">TECHNICAL</p>
                <h3 className="lp-h3 mb-2">The rails failed</h3>
                <p>Bank timeout. Network error. The customer’s intent was never in question, the infrastructure was.</p>
              </Reveal>
              <Reveal delayMs={80} className="lp-card">
                <p className="lp-card__n">INSTRUMENT</p>
                <h3 className="lp-h3 mb-2">The method failed</h3>
                <p>An expired card is a channel problem, not an intent problem. Retrying the same card cannot fix it.</p>
              </Reveal>
              <Reveal delayMs={160} className="lp-card">
                <p className="lp-card__n">CUSTOMER</p>
                <h3 className="lp-h3 mb-2">The account failed</h3>
                <p>Insufficient funds is a timing problem. The same retry an hour later and a week later are different bets.</p>
              </Reveal>
            </div>

            <Reveal className="lp-statement" style={{ marginTop: 72, maxWidth: "24ch" }}>
              The problem isn’t detecting failure.{" "}
              <span className="gold">It’s deciding what happens next.</span>
            </Reveal>
          </div>
        </section>

        {/* ================================================= PRIOR ART === */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">02, What already exists</Reveal>
            <Reveal delayMs={80} className="lp-h2">Recovery isn’t a new idea.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Razorpay’s Agent Studio already ships a Subscription Recovery Agent, an Abandoned
              Cart Conversion Agent and a Dispute Responder. They detect a failure and send a
              nudge, and they do it well.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-5" style={{ marginTop: 52 }}>
              <Reveal className="lp-card lp-card--flat">
                <p className="lp-card__n">ALREADY SHIPPED</p>
                <p>
                  Detect failed payments · retry intelligently · generate payment links ·
                  recover abandoned carts · recover subscriptions · reach customers across
                  channels · enforce merchant controls.
                </p>
              </Reveal>
              <Reveal delayMs={80} className="lp-card lp-card--flat">
                <p className="lp-card__n">STILL UNANSWERED</p>
                <p>
                  Whether a given failed payment is worth pursuing at all, and which of the
                  available actions returns the most value net of what it costs to run.
                </p>
              </Reveal>
            </div>

            <Reveal className="lp-statement" style={{ marginTop: 72 }}>
              So we didn’t build another recovery bot.
            </Reveal>
          </div>
        </section>

        {/* ===================================================== GAP ==== */}
        <section className="lp-section" id="decision">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">03, The gap</Reveal>
            <Reveal delayMs={80} className="lp-statement" style={{ maxWidth: "26ch" }}>
              <span className="dim">Existing recovery asks: can we recover this?</span>
              <br />
              We ask <span className="gold">should we</span>, and <span className="gold">with what</span>.
            </Reveal>
            <Reveal delayMs={160} className="lp-lede">
              That turns recovery from a notification problem into a decision problem, and a
              decision problem has a correct answer you can compute, audit and be wrong about
              in a traceable way.
            </Reveal>

            <div className="grid md:grid-cols-4 gap-5" style={{ marginTop: 52 }}>
              {[
                ["01", "What happened", "Failure reason, amount, transaction type, retries already spent."],
                ["02", "Can we recover it", "A trained model estimates P(recovery) for every available action."],
                ["03", "Is it worth it", "Expected value nets the recovered revenue against what the action costs."],
                ["04", "When to stop", "Guardrails remove actions that aren’t permitted before anything is chosen."],
              ].map(([n, title, body], i) => (
                <Reveal key={n} delayMs={i * 80} className="lp-card">
                  <p className="lp-card__n">{n}</p>
                  <h3 className="lp-h3 mb-2">{title}</h3>
                  <p>{body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ============================================== PREVENTION ==== */}
        <PaymentSuccessSection />

        {/* ================================================ ECONOMICS ==== */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">05, The economics</Reveal>
            <Reveal delayMs={80} className="lp-h2">Recovery isn’t free.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Every intervention has a price, and the cheapest action is rarely the best one -
              but the most aggressive action is rarely the best one either. The engine prices
              all seven and picks the argmax.
            </Reveal>

            <Reveal delayMs={160} className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Intervention</th>
                    <th className="lp-num">Unit cost</th>
                    <th>Involves contacting the customer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>No action</td><td className="lp-num">₹0</td><td style={{ color: "var(--lp-muted)" }}>No</td></tr>
                  <tr><td>Retry later</td><td className="lp-num">₹1</td><td style={{ color: "var(--lp-muted)" }}>No</td></tr>
                  <tr><td>Email</td><td className="lp-num">₹1</td><td>Yes</td></tr>
                  <tr><td>Retry now</td><td className="lp-num">₹2</td><td style={{ color: "var(--lp-muted)" }}>No</td></tr>
                  <tr><td>SMS payment link</td><td className="lp-num">₹3</td><td>Yes</td></tr>
                  <tr><td>WhatsApp nudge</td><td className="lp-num">₹5</td><td>Yes</td></tr>
                  <tr><td>Voice call</td><td className="lp-num">₹15</td><td>Yes</td></tr>
                </tbody>
              </table>
            </Reveal>
            <p className="lp-caption">
              Expected value per action: <code>EV(a) = P(recovery | context, a) × amount − cost(a)</code>.
              Plain arithmetic on a calibrated probability, auditable, reproducible, no model
              in the loop at the point money is decided.
            </p>

            <Reveal className="lp-statement" style={{ marginTop: 72 }}>
              The smartest recovery action <span className="gold">can be no action.</span>
            </Reveal>
          </div>
        </section>

        {/* ==================================================== MATRIX === */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">06, One payment, seven actions</Reveal>
            <Reveal delayMs={80} className="lp-h2">The engine prices every alternative.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              This is the real breakdown for <code>pay_06faed414893</code>, the ₹26,269.61
              card-expired payment from the hero, exactly as the running system scored it.
            </Reveal>

            <Reveal delayMs={160} className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Intervention</th>
                    <th className="lp-num">P(recovery)</th>
                    <th className="lp-num">Cost</th>
                    <th className="lp-num">Expected value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="is-winner">
                    <td>Voice call</td><td className="lp-num">37.68%</td><td className="lp-num">₹15</td>
                    <td className="lp-num">₹9,884.33</td><td>Chosen<span className="lp-tag">argmax EV</span></td>
                  </tr>
                  <tr><td>WhatsApp nudge</td><td className="lp-num">32.27%</td><td className="lp-num">₹5</td><td className="lp-num">₹8,472.53</td><td style={{ color: "var(--lp-muted)" }}>Lower EV</td></tr>
                  <tr><td>SMS payment link</td><td className="lp-num">30.68%</td><td className="lp-num">₹3</td><td className="lp-num">₹8,057.11</td><td style={{ color: "var(--lp-muted)" }}>Lower EV</td></tr>
                  <tr><td>Email</td><td className="lp-num">24.93%</td><td className="lp-num">₹1</td><td className="lp-num">₹6,547.32</td><td style={{ color: "var(--lp-muted)" }}>Lower EV</td></tr>
                  <tr><td>Retry later</td><td className="lp-num">14.52%</td><td className="lp-num">₹1</td><td className="lp-num">₹3,813.86</td><td style={{ color: "var(--lp-muted)" }}>Lower EV</td></tr>
                  <tr><td>Retry now</td><td className="lp-num">13.18%</td><td className="lp-num">₹2</td><td className="lp-num">₹3,459.18</td><td style={{ color: "var(--lp-muted)" }}>Lower EV</td></tr>
                  <tr><td>No action</td><td className="lp-num">13.09%</td><td className="lp-num">₹0</td><td className="lp-num">₹3,439.38</td><td style={{ color: "var(--lp-muted)" }}>Lower EV</td></tr>
                </tbody>
              </table>
            </Reveal>
            <p className="lp-caption">
              A hand-coded heuristic has no special case for <code>card_expired</code> and falls
              through to a generic email, ₹6,547. The engine reads the same failure as a channel
              problem worth a real conversation and picks the voice call:{" "}
              <strong style={{ color: "var(--lp-ink)" }}>₹3,337 more in expected value on this
              one payment</strong>, because the ₹15 buys uplift the ₹1 cannot.
            </p>
          </div>
        </section>

        {/* =================================================== CONTEXT === */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">07, Context</Reveal>
            <Reveal delayMs={80} className="lp-statement">
              Same failure. <span className="gold">Different decision.</span>
            </Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Two payments can carry an identical status code and deserve opposite treatment.
              The model learns P(recovery | context, action), so the amount, the customer’s
              historical success rate, their lifetime value and how many retries have already
              been spent all move the answer.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-5" style={{ marginTop: 52 }}>
              <Reveal className="lp-card">
                <p className="lp-card__n">FEATURES THE MODEL SEES</p>
                <p>
                  Failure reason · transaction type · amount · retries so far · customer’s past
                  success rate · customer lifetime value · and the candidate intervention itself.
                </p>
              </Reveal>
              <Reveal delayMs={80} className="lp-card">
                <p className="lp-card__n">WHY THAT LAST ONE MATTERS</p>
                <p>
                  Because the intervention is a feature, one model answers “what would happen if
                  we did <em>this</em> instead” for all seven actions, not just the one that
                  happened to be tried.
                </p>
              </Reveal>
            </div>

            <p className="lp-caption" style={{ marginTop: 32 }}>
              Training data comes from a logged randomised trial: interventions were assigned
              uniformly at random, never by a policy. Without that, the model would learn who we
              already chose to contact rather than what contacting them does.
            </p>
          </div>
        </section>

        {/* ================================================== PIPELINE === */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">08, The decision pipeline</Reveal>
            <Reveal delayMs={80} className="lp-h2">From failure to action.</Reveal>

            <div className="mt-13" style={{ marginTop: 52 }}>
              {[
                ["STEP 01", "Payment fails", "Amount, failure reason, transaction type, retry count."],
                ["STEP 02", "Join customer context", "Lifetime value and historical success rate for the customer on this payment."],
                ["STEP 03", "Predict recovery probability", "P(recovery | context, action) for all seven interventions in one pass."],
                ["STEP 04", "Compute expected value", "EV = P × amount − cost. Deterministic arithmetic, no model involved."],
                ["STEP 05", "Apply guardrails", "Ineligible actions are removed from the menu before anything is selected."],
                ["STEP 06", "Select argmax", "Highest EV among what survived. Ties break deterministically."],
                ["STEP 07", "Execute", "For the payment-link action, a real Razorpay test-mode Payment Links API call."],
                ["STEP 08", "Explain", "One LLM call turns the decided numbers into an operator-readable rationale."],
                ["STEP 09", "Record", "Every EV considered, every guardrail block and its reason, written to the audit log."],
              ].map(([n, title, body]) => (
                <Reveal key={n} className="lp-step">
                  <div className="lp-step__n">{n}</div>
                  <div>
                    <h3 className="lp-h3">{title}</h3>
                    <p className="mt-1.5 text-[14.5px]" style={{ color: "var(--lp-muted)" }}>{body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* =================================================== WHERE AI == */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">09, Where AI actually belongs</Reveal>
            <Reveal delayMs={80} className="lp-h2">We didn’t put a language model in the money path.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              A decision that shapes who gets contacted, how often, and through which channel has
              to be reproducible and traceable to a number. If a customer complains, the answer
              must be a log lookup, not a shrug at a black box.
            </Reveal>

            <div className="grid md:grid-cols-4 gap-5" style={{ marginTop: 52 }}>
              {[
                ["GRADIENT BOOSTING", "Predicts", "Recovery probability per action. Calibrated, held-out tested, swappable."],
                ["PLAIN PYTHON", "Decides", "EV arithmetic and argmax. Same inputs, same output, every single time."],
                ["DETERMINISTIC RULES", "Controls", "Guardrails filter the menu first. Nothing ineligible can ever be selected."],
                ["LLM · ONE CALL", "Explains", "Turns a decision already made into a sentence a human can read. Nothing more."],
              ].map(([n, title, body], i) => (
                <Reveal key={n} delayMs={i * 80} className="lp-card">
                  <p className="lp-card__n">{n}</p>
                  <h3 className="lp-h3 mb-2">{title}</h3>
                  <p>{body}</p>
                </Reveal>
              ))}
            </div>

            <Reveal className="lp-statement" style={{ marginTop: 72, maxWidth: "26ch" }}>
              <span className="dim">A model can explain a decision.</span> It shouldn’t have
              unrestricted authority to move money.
            </Reveal>
          </div>
        </section>

        {/* ================================================= GUARDRAILS == */}
        <section className="lp-section" id="guardrails">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">10, Guardrails</Reveal>
            <Reveal delayMs={80} className="lp-statement">
              Recommendation <span className="dim">≠</span> <span className="gold">authorization.</span>
            </Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Guardrails run before the optimizer, not after it. An ineligible intervention is
              never a candidate, no matter how high its expected value would have been.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-5" style={{ marginTop: 52 }}>
              {[
                ["VOICE-CALL THRESHOLD", "A ₹15 call only pays for itself above ₹5,000. Below that it is removed from the menu, and the audit log records why."],
                ["CONTACT-FREQUENCY CAP", "At most two contact-based interventions per customer per failed payment. Past the cap, only non-contact actions remain eligible."],
                ["SUPPRESSION LIST", "Opted-out customers are never contacted. Only no_action and retry_now, which touch no channel, stay available."],
                ["NO DARK PATTERNS", "Generated explanations are scanned for false urgency and confirm-shaming, and fall back to a deterministic template if flagged. A phrase list is a safeguard, not a guarantee, and we say so."],
              ].map(([n, body], i) => (
                <Reveal key={n} delayMs={i * 80} className="lp-card">
                  <p className="lp-card__n">{n}</p>
                  <p>{body}</p>
                </Reveal>
              ))}
            </div>

            <Reveal className="lp-statement" style={{ marginTop: 72 }}>
              A good recovery agent <span className="gold">knows when not to act.</span>
            </Reveal>
          </div>
        </section>

        {/* =================================================== FAILURE === */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">11, Failure is part of the product</Reveal>
            <Reveal delayMs={80} className="lp-h2">What broke, and what we did about it.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              The contact-frequency cap was implemented correctly and unit-tested. It passed. Then
              we wrote a test that called the live API three times against the same payment, and
              the cap never fired.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-5" style={{ marginTop: 52 }}>
              <Reveal className="lp-card">
                <p className="lp-card__n">THE BUG</p>
                <p>
                  The guardrail was never wired to real state. The API always passed a prior-contact
                  count of zero, so the cap could not trigger in production no matter how many times
                  a customer had actually been contacted.
                </p>
              </Reveal>
              <Reveal delayMs={80} className="lp-card">
                <p className="lp-card__n">THE FIX</p>
                <p>
                  The count is now derived from the audit log itself. The regression test asserts the
                  third contact attempt falls back to a non-contact action, and it does.
                </p>
              </Reveal>
            </div>

            <p className="lp-caption" style={{ marginTop: 32 }}>
              Two more failure scenarios are covered by tests that pass today: an external API
              timeout during explanation or payment-link generation degrades to a documented
              fallback instead of breaking the pipeline, and an unresolvable payment or orphaned
              customer record returns a clean 404 rather than an unhandled exception.
            </p>

            <Reveal className="lp-statement" style={{ marginTop: 72, maxWidth: "26ch" }}>
              A guardrail that’s correct in isolation but never connected{" "}
              <span className="gold">isn’t a guardrail.</span>
            </Reveal>
          </div>
        </section>

        {/* ==================================================== AUDIT === */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">12, The audit trail</Reveal>
            <Reveal delayMs={80} className="lp-h2">Every decision leaves evidence.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              The log stores every expected value considered, not just the winner, plus which
              actions were blocked and by which rule. That is what makes the “why not this action?”
              view possible at zero extra computation.
            </Reveal>

            <Reveal delayMs={160} className="lp-ledger">
              {[
                ["step 01", "Payment failed · ₹26,269.61 · card_expired", false],
                ["step 02", "Customer context joined · LTV, past success rate", false],
                ["step 03", "Seven recovery probabilities predicted", false],
                ["step 04", "Seven expected values computed", false],
                ["step 05", "Guardrails applied · voice call eligible above ₹5,000", false],
                ["step 06", "Voice call selected · EV ₹9,884.33", true],
                ["step 07", "Explanation generated and scanned for dark patterns", false],
                ["step 08", "Full decision written to audit log · 7 EVs, 0 blocked", true],
              ].map(([t, s, key]) => (
                <li key={t as string} className={key ? "is-key" : ""}>
                  <time>{t}</time>
                  <span>{s}</span>
                </li>
              ))}
            </Reveal>

            <Reveal className="lp-statement" style={{ marginTop: 72 }}>
              Every action has a reason. <span className="gold">Every reason has evidence.</span>
            </Reveal>
          </div>
        </section>

        {/* ================================================= EVALUATION == */}
        <section className="lp-section" id="evaluation">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">13, The evidence</Reveal>
            <Reveal delayMs={80} className="lp-h2">One decision proves nothing. So we ran the batch.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Four policies, the same held-out batch of 500 synthetic failed payments, scored
              against ground truth that only the evaluation harness can see. The model and the
              optimizer never touch it.
            </Reveal>

            <Reveal delayMs={160} className="lp-table-wrap">
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th className="lp-num">Revenue recovered</th>
                    <th className="lp-num">Intervention cost</th>
                    <th className="lp-num">Net revenue</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Always do nothing</td><td className="lp-num">₹1,95,118.87</td><td className="lp-num">₹0</td><td className="lp-num">₹1,95,118.87</td></tr>
                  <tr><td>Always retry now</td><td className="lp-num">₹2,95,779.89</td><td className="lp-num">₹1,000</td><td className="lp-num">₹2,94,779.89</td></tr>
                  <tr><td>Rule-based heuristic</td><td className="lp-num">₹3,47,639.31</td><td className="lp-num">₹762</td><td className="lp-num">₹3,46,877.31</td></tr>
                  <tr className="is-winner">
                    <td>EV-optimized policy<span className="lp-tag">this project</span></td>
                    <td className="lp-num">₹3,85,106.16</td><td className="lp-num">₹1,655</td><td className="lp-num">₹3,83,451.16</td>
                  </tr>
                </tbody>
              </table>
            </Reveal>
            <p className="lp-caption">
              Beating “always retry” is the easy bar. The rule-based heuristic, transient failures
              retry, insufficient funds retries later, repeat failures get a link, everything else
              gets an email, is what a competent merchant would actually hand-code without any of
              this. That is the number worth beating.
            </p>

            <div className="grid md:grid-cols-3 gap-5" style={{ marginTop: 56 }}>
              <Reveal className="lp-card">
                <StatValue
                  target={5}
                  format={(n) => `${Math.round(n)} / 5`}
                  style={{ color: "var(--lp-accent)" }}
                />
                <span className="lp-stat__label">Independent seeds where the EV-optimized policy beat the rule-based heuristic. One seed is a coincidence waiting to happen, so we reran the entire pipeline five times.</span>
              </Reveal>
              <Reveal delayMs={80} className="lp-card">
                <StatValue target={97.4} format={(n) => `+${n.toFixed(1)}%`} />
                <span className="lp-stat__label">Gain on card-expired failures, where a fixed rule has no special case and defaults to email. This is where the model earns its place.</span>
              </Reveal>
              <Reveal delayMs={160} className="lp-card">
                <StatValue
                  target={-0.1}
                  format={(n) => `${n.toFixed(1)}%`}
                  style={{ color: "var(--lp-muted)" }}
                />
                <span className="lp-stat__label">On bank timeouts, where the heuristic already picks the right cheap move. We report this too, the model does not help everywhere.</span>
              </Reveal>
            </div>

            <Reveal className="lp-statement" style={{ marginTop: 72, maxWidth: "26ch" }}>
              The model doesn’t help everywhere. It helps{" "}
              <span className="gold">exactly where a fixed rule can’t adapt.</span>
            </Reveal>
          </div>
        </section>

        {/* =================================================== HONESTY === */}
        <section className="lp-section lp-section--tight">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow" style={{ color: "var(--lp-muted)" }}>14, What these numbers are not</Reveal>
            <Reveal delayMs={80} className="lp-h2">This is an offline evaluation, not a live A/B test.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Every figure on this page comes from code that ran against a seeded synthetic
              simulator. Because that ground truth is known exactly, expected value is computed
              analytically rather than sampled, a simplification only available because the data
              is synthetic.
            </Reveal>
            <Reveal delayMs={160} className="lp-body">
              A real deployment would need a live randomised rollout or proper off-policy
              evaluation against logged production traffic. We don’t have Razorpay’s production
              data and we don’t pretend otherwise. The recovery-probability model’s own quality -{" "}
              <strong>AUC 0.680</strong> on a held-out slice of 6,000 rows from 30,000 training
              examples, is a standard supervised-learning claim and carries no such caveat. It’s a
              moderate score, not a strong one, and we report it as such.
            </Reveal>

            <Reveal className="lp-statement" style={{ marginTop: 64 }}>
              Honest evidence beats <span className="dim">inflated metrics.</span>
            </Reveal>
          </div>
        </section>

        {/* ================================================ EXPLAIN VIEW = */}
        <section className="lp-section">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">15, The operator’s view</Reveal>
            <Reveal delayMs={80} className="lp-h2">Don’t give operators another dashboard. Give them a decision queue.</Reveal>
            <Reveal delayMs={160} className="lp-lede">
              Every row is a decision already made, and every decision opens into the reasoning
              behind it, including what lost, and why.
            </Reveal>

            <div className="grid md:grid-cols-2 gap-5" style={{ marginTop: 48 }}>
              <Reveal className="lp-card">
                <p className="lp-card__n">WHY THIS ACTION</p>
                <ul className="lp-reasons lp-reasons--yes">
                  <li>Highest expected value among eligible actions<small>₹9,884.33 · next best ₹8,472.53</small></li>
                  <li>Amount clears the voice-call threshold<small>₹26,269.61 ≥ ₹5,000</small></li>
                  <li>Customer is not on the suppression list</li>
                  <li>No prior contacts recorded for this payment</li>
                </ul>
              </Reveal>
              <Reveal delayMs={80} className="lp-card">
                <p className="lp-card__n">WHY NOT THE ALTERNATIVES</p>
                <ul className="lp-reasons lp-reasons--no">
                  <li>WhatsApp nudge<small>Rejected, ₹8,472.53 vs ₹9,884.33 for the chosen action</small></li>
                  <li>Email<small>Rejected, ₹6,547.32, the cheap channel doesn’t buy enough uplift here</small></li>
                  <li>Retry now<small>Rejected, ₹3,459.18, an expired card won’t clear on a retry</small></li>
                  <li>No action<small>Rejected, leaves ₹6,444.95 of expected value unrecovered</small></li>
                </ul>
              </Reveal>
            </div>

            <p className="lp-caption">
              This panel is read straight from the audit record. Nothing here is recomputed for
              display, which means the explanation and the decision can never drift apart.
            </p>
          </div>
        </section>

        {/* ===================================================== SCOPE === */}
        <section className="lp-section lp-section--tight">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow" style={{ color: "var(--lp-muted)" }}>16, Scope</Reveal>
            <Reveal delayMs={80} className="lp-h2">What we deliberately did not build.</Reveal>
            <div className="grid md:grid-cols-2 gap-5" style={{ marginTop: 32 }}>
              <Reveal className="lp-card lp-card--flat">
                <p className="lp-card__n">OUT OF SCOPE, ON PURPOSE</p>
                <p>
                  Pre-failure prediction. Live WhatsApp, email and voice sending, those
                  interventions are decided and logged, not delivered. True live A/B measurement.
                  Discount and incentive interventions.
                </p>
              </Reveal>
              <Reveal delayMs={80} className="lp-card lp-card--flat">
                <p className="lp-card__n">WHAT IS ACTUALLY LIVE</p>
                <p>
                  The SMS payment-link action calls Razorpay’s real test-mode Payment Links API and
                  returns a genuine link. It’s the one place this system touches an external money
                  surface, and it’s wired end to end.
                </p>
              </Reveal>
            </div>
            <p className="lp-caption" style={{ marginTop: 28 }}>
              Listing the edges deliberately is cheaper than letting a reviewer discover them.
            </p>
          </div>
        </section>

        {/* ===================================================== CLOSE === */}
        <section className="lp-section lp-close">
          <div className="lp-wrap">
            <Reveal as="p" className="lp-eyebrow">Recovery Value Engine</Reveal>
            <Reveal delayMs={80} className="lp-statement" style={{ maxWidth: "20ch" }}>
              Don’t just recover payments. <span className="gold">Recover value.</span>
            </Reveal>
            <Reveal delayMs={160} className="lp-lede">
              A decision engine for already-failed payments: calibrated probability, explicit
              economics, deterministic guardrails, and an audit trail that can answer for every
              call it made.
            </Reveal>

            <Reveal delayMs={240} className="flex gap-3.5 justify-center flex-wrap mt-11">
              <MotionLink to="/dashboard" className="lp-btn lp-btn--primary lp-btn--lg" {...BUTTON_MOTION}>
                Open the dashboard →
              </MotionLink>
              <MotionLink
                to="/dashboard/policy-comparison"
                className="lp-btn lp-btn--ghost lp-btn--lg"
                {...BUTTON_MOTION}
              >
                See the evaluation
              </MotionLink>
            </Reveal>

            <div className="grid md:grid-cols-3 gap-5 text-left" style={{ marginTop: 72 }}>
              <Reveal className="lp-card">
                <p className="lp-card__n">VALUE</p>
                <p>Recover what is worth recovering, and leave the rest alone.</p>
              </Reveal>
              <Reveal delayMs={80} className="lp-card">
                <p className="lp-card__n">JUDGMENT</p>
                <p>Classical code where the money is. A language model only where language is.</p>
              </Reveal>
              <Reveal delayMs={160} className="lp-card">
                <p className="lp-card__n">TRUST</p>
                <p>Bounded, explainable, measured against a baseline that could beat it.</p>
              </Reveal>
            </div>
          </div>
        </section>

        <footer className="lp-footer">
          <FooterArcCanvas />
          <div className="lp-wrap">
            <div className="flex justify-between gap-8 flex-wrap">
              <div>
                <strong style={{ color: "var(--lp-ink)" }}>Recovery Value Engine</strong>
                <br />
                AI Revenue Recovery · Razorpay AI Buildathon · Track 3
              </div>
              <div>
                <Link to="/dashboard">Decision queue</Link> · <Link to="/dashboard/policy-comparison">Policy comparison</Link> ·{" "}
                <Link to="/dashboard/metrics">Model metrics</Link>
              </div>
            </div>
            <p className="mt-9 pt-6 border-t max-w-[70ch]" style={{ borderColor: "var(--lp-hairline)", color: "var(--lp-ink)", fontSize: 15 }}>
              AI should not decide everything. It should decide what it is good at, and know
              when to stop.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
