import path from "node:path";
import { parse as parseYaml } from "yaml";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import type {
  SkillContract, SkillContractMode, SkillContractSourceOfTruth, SkillContractRefresh,
  SkillContractConfirmation, SkillContractConcurrency, SkillContractPresentationAuthority,
} from "./skill-contract-types";

const CONTRACT_FILE = "contract.yaml";
const CONTRACT_MAX_BYTES = 32 * 1024;
const MODES = new Set(["read", "write", "execute", "mixed"]);
const SOURCES = new Set(["live", "local", "snapshot", "mixed"]);
const REFRESH = new Set(["always", "before-write", "contextual"]);
const RISKS = new Set(["low", "medium", "high"]);
const CONFIRMATIONS = new Set(["none", "contextual", "explicit"]);
const CONCURRENCY = new Set(["none", "hash", "revision", "compare", "contextual"]);
const AUTHORITIES = new Set(["tool", "model", "hybrid"]);

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const strings = (value: unknown, field: string, required = false): string[] | undefined => {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${field} must be a non-empty string array`);
  return value.map((item) => item.trim());
};
const oneOf = (value: unknown, allowed: Set<string>, field: string): string => {
  if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${field} must be one of: ${[...allowed].join(", ")}`);
  return value;
};
const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
};

/** Parse the portable, execution-neutral contract that accompanies trusted skills. */
export function parseSkillContract(value: unknown): SkillContract {
  if (!object(value)) throw new Error("skill contract must be an object");
  if (value.version !== 1) throw new Error("skill contract version must be 1");
  if (!object(value.routing)) throw new Error("skill contract routing is required");
  if (!object(value.context)) throw new Error("skill contract context is required");

  const routing = {
    use_when: strings(value.routing.use_when, "routing.use_when", true)!,
    do_not_use_when: strings(value.routing.do_not_use_when, "routing.do_not_use_when", true)!,
    ...(value.routing.fallback === undefined ? {} : typeof value.routing.fallback === "boolean" ? { fallback: value.routing.fallback } : (() => { throw new Error("routing.fallback must be boolean"); })()),
    ...(strings(value.routing.prefer_over, "routing.prefer_over") ? { prefer_over: strings(value.routing.prefer_over, "routing.prefer_over")! } : {}),
    ...(strings(value.routing.handoff_to, "routing.handoff_to") ? { handoff_to: strings(value.routing.handoff_to, "routing.handoff_to")! } : {}),
  };
  const context = {
    target: optionalString(value.context.target, "context.target") ?? (() => { throw new Error("context.target is required"); })(),
    mode: oneOf(value.context.mode, MODES, "context.mode") as SkillContractMode,
    ...(optionalString(value.context.actor, "context.actor") ? { actor: optionalString(value.context.actor, "context.actor")! } : {}),
  };

  let lifecycle: SkillContract["lifecycle"];
  if (value.lifecycle !== undefined) {
    if (!object(value.lifecycle)) throw new Error("lifecycle must be an object");
    lifecycle = {
      ...(strings(value.lifecycle.discover, "lifecycle.discover") ? { discover: strings(value.lifecycle.discover, "lifecycle.discover")! } : {}),
      ...(strings(value.lifecycle.validate, "lifecycle.validate") ? { validate: strings(value.lifecycle.validate, "lifecycle.validate")! } : {}),
      ...(strings(value.lifecycle.verify, "lifecycle.verify") ? { verify: strings(value.lifecycle.verify, "lifecycle.verify")! } : {}),
    };
  }

  let state: SkillContract["state"];
  if (value.state !== undefined) {
    if (!object(value.state)) throw new Error("state must be an object");
    state = {
      source_of_truth: oneOf(value.state.source_of_truth, SOURCES, "state.source_of_truth") as SkillContractSourceOfTruth,
      refresh: oneOf(value.state.refresh, REFRESH, "state.refresh") as SkillContractRefresh,
    };
  }

  let safety: SkillContract["safety"];
  if (value.safety !== undefined) {
    if (!object(value.safety)) throw new Error("safety must be an object");
    safety = {
      risk: oneOf(value.safety.risk, RISKS, "safety.risk") as "low" | "medium" | "high",
      confirmation: oneOf(value.safety.confirmation, CONFIRMATIONS, "safety.confirmation") as SkillContractConfirmation,
      concurrency: oneOf(value.safety.concurrency, CONCURRENCY, "safety.concurrency") as SkillContractConcurrency,
    };
  }

  let presentation: SkillContract["presentation"];
  if (value.presentation !== undefined) {
    if (!object(value.presentation)) throw new Error("presentation must be an object");
    presentation = {
      authority: oneOf(value.presentation.authority, AUTHORITIES, "presentation.authority") as SkillContractPresentationAuthority,
      ...(optionalString(value.presentation.renderer, "presentation.renderer") ? { renderer: optionalString(value.presentation.renderer, "presentation.renderer")! } : {}),
    };
  }

  return { version: 1, routing, context, ...(lifecycle ? { lifecycle } : {}), ...(state ? { state } : {}), ...(safety ? { safety } : {}), ...(presentation ? { presentation } : {}) };
}

export async function readSkillContract(skillDir: string): Promise<SkillContract | undefined> {
  const raw = await readBoundedRegularFile(path.join(skillDir, CONTRACT_FILE), CONTRACT_MAX_BYTES);
  if (!raw) return undefined;
  return parseSkillContract(parseYaml(raw));
}

export function compactSkillContract(contract: SkillContract) {
  return {
    target: contract.context.target,
    mode: contract.context.mode,
    useWhen: contract.routing.use_when.slice(0, 4),
    doNotUse: contract.routing.do_not_use_when.slice(0, 4),
    handoffTo: contract.routing.handoff_to?.slice(0, 4) ?? [],
    fallback: contract.routing.fallback === true,
    risk: contract.safety?.risk,
    confirmation: contract.safety?.confirmation,
    concurrency: contract.safety?.concurrency,
    sourceOfTruth: contract.state?.source_of_truth,
    refresh: contract.state?.refresh,
    discover: contract.lifecycle?.discover ?? [],
    validate: contract.lifecycle?.validate ?? [],
    verify: contract.lifecycle?.verify ?? [],
  };
}
