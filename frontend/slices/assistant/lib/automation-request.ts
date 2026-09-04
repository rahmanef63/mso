import { toolById } from "./tools";
import type { Automation } from "./types";

export function composeAutomationRequest(auto: Automation, agentName: string): string {
  const lines = auto.steps.map((step, index) => {
    const tool = toolById(step.tool);
    const context = step.argText ? ` — requested args/context: ${step.argText}` : "";
    return `${index + 1}. ${step.tool}${tool?.name ? ` (${tool.name})` : ""}${context}`;
  });
  return [
    `Run my saved Alfa automation “${auto.name}” using the ${agentName} persona.`,
    "Execute these steps in order through the listed MSO host tools. Inspect/validate before each dependent step; do not claim success without the tool result. Mutations must use the normal human approval cards.",
    lines.join("\n") || "No steps are configured; explain that and stop.",
  ].join("\n\n");
}
