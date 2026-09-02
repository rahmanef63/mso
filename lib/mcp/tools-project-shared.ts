import { resolveProjectHint } from "@/lib/host/projects-api";
import { opt } from "./tool-kit";

export async function selectedProject(value: string) {
  const project = await resolveProjectHint(value);
  if (!project) throw new Error(`project not found: ${value}`);
  return project;
}

export function databaseDeployment(a: Record<string, unknown>): string | undefined {
  return opt(a, "deployment");
}
