import type {
  DecideResponse,
  DecisionsListResponse,
  EvaluateResponse,
  HealthResponse,
  MetricsResponse,
  NegotiationAnalyzeRequest,
  NegotiationAnalyzeResponse,
  PSSConditions,
  PSSScoreResponse,
  RecoveryLabExposureResponse,
  RecoveryLabSensitivityRequest,
  RecoveryLabSensitivityResponse,
  RecoveryLabSimulateRequest,
  RecoveryLabSimulateResponse,
  RevenueAutopsyCausesResponse,
  RevenueAutopsyPaymentsParams,
  RevenueAutopsyPaymentsResponse,
  RevenueAutopsySummaryResponse,
  SimulateRequest,
  SimulateResponse,
  TimingPreviewResponse,
  TimingPreviewScenarioId,
} from "./types";
import {
  mockDecisionsListResponse,
  mockEvaluateResponse,
  mockMetricsResponse,
  mockPSSScore,
  mockSimulateResponse,
  getMockDecideResponse,
} from "../mocks/fixtures";
import { mockTimingPreview } from "../mocks/timingPreviewFixtures";
import {
  mockRecoveryLabExposure,
  mockRecoveryLabSensitivity,
  mockRecoveryLabSimulate,
} from "../mocks/recoveryLabFixtures";
import {
  mockRevenueAutopsyCauses,
  mockRevenueAutopsyPayments,
  mockRevenueAutopsySummary,
} from "../mocks/revenueAutopsyFixtures";
import { mockNegotiationAnalyze } from "../mocks/negotiationFixtures";
import {
  adaptAuditRecord,
  adaptDecisionsResponse,
  adaptEvaluateResponse,
  adaptMetricsResponse,
  adaptSimulateResponse,
  type RawDecideResponse,
  type RawDecisionsResponse,
  type RawEvaluateResponse,
  type RawMetricsResponse,
  type RawSimulateResponse,
} from "./adapt";

/**
 * Base URL for the RVE backend. Override with VITE_API_BASE_URL in a .env
 * file (see .env.example) once the FastAPI service is running locally or
 * deployed. Defaults to the backend's local dev port.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

/**
 * Flip to `false` (or set VITE_USE_MOCKS=false) once the backend is live and
 * you want the dashboard to hit it instead of the bundled fixtures. Every
 * function below has the real `fetch` call already wired in, swapping over
 * is a one-line change per function, not a rewrite.
 *
 * Exported (not just module-private) so Layout.tsx's EnvironmentIndicator
 * can render a real "Mock data" / "Live backend" badge instead of a
 * decorative one -- a judge (or anyone else) looking at the dashboard has no
 * other way to tell whether a number came from bundled fixtures or the
 * actual running FastAPI pipeline, and a misconfigured env value (a typo, or
 * anything other than the exact string "false") would otherwise silently
 * keep serving mocks with no visible signal that it happened.
 */
export const USE_MOCKS: boolean =
  (import.meta.env.VITE_USE_MOCKS as string | undefined) !== "false";

/**
 * The deterministic canonical demo payment for the judge walkthrough (see
 * docs/PITCH_SCRIPT.md). A real row in the seed-42 startup batch; hard-named
 * here (and on the backend in `demo_cases.py`) so the queue callout and the
 * drill-down never have to guess it from array order. The backend also
 * reports it in `GET /health` as `canonical_payment_id`.
 */
export const CANONICAL_DEMO_PAYMENT_ID = "pay_2ff975708893";

/**
 * The canonical safety-story payment: a ₹5,195.26 `fraud_block` failure in the
 * same deterministic seed-42 batch. The model would have chased it (it clears
 * every amount threshold), but the hard risk policy suppresses recovery to
 * `no_action`. Used by the Command Center demo callout as the contrast case
 * to the normal recovery example above. Its decision outcome is stable no
 * matter how many times it is opened (fraud suppression is absolute and
 * `no_action` is non-contact), so it needs no special non-appending path.
 */
