import { getManagedAppDefinition } from "./catalog";
import { managedAppHealth } from "./health";
import type { ManagedAppId } from "./types";

export async function probeManagedAppRuntime(id: ManagedAppId): Promise<void> {
  if (await managedAppHealth(getManagedAppDefinition(id)) !== true) {
    throw new Error(`${id} is not healthy on its configured loopback endpoint; start the application, then retry mso domain ensure ${id} --apply`);
  }
}
