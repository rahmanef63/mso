// MSO-specific composition surface. Generic shell/runtime APIs belong to
// @/features/appshell; this module owns only the MSO brand, manifest additions
// and capability adapters that compose that framework into the product.
export {
  TOPSIDE_BRAND,
  TOPSIDE_FEATURES,
  TOPSIDE_PERSIST_KEY,
  BUILTIN_APPS,
} from "./shell.manifest";
export { topsideCapabilities } from "./capabilities";
export { A11yCommands } from "./a11y-commands";

// Built-in live wallpapers are MSO registrations into the generic AppShell
// registry. Importing the composition surface performs that registration once.
import "./live-wallpapers";
