import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DecisionQueue } from "./components/DecisionQueue";
import { DecisionDrillDown } from "./components/DecisionDrillDown";
import { PolicyComparison } from "./components/PolicyComparison";
import { MetricsPanel } from "./components/MetricsPanel";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
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
