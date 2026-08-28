import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { writeConfig, writeOAuthBundle } from "@/lib/config/store";
import { codexStart, codexPoll, codexModels, CODEX } from "@/lib/ai/oauth/codex";
import { setFlow, getFlow, clearFlow } from "@/lib/ai/oauth/flow-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OAuth "sign in with…" for subscription providers. POST { action:"start"|"poll" }.
// Only OpenAI (Codex device-code) is wired today; others return not-supported.
// Session-gated; the token bundle lands in the 0600 host config file, and on
// success the provider is selected so the assistant uses it immediately.
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { provider } = await ctx.params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (provider !== "openai") {
    return NextResponse.json({ error: `${provider} OAuth is not supported yet` }, { status: 400 });
  }

  const SLUG = "openai-codex";
  try {
    switch (body.action) {
      case "start": {
        const { deviceAuthId, userCode, intervalMs } = await codexStart();
        setFlow(SLUG, { deviceAuthId, userCode });
        return NextResponse.json({ verificationUrl: CODEX.verificationUrl, userCode, intervalMs });
      }
      case "poll": {
        const flow = getFlow(SLUG);
        if (!flow?.deviceAuthId || !flow.userCode) return NextResponse.json({ error: "no_flow" }, { status: 400 });
        const res = await codexPoll(flow.deviceAuthId, flow.userCode);
        if ("pending" in res) return NextResponse.json({ pending: true });
        clearFlow(SLUG);
        await writeOAuthBundle(SLUG, res.bundle);
        const models = await codexModels(res.bundle);
        // The account's own first model. No literal fallback — "gpt-5-codex" is refused
        // by the backend, so writing it here just made the first request after a
        // successful sign-in fail.
        const model = models[0] ?? "";
        await writeConfig({ provider: SLUG, model });
        return NextResponse.json({ ok: true, slug: SLUG, model });
      }
      default:
        return NextResponse.json({ error: "bad_action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
