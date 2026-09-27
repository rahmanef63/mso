export type JevDecisionType = "choice" | "noul" | "score";
export type JevDecisionId =
  | "workflow.optimize"
  | "session.optimize"
  | "action.select"
  | "action.verify"
  | "model.route"
  | "context.admit"
  | "memory.admit"
  | "failure.triage"
  | "recipe.promote";

export type JevDecisionDefinition = {
  id: JevDecisionId;
  version: number;
  type: JevDecisionType;
  instructions: string;
  criteria?: Record<string, string> | string[];
  candidateSource: string;
  threshold: number;
  fallbackBehavior: string;
  telemetryPolicy: "metadata-only";
  allowedDownstreamActions: string[];
  verificationStrategy: string;
};

const DEFINITIONS: Record<JevDecisionId, JevDecisionDefinition> = {
  "workflow.optimize": {
    id:"workflow.optimize",version:1,type:"noul",
    instructions:"Apply this bounded workflow optimization only when it improves the route without weakening semantics, authorization, verification, auditability, or debuggability.",
    candidateSource:"deterministic workflow optimizer",threshold:.72,fallbackBehavior:"deterministic optimizer",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["workflow preview","explicit review apply"],
    verificationStrategy:"graph schema + deterministic workflow tests",
  },
  "session.optimize": {
    id:"session.optimize",version:1,type:"noul",
    instructions:"Select only bounded continuation, route-reuse, or compaction candidates that preserve evidence and authorization boundaries.",
    candidateSource:"deterministic semantic session projection",threshold:.5,fallbackBehavior:"no semantic recommendation",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["LLM context packet","preservation receipt"],
    verificationStrategy:"exact session/archive digest + live-state recheck",
  },
  "action.select": {
    id:"action.select",version:1,type:"noul",
    instructions:"Select only host-generated actions that are useful for the stated intent. Selection never grants execution authority.",
    candidateSource:"MSO capability catalog + caller-bounded candidates",threshold:.65,fallbackBehavior:"no action",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["explicit safe read execution through Capability Runtime"],
    verificationStrategy:"capability digest + policy recheck + post-action semantic verification",
  },
  "action.verify": {
    id:"action.verify",version:1,type:"noul",
    instructions:"Decide whether the bounded execution evidence satisfies the stated intent. Deterministic status and tests remain authoritative.",
    candidateSource:"post-action bounded evidence",threshold:.7,fallbackBehavior:"verification unknown",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["mark semantic verification signal"],
    verificationStrategy:"compare with deterministic execution result",
  },
  "model.route": {
    id:"model.route",version:1,type:"choice",
    instructions:"Choose the cheapest route that can safely satisfy the task; escalate when uncertainty or reasoning requirements justify it.",
    criteria:{
      "no-llm":"Deterministic code or an existing verified route is sufficient.",
      "cheap-local":"A cheap/local generative model is sufficient.",
      "frontier":"A frontier general model is needed.",
      "reasoning-escalation":"A higher-reasoning model is needed.",
      "ask-human":"Human input or authorization is required before continuing.",
    },
    candidateSource:"host routing policy",threshold:.6,fallbackBehavior:"current configured model",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["model route recommendation only"],
    verificationStrategy:"downstream success/cost telemetry",
  },
  "context.admit": {
    id:"context.admit",version:1,type:"noul",
    instructions:"Include this evidence in expensive-model context only when it is materially useful for the current task.",
    candidateSource:"bounded host evidence candidates",threshold:.55,fallbackBehavior:"deterministic context bounds",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["context inclusion recommendation"],
    verificationStrategy:"downstream answer/tool outcome telemetry",
  },
  "memory.admit": {
    id:"memory.admit",version:1,type:"choice",
    instructions:"Classify whether this bounded observation deserves durable memory. Prefer ignore when it is transient, redundant, unsafe, or unsupported.",
    criteria:{
      ignore:"Do not persist.",
      episodic:"Persist as time-bound event/history.",
      semantic:"Persist as a durable fact or preference.",
      procedural:"Persist as a reusable procedure or successful route.",
      "candidate-recipe":"Retain only as a recipe candidate that still needs evidence and promotion review.",
    },
    candidateSource:"automatic observed-memory candidate",threshold:.7,fallbackBehavior:"existing deterministic admission policy",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["non-destructive memory write","recipe candidate"],
    verificationStrategy:"memory provenance + maturity/evidence rules; never deletion",
  },
  "failure.triage": {
    id:"failure.triage",version:1,type:"choice",
    instructions:"Choose the safest next response to the bounded failure evidence.",
    criteria:{
      retry:"Retry the same bounded route when the failure is plausibly transient.",
      "alternate-tool":"Use a different already-allowed tool.",
      "alternate-provider":"Use a different configured provider.",
      "escalate-model":"Escalate reasoning/generation capability.",
      "human-review":"Require human review or authorization.",
      "stop-safely":"Stop without further side effects.",
    },
    candidateSource:"host failure policy",threshold:.6,fallbackBehavior:"stop safely",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["bounded retry/alternate/escalation recommendation"],
    verificationStrategy:"next-attempt deterministic outcome",
  },
  "recipe.promote": {
    id:"recipe.promote",version:1,type:"score",
    instructions:"Score how mature this repeated route is for promotion. A high score is advisory only; existing tests, evidence, and explicit promotion remain mandatory.",
    criteria:[
      "Unproven or unsafe repetition.",
      "Repeated but weak or conflicting evidence.",
      "Useful candidate with incomplete verification.",
      "Strong repeated evidence and passing bounded tests.",
      "Promotion-ready evidence; still requires explicit existing promotion authority.",
    ],
    candidateSource:"learned recipe maturity/evidence",threshold:.8,fallbackBehavior:"remain candidate",
    telemetryPolicy:"metadata-only",allowedDownstreamActions:["reviewable promotion candidate only"],
    verificationStrategy:"existing recipe/Tool Forge tests + explicit promotion",
  },
};

export function getJevDecisionDefinition(id: JevDecisionId): JevDecisionDefinition {
  return DEFINITIONS[id];
}
export function listJevDecisionDefinitions(): JevDecisionDefinition[] {
  return Object.values(DEFINITIONS).map((row)=>({...row,criteria:Array.isArray(row.criteria)?[...row.criteria]:row.criteria?{...row.criteria}:undefined,allowedDownstreamActions:[...row.allowedDownstreamActions]}));
}
