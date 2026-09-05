export interface DiagramNode {
  id: string;
  label: string;
  sublabel?: string;
  type: "input" | "process" | "decision" | "output" | "guardrail" | "ml";
}

export interface DiagramConnection {
  from: string;
  to: string;
  label?: string;
}

export interface FeatureItem {
  sNo: string;
  name: string;
  category:
    | "Core Decision Engine"
    | "Payment Intelligence"
    | "Guardrails & Risk Policy"
    | "AI Reliability & Safety"
    | "Strategic Simulation"
    | "Loss Forensics"
    | "Negotiation & Settlement"
    | "Execution & Verification";
  badge: string;
  summary: string;
  howItWorks: string[];
  aiJudgment: string;
  diagram: {
    title: string;
    flowType: "linear" | "branching" | "feedback";
    nodes: DiagramNode[];
    connections: DiagramConnection[];
    takeaway: string;
  };
  codeRef: string;
  endpoint?: string;
  route?: string;
  routeLabel?: string;
}

export const FEATURES_LIST: FeatureItem[] = [
  {
    sNo: "01",
    name: "Synthetic Simulator & Ground Truth Engine",
    category: "Core Decision Engine",
    badge: "Causal Inference",
    summary:
      "Generates fully reproducible synthetic customer cohorts and failed payment batches paired with a hidden, counterfactual ground-truth table.",
    howItWorks: [
      "Generates customer profiles with lifetime value (LTV), past payment success rates, and preferred contact channels.",
      "Creates failed payment events across six distinct failure archetypes (insufficient funds, bank timeout, network error, card expired, fraud block, other).",
      "Constructs a hidden ground-truth table containing true baseline organic recovery odds and additive uplift per candidate intervention.",
      "Runs an un-confounded logged randomized trial (training_logs) assigning candidate interventions uniformly at random so causal uplift is learnable without data leakage.",
    ],
    aiJudgment:
      "Deterministic data generation with fixed seeds (seed=42). Pure classical synthesis allows rigorous analytical evaluation without privacy risks or production data leakage.",
    diagram: {
      title: "Synthetic Data & Unconfounded Trial Generation",
      flowType: "branching",
      nodes: [
        { id: "seed", label: "Seed & Config", sublabel: "Reproducible RNG (seed 42)", type: "input" },
        { id: "cust", label: "Customer Cohort", sublabel: "LTV, Success Rate, Channel", type: "process" },
        { id: "hidden", label: "Hidden Ground Truth", sublabel: "Base P + Uplift Matrix", type: "process" },
        { id: "trial", label: "Randomized Trial", sublabel: "Uniform Intervention Logging", type: "decision" },
        { id: "out", label: "Clean Training Logs", sublabel: "Unconfounded P(Rec|C,I)", type: "output" },
      ],
      connections: [
        { from: "seed", to: "cust" },
        { from: "cust", to: "hidden" },
        { from: "hidden", to: "trial", label: "Random assignment" },
        { from: "trial", to: "out", label: "Zero leakage" },
      ],
      takeaway: "Random exploration in training logs guarantees causal uplift can be learned without confounding.",
    },
    codeRef: "backend/app/simulator.py",
    endpoint: "POST /simulate",
    route: "/dashboard",
    routeLabel: "View Live Batch in Queue",
  },
  {
    sNo: "02",
    name: "Recovery-Probability ML Model",
    category: "Core Decision Engine",
    badge: "HistGradientBoosting",
    summary:
      "Supervised ML model predicting recovery probability across all candidate interventions, calibrated against held-out randomized trial data.",
    howItWorks: [
      "Trained exclusively on training_logs (using observed binary outcome as label, never touching the hidden simulator truth).",
      "Features: failure reason, transaction type, assigned intervention, payment amount, retry count, customer past success rate, and customer LTV.",
      "HistGradientBoostingClassifier natively handles categorical features without manual one-hot dimensionality explosion.",
      "Evaluates organic recovery as a first-class citizen (no_action is just another assigned_intervention value in the same model).",
      "Evaluates generalization via held-out AUC and a 10-bin quantile calibration curve.",
    ],
    aiJudgment:
      "Classical Gradient Boosting over an LLM. ML probability estimation provides calibratable, reproducible numeric outputs (Brier score & AUC) that financial optimization requires.",
    diagram: {
      title: "Causal Recovery Probability Inference Pipeline",
      flowType: "linear",
      nodes: [
        { id: "f_in", label: "Payment Context", sublabel: "Reason, Amount, Retries, LTV", type: "input" },
        { id: "menu", label: "7 Interventions", sublabel: "no_action ... voice_call", type: "input" },
        { id: "hgb", label: "HistGradientBoosting", sublabel: "Calibrated categorical trees", type: "ml" },
        { id: "probs", label: "Predicted P(Recovery)", sublabel: "Vector [P₀, P₁, ... P₆]", type: "output" },
      ],
      connections: [
        { from: "f_in", to: "hgb" },
        { from: "menu", to: "hgb" },
        { from: "hgb", to: "probs", label: "Inference in <5ms" },
      ],
      takeaway: "Estimates recovery probabilities across the full menu simultaneously in a single vectorized pass.",
    },
    codeRef: "backend/app/probability_model.py",
    endpoint: "GET /metrics",
    route: "/dashboard/metrics",
    routeLabel: "View Calibration & AUC",
  },
  {
    sNo: "03",
    name: "Expected Net Value (EV) Arithmetic Engine",
    category: "Core Decision Engine",
    badge: "Deterministic Math",
    summary:
      "Converts recovery probabilities into hard rupee economics: EV = P(recovery) × Amount − Unit Cost.",
    howItWorks: [
      "Evaluates all 7 menu interventions with fixed unit cost accounting: no_action (₹0), retry_now (₹2), retry_later (₹1), sms_link (₹3), whatsapp_nudge (₹5), email (₹1), voice_call (₹15).",
      "Computes organic baseline value: EV(no_action) = P(organic_recovery) × Amount.",
      "Ensures that argmax(EV) is mathematically equivalent to maximizing marginal net value over doing nothing.",
      "Never assumes an intervention is profitable just because it increases recovery probability — high-cost channels must justify their spend.",
    ],
    aiJudgment:
      "Pure deterministic arithmetic without neural networks or LLMs. Decisions that move money must be auditable line-by-line and mathematically verifiable.",
    diagram: {
      title: "Expected Rupee Net Value Formulation",
      flowType: "linear",
      nodes: [
        { id: "prob", label: "P(Recovery)", sublabel: "Model prediction", type: "input" },
        { id: "amt", label: "Transaction Amount", sublabel: "Rupee value at stake", type: "input" },
        { id: "cost", label: "Unit Cost Table", sublabel: "₹0 to ₹15 per action", type: "input" },
        { id: "ev_calc", label: "EV = (P × Amount) - Cost", sublabel: "Pure arithmetic", type: "process" },
        { id: "ev_out", label: "Expected Net Rupees", sublabel: "Financial score per action", type: "output" },
      ],
      connections: [
        { from: "prob", to: "ev_calc" },
        { from: "amt", to: "ev_calc" },
        { from: "cost", to: "ev_calc" },
        { from: "ev_calc", to: "ev_out", label: "Marginal net value" },
      ],
      takeaway: "Prevents spending ₹15 on a voice call to recover a ₹50 payment — money only moves when EV is strictly positive.",
    },
    codeRef: "backend/app/ev_engine.py",
    route: "/dashboard/policy-comparison",
    routeLabel: "Compare Policy Economics",
  },
  {
    sNo: "04",
    name: "Multi-Stage Deterministic Guardrail Layer",
    category: "Guardrails & Risk Policy",
    badge: "Hard Regulatory Rules",
    summary:
      "Hard operational and regulatory constraints enforced before optimization, ensuring zero policy breaches or dark patterns.",
    howItWorks: [
      "Rule 0 (Fraud Block Suppression): Any payment failed due to fraud_block is immediately collapsed to [no_action]. No retries, messages, or calls are ever permitted.",
      "Rule 1 (Voice Call Threshold): voice_call is strictly prohibited unless transaction amount ≥ ₹5,000.",
      "Rule 2 (Customer Suppression List): Opted-out customers can only receive non-contact actions (no_action or retry_now).",
      "Rule 3 (Contact Frequency Cap): Maximum of 2 contact attempts per failed payment; additional outreach is blocked.",
      "Rule 4 (Dark Pattern Scanner): Automated scan rejecting false urgency, confirm-shaming, or fabricated scarcity.",
    ],
    aiJudgment:
      "Strict code guardrails, never prompt-engineered LLM guardrails. Hard financial, legal, and anti-fraud boundaries cannot rely on probabilistic model compliance.",
    diagram: {
      title: "Deterministic Guardrail Filter Cascade",
      flowType: "branching",
      nodes: [
        { id: "in_menu", label: "Full Menu (7)", sublabel: "All candidate actions", type: "input" },
        { id: "g_fraud", label: "Fraud Check", sublabel: "Is fraud_block?", type: "guardrail" },
        { id: "g_voice", label: "Voice Filter", sublabel: "Amount ≥ ₹5,000?", type: "guardrail" },
        { id: "g_supp", label: "Suppression List", sublabel: "Customer opted out?", type: "guardrail" },
        { id: "g_cap", label: "Frequency Cap", sublabel: "Contacts < 2?", type: "guardrail" },
        { id: "eligible", label: "Eligible Set", sublabel: "Surviving actions with reasons", type: "output" },
      ],
      connections: [
        { from: "in_menu", to: "g_fraud" },
        { from: "g_fraud", to: "g_voice" },
        { from: "g_voice", to: "g_supp" },
        { from: "g_supp", to: "g_cap" },
        { from: "g_cap", to: "eligible", label: "Filtered legal choices" },
      ],
      takeaway: "Guardrails run *before* the optimizer, capturing exact human-readable rejection reasons for every filtered choice.",
    },
    codeRef: "backend/app/guardrails.py",
    route: "/dashboard/decisions/pay_2ff975708893",
    routeLabel: "Inspect Rejection Reasons",
  },
  {
    sNo: "05",
    name: "Guardrail-Filtered Argmax Optimizer",
    category: "Core Decision Engine",
    badge: "Constrained Optimization",
    summary:
      "Selects the single intervention maximizing expected net value among guardrail-eligible candidates, recording all rejected alternatives.",
    howItWorks: [
      "Filters the action menu through all deterministic guardrails first.",
      "Computes EV for each surviving option and selects argmax(EV).",
      "Ties break deterministically using standard static menu ordering.",
      "Logs every rejected candidate alongside its EV and why it lost, directly powering the 'Why Not This Action?' trust panel.",
      "Surfaces critical trust cases: e.g. when an action had the highest raw EV but was rightfully vetoed by a compliance guardrail.",
    ],
    aiJudgment:
      "Mathematical argmax over surviving set. Eliminates LLM decision drift and ensures decisions are fully deterministic, auditable, and reproducible.",
    diagram: {
      title: "Constrained Policy Optimization",
      flowType: "linear",
      nodes: [
        { id: "menu_ev", label: "Evaluated Candidates", sublabel: "Eligible actions with EVs", type: "input" },
        { id: "argmax", label: "Argmax(EV)", sublabel: "Deterministic selection", type: "process" },
        { id: "winner", label: "Optimal Intervention", sublabel: "Highest expected net value", type: "output" },
        { id: "audit_loss", label: "Rejected Alternatives", sublabel: "Logged with loss reasons", type: "output" },
      ],
      connections: [
        { from: "menu_ev", to: "argmax" },
        { from: "argmax", to: "winner", label: "Select winner" },
        { from: "argmax", to: "audit_loss", label: "Record competitors" },
      ],
      takeaway: "Never hides rejected options; preserves the entire decision boundary for complete operational transparency.",
    },
    codeRef: "backend/app/optimizer.py",
    route: "/dashboard",
    routeLabel: "Open Decision Queue",
  },
  {
    sNo: "06",
    name: "Bootstrap Ensemble Confidence & Escalation Gate",
    category: "AI Reliability & Safety",
    badge: "20-Model Ensemble",
    summary:
      "Measures epistemic model uncertainty via a 20-member bootstrap ensemble; automatically escalates high-disagreement decisions to human ops.",
    howItWorks: [
      "Trains 20 parallel HistGradientBoosting models on bootstrap resamples of the training data.",
      "Uncertainty is defined as the standard deviation (spread) across the 20 ensemble predictions for the chosen intervention.",
      "High/Medium/Low confidence tiers are calibrated from empirical 33rd and 67th percentiles of held-out disagreement.",
      "If ensemble disagreement reaches or exceeds the 95th percentile (p95), the autonomous pipeline halts and marks the decision as ESCALATE.",
      "Escalated decisions take no automated customer contact, trigger no charges, and route directly to a human operator.",
    ],
    aiJudgment:
      "Statistical ensemble disagreement rather than arbitrary heuristic distance from 50%. A true confidence gate based on model consensus.",
    diagram: {
      title: "Ensemble Uncertainty & Human Escalation Gate",
      flowType: "branching",
      nodes: [
        { id: "ctx", label: "Decision Context", sublabel: "Payment & Customer Data", type: "input" },
        { id: "ens", label: "20 Bootstrap Models", sublabel: "Independently resampled fits", type: "ml" },
        { id: "spread", label: "Compute Disagreement", sublabel: "Std dev of predictions", type: "process" },
        { id: "check_p95", label: "Spread ≥ p95?", sublabel: "Top 5% highest uncertainty", type: "decision" },
        { id: "act", label: "Autonomous Execution", sublabel: "High / Med / Low tier action", type: "output" },
        { id: "esc", label: "Escalate to Human Ops", sublabel: "Terminal safe state", type: "guardrail" },
      ],
      connections: [
        { from: "ctx", to: "ens" },
        { from: "ens", to: "spread" },
        { from: "spread", to: "check_p95" },
        { from: "check_p95", to: "act", label: "Normal uncertainty (<p95)" },
        { from: "check_p95", to: "esc", label: "Extreme uncertainty (≥p95)" },
      ],
      takeaway: "Prevents autonomous blunders by knowing when the model does not know.",
    },
    codeRef: "backend/app/probability_model.py",
    endpoint: "GET /decide/demo/low-confidence",
    route: "/dashboard/metrics",
    routeLabel: "Inspect Uncertainty Tiers",
  },
  {
    sNo: "07",
    name: "Grounded LLM Ops Explanation Generator",
    category: "Core Decision Engine",
    badge: "Anthropic Claude (Sole LLM)",
    summary:
      "The only LLM component in the entire system: synthesizes structured, deterministic decision parameters into concise human rationales.",
    howItWorks: [
      "Receives strictly verified upstream facts: chosen action, estimated P(recovery), EV, unit cost, and payment context.",
      "Generates an operational 1-2 sentence rationale for merchants without ever making financial or policy choices.",
      "Gracefully falls back to a deterministic text template if ANTHROPIC_API_KEY is not configured.",
      "Generated text passes through an automated dark-pattern keyword scanner to prevent manipulative language.",
      "Escalated decisions skip the LLM entirely, serving a fixed safety notification.",
    ],
    aiJudgment:
      "Deliberately restricted LLM usage to natural-language synthesis. Financial calculations, guardrails, and optimization are kept strictly deterministic.",
    diagram: {
      title: "Grounded Natural Language Explanation Boundary",
      flowType: "linear",
      nodes: [
        { id: "facts", label: "Deterministic Decision", sublabel: "Action, EV, Odds, Guardrail state", type: "input" },
        { id: "prompt", label: "Grounded Prompt", sublabel: "Strictly factual context injection", type: "process" },
        { id: "llm", label: "Anthropic Claude", sublabel: "Natural language generation", type: "ml" },
        { id: "scan", label: "Dark Pattern Scan", sublabel: "Verify zero urgency/shaming", type: "guardrail" },
        { id: "text", label: "Ops Rationale", sublabel: "Auditable human explanation", type: "output" },
      ],
      connections: [
        { from: "facts", to: "prompt" },
        { from: "prompt", to: "llm" },
        { from: "llm", to: "scan" },
        { from: "scan", to: "text", label: "Verified clean text" },
      ],
      takeaway: "The LLM explains what happened; it never decides what happens.",
    },
    codeRef: "backend/app/explain.py",
    route: "/dashboard/decisions/pay_2ff975708893",
    routeLabel: "View Generated Rationale",
  },
  {
    sNo: "08",
    name: "Audit Trail & 'Why Not This Action?' Inspector",
    category: "Core Decision Engine",
    badge: "Full Transparency",
    summary:
      "Maintains an immutable audit ledger of every decision, exposing winning and losing candidate evaluations side-by-side.",
    howItWorks: [
      "Captures every evaluation metric across all 7 actions: recovery probability, ensemble spread, unit cost, and expected net value.",
      "Records specific guardrail rejection codes (e.g. 'Amount < ₹5,000 threshold', 'Customer opted out').",
      "Stores timestamp, customer ID, canonical demo markers, and live Razorpay payment link IDs.",
      "Feeds the interactive Decision Drill-Down interface directly from memory/database without recalculation.",
    ],
    aiJudgment:
      "Built directly from deterministic state structures. Ensures every rupee gained or spent is defensible to compliance auditors.",
    diagram: {
      title: "Audit Trail & Decision Drill-Down",
      flowType: "linear",
      nodes: [
        { id: "decide_run", label: "Decision Event", sublabel: "POST /decide execution", type: "input" },
        { id: "audit_obj", label: "AuditRecord Object", sublabel: "Winner + 6 Rejections + EVs", type: "process" },
        { id: "log_store", label: "Audit Log Store", sublabel: "Immutable decision ledger", type: "process" },
        { id: "ui_panel", label: "'Why Not?' UI Inspector", sublabel: "Side-by-side comparative cards", type: "output" },
      ],
      connections: [
        { from: "decide_run", to: "audit_obj" },
        { from: "audit_obj", to: "log_store" },
        { from: "log_store", to: "ui_panel", label: "Instant inspection" },
      ],
      takeaway: "Turns opaque black-box AI decisions into transparent, defensible financial statements.",
    },
    codeRef: "backend/app/models.py",
    endpoint: "GET /decisions",
    route: "/dashboard/decisions/pay_2ff975708893",
    routeLabel: "Open Decision Drill-Down",
  },
  {
    sNo: "09",
    name: "Live Razorpay Test-Mode Payment Link Integration",
    category: "Execution & Verification",
    badge: "Razorpay Sandbox API",
    summary:
      "Direct API integration with Razorpay's live sandbox to generate real payment recovery links when sms_link is selected.",
    howItWorks: [
      "Triggers automatically when the optimizer selects sms_link on an explicit POST /decide call.",
      "Calls Razorpay's real test-mode API (POST /v1/payment_links) with customer phone, email, and amount in paise.",
      "Attaches the live sandbox URL to the audit record for immediate merchant inspection.",
      "Gracefully handles missing or invalid API keys by setting structured error fields without crashing the pipeline.",
    ],
    aiJudgment:
      "Real test-mode API integration proving end-to-end execution. Replaces mock-only stubs with verified payment gateway communication.",
    diagram: {
      title: "Razorpay Test-Mode Link Execution",
      flowType: "branching",
      nodes: [
        { id: "opt_sms", label: "Chosen Action: sms_link", sublabel: "Optimizer recommendation", type: "input" },
        { id: "rzp_client", label: "Razorpay Client", sublabel: "Auth check & payload builder", type: "process" },
        { id: "api_call", label: "POST /v1/payment_links", sublabel: "Razorpay sandbox gateway", type: "process" },
        { id: "success_link", label: "Live Payment URL", sublabel: "e.g. rzp.io/i/...", type: "output" },
        { id: "err_fallback", label: "Structured Fallback", sublabel: "Logs payment_link_error cleanly", type: "guardrail" },
      ],
      connections: [
        { from: "opt_sms", to: "rzp_client" },
        { from: "rzp_client", to: "api_call", label: "Sandbox keys present" },
        { from: "api_call", to: "success_link", label: "200 OK from Razorpay" },
        { from: "rzp_client", to: "err_fallback", label: "Missing keys / network timeout" },
      ],
      takeaway: "Connects autonomous algorithmic decisions directly to real financial infrastructure.",
    },
    codeRef: "backend/app/razorpay_client.py",
    route: "/dashboard",
    routeLabel: "View Payment Links in Queue",
  },
  {
    sNo: "10",
    name: "Payment Success Score (PSS) Pre-Attempt Intelligence",
    category: "Payment Intelligence",
    badge: "Pre-Failure ML",
    summary:
      "Estimates payment success probabilities across UPI, Card, Netbanking, and Wallet before checkout is attempted, recommending the best route.",
    howItWorks: [
      "Operates prior to transaction failure using live gateway conditions: latency (ms), gateway error rate, traffic load index, and merchant uptime.",
      "Scores four payment methods simultaneously via a separate HistGradientBoostingClassifier.",
      "Ranks payment methods and flags the optimal method to dynamically arrange checkout options.",
      "Calculates degradation impact by contrasting live scores against a fixed 'healthy benchmark' reference condition.",
      "Includes interactive 'What-If' condition sliders allowing operators to simulate gateway outages in real-time.",
    ],
    aiJudgment:
      "Separate machine learning pipeline with distinct boundaries. Pre-failure method scoring does not mix with post-failure recovery economics.",
    diagram: {
      title: "Pre-Checkout Dynamic Routing Pipeline",
      flowType: "linear",
      nodes: [
        { id: "telemetry", label: "Live Telemetry", sublabel: "Latency, Error Rate, Traffic Load", type: "input" },
        { id: "pss_model", label: "PSS ML Model", sublabel: "Trained on gateway trial data", type: "ml" },
        { id: "method_scores", label: "Method Ranking", sublabel: "Scores for UPI, Card, Netbanking, Wallet", type: "process" },
        { id: "checkout_rec", label: "Recommended Route", sublabel: "Dynamic checkout ordering", type: "output" },
      ],
      connections: [
        { from: "telemetry", to: "pss_model" },
        { from: "pss_model", to: "method_scores" },
        { from: "method_scores", to: "checkout_rec", label: "Reorder payment UI" },
      ],
      takeaway: "Prevents failed payments before they occur by routing users to resilient gateway rails.",
    },
    codeRef: "backend/app/pss_scorer.py",
    endpoint: "POST /pss/score",
    route: "/payments",
    routeLabel: "Test PSS What-If Sliders",
  },
  {
    sNo: "11",
    name: "Recovery Negotiation Engine",
    category: "Negotiation & Settlement",
    badge: "Dynamic Incentive Curve",
    summary:
      "Solves optimal variable incentive (discount/voucher) allocation for high-friction recoveries, identifying maximum net value and minimum effective spend.",
    howItWorks: [
      "Accepts RVE's chosen communication channel and explores incentive levels from 0% up to 25% of transaction amount.",
      "Applies a closed-form diminishing-returns elasticity curve over the model's base probability.",
      "Identifies three distinct milestones: Max Probability, Optimal Net Value, and Minimum Effective Incentive (cheapest incentive achieving 95% of optimum value).",
      "Suppresses incentive allocation if failure reason is fraud_block or if customer is unsuppressed.",
      "Helps merchants avoid over-discounting customers who would have completed payment with lower concessions.",
    ],
    aiJudgment:
      "Closed-form elasticity mathematics rather than unconstrained LLM negotiation. Guarantees profit margin preservation and predictable financial boundaries.",
    diagram: {
      title: "Elasticity Ladder & Net Value Optimization",
      flowType: "branching",
      nodes: [
        { id: "neg_in", label: "Failed Payment Context", sublabel: "Base P(Rec) & Amount", type: "input" },
        { id: "ladder", label: "Incentive Ladder", sublabel: "0% to 25% steps", type: "process" },
        { id: "elastic", label: "Elasticity Curve", sublabel: "Diminishing probability gains", type: "process" },
        { id: "opt_val", label: "Net Optimal Incentive", sublabel: "Max Net Revenue", type: "output" },
        { id: "min_eff", label: "Min-Effective Incentive", sublabel: "95% value at lowest discount", type: "output" },
      ],
      connections: [
        { from: "neg_in", to: "ladder" },
        { from: "ladder", to: "elastic" },
        { from: "elastic", to: "opt_val", label: "Argmax(Net EV)" },
        { from: "elastic", to: "min_eff", label: "Budget-saving threshold" },
      ],
      takeaway: "Eliminates margin sacrifice by computing the smallest concession necessary to drive conversion.",
    },
    codeRef: "backend/app/negotiation_engine.py",
    endpoint: "POST /recovery-negotiation/analyze",
    route: "/recovery-negotiation",
    routeLabel: "Run Negotiation Simulation",
  },
  {
    sNo: "12",
    name: "Recovery Lab: Revenue Recovery Digital Twin",
    category: "Strategic Simulation",
    badge: "Macro Strategy Simulator",
    summary:
      "Simulates recovery operations at portfolio scale under real-world constraints (call capacity, budgets, contact caps) with live interactive sliders.",
    howItWorks: [
      "Simulates 4 competing policies simultaneously (No Action, Always Retry, Aggressive Outreach, RVE Adaptive).",
      "Applies hard operational constraints: maximum voice call hours, total discount budget, customer contact frequency limits.",
      "Provides live interactive sliders with 70ms debounced recomputation and Monte Carlo confidence intervals.",
      "Includes an automated Sensitivity Sweep discovering the exact optimal operating budget and capacity threshold.",
      "Calculates incremental net revenue gains directly against hidden simulator ground truth.",
    ],
    aiJudgment:
      "High-speed vectorized matrix math running in pure Python/NumPy, enabling instantaneous sub-100ms what-if scenario exploration.",
    diagram: {
      title: "Digital Twin Policy Constraint Simulator",
      flowType: "branching",
      nodes: [
        { id: "const", label: "Merchant Constraints", sublabel: "Budget, Agent Hours, Caps", type: "input" },
        { id: "batch", label: "Failed Cohort (500)", sublabel: "Synthetic payment population", type: "input" },
        { id: "twin", label: "Digital Twin Engine", sublabel: "Constrained allocation & priority queue", type: "process" },
        { id: "rve_pol", label: "RVE Adaptive Net", sublabel: "Optimal budget allocation", type: "output" },
        { id: "comp_pol", label: "3 Baseline Policies", sublabel: "Do-Nothing, Retry, Aggressive", type: "output" },
      ],
      connections: [
        { from: "const", to: "twin" },
        { from: "batch", to: "twin" },
        { from: "twin", to: "rve_pol", label: "Optimized allocation" },
        { from: "twin", to: "comp_pol", label: "Baseline benchmark" },
      ],
      takeaway: "Empowers merchant CFOs to test operational policies before deploying capital in production.",
    },
    codeRef: "backend/app/recovery_lab.py",
    endpoint: "POST /recovery-lab/simulate",
    route: "/recovery-lab",
    routeLabel: "Open Recovery Lab Simulator",
  },
  {
    sNo: "13",
    name: "Revenue Recovery Autopsy: Forensic Loss Chain",
    category: "Loss Forensics",
    badge: "Root-Cause Diagnostics",
    summary:
      "Deconstructs lost revenue into a multi-stage forensic loss chain, providing a Pareto root-cause breakdown and Fix-First action priority.",
    howItWorks: [
      "Classifies all cohort revenue into 5 states: Initial Losses, Natural Decay, Guardrail Blocked, Failed Outreach, and Permanently Lost.",
      "Builds a Pareto breakdown of technical, banking, and fraud root causes.",
      "Ranks a 'Fix-First' engineering list sorted by: Preventable Loss × Technical Feasibility ÷ Estimated Fix Cost.",
      "Maintains strict read-only guarantees: inspects audit records and simulated outcomes without altering live engine state.",
    ],
    aiJudgment:
      "Deterministic diagnostic analytics. Turns post-mortem payment data into structured ROI-ranked engineering tickets.",
    diagram: {
      title: "Forensic Loss Chain & Fix-First Prioritization",
      flowType: "linear",
      nodes: [
        { id: "history", label: "Historical Decisions", sublabel: "Audit ledger & realized outcomes", type: "input" },
        { id: "chain", label: "5-Stage Loss Chain", sublabel: "Trace drainage stage-by-stage", type: "process" },
        { id: "pareto", label: "Root Cause Pareto", sublabel: "Timeout vs Funds vs Auth", type: "process" },
        { id: "fix_first", label: "Fix-First Prioritization", sublabel: "Sorted by Preventable ROI", type: "output" },
      ],
      connections: [
        { from: "history", to: "chain" },
        { from: "chain", to: "pareto" },
        { from: "pareto", to: "fix_first", label: "Ranked remediation" },
      ],
      takeaway: "Tells engineering teams which checkout bugs cost the most money and are easiest to solve.",
    },
    codeRef: "backend/app/revenue_autopsy.py",
    endpoint: "GET /revenue-autopsy/summary",
    route: "/revenue-autopsy",
    routeLabel: "Examine Revenue Autopsy",
  },
  {
    sNo: "14",
    name: "Four-Policy Offline Benchmark Evaluator",
    category: "Execution & Verification",
    badge: "Analytical Benchmark",
    summary:
      "Rigorous offline policy evaluator measuring RVE against Do-Nothing, Naive Always-Retry, and Sophisticated Rule-Based Heuristics.",
    howItWorks: [
      "Accesses the simulator's hidden ground truth to compute exact expected revenue across 4 policies on the same held-out batch.",
      "Policy 1 (Do Nothing): Baseline floor representing purely organic customer recovery.",
      "Policy 2 (Always Retry Now): The standard naive implementation built by most developers.",
      "Policy 3 (Rule-Based Heuristic): Sophisticated merchant rule engine (e.g. retry on timeout, SMS on funds, email on card).",
      "Policy 4 (RVE Value Engine): Maximizes net rupee recovery after deducting unit intervention expenses.",
    ],
    aiJudgment:
      "Analytical evaluation against synthetic ground truth rather than fabricated live A/B claims. Clear, honest scientific boundaries.",
    diagram: {
      title: "Four-Policy Benchmark Comparison",
      flowType: "branching",
      nodes: [
        { id: "heldout", label: "Held-Out Batch (500)", sublabel: "Identical evaluation cohort", type: "input" },
        { id: "eval_core", label: "Evaluator Core", sublabel: "Analytical expectation engine", type: "process" },
        { id: "p1", label: "1. Do Nothing", sublabel: "Floor organic benchmark", type: "output" },
        { id: "p2", label: "2. Always Retry", sublabel: "Naive common submission", type: "output" },
        { id: "p3", label: "3. Rule Heuristics", sublabel: "Merchant rule-based logic", type: "output" },
        { id: "p4", label: "4. RVE Engine", sublabel: "Highest net value per rupee", type: "output" },
      ],
      connections: [
        { from: "heldout", to: "eval_core" },
        { from: "eval_core", to: "p1" },
        { from: "eval_core", to: "p2" },
        { from: "eval_core", to: "p3" },
        { from: "eval_core", to: "p4", label: "Outperforms all baselines" },
      ],
      takeaway: "Beating a naive retry bot is easy; beating a tuned rule heuristic is the true test of machine intelligence.",
    },
    codeRef: "backend/app/evaluator.py",
    endpoint: "GET /evaluate",
    route: "/dashboard/policy-comparison",
    routeLabel: "View 4-Policy Results",
  },
  {
    sNo: "15",
    name: "Smart Recovery Timing & Clearinghouse Windowing",
    category: "Payment Intelligence",
    badge: "Roadmap Research Preview",
    summary:
      "Preview model simulating optimal dispatch timing for retries and nudges to align with banking clearinghouse cycles and salary dates.",
    howItWorks: [
      "Simulates time-of-day and cyclical banking recovery curves.",
      "Contrasts immediate retry against optimal dispatch windowing (e.g. holding retry until morning clearinghouse window).",
      "Models customer availability cycles to prevent sending intrusive nudges during dormant late-night hours.",
      "Isolated roadmap preview endpoint cleanly segregated from the live decision pipeline.",
    ],
    aiJudgment:
      "Simulated temporal mechanics demonstrating future architectural expansion without destabilizing core decisioning.",
    diagram: {
      title: "Temporal Dispatch & Window Optimization",
      flowType: "linear",
      nodes: [
        { id: "time_in", label: "Failure Timestamp", sublabel: "Time of day & day of month", type: "input" },
        { id: "decay_curve", label: "Banking Window Model", sublabel: "Clearinghouse uptime cycles", type: "process" },
        { id: "delay_decision", label: "Dispatch Scheduler", sublabel: "Immediate vs Window Delay", type: "decision" },
        { id: "window_out", label: "Optimal Retry Window", sublabel: "Maximizes clearance odds", type: "output" },
      ],
      connections: [
        { from: "time_in", to: "decay_curve" },
        { from: "decay_curve", to: "delay_decision" },
        { from: "delay_decision", to: "window_out", label: "Scheduled execution" },
      ],
      takeaway: "Timing matters as much as channel: retrying an insufficient-funds failure at 3 AM is guaranteed to fail.",
    },
    codeRef: "backend/app/timing_preview.py",
    endpoint: "GET /timing-preview/scenarios",
    route: "/timing-preview",
    routeLabel: "Explore Timing Windows",
  },
  {
    sNo: "16",
    name: "Resilient Chaos Recovery & Fault Isolation",
    category: "Execution & Verification",
    badge: "Battle-Tested Resilience",
    summary:
      "Enterprise failure recovery mechanisms covering external API timeouts, missing telemetry, corrupt data, and runaway retries.",
    howItWorks: [
      "API Timeout Fallback: If Anthropic or Razorpay times out, decisions complete with fallback templates and error logs without hanging the HTTP worker.",
      "Unresolvable Reference Safety: Queries for non-existent transactions return strict 404 responses without unhandled 500 crashes.",
      "Audit-Linked Retry Caps: Contact frequency caps are wired to real-time audit logs, preventing loops even under aggressive retries.",
      "Fast Startup Probe: Health readiness probe (/health) allows frontends to smoothly gate UI rendering during backend model fits.",
    ],
    aiJudgment:
      "Architectural defense-in-depth. Every external service boundary has a deterministic fallback, ensuring 100% service availability.",
    diagram: {
      title: "Fault Isolation & Graceful Degradation",
      flowType: "branching",
      nodes: [
        { id: "fault_in", label: "System Fault / Timeout", sublabel: "Anthropic down / Bad payload", type: "input" },
        { id: "circuit", label: "Resilience Boundary", sublabel: "Timeout guard & validation", type: "guardrail" },
        { id: "fallback_run", label: "Deterministic Fallback", sublabel: "Template rationale + audit record", type: "process" },
        { id: "healthy_resp", label: "200 OK Safe Response", sublabel: "Zero user-facing crashes", type: "output" },
      ],
      connections: [
        { from: "fault_in", to: "circuit" },
        { from: "circuit", to: "fallback_run", label: "Graceful trap" },
        { from: "fallback_run", to: "healthy_resp", label: "Logged and resolved" },
      ],
      takeaway: "Failures are contained at the boundary, ensuring payment operations never freeze.",
    },
    codeRef: "backend/tests/test_failure_scenarios.py",
    endpoint: "GET /health",
    route: "/dashboard",
    routeLabel: "Inspect Resilient Dashboard",
  },
];
