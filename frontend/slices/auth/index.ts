// Barrel — the app layer imports the gate + session from here.
export { AuthGate, openOnboarding } from "./components/auth-gate";
export { SessionProvider, useSession, type SessionStatus } from "./lib/use-session";
export type { DeviceRole } from "@/lib/auth/roles";

