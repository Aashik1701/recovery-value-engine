import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DecisionQueue } from "./components/DecisionQueue";
import { DecisionDrillDown } from "./components/DecisionDrillDown";
import { PolicyComparison } from "./components/PolicyComparison";
import { MetricsPanel } from "./components/MetricsPanel";
import { LandingPage } from "./landing/LandingPage";
import { PaymentQueue } from "./payments/PaymentQueue";
import { PaymentDetail } from "./payments/PaymentDetail";
import { RecoveryLab } from "./recoveryLab/RecoveryLab";
import { RevenueAutopsy } from "./revenueAutopsy/RevenueAutopsy";
import { RecoveryNegotiation } from "./negotiation/RecoveryNegotiation";
import { TimingPreviewPanel } from "./timingPreview/TimingPreviewPanel";

function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Landing is the root, it's the entry point, no Layout wrapper
            since it has its own nav and is a different visual language from
            the dashboard on purpose. */}
        <Route index element={<LandingPage />} />
        <Route path="dashboard" element={<Layout />}>
          <Route index element={<DecisionQueue />} />
          <Route path="decisions/:paymentId" element={<DecisionDrillDown />} />
          <Route path="policy-comparison" element={<PolicyComparison />} />
          <Route path="metrics" element={<MetricsPanel />} />
        </Route>
        <Route path="recovery-lab" element={<Layout />}>
          <Route index element={<RecoveryLab />} />
        </Route>
        <Route path="revenue-autopsy" element={<Layout />}>
          <Route index element={<RevenueAutopsy />} />
        </Route>
        <Route path="recovery-negotiation" element={<Layout />}>
          <Route index element={<RecoveryNegotiation />} />
        </Route>
        {/* Roadmap preview, not a shipped feature -- see docs/ROADMAP.md and
            docs/Timing preview brief.md. Standalone demo endpoint, nothing
            wired to the live batch or optimizer. */}
        <Route path="timing-preview" element={<Layout />}>
          <Route index element={<TimingPreviewPanel />} />
        </Route>
        {/* Payment Intelligence: PSS + RVE as one continuous flow, a
            sibling to /dashboard rather than nested under it, per the
            explicit /payments route requested -- reuses the same Layout
            shell (sidebar, header) for visual/navigational consistency. */}
        <Route path="payments" element={<Layout />}>
          <Route index element={<PaymentQueue />} />
          <Route path=":paymentId" element={<PaymentDetail />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
