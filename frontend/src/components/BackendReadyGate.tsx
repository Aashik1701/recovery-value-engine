import { useEffect, useRef, useState } from "react";
import { api, API_BASE_URL, USE_MOCKS } from "../api/client";
import { Card } from "./Card";
import { Button } from "./Button";

/**
 * Wraps the dashboard shell so data pages never mount against a
 * not-yet-ready backend. The FastAPI service trains its model synchronously
 * on boot (~3-3.5 min cold start) and does not accept connections until it
 * finishes, so during that window a `fetch` here fails outright rather than
 * returning 503 -- that failure means "still starting", not "broken".
 *
 * In mock mode there is nothing to wait for, so this is a pass-through.
 *
 * Behaviour:
 *   - poll GET /health every POLL_MS
 *   - while it fails or reports `ready: false` -> show a calm "starting up" card
 *   - once `ready: true` -> render children (and never gate again this session)
 *   - after GIVE_UP_MS of continuous failure -> show an actionable error with Retry
 */

const POLL_MS = 2000;
const GIVE_UP_MS = 240_000; // 4 min -- longer than a worst-case cold start

type Phase = "checking" | "ready" | "unreachable";

export function BackendReadyGate({ children }: { children: React.ReactNode }) {
  // Mock mode: no backend, render immediately. Evaluated once -- USE_MOCKS is
  // a build-time constant.
  const [phase, setPhase] = useState<Phase>(USE_MOCKS ? "ready" : "checking");
  const [detail, setDetail] = useState<string>("");
  const [attempt, setAttempt] = useState(0); // bump to force a fresh poll cycle
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (USE_MOCKS || phase === "ready") return;

    let cancelled = false;
    let timer: number | undefined;
    startedAt.current = Date.now();

    const tick = async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        if (h.ready) {
          setPhase("ready");
          return;
        }
        setDetail(
          h.rve_ready
            ? "Model ready, finishing Payment Success Score model…"
            : "Training the recovery-probability model and its 20-member confidence ensemble…",
        );
      } catch {
        if (cancelled) return;
        setDetail("Waiting for the FinSherlock API to accept connections…");
      }
      if (cancelled) return;
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setPhase("unreachable");
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [phase, attempt]);

  if (phase === "ready") return <>{children}</>;

  return (
    <div className="flex items-center justify-center py-16 px-4">
      <Card className="max-w-md w-full text-center">
        {phase === "checking" ? (
          <>
            <Spinner />
            <p className="text-sm font-medium mt-3" style={{ color: "var(--color-text-primary)" }}>
              Starting the FinSherlock API…
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-text-muted)" }}>
              {detail || "Connecting…"}
            </p>
            <p className="text-xs mt-3" style={{ color: "var(--color-text-muted)" }}>
              First boot trains the model deterministically and can take a few minutes. The dashboard
              will load automatically when it is ready.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium" style={{ color: "var(--color-status-danger-text)" }}>
              Backend unavailable
            </p>
            <p className="text-xs mt-1.5" style={{ color: "var(--color-text-secondary)" }}>
              Couldn't reach the FinSherlock API at <code>{API_BASE_URL}</code> after several minutes.
              Check that it is running (<code>uvicorn app.main:app</code> in <code>backend/</code>).
            </p>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPhase("checking");
                  setAttempt((n) => n + 1);
                }}
              >
                Retry
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: 22,
        height: 22,
        border: "2.5px solid var(--color-border-strong)",
        borderTopColor: "var(--color-primary)",
        animation: "rve-spin 0.8s linear infinite",
      }}
      aria-hidden="true"
    />
  );
}
