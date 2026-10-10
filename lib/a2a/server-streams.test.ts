import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(os.tmpdir(), "mso-a2a-streams-"));
process.env.OS_A2A_CREDENTIAL_STORE = path.join(root, "outbound.json");
process.env.OS_A2A_INBOUND_TOKEN_STORE = path.join(root, "inbound.json");
process.env.OS_A2A_TASK_STORE = path.join(root, "tasks.json");
process.env.OS_A2A_INBOUND_ENABLED = "1";
process.env.OS_PUBLIC_ORIGIN = "https://mso.example.test";
process.env.NEXT_PUBLIC_OS_DEMO = "0";
const runner = vi.hoisted(() => vi.fn());
vi.mock("./inbound-agent", () => ({ runInboundA2AAgent: runner }));
const { createA2AInboundToken, removeA2AInboundToken } = await import("./credentials");
const { createA2ATask } = await import("./tasks");
const { handleA2ARequest } = await import("./server");
const { a2aSseResponse } = await import("./server-execution");
const { publishA2AEvent, registerA2AStream } = await import("./server-events");
const capabilities = { list: () => [], invoke: vi.fn(async () => ({ content: [] })) };
const handle = (req: Request) => handleA2ARequest(req, capabilities);
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const rpc = (token: string | null, body: object) =>
  new Request("https://mso.example.test/a2a/v1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe("authenticated inbound A2A server", () => {
  it("closes standalone task subscriptions on terminal events and credential revocation", async () => {
    const {token,profile} = await createA2AInboundToken("subscription-lifecycle","read");
    const task = await createA2ATask(`a2a:${profile.id}`,"read",{messageId:"lifecycle",role:"ROLE_USER",parts:[{text:"inspect",mediaType:"text/plain"}]});
    const response = await handle(rpc(token,{jsonrpc:"2.0",id:"subscribe",method:"SubscribeToTask",params:{id:task.id}}));
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    publishA2AEvent(task.id,{statusUpdate:{status:{state:"TASK_STATE_COMPLETED"}}});
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("TASK_STATE_COMPLETED");
    expect((await reader.read()).done).toBe(true);
    const revoked = a2aSseResponse("revoked",task,profile,capabilities).body!.getReader();
    await revoked.read();
    await removeA2AInboundToken(profile.id);
    publishA2AEvent(task.id,{artifactUpdate:{private:"must-not-deliver"}});
    expect(await revoked.read()).toEqual({done:true,value:undefined});
  });

  it("bounds simultaneous subscriptions and frees slots on disconnect", async () => {
    const {profile} = await createA2AInboundToken("subscription-limit","read");
    const task = await createA2ATask(`a2a:${profile.id}`,"read",{messageId:"limit",role:"ROLE_USER",parts:[{text:"inspect",mediaType:"text/plain"}]});
    const readers = Array.from({length:8},()=>a2aSseResponse("limit",task,profile,capabilities).body!.getReader());
    await Promise.all(readers.map(reader=>reader.read()));
    expect(a2aSseResponse("excess",task,profile,capabilities).status).toBe(429);
    await readers.pop()!.cancel();
    const freed = a2aSseResponse("freed",task,profile,capabilities);
    expect(freed.status).toBe(200);
    readers.push(freed.body!.getReader());
    await readers.at(-1)!.read();
    await removeA2AInboundToken(profile.id);
    expect((await Promise.all(readers.map(reader=>reader.read()))).every(row=>row.done)).toBe(true);
    const releases: Array<()=>void> = [];
    for(let i=0;i<64;i++) {
      const release = registerA2AStream(`global-fixture-${i}`,()=>{});
      expect(release).not.toBeNull(); releases.push(release!);
    }
    expect(registerA2AStream("global-excess",()=>{})).toBeNull();
    releases.forEach(release=>release());
  });

  it("closes subscriptions on request abort and an absolute deadline", async () => {
    const {profile} = await createA2AInboundToken("subscription-timeout","read");
    const task = await createA2ATask(`a2a:${profile.id}`,"read",{messageId:"timeout",role:"ROLE_USER",parts:[{text:"inspect",mediaType:"text/plain"}]});
    const abort = new AbortController();
    const disconnected = a2aSseResponse("abort",task,profile,capabilities,undefined,undefined,abort.signal).body!.getReader();
    await disconnected.read(); abort.abort();
    expect((await disconnected.read()).done).toBe(true);
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});
    try {
      const timed = a2aSseResponse("timeout",task,profile,capabilities).body!.getReader();
      await timed.read();
      await vi.advanceTimersByTimeAsync(5*60_000);
      expect((await timed.read()).done).toBe(true);
    } finally {vi.useRealTimers();}
  });
});
