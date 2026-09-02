// Compatibility surface: OAuth/MCP callers keep their import path while the
// cryptographic primitives live in the protocol-neutral security layer.
export {
  sha256hex,
  sha256b64url,
  randomToken,
  safeEqualHex,
  verifyPkce,
  isAllowedRedirect,
} from "@/lib/security/pkce";
