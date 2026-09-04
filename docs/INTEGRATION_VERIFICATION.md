# Integration Verification

This documents an actual, browser-driven verification of the real path
`React (browser) → FastAPI → RVE decision pipeline → guardrails → audit log
→ Razorpay test-mode API → response → React UI`, performed against a
locally running backend and frontend. It is not a description of intended
behavior — every flow below was exercised against live processes and the
observed output (network requests, rendered DOM text, backend audit log
contents) is what's reported.

## Environment

- **Backend:** `cd backend && source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000`
- **Frontend:** `npm --prefix frontend run dev` (Vite, `http://localhost:5173`)
- **`VITE_USE_MOCKS`:** `false` for Flows A–E, `true` for Flow F (`frontend/.env.local`; requires a dev-server restart to take effect — Vite bakes `import.meta.env` in at server start, it is not hot-reloadable)
- **`VITE_API_BASE_URL`:** `http://localhost:8000`
- **Required Razorpay env vars:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` in `backend/.env` (test-mode keys). Present and valid in this environment — real payment links were generated (Flow D). `ANTHROPIC_API_KEY` was **not** set; explanations correctly used the documented deterministic-template fallback throughout, which is expected, not a failure.

## Verified flows

### Flow A — real dashboard
Loaded `#/dashboard` with mocks off and a live backend. Network log confirms `GET /decisions?page=1&page_size=200 → 200`. Rendered payment IDs matched the backend's random-hex format (e.g. `pay_705cad2a2eaa`), not the mock fixtures' sequential `pay_000120` format, confirming real data. The intervention filter (`sms_link`) was exercised via a native `<select>` value + `change` event and correctly reduced "200 of 200" to "10 of 200," with every visible row showing `SMS link`.

### Flow B — real decision
Clicked/triggered a real, previously-undecided `sms_link`-eligible payment (`pay_66ff1ad3b670`). Exactly one `POST /decide/pay_66ff1ad3b670 → 200` fired. The rendered drill-down showed the real probability (20.0%), unit cost (₹3), expected value (₹109.67), and a `WhyNotPanel` listing all 6 rejected/blocked alternatives with their real EVs and reasons (e.g. `voice_call` blocked for being under the ₹5,000 threshold; every other channel correctly marked "Rejected: lower expected value" with the actual numbers). This is the real pipeline's output, not a static mock — the same payment decided a second time (see Flow B's guardrail case below) produced different, guardrail-affected numbers, which a mock could not reproduce.

**Guardrail case, found organically, not staged:** `pay_705cad2a2eaa` was decided three times over the course of this verification (once by the startup batch, once by an earlier manual call, once from the browser). By the third call its `all_evs` showed every contact-requiring intervention (`sms_link`, `whatsapp_nudge`, `email`, `retry_later`... contact ones) blocked with `"Blocked: contact-frequency cap reached (2/2 contacts already made for this payment)"`, and the optimizer correctly fell back to `no_action` (the highest-EV non-contact survivor). This is the exact guardrail bug that `docs/FAILURE_MODES.md` documents fixing, now re-confirmed live through the real browser → API path, not just in `pytest`.

### Flow C — real audit
After the Flow B decision, `curl http://localhost:8000/decisions` (bypassing the browser entirely) showed the new `decision_id` with the same `payment_link_url` the UI had rendered — proof it's server-side state, not frontend-only. Reloading the dashboard in the browser re-fetched from `GET /decisions` (fresh network call, `total` reflected the new count) rather than reusing any cached/local state.

### Flow D — Razorpay test mode → real payment link
`POST /decide/pay_66ff1ad3b670` returned `payment_link_url: "https://rzp.io/rzp/UCsTNUhy"` — a genuine Razorpay test-mode Payment Links API response (also independently confirmed via a direct `curl POST /decide/pay_705cad2a2eaa` earlier, which returned `https://rzp.io/rzp/21dvVJX`). The Razorpay API was not mocked for this. The frontend rendered the link under "Live Razorpay test-mode payment link" with a "real API call" badge, and the audit record on the backend carries the same URL (Flow C). **PASS.**

### Flow E — Razorpay failure handling
Two layers of evidence, both against the real SDK/API, neither mocked:
1. **New automated test**, `test_payment_link_reports_error_for_real_invalid_credentials` in `backend/tests/test_failure_scenarios.py`: calls `create_payment_link()` with syntactically valid but wrong test-mode credentials, hitting Razorpay's real endpoint and getting a genuine auth failure. Asserts no exception propagates and `PaymentLinkResult(error=...)` is returned. **Passes.**
2. The two pre-existing tests in the same file (`test_payment_link_reports_error_when_razorpay_raises`, `test_payment_link_reports_missing_keys_without_raising`) cover the SDK-raises and no-keys-configured cases respectively, both already passing.

In all cases: no crash, `payment_link_error` is set on the audit record (never a fabricated `payment_link_url`), and `main.py`'s `_decide()` calls `create_payment_link()` exactly once per live `/decide` — there is no retry-on-failure path that could double-execute.

