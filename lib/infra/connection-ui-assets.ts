// Static assets the connection manager script needs inline.
//
// Kept out of connection-ui.ts so that file stays under the 220-line architecture ratchet, and
// because these are build-time string preparation, not UI logic.
import { MSO_LOGO_SVG } from "@/lib/presentation/logo";
import { PROVIDER_ICON_PATHS } from "./provider-icons";

/** The brand mark with its own labelling removed: it is decorative here, since the product name
 *  already appears as text right next to it. */
export const MSO_BRAND_ICON_SVG = MSO_LOGO_SVG.replace(/\s*role="img"/, "")
  .replace(/\s*aria-label="[^"]*"/, "")
  .replace("<svg", '<svg aria-hidden="true"');

/** The preamble that ships both constants into the browser script. */
export const CONNECTION_MANAGER_ASSETS =
  `const PROVIDER_ICON_PATHS=${JSON.stringify(PROVIDER_ICON_PATHS)};` +
  `const MSO_LOGO_SVG=${JSON.stringify(MSO_BRAND_ICON_SVG)};`;
