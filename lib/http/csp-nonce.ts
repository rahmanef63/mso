// Injects a per-request CSP nonce into HTML <script> opening tags without duplicating existing nonces.

const SAFE_NONCE = /^[A-Za-z0-9+/=_-]+$/;

export function injectScriptNonces(html: string, nonce: string | null): string {
  if (!nonce || !SAFE_NONCE.test(nonce)) return html;
  return html.replace(/<script(\s[^<>]*)?>/gi, (tag, attrs: string | undefined) => {
    const rest = attrs ?? "";
    if (/\bnonce\s*=/i.test(rest)) return tag;
    return `<script nonce="${nonce}"${rest}>`;
  });
}