### Flow F — mock regression
Set `VITE_USE_MOCKS=true`, **stopped the backend entirely** (`lsof -i :8000` confirmed nothing listening), restarted the frontend dev server. The dashboard loaded "120 of 120 decisions shown" with sequential `pay_000120`-style IDs from `mocks/fixtures.ts` — the mock dataset, not stale real data. No new requests to `:8000` appeared in the network log. **PASS**, and mock mode has zero runtime dependency on the backend being reachable.

**No-silent-fallback check:** with `VITE_USE_MOCKS=false` and the backend still stopped, the dashboard rendered `Could not load decisions: Failed to fetch` — a clear error state, not a silent switch to mock data. This is the correct, required behavior and was verified directly, not assumed from reading the code.

## Bugs found and fixed during this verification

1. **Real duplicate-execution bug in `DecisionDrillDown.tsx`.** `POST /decide/{payment_id}` is intentionally non-idempotent (each call appends an audit record and, for `sms_link`, calls the real Razorpay API). The component fired this call from a bare `useEffect` with no guard against React 18/19 StrictMode's development-mode double-invoke, so every drill-down page visit in `npm run dev` fired it **twice** — silently doubling audit entries and, when `sms_link` won, firing two real Razorpay payment-link calls for one page view. Fixed with a `useRef`-based guard that blocks the synthetic second invocation. Confirmed live: after the fix, exactly one `POST /decide/...` request appears per page visit in the network log.
   - **A regression introduced by the first version of that fix, caught in the same session:** the first attempt used a per-effect `cancelled` closure variable, which StrictMode's synthetic cleanup set to `true` *before* the guarded second invocation ran — silently discarding the one real response forever and leaving the page stuck on "Loading decision…" indefinitely. Caught by actually loading the page in the browser (not just `tsc`), not by re-reading the diff. Fixed by keying "is this response still current" off the same ref instead of a separate flag; verified live afterward (see Flow B).
2. **`policy_id` naming drift between mock and real data.** `frontend/src/api/types.ts` typed the second policy as `"always_retry"`; the real backend (`evaluator.py`) and the frontend's own `adapt.ts` label map both use `"always_retry_now"`. Mock fixtures used the (wrong) `"always_retry"`, so switching between mock and real data silently changed this one field's value with no type error to catch it (the adapter's `as` cast bypassed the check). Fixed by standardizing on `"always_retry_now"` (the backend's actual value) in both `types.ts` and `mocks/fixtures.ts`.
3. **`SimulateRequest` frontend type didn't match the backend's Pydantic model.** Frontend declared `n_failed_payments`; backend expects `n_batch_payments` (and was also missing `n_training_logs`). Not currently reachable from the UI (no "regenerate batch" control exists), so no live symptom, but fixed for correctness since the task asked for exactly this kind of drift to be found.
4. **`load_dotenv()` in `main.py` depended on the process's current working directory**, not the repo layout. It silently loads nothing (no error) if `uvicorn` is started from anywhere other than `backend/` — indistinguishable at runtime from "no keys configured." Discovered because this environment's own preview-server sandboxing couldn't launch the backend from `backend/` without hitting an unrelated permission error, which forced running `uvicorn` a different way and exposed the fragility. Fixed by resolving `backend/.env` from `Path(__file__)` instead of `os.getcwd()`.

## Known limitations

- **`computer` (pixel-coordinate) clicks were unreliable in this sandboxed Browser pane** — coordinates that matched the visible screenshot did not land on the intended element (confirmed via `elementFromPoint`; the DOM itself was correctly sized at 1280×800 with no zoom/transform applied, so this was a tool-side coordinate-translation issue, not an app layout bug). Real user interactions were instead verified by dispatching genuine `MouseEvent` sequences (`pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click`) directly at each target element's own measured center — this exercises the same React `onClick` handler and real network calls a physical click would, and every resulting request/render was independently confirmed against the running backend (`curl`, audit-log inspection), not asserted from the dispatch alone. Screenshots taken in this same pane were similarly not trustworthy as visual evidence in this session (content sometimes rendered into a small sub-region of the capture); `get_page_text`, `read_page`, and `read_network_requests` were used as the primary evidence instead, cross-checked against direct backend queries.
- **The decision queue's default page (`page_size=200`) is not sorted by recency.** A payment just decided from the drill-down page will be in the backend's audit log (Flow C confirms this) but may not appear on the queue's first page if the total exceeds 200, since `GET /decisions` returns insertion order, not most-recent-first. This is existing, documented pagination behavior (not something this task's scope covers changing) — noted here so it isn't mistaken for a persistence failure.
- **`ANTHROPIC_API_KEY` was not configured in this environment**, so every explanation observed used the deterministic template fallback, never the live LLM path. That fallback is itself a tested, documented behavior (`test_explanation_falls_back_when_anthropic_raises`), so this doesn't weaken the verification of the Razorpay/decision-pipeline path, but the live-LLM explanation branch specifically was not exercised here.
- **Frontend has no automated test runner** (`package.json` has no `test` script, no Vitest/Jest in `devDependencies`). Regression coverage for the frontend fixes in this pass rests on: TypeScript strict-checking (which now catches the `policy_id`/`SimulateRequest` drift), `oxlint`, a production `vite build`, and this document's manual browser verification — not an automated frontend test suite. Adding one would be a real infrastructure addition, out of scope for a fix-and-verify pass.
