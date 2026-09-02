import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_PROVIDER,
  hostCredentialStore,
  readConfig,
  readOAuthBundle,
  resolveModelRef,
  selectedCustomConn,
  writeOAuthBundle,
  type OAuthBundle,
} from "@/lib/config/store";
import { resolveModel } from "@/lib/models";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { ensureFreshCodex } from "@/lib/ai/oauth/codex";
import { streamCodex } from "@/lib/ai/codex-stream";
import { streamOpenAI, type OaMsg, type OaTool } from "@/lib/ai/openai-stream";
import { anthropicDonePayload } from "@/lib/ai/usage";

export type SelectedModelEvent = "delta" | "tool_use" | "done";
export type SelectedModelEmit = (
  event: SelectedModelEvent,
  data: unknown,
) => void;

type ResolvedModel = Awaited<ReturnType<typeof resolveModel>>;
export type PreparedSelectedModel =
  | { kind: "codex"; provider: string; model: string; bundle: OAuthBundle }
  | {
      kind: "anthropic";
      provider: string;
      model: string;
      resolved: ResolvedModel;
      customProvider: boolean;
    }
  | {
      kind: "openai";
      provider: string;
      model: string;
      resolved: ResolvedModel;
      customProvider: boolean;
    };

export class SelectedModelConfigError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "SelectedModelConfigError";
  }
}

export async function prepareSelectedModel(): Promise<PreparedSelectedModel> {
  const cfg = await readConfig();
  const provider = cfg.provider || DEFAULT_PROVIDER;
  if (provider === "openai-codex") {
    const existing = await readOAuthBundle("openai-codex");
    if (!existing)
      throw new SelectedModelConfigError(`no_api_key:${provider}`, 501);
    try {
      const bundle = await ensureFreshCodex(existing);
      if (bundle !== existing) await writeOAuthBundle("openai-codex", bundle);
      if (!cfg.model)
        throw new SelectedModelConfigError("model_not_selected", 400);
      return { kind: "codex", provider, model: cfg.model, bundle };
    } catch (error) {
      if (error instanceof SelectedModelConfigError) throw error;
      throw new SelectedModelConfigError("oauth_refresh_failed", 502);
    }
  }

  try {
    const custom = await selectedCustomConn();
    const resolved = await resolveModel(await resolveModelRef(), {
      store: hostCredentialStore(),
      baseUrl: custom?.baseUrl,
      protocol: custom?.protocol,
    });
    return {
      kind: resolved.protocol === "anthropic" ? "anthropic" : "openai",
      provider,
      model: resolved.model,
      resolved,
      customProvider: Boolean(custom),
    } as PreparedSelectedModel;
  } catch (error) {
    if (error instanceof SelectedModelConfigError) throw error;
    throw new SelectedModelConfigError(`no_api_key:${provider}`, 501);
  }
}

function toAnthropic(messages: OaMsg[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      if (message.text?.trim())
        out.push({ role: "user", content: message.text });
      continue;
    }
    if (message.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.text?.trim())
        content.push({ type: "text", text: message.text });
      for (const tool of message.toolUses ?? [])
        content.push({
          type: "tool_use",
          id: tool.id,
          name: tool.name,
          input: tool.input,
        });
      if (content.length) out.push({ role: "assistant", content });
      continue;
    }
    out.push({
      role: "user",
      content: message.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id,
        content: result.content,
        is_error: result.isError,
      })),
    });
  }
  return out;
}

export async function streamPreparedSelectedModel(opts: {
  prepared: PreparedSelectedModel;
  messages: OaMsg[];
  tools?: OaTool[];
  system: string;
  signal: AbortSignal;
  emit: SelectedModelEmit;
}): Promise<void> {
  const { prepared, messages, tools, system, signal, emit } = opts;
  if (prepared.kind === "codex") {
    await streamCodex({
      bundle: prepared.bundle,
      model: prepared.model,
      messages,
      tools,
      system,
      signal,
      emit,
    });
    return;
  }
  if (prepared.kind === "openai") {
    await streamOpenAI({
      resolved: prepared.resolved,
      messages,
      tools,
      system,
      signal,
      emit,
      ...(prepared.customProvider ? { fetchImpl: safeProviderFetch } : {}),
    });
    return;
  }

  const anthropic = new Anthropic({
    apiKey: prepared.resolved.apiKey,
    baseURL: prepared.resolved.baseUrl,
    ...(prepared.customProvider ? { fetch: safeProviderFetch } : {}),
  });
  const ai = anthropic.messages.stream(
    {
      model: prepared.resolved.model,
      max_tokens: 4096,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: toAnthropic(messages),
      ...(tools?.length ? { tools: tools as Anthropic.Tool[] } : {}),
    },
    { signal },
  );
  for await (const event of ai) {
    if (signal.aborted) break;
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    )
      emit("delta", event.delta.text);
  }
  if (signal.aborted) {
    ai.abort();
    return;
  }
  const final = await ai.finalMessage();
  for (const use of final.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  )) {
    emit("tool_use", { id: use.id, name: use.name, input: use.input });
  }
  emit("done", anthropicDonePayload(final));
}
