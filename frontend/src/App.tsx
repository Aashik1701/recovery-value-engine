import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DecisionQueue } from "./components/DecisionQueue";
import { DecisionDrillDown } from "./components/DecisionDrillDown";
import { PolicyComparison } from "./components/PolicyComparison";
import { MetricsPanel } from "./components/MetricsPanel";
import { LandingPage } from "./landing/LandingPage";

function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Landing is the root — it's the entry point, no Layout wrapper
            since it has its own nav and is a different visual language from
            the dashboard on purpose. */}
        <Route index element={<LandingPage />} />
        <Route path="dashboard" element={<Layout />}>
          <Route index element={<DecisionQueue />} />
          <Route path="decisions/:paymentId" element={<DecisionDrillDown />} />
          <Route path="policy-comparison" element={<PolicyComparison />} />
          <Route path="metrics" element={<MetricsPanel />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