export const CANONICAL_DEMO_FRAUD_PAYMENT_ID = "pay_594a26af1f2e";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`RVE API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Like `delay`, but rejects with an AbortError if `signal` fires first --
 * so mock-mode endpoints that a caller cancels (e.g. the Recovery Lab
 * interactive panel on rapid slider drags) behave like the real fetch. */
function abortableDelay<T>(produce: () => T, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(produce());
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const MOCK_HEALTH: HealthResponse = {
  status: "ok",
  ready: true,
  rve_ready: true,
  pss_ready: true,
  ensemble_ready: true,
  seed: 42,
  n_batch_payments: 500,
  n_decisions_logged: 500,
  canonical_payment_id: CANONICAL_DEMO_PAYMENT_ID,
};

export const api = {
  /**
   * GET /health -- unguarded readiness probe. In mock mode there is nothing
   * to wait for, so it resolves ready immediately. In live mode the backend
   * trains its model synchronously on boot (~30-40s cold start) and does not
   * accept connections until it finishes, so a failed fetch here means
   * "still starting", not "broken" -- callers should retry.
   */
  async health(signal?: AbortSignal): Promise<HealthResponse> {
    if (USE_MOCKS) return MOCK_HEALTH;
    return request<HealthResponse>("/health", { signal });
  },

  /** POST /simulate, generate a fresh synthetic batch. */
  async simulate(body?: SimulateRequest): Promise<SimulateResponse> {
    if (USE_MOCKS) return delay(mockSimulateResponse);
    const raw = await request<RawSimulateResponse>("/simulate", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
    return adaptSimulateResponse(raw);
  },

  /** POST /demo/reset -- rebuild the deterministic seed-42 demo state (batch,
   *  model, ensemble) and clear the in-memory audit log. Deterministic: the
   *  canonical walkthrough reproduces identically afterward. */
  async demoReset(): Promise<HealthResponse> {
    if (USE_MOCKS) return delay(MOCK_HEALTH, 400);
    return request<HealthResponse>("/demo/reset", { method: "POST" });
  },

  /** POST /decide/{payment_id}, run the full pipeline for one failed payment. */
  async decide(paymentId: string): Promise<DecideResponse> {
    if (USE_MOCKS) return delay(getMockDecideResponse(paymentId));
    const raw = await request<RawDecideResponse>(`/decide/${encodeURIComponent(paymentId)}`, {
      method: "POST",
    });
    return { decision: adaptAuditRecord(raw.audit_record) };
  },

  /**
   * GET /decide/demo/canonical -- the canonical judge-walkthrough decision.
   * Runs the same pipeline as `decide()` but from a NON-appending backend
   * path, so opening it repeatedly (refresh, restart, re-open) never mutates
   * the audit log or the contact-frequency count. Use this instead of
   * `decide(CANONICAL_DEMO_PAYMENT_ID)` for the demo so the story is stable.
   */
  async decideCanonicalDemo(): Promise<DecideResponse> {
    if (USE_MOCKS) return delay(getMockDecideResponse(CANONICAL_DEMO_PAYMENT_ID));
    const raw = await request<RawDecideResponse>("/decide/demo/canonical");
    return { decision: adaptAuditRecord(raw.audit_record) };
  },

  /**
   * GET /decide/demo/fraud -- the fraud-block safety-story decision, served
   * from the same non-appending path as the canonical one so re-opening it
   * during a demo never grows the audit log with duplicate no_action rows.
   */
  async decideFraudDemo(): Promise<DecideResponse> {
    if (USE_MOCKS) return delay(getMockDecideResponse(CANONICAL_DEMO_FRAUD_PAYMENT_ID));
    const raw = await request<RawDecideResponse>("/decide/demo/fraud");
    return { decision: adaptAuditRecord(raw.audit_record) };
  },

  /** GET /decisions, paginated list of past decisions. */
  async listDecisions(page = 1, pageSize = 50): Promise<DecisionsListResponse> {
    if (USE_MOCKS) return delay(mockDecisionsListResponse(page, pageSize));
    const raw = await request<RawDecisionsResponse>(`/decisions?page=${page}&page_size=${pageSize}`);
    return adaptDecisionsResponse(raw);
  },

  /** GET /evaluate, four-policy offline comparison table. */
  async evaluate(): Promise<EvaluateResponse> {
    if (USE_MOCKS) return delay(mockEvaluateResponse);
    const raw = await request<RawEvaluateResponse>("/evaluate");
    return adaptEvaluateResponse(raw);
  },

  /** GET /metrics, probability model's AUC / calibration stats. */
  async metrics(): Promise<MetricsResponse> {
    if (USE_MOCKS) return delay(mockMetricsResponse);
    const raw = await request<RawMetricsResponse>("/metrics");
    return adaptMetricsResponse(raw);
  },

  /**
   * POST /pss/score (v2, see docs/PAYMENT_PAGE.md) -- Payment Success
   * Score, an entirely separate pipeline from the RVE flow above. The
   * backend's response shape already matches PSSScoreResponse field for
   * field, so no adapter is needed here (unlike the other endpoints,
   * which drifted from their Pydantic models independently -- see
   * adapt.ts's own comment on why that reconciliation exists there).
   */
  async pssScore(conditions?: Partial<PSSConditions>): Promise<PSSScoreResponse> {
    if (USE_MOCKS) return delay(mockPSSScore(conditions ?? {}), 60);
    return request<PSSScoreResponse>("/pss/score", {
      method: "POST",
      body: JSON.stringify(conditions ?? {}),
    });
  },

  /**
   * GET /decide/demo/timing-preview/{scenario} -- Optimal Recovery Timing,
   * a heuristic PREVIEW only, not a shipped feature (see docs/ROADMAP.md).
   * Standalone hardcoded demo scenarios, nothing wired to the live batch or
   * optimizer. Response shape already matches TimingPreviewResponse field
   * for field, same as pssScore above -- no adapter needed.
   */
  async timingPreview(scenario: TimingPreviewScenarioId): Promise<TimingPreviewResponse> {
    if (USE_MOCKS) return delay(mockTimingPreview(scenario), 80);
    return request<TimingPreviewResponse>(`/decide/demo/timing-preview/${encodeURIComponent(scenario)}`);
  },

  /**
   * Recovery Lab -- "Revenue Recovery Digital Twin" (see
   * docs/RECOVERY_DIGITAL_TWIN.md). Entirely offline/synthetic; never calls
   * Razorpay or any real messaging channel. Field names match the backend's
   * RecoveryLab* Pydantic models directly, so no adapter is needed.
   */
  async recoveryLabExposure(): Promise<RecoveryLabExposureResponse> {
    if (USE_MOCKS) return delay(mockRecoveryLabExposure(), 120);
    return request<RecoveryLabExposureResponse>("/recovery-lab/exposure");
  },

  async recoveryLabSimulate(
    req: RecoveryLabSimulateRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<RecoveryLabSimulateResponse> {
    // Shorter mock delay than the other endpoints: the Recovery Lab
    // interactive panel drives this on every slider drag, and mock mode
    // should feel live too. The mock also honours `opts.signal` so a
    // superseded drag step is dropped the same way it is against the real
    // backend (otherwise stale mock results resolve late and clobber the
    // current one).
    if (USE_MOCKS) return abortableDelay(() => mockRecoveryLabSimulate(req), 120, opts?.signal);
    return request<RecoveryLabSimulateResponse>("/recovery-lab/simulate", {
      method: "POST",
      body: JSON.stringify(req),
      signal: opts?.signal,
    });
  },

  async recoveryLabSensitivity(req: RecoveryLabSensitivityRequest): Promise<RecoveryLabSensitivityResponse> {
    if (USE_MOCKS) return delay(mockRecoveryLabSensitivity(req), 250);
    return request<RecoveryLabSensitivityResponse>("/recovery-lab/sensitivity", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  /**
   * Revenue Recovery Autopsy -- a forensic root-cause layer built on top of
   * the existing synthetic batch and existing RVE audit log (see
   * docs/REVENUE_RECOVERY_AUTOPSY.md). Entirely offline/synthetic; never
   * calls Razorpay. Field names match the backend's RevenueAutopsy and
   * ForensicPaymentRecord Pydantic models directly, so no adapter is needed.
   */
  async revenueAutopsySummary(): Promise<RevenueAutopsySummaryResponse> {
    if (USE_MOCKS) return delay(mockRevenueAutopsySummary(), 200);
    return request<RevenueAutopsySummaryResponse>("/revenue-autopsy/summary");
  },

  async revenueAutopsyCauses(): Promise<RevenueAutopsyCausesResponse> {
    if (USE_MOCKS) return delay(mockRevenueAutopsyCauses(), 220);
    return request<RevenueAutopsyCausesResponse>("/revenue-autopsy/causes");
  },

  async revenueAutopsyPayments(params: RevenueAutopsyPaymentsParams): Promise<RevenueAutopsyPaymentsResponse> {
    if (USE_MOCKS) return delay(mockRevenueAutopsyPayments(params), 180);
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.page_size) query.set("page_size", String(params.page_size));
    if (params.cause) query.set("cause", params.cause);
    if (params.status) query.set("status", params.status);
    if (params.search) query.set("search", params.search);
    return request<RevenueAutopsyPaymentsResponse>(`/revenue-autopsy/payments?${query.toString()}`);
  },

  /**
   * Recovery Negotiation Engine -- a higher-level layer over the RVE
   * decision above (see docs/RECOVERY_NEGOTIATION_ENGINE.md): RVE picks
   * WHICH intervention; this searches HOW MUCH incentive is worth attaching
   * to it. Entirely analysis-only -- never calls Razorpay, never mutates the
   * audit log. Field names match the backend's Negotiation* Pydantic models
   * directly, so no adapter is needed.
   */
  async recoveryNegotiationAnalyze(req: NegotiationAnalyzeRequest): Promise<NegotiationAnalyzeResponse> {
    if (USE_MOCKS) return delay(mockNegotiationAnalyze(req), 300);
    return request<NegotiationAnalyzeResponse>("/recovery-negotiation/analyze", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },
};
