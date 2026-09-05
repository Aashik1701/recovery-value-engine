# Payment Intelligence page

A dedicated application page that presents the Payment Success Score (PSS) and the Recovery Value Engine (RVE) as one continuous payment experience not two separate features stitched together. This document describes what was built, how it's wired, and where its honesty boundary sits.

## Routes

- `/payments` — Payment Intelligence queue.
- `/payments/:paymentId` — the payment detail / attempt / recovery experience.

Both are siblings of `/dashboard/*`, sharing the same `Layout` shell (header, sidebar, theme toggle) for navigational consistency — added as their own top-level `<Route>` block in `App.tsx`, not nested under `/dashboard`, matching the requested route shape. The sidebar (`components/Layout.tsx`) gained one new nav item, "Payment Intelligence."

## Where the "payments" come from

Neither PSS nor RVE's backend has a concept of "a payment awaiting attempt" — RVE's synthetic simulator generates *already-failed* payments by design (its unit of analysis is a single failed payment event), and PSS scores arbitrary conditions, not a specific payment record. To give this page a single coherent payment identity without inventing a new backend concept, both `/payments` and `/payments/:paymentId` source their payment records from the **existing** `GET /decisions` endpoint (RVE's real audit log / batch). Every `payment_id`, `customer_id`, `amount`, and `failure_reason` shown on this page is genuine backend data, not fabricated.

## PSS integration

- `PaymentDetail` calls `POST /pss/score` once per payment, with conditions from `payments/pssConditions.ts`'s `conditionsForPayment()` — a deterministic function of the payment_id (seeded PRNG, same approach `mocks/fixtures.ts` already uses) that nudges the healthy-default `PSSConditions` toward realistic-but-varied gateway latency / error rate / traffic / uptime values. This is **necessary and documented**, not incidental: without it every payment would score identically under the PSS defaults, and the queue's whole premise (showing meaningfully different reliability across payments) wouldn't hold. It is still fully synthetic and fully reproducible — the same payment_id always produces the same conditions.
- The response's `methods[]` (all four payment methods, each already scored and ranked by the backend) is rendered as-is. **The frontend never recomputes or re-ranks** — `recommended` comes directly from `PSSScoreResponse.recommended_method`.
- `PaymentQueue` calls `/pss/score` once per row (bounded to `QUEUE_SIZE = 30` rows) to populate the summary metrics and the Score/Status columns. This is a real, deliberate trade-off: scoring the full batch (up to 500 payments) on every queue load would be wasteful and slow for no product benefit; 30 is enough to demonstrate real variety.
- "Why this score?" (`pssConditions.ts`'s `deriveQualitativeSignals`) turns the response's real `conditions` numbers into qualitative labels (Healthy/Elevated/Degraded) using fixed thresholds — there is no feature-importance/SHAP data available from `pss_scorer.py` to show, so no precise per-feature weight is fabricated. The one quantitative-feeling number shown (`delta_from_healthy`) is copied verbatim from the backend response, not invented.

## RVE integration

- `POST /decide/{payment_id}` is called through the **existing** `api.decide()` client method — no new endpoint, no duplicated decision logic. The full response (`evaluations`, `explanation`, `chosen_intervention`, `payment_link_url`/`payment_link_error`) is rendered as-is.
- The rejected-vs-blocked distinction is preserved by reusing the **existing** `WhyNotPanel` component unmodified — no duplicate explanation UI was built.
- When `chosen_intervention === "sms_link"`, the Razorpay Test Mode link (or error) already present in the `/decide` response is displayed. **No second Razorpay call is made from this page** — `main.py`'s `/decide` already performs that call server-side as part of the same request; this page only renders the result. There is no browser-to-Razorpay call anywhere in this codebase.

## The state machine

`payments/usePaymentFlow.ts` drives the whole detail page off a single `phase` field (`PaymentFlowPhase`), so the UI can never render two conflicting states (e.g. "success" and "failed") simultaneously — every render branches on one string, not a set of independent booleans:

```
loading_payment → scoring → ready → processing → success
                                         └──────→ failed → recovery_evaluating ─┬→ recovery_decided
                                                                                 ├→ recovered
                                                                                 └→ recovery_failed
(any stage) → error
```

- `recovery_decided`: RVE chose an intervention other than `sms_link` — nothing external was executed.
- `recovered`: `sms_link` was chosen and the Razorpay test-mode link was created successfully.
- `recovery_failed`: `sms_link` was chosen but the Razorpay call failed (`payment_link_error` present). This is a real failure state, not folded into a generic error — the decision is still shown as fully auditable, and no link is fabricated.

## The payment-attempt simulation, and its honesty boundary

There is no backend "attempt this payment" endpoint, and this project doesn't invent one. The **Pay** button's success/failure outcome is decided client-side, as a single weighted coin flip using the *real, backend-computed* `success_probability` for the selected method — `Math.random() < methodScore.success_probability`. This is the one place in the flow that is a simulation rather than a backend response, and it is treated that way throughout the UI:

- Success is labeled **"Test payment successful"**, never "Payment successful" or any language implying real money moved.
- On failure, the specific reason shown (`card_expired`, `bank_timeout`, …) is **not** invented for the occasion — it's the real `failure_reason` already assigned to that payment_id by RVE's simulator, the same value the hidden ground truth already carries for every batch payment.
- Everything downstream of a failure (the RVE decision, the explanation, the EVs, the Razorpay link) is 100% real — only the coin flip that decides *whether* we show a failure at all is simulated, and it's simulated using a real probability, not a fabricated one.

Nothing on this page claims "live gateway intelligence," "real-time production success probability," or "actual payment routing." The score card and the method-recommendation copy both explicitly state "current test/simulated conditions."

## Duplicate-execution safety

`POST /decide/{payment_id}` is only ever called from inside `attemptPayment`, which only ever runs in response to a real user click on the **Pay** button — not from a `useEffect`. React StrictMode's development-mode double-invoke behavior applies to component bodies and effects, not to event handlers, so the specific bug class this project already found once (DecisionDrillDown.tsx's original StrictMode-triggered duplicate `/decide` call) cannot recur here by construction. A separate `actionInFlight` ref guards against a literal rapid double-click on the button before it disables. Verified live in the browser (network panel), not by source inspection alone — see the verification section of the final report.

The `/pss/score` calls (in both `PaymentQueue` and `PaymentDetail`'s loading effect) are idempotent GETs-in-spirit (no side effects on the backend), so StrictMode's double-invoke is harmless there; a sequence-number ref (`loadSeq`) still guards against a stale response from a superseded `paymentId` clobbering fresher state.

## Mock mode

`VITE_USE_MOCKS=true` requires **zero new fixture code** — `api.listDecisions`, `api.decide`, and `api.pssScore` already had complete mock implementations (`mocks/fixtures.ts`'s `mockDecisionsListResponse`, `getMockDecideResponse`, `mockPSSScore`) from the existing dashboard and the landing page's Payment Success Score section, respectively. `/payments` and `/payments/:paymentId` reuse them directly; no backend is required, and no request reaches `:8000`/`:8001` in mock mode.

## Real-mode error handling

`VITE_USE_MOCKS=false` never falls back to fixtures. If the backend is unreachable, `api.listDecisions`/`api.pssScore`/`api.decide` all reject, and every screen (`PaymentQueue`, `PaymentDetail`, the recovery step) renders an explicit "Unable to connect to Payment Intelligence" (or the specific stage's equivalent) error state instead.

## Known limitations

- **The queue is capped at 30 rows** (`PaymentQueue.tsx`'s `QUEUE_SIZE`), not the full batch — a deliberate performance trade-off (see PSS integration above), not a hidden bug.
- **Per-payment PSS conditions are a deterministic function of payment_id, not of anything about the payment's real amount/failure_reason beyond what's passed to `/pss/score` explicitly** (amount and transaction_type are; the synthetic gateway/traffic conditions are not causally linked to why that payment actually failed in RVE's hidden ground truth). This is stated so it isn't mistaken for a deeper connection between the two models than actually exists — they are two separate pipelines, deliberately not merged into one model, per the project's explicit "do not introduce another ML model" constraint.
- **No single-payment backend lookup endpoint exists**, so `PaymentDetail` loads its payment record via `GET /decisions?page=1&page_size=500` and finds the matching `payment_id` client-side, rather than a targeted fetch. Correct and functional, but not the most efficient possible approach; adding a `GET /decisions/{payment_id}` endpoint would be a small, natural follow-up if this page's usage grows.
- **The payment-attempt outcome is a client-side simulation** (see above) — by design, not an oversight, and labeled as such everywhere it appears.
