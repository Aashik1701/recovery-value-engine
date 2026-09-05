import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type {
  RecoveryLabExposureResponse,
  RecoveryLabPolicyMetrics,
  RecoveryLabSensitivityResponse,
  RecoveryLabSimulateRequest,
  RecoveryLabSimulateResponse,
} from "../api/types";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { LoadingState, ErrorState } from "../components/PageState";
import { Table, TableHeaderRow, Td, Th, Tr } from "../components/Table";
import { formatCurrency } from "../lib/format";
import { InteractivePanel } from "./InteractivePanel";
import { POLICY_LABELS, POLICY_ORDER } from "./labFormat";
import { PolicyFrontierChart } from "./PolicyFrontierChart";
import { ResourceSensitivityPanel } from "./ResourceSensitivityPanel";
import { SimulationControls, type LabConfig } from "./SimulationControls";
import { useAnimatedNumber } from "./useAnimatedNumber";

const DEFAULT_CONFIG: LabConfig = {
  policy: "rve_adaptive",
  contact_intensity: "moderate",
  discount_budget: 50_000,
  voice_capacity: 1000,
  max_contacts_per_customer: 2,
  recovery_window_hours: 24 * 7,
  n_simulation_runs: 1000,
  seed: 42,
};

export function RecoveryLab() {
  const [exposure, setExposure] = useState<RecoveryLabExposureResponse | null>(null);
  const [exposureError, setExposureError] = useState<string | null>(null);

  const [config, setConfig] = useState<LabConfig>(DEFAULT_CONFIG);
  const [result, setResult] = useState<RecoveryLabSimulateResponse | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const [sensitivityDimension, setSensitivityDimension] = useState("voice_capacity");
  const [sensitivity, setSensitivity] = useState<RecoveryLabSensitivityResponse | null>(null);
  const [sensitivityLoading, setSensitivityLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .recoveryLabExposure()
      .then((res) => {
        if (!cancelled) setExposure(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setExposureError(err instanceof Error ? err.message : "Failed to load exposure");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSensitivity(baseConfig: LabConfig, dimension: string) {
    setSensitivityLoading(true);
    try {
      const req = {
        policy: baseConfig.policy,
        dimension: dimension as "voice_capacity" | "discount_budget" | "max_contacts_per_customer",
        contact_intensity: baseConfig.contact_intensity,
        discount_budget: baseConfig.discount_budget,
        voice_capacity: baseConfig.voice_capacity,
        max_contacts_per_customer: baseConfig.max_contacts_per_customer,
        recovery_window_hours: baseConfig.recovery_window_hours,
        seed: baseConfig.seed,
      };
      const res = await api.recoveryLabSensitivity(req);
      setSensitivity(res);
    } catch {
      setSensitivity(null);
    } finally {
      setSensitivityLoading(false);
    }
  }

  async function handleSimulate() {
    if (inFlightRef.current) return; // guard against duplicate submissions
    inFlightRef.current = true;
    setIsSimulating(true);
    setSimulateError(null);
    try {
      const req: RecoveryLabSimulateRequest = { ...config };
      const res = await api.recoveryLabSimulate(req);
      setResult(res);
      void runSensitivity(config, sensitivityDimension);
    } catch (err: unknown) {
      setSimulateError(err instanceof Error ? err.message : "Simulation could not be completed.");
    } finally {
      setIsSimulating(false);
      inFlightRef.current = false;
    }
  }

  function handleDimensionChange(dimension: string) {
    setSensitivityDimension(dimension);
    if (result) void runSensitivity(config, dimension);
  }

  const primary = result?.policies.find((p) => p.policy_id === result.primary_policy_id) ?? null;

  return (
    <div className="flex flex-col gap-6 w-full">
      <Header />
      <ExposureSection exposure={exposure} error={exposureError} />

      <InteractivePanel />

      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Full comparison &amp; sensitivity
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
          Configure any policy, run it once, and read the detailed table, efficiency frontier, and diminishing-returns
          curve.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
        <SimulationControls
          config={config}
          onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
          onSimulate={handleSimulate}
          isSimulating={isSimulating}
        />

        <div className="flex flex-col gap-6 min-w-0">
          {simulateError && (
            <ErrorState
              title="Simulation could not be completed"
              detail={simulateError}
              reassurance="Your existing payment and recovery systems are unaffected -- this is an isolated simulation."
            />
          )}

          {!result && !simulateError && (
            <Card>
              <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                Configure a strategy on the left, then run <strong>Simulate strategy</strong> to see projected
                outcome, policy comparison, and where returns start diminishing.
              </p>
            </Card>
          )}

          {result && primary && (
            <>
              <ProjectedOutcome result={result} primary={primary} />
              <PolicyComparisonTable policies={result.policies} primaryId={result.primary_policy_id} />
              <PolicyFrontierChart policies={result.policies} />
              <ResourceSensitivityPanel
                dimension={sensitivityDimension}
                onDimensionChange={handleDimensionChange}
                sensitivity={sensitivity}
                loading={sensitivityLoading}
              />
              <InsightAndExample result={result} />
            </>
          )}
        </div>
      </div>

      <MethodologyPanel />
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      eyebrow="Recovery Lab"
      title="Revenue Recovery Digital Twin"
      badge="Offline simulation"
      description={
        <>
          Simulate the outcome of a recovery strategy against a synthetic payment population before you deploy it.
          <span className="block text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            No real payments, customers, or recovery actions are executed.
          </span>
        </>
      }
    />
  );
}

function ExposureSection({ exposure, error }: { exposure: RecoveryLabExposureResponse | null; error: string | null }) {
  if (error) {
    return <ErrorState title="Unable to load current exposure" detail={error} reassurance="Check that the backend is running and try again." />;
  }
  if (!exposure) return <LoadingState label="Loading exposure…" />;

  return (
    <Card>
      <div className="flex flex-wrap gap-8">
        <Stat label="Revenue at risk" value={formatCurrency(exposure.total_at_risk)} emphasize />
        <Stat label="Failed payments" value={exposure.n_failed_payments.toLocaleString("en-IN")} />
        <Stat label="Median payment value" value={formatCurrency(exposure.median_payment_value)} />
        <Stat label="Suggested policy" value={exposure.suggested_policy_label} />
      </div>
    </Card>
  );
}

function ProjectedOutcome({
  result,
  primary,
}: {
  result: RecoveryLabSimulateResponse;
  primary: RecoveryLabPolicyMetrics;
}) {
  const netValue = useAnimatedNumber(primary.net_value_created);
  const gross = useAnimatedNumber(primary.gross_recovery);
  const natural = useAnimatedNumber(primary.natural_recovery);
  const incremental = useAnimatedNumber(primary.incremental_recovery);
  const cost = useAnimatedNumber(primary.intervention_cost);

  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-x-4 mb-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Projected outcome — {POLICY_LABELS[result.primary_policy_id]}
        </h2>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {result.n_payments_in_scope.toLocaleString("en-IN")} payments in scope
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label="Revenue at risk" value={formatCurrency(result.total_at_risk)} />
        <Stat label="Natural recovery" value={formatCurrency(natural)} />
        <Stat label="Gross recovery" value={formatCurrency(gross)} />
        <Stat label="Incremental recovery" value={formatCurrency(incremental)} />
        <Stat label="Intervention cost" value={formatCurrency(cost)} />
      </div>

      <div className="mt-4 pt-4 border-t flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--color-text-muted)" }}>
            Net value created
          </p>
          <p
            className="text-2xl font-semibold mt-0.5"
            style={{ color: "var(--color-status-success-text)", fontFamily: "var(--font-family-data)" }}
          >
            {formatCurrency(netValue)}
          </p>
          {primary.net_value_low !== null && primary.net_value_high !== null && (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              Simulation uncertainty: {formatCurrency(primary.net_value_low)} – {formatCurrency(primary.net_value_high)} ({" "}
              {result.n_simulation_runs.toLocaleString("en-IN")} simulated runs)
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </p>
      <p
        className={emphasize ? "text-2xl font-semibold mt-0.5" : "text-sm font-medium mt-0.5"}
        style={{ color: "var(--color-text-primary)", fontFamily: "var(--font-family-data)" }}
      >
        {value}
      </p>
    </div>
  );
}

function PolicyComparisonTable({
  policies,
  primaryId,
}: {
  policies: RecoveryLabPolicyMetrics[];
  primaryId: string;
}) {
  const winnerId = policies.reduce((best, p) => (p.net_value_created > best.net_value_created ? p : best), policies[0])
    .policy_id;

  return (
    <Card padded={false}>
      <div className="px-4 pt-3 pb-1">
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Compare recovery strategies
        </h3>
      </div>
      <Table>
        <thead>
          <TableHeaderRow>
            <Th>Policy</Th>
            <Th align="right">Gross recovery</Th>
            <Th align="right">Incremental</Th>
            <Th align="right">Cost</Th>
            <Th align="right">Net value</Th>
            <Th align="right">Contacts</Th>
            <Th align="right">Recovery rate</Th>
          </TableHeaderRow>
        </thead>
        <tbody>
          {POLICY_ORDER.map((id) => {
            const p = policies.find((x) => x.policy_id === id);
            if (!p) return null;
            const isWinner = p.policy_id === winnerId;
            const isPrimary = p.policy_id === primaryId;
            return (
              <Tr
                key={id}
                style={{ background: isWinner ? "var(--color-status-success-bg)" : undefined }}
              >
                <Td className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                  <div className="flex items-center gap-2">
                    {p.policy_label}
                    {isPrimary && <StatusBadge tone="neutral">simulated</StatusBadge>}
                    {isWinner && <StatusBadge tone="success">highest net value</StatusBadge>}
                  </div>
                </Td>
                <Td align="right" mono>
                  {formatCurrency(p.gross_recovery)}
                </Td>
                <Td align="right" mono>
                  {formatCurrency(p.incremental_recovery)}
                </Td>
                <Td align="right" mono>
                  {formatCurrency(p.intervention_cost)}
                </Td>
                <Td align="right" mono className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {formatCurrency(p.net_value_created)}
                </Td>
                <Td align="right" mono>
                  {p.number_contacted.toLocaleString("en-IN")}
                </Td>
                <Td align="right" mono>
                  {(p.recovery_rate * 100).toFixed(1)}%
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

function InsightAndExample({ result }: { result: RecoveryLabSimulateResponse }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
        Decision insight
      </h3>
      <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
        {result.insight}
      </p>
      {result.primary_policy_id === "rve_adaptive" && (
        <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
          Policy source: Recovery Value Engine — uses RVE decisioning and its existing guardrails, run against every
          payment in scope.
        </p>
      )}
      {result.example_payment_id && (
        <Link
          to={`/dashboard/decisions/${result.example_payment_id}`}
          className="text-xs mt-2 inline-block"
          style={{ color: "var(--color-primary)" }}
        >
          Inspect an example decision →
        </Link>
      )}
    </Card>
  );
}

function MethodologyPanel() {
  return (
    <Card>
      <details>
        <summary className="text-sm font-semibold cursor-pointer" style={{ color: "var(--color-text-primary)" }}>
          Simulation methodology
        </summary>
        <p className="text-sm mt-2" style={{ color: "var(--color-text-secondary)" }}>
          This environment evaluates recovery strategies against a synthetic payment population, reusing the same
          simulator and trained recovery-probability model as the rest of this project. Headline metrics (natural,
          gross, and incremental recovery, cost, and net value) are the exact analytic expectation given the
          simulator's hidden ground truth — the same approach used in the offline policy evaluation elsewhere in this
          app. Monte Carlo resampling is used only to report a sampling-variance range around net value ("simulation
          uncertainty"), not the headline numbers themselves. Results are offline estimates and are not production
          forecasts. No real customer or payment action is executed from this page.
        </p>
      </details>
    </Card>
  );
}
