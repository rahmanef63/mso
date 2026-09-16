// Provider CONNECTION registry — separate from the capability/pricing catalog (hermes lesson).
// Each entry: how to REACH a provider (baseUrl + wire protocol) and which env vars hold its key.
// catalogId maps our slug -> models.dev provider id (for metadata lookup in catalog.js).
// ponytail: hand-maintained table of the common providers; add rows as needed — no plugin system.

export const PROVIDERS = {
  openai:     { baseUrl: 'https://api.openai.com/v1',                          protocol: 'openai',    envVars: ['OPENAI_API_KEY'],                catalogId: 'openai' },
  anthropic:  { baseUrl: 'https://api.anthropic.com',                          protocol: 'anthropic', envVars: ['ANTHROPIC_API_KEY'],             catalogId: 'anthropic' },
  google:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], catalogId: 'google' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1',                       protocol: 'openai',    envVars: ['OPENROUTER_API_KEY'],            catalogId: 'openrouter' },
  opencode:   { baseUrl: 'https://opencode.ai/zen/v1',                         protocol: 'openai',    envVars: ['OPENCODE_API_KEY'],              catalogId: 'opencode' },
  groq:       { baseUrl: 'https://api.groq.com/openai/v1',                     protocol: 'openai',    envVars: ['GROQ_API_KEY'],                  catalogId: 'groq' },
  deepseek:   { baseUrl: 'https://api.deepseek.com',                           protocol: 'openai',    envVars: ['DEEPSEEK_API_KEY'],              catalogId: 'deepseek' },
  xai:        { baseUrl: 'https://api.x.ai/v1',                                protocol: 'openai',    envVars: ['XAI_API_KEY'],                   catalogId: 'xai' },
  mistral:    { baseUrl: 'https://api.mistral.ai/v1',                          protocol: 'openai',    envVars: ['MISTRAL_API_KEY'],               catalogId: 'mistral' },
  moonshotai: { baseUrl: 'https://api.moonshot.ai/v1',                         protocol: 'openai',    envVars: ['MOONSHOT_API_KEY'],              catalogId: 'moonshotai' },
  // expanded OpenAI-compatible providers
  togetherai:       { baseUrl: 'https://api.together.xyz/v1',            protocol: 'openai', envVars: ['TOGETHER_API_KEY'],   catalogId: 'togetherai' },
  'fireworks-ai':   { baseUrl: 'https://api.fireworks.ai/inference/v1',  protocol: 'openai', envVars: ['FIREWORKS_API_KEY'],  catalogId: 'fireworks-ai' },
  cerebras:         { baseUrl: 'https://api.cerebras.ai/v1',             protocol: 'openai', envVars: ['CEREBRAS_API_KEY'],   catalogId: 'cerebras' },
  perplexity:       { baseUrl: 'https://api.perplexity.ai',              protocol: 'openai', envVars: ['PERPLEXITY_API_KEY'], catalogId: 'perplexity' },
  deepinfra:        { baseUrl: 'https://api.deepinfra.com/v1/openai',    protocol: 'openai', envVars: ['DEEPINFRA_API_KEY'],  catalogId: 'deepinfra' },
  nebius:           { baseUrl: 'https://api.studio.nebius.com/v1',       protocol: 'openai', envVars: ['NEBIUS_API_KEY'],     catalogId: 'nebius' },
  hyperbolic:       { baseUrl: 'https://api.hyperbolic.xyz/v1',          protocol: 'openai', envVars: ['HYPERBOLIC_API_KEY'], catalogId: 'hyperbolic' },
  sambanova:        { baseUrl: 'https://api.sambanova.ai/v1',            protocol: 'openai', envVars: ['SAMBANOVA_API_KEY'],  catalogId: 'sambanova' },
  novita:           { baseUrl: 'https://api.novita.ai/v3/openai',        protocol: 'openai', envVars: ['NOVITA_API_KEY'],     catalogId: 'novita' },
  cohere:           { baseUrl: 'https://api.cohere.ai/compatibility/v1', protocol: 'openai', envVars: ['COHERE_API_KEY', 'CO_API_KEY'], catalogId: 'cohere' },
  glm:              { baseUrl: 'https://api.z.ai/api/paas/v4',           protocol: 'openai', envVars: ['GLM_API_KEY', 'ZHIPUAI_API_KEY'], catalogId: 'zhipuai' },
  'github-models':  { baseUrl: 'https://models.github.ai/inference',     protocol: 'openai', envVars: ['GITHUB_TOKEN'],       catalogId: 'github-models' },
  'vercel-gateway': { baseUrl: 'https://ai-gateway.vercel.sh/v1',        protocol: 'openai', envVars: ['AI_GATEWAY_API_KEY'], catalogId: 'vercel' },
  // latest additions — slug === models.dev provider id (moonshotai already serves kimi-k2.7).
  'moonshotai-cn':  { baseUrl: 'https://api.moonshot.cn/v1',                        protocol: 'openai', envVars: ['MOONSHOT_API_KEY'],    catalogId: 'moonshotai-cn' },
  nvidia:           { baseUrl: 'https://integrate.api.nvidia.com/v1',              protocol: 'openai', envVars: ['NVIDIA_API_KEY'],      catalogId: 'nvidia' },
  huggingface:      { baseUrl: 'https://router.huggingface.co/v1',                 protocol: 'openai', envVars: ['HF_TOKEN'],           catalogId: 'huggingface' },
  alibaba:          { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', protocol: 'openai', envVars: ['DASHSCOPE_API_KEY'], catalogId: 'alibaba' },
  siliconflow:      { baseUrl: 'https://api.siliconflow.com/v1',                   protocol: 'openai', envVars: ['SILICONFLOW_API_KEY'], catalogId: 'siliconflow' },
  'ollama-cloud':   { baseUrl: 'https://ollama.com/v1',                            protocol: 'openai', envVars: ['OLLAMA_API_KEY'],      catalogId: 'ollama-cloud' },
  xiaomi:           { baseUrl: 'https://api.xiaomimimo.com/v1',                    protocol: 'openai', envVars: ['XIAOMI_API_KEY'],      catalogId: 'xiaomi' },
  baseten:          { baseUrl: 'https://inference.baseten.co/v1',                  protocol: 'openai', envVars: ['BASETEN_API_KEY'],     catalogId: 'baseten' },
  'nano-gpt':       { baseUrl: 'https://nano-gpt.com/api/v1',                      protocol: 'openai', envVars: ['NANO_GPT_API_KEY'],   catalogId: 'nano-gpt' },
  zenmux:           { baseUrl: 'https://zenmux.ai/api/v1',                         protocol: 'openai', envVars: ['ZENMUX_API_KEY'],     catalogId: 'zenmux' },
}

