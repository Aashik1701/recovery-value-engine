import type {
  DecideResponse,
  DecisionsListResponse,
  EvaluateResponse,
  MetricsResponse,
  SimulateRequest,
  SimulateResponse,
} from "./types";
import {
  mockDecisionsListResponse,
  mockEvaluateResponse,
  mockMetricsResponse,
  mockSimulateResponse,
  getMockDecideResponse,
} from "../mocks/fixtures";
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
 */
const USE_MOCKS: boolean =
  (import.meta.env.VITE_USE_MOCKS as string | undefined) !== "false";

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

export const api = {
  /** POST /simulate, generate a fresh synthetic batch. */
  async simulate(body?: SimulateRequest): Promise<SimulateResponse> {
    if (USE_MOCKS) return delay(mockSimulateResponse);
    const raw = await request<RawSimulateResponse>("/simulate", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
    return adaptSimulateResponse(raw);
  },

  /** POST /decide/{payment_id}, run the full pipeline for one failed payment. */
  async decide(paymentId: string): Promise<DecideResponse> {
    if (USE_MOCKS) return delay(getMockDecideResponse(paymentId));
    const raw = await request<RawDecideResponse>(`/decide/${encodeURIComponent(paymentId)}`, {
      method: "POST",
    });
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
};
