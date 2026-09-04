# Optimal Recovery Timing — Preview Demo (NOT the full feature)

> Prompt for Claude Code. Read this whole file first.
> This is a demo/preview layer, explicitly and honestly labeled as such. It does not touch the live decision path, the optimizer, evaluator.py, Recovery Lab, or any pinned number. If any step below would require touching those, stop and flag it rather than proceeding.

---

## 1. What this is, and why it's scoped this way

The missing-features report ranked Optimal Recovery Timing as the #1 highest-leverage addition — extending `EV(action)` to `EV(action, timing)`. Fully implemented, that requires a new timing-conditioned training dataset (randomized timing-bucket exploration, the same pattern `training_logs` uses for interventions), a trained timing-probability model, integration into the live optimizer, and a full re-pin. That's genuinely days of work.

What we're building instead: a **transparently-labeled preview** that demonstrates the *reasoning shape* — action × timing as a joint decision, "why tomorrow, not now" as an explanation — using domain-informed heuristic curves instead of a fitted model. This is not a lesser version of the real feature pretending to be the real thing. It's explicitly the next roadmap item, made tangible.

**The three-decision framing to carry through the whole build** (from the source analysis): every recovery decision actually has three questions — *whether* to recover at all (already exists), *what* action to take (already exists), and *when* to take it (this feature, preview only). Keep these visually and conceptually separate in the UI — don't collapse them into one opaque recommendation.

---

## 2. The heuristic curves — use these exact values, don't invent new ones

Illustrative recovery-probability-by-timing-bucket, by `failure_reason`. These are domain-informed placeholders, not fitted — say so everywhere they appear.

| failure_reason | now | +30min | +2h | +6h | tomorrow AM | tomorrow PM |
|---|---|---|---|---|---|---|
| `insufficient_funds` | 12% | 14% | 18% | 25% | 45% | 55% |
| `bank_timeout` | 70% | 65% | 55% | 45% | 35% | 30% |
| `network_error` | 68% | 63% | 52% | 42% | 32% | 28% |
| `card_expired` | 2% | 2% | 2% | 2% | 2% | 2% |
| `fraud_block` | — excluded entirely, see below | | | | | |
| `other` | 30% | 30% | 28% | 26% | 24% | 22% |

Two things this table is deliberately encoding, and the demo should make both visible:

- **`insufficient_funds` rises with time** (plausible salary/cash-flow timing) — this is the "why tomorrow, not now" headline case.
- **`bank_timeout` / `network_error` decay with time** — these are transient technical failures; waiting doesn't help, intent fades. The demo should also be able to show a case where the answer is "now," not just the more dramatic "wait" case. Don't only demo the flattering example.
- **`card_expired` is flat and low regardless of timing** — because timing isn't the relevant lever for this failure reason at all; the real answer is switch action (payment link / new method), not wait. This is exactly the WHAT-vs-WHEN distinction from the source analysis. Encode this by having the demo response note explicitly: "timing has negligible effect for this failure reason — the decision that matters here is which action, not when."
- **`fraud_block` never gets a timing recommendation** — it's excluded from this preview the same way it's excluded from contact-based interventions in the live guardrails. Consistency with that existing decision matters more than completeness here.

---

## 3. Backend — one standalone endpoint, nothing wired

Add `GET /decide/demo/timing-preview/{scenario}` (or similar), where `scenario` selects from 2-3 hardcoded demo contexts — at minimum one `insufficient_funds` case (the "wait" story) and one `bank_timeout` case (the "act now" story), so the demo doesn't look like it only knows how to say "wait."

For the selected scenario:
- Look up the heuristic curve for its `failure_reason`.
- Compute `EV(timing) = heuristic_prob(timing) × amount − cost` for each timing bucket (reuse the existing action's cost from the intervention menu — don't invent new cost logic).
- Return the full candidate table (every timing bucket with its probability and EV) plus the argmax recommendation — the "why not the alternatives" pattern should extend naturally to "why not this time" using the same shape as the existing rejected-alternatives data.
- The response must include an explicit field, e.g. `"is_heuristic_preview": true` and `"note": "Illustrative timing curves, not fitted from data — see ROADMAP.md"` — this is not optional, it's the entire point.

Do not touch `main._run_decision`, `optimizer.py`, `evaluator.py`, or `recovery_lab.py`. This lives entirely in its own module, called from its own endpoint.

---

## 4. Frontend — a preview panel, honestly labeled

A small new section (reuse `WhyNotPanel`'s visual pattern for the rejected-timing-buckets, don't build a new component style from scratch) showing:
- The recommended time, with the EV comparison across all candidate buckets.
- A visible "Preview" badge — distinct from the Live/Mock backend badge you already have, this is a third state: *illustrative, not fitted*. Don't reuse the Mock badge for this; conflating "mock data" with "heuristic-not-yet-learned" would blur two different honesty claims.
- For the `card_expired` case specifically, surface the "timing isn't the lever here" note rather than a flat, unexplained recommendation.

---

## 5. Docs — this is where the real payoff is

Create `docs/ROADMAP.md` if it doesn't exist (it should also carry the rest of the missing-features report's prioritized list from the earlier analysis — Optimal Timing, Multi-Step Policy, Execution Approval Modes, and the rest, ranked, with the ones requiring live traffic explicitly marked as such). Add a section:

> **Optimal Recovery Timing — previewed, not shipped.** The dashboard includes a heuristic preview of action × timing joint optimization, using domain-informed illustrative curves rather than a fitted model. Full implementation requires: (1) a timing-conditioned training dataset generated the same way `training_logs` uses randomized intervention exploration, extended to randomized timing-bucket exploration; (2) a trained timing-probability model; (3) integration into the live EV engine and optimizer; (4) contact-fatigue/decay modeling so repeated attempts don't naively look beneficial; (5) full re-validation and re-pin of all downstream evaluation numbers. The preview demonstrates the target reasoning shape, not the target accuracy.

Link this from `JUDGE_EVIDENCE.md` too, next to wherever other stated limitations already live — this fits the same honesty pattern as the offline-evaluation disclosure and the confidence-gate framing, not a new category of caveat.

---

## 6. Acceptance checklist

- [ ] Heuristic table matches Section 2 exactly, including the flat `card_expired` curve and the `fraud_block` exclusion
- [ ] At least one "wait" demo case and one "act now" demo case — not only the flattering example
- [ ] `is_heuristic_preview: true` and the illustrative-not-fitted note present in every response
- [ ] Zero changes to `main._run_decision`, `optimizer.py`, `evaluator.py`, `recovery_lab.py`
- [ ] Distinct "Preview" UI badge, not reusing the Mock/Live badge
- [ ] `docs/ROADMAP.md` exists and states the five concrete requirements for full implementation
- [ ] Full backend suite still shows the same pass count as before this change — this feature should add tests, not risk existing ones

---

## 7. What not to do

- Don't wire this into the live optimizer's argmax, even partially.
- Don't let the heuristic table quietly become "the model" in any doc or pitch line — every mention gets the illustrative-not-fitted caveat.
- Don't spend more than a few hours on this. If it's sprawling, cut the scenario count to one and ship that.