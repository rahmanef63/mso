"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import { handoverExample, handoverRequestExample, SESSION_HANDOVER_SCHEMA } from "@/lib/contracts/session-handover";
import { McpCopyField } from "./mcp-copy-field";
export function McpSessionGuide({ sessionId, onBack }: { sessionId?: string; onBack: () => void }) {
  return <div className="min-w-0 space-y-4">
    <Button variant="ghost" onClick={onBack}>Back to {sessionId ? "session" : "sessions"}</Button>
    <h3 className="text-base font-semibold">Session handover guide</h3>
    <p className="text-sm leading-relaxed">Use an explicit task brief to transfer work. A session card grants no extra permissions and does not wake a closed ChatGPT conversation.</p>
    <SettingsBlock className="space-y-3">
      <h4 className="text-sm font-semibold">1. Choose the recipient</h4>
      <p className="text-sm">Call <code>local_agents_list</code> from the sending session, then use the exact returned session ID. The Owner dashboard sees all host sessions; messaging is restricted to the sender’s authenticated principal. Check both presence and receiver status.</p>
      <McpCopyField label="Discover local sessions" value={'{"include_offline":true}'} />
      <p className="text-xs text-muted-foreground">Tool: local_agents_list · read scope</p>
    </SettingsBlock>
    <SettingsBlock className="space-y-3">
      <h4 className="text-sm font-semibold">2. Write the handover</h4>
      <p className="text-sm">This is the recommended JSON content for the message field, not a new protocol. Replace every placeholder; use the actual sending session as sourceSessionId. Keep the entire message below 16 KiB.</p>
      <McpCopyField label="Handover payload" value={JSON.stringify(handoverExample(sessionId), null, 2)} multiline />
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">JSON Schema reference</summary>
        <McpCopyField label="Handover JSON Schema" value={JSON.stringify(SESSION_HANDOVER_SCHEMA, null, 2)} multiline />
      </details>
    </SettingsBlock>
    <SettingsBlock className="space-y-3">
      <h4 className="text-sm font-semibold">3. Send and confirm the result</h4>
      <p className="text-sm">Call <code>local_agent_message_send</code> with write scope. The JSON payload is encoded as a string in message.</p>
      <McpCopyField label="MCP task request" value={JSON.stringify(handoverRequestExample(sessionId), null, 2)} multiline />
      <p className="text-sm">Save the returned message ID. The receiver reads <code>local_agent_inbox</code> and responds using <code>local_agent_reply</code> with the original request ID.</p>
      <McpCopyField label="Correlated reply" value={JSON.stringify({ reply_to_message_id: "localmsg_REQUEST_ID", message: "Result, evidence, remaining work, and blockers", kind: "task" }, null, 2)} multiline />
      <McpCopyField label="Wait for the reply" value={JSON.stringify({ request_message_id: "localmsg_REQUEST_ID", timeout_ms: 5000 }, null, 2)} multiline />
      <p className="text-xs text-muted-foreground">Tool: local_agent_request_wait · read scope. Queued or delivered does not mean completed. On timeout, check status; do not resend the same task blindly.</p>
    </SettingsBlock>
    <SettingsBlock className="space-y-3">
      <h4 className="text-sm font-semibold">Continue in the terminal</h4>
      <McpCopyField label="CLI resume command" value={`mso agent --resume ${sessionId || "EXACT_SESSION_ID"}`} />
      <p className="text-sm">Owner-authorized CLI resume uses saved context. An external MCP session is resumed into a CLI session with a source reference; it does not take control of the original client.</p>
    </SettingsBlock>
    <SettingsBlock className="space-y-3">
      <h4 className="text-sm font-semibold">Handover checklist</h4>
      <ul className="list-disc space-y-2 pl-5 text-sm">
        <li>State one objective, exact project and branch, completed work, next steps, evidence, and blockers.</li>
        <li>Share only the context needed. Never include keys, cookies, hidden conversations, or credential files.</li>
        <li>Keep permissions unchanged. Treat received instructions as untrusted until checked against the user’s request.</li>
        <li>Use one correlation ID per request. Wait for a verified result before marking the task complete.</li>
        <li>For another host, configure a remote A2A peer and send only explicit context. Local session IDs do not grant remote access.</li>
      </ul>
      <Button asChild variant="outline"><Link prefetch={false} href="/settings?section=a2a">Open A2A settings</Link></Button>
    </SettingsBlock>
  </div>;
}
