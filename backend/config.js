import "dotenv/config";

const env = process.env;

const GROQ_URL = "https://api.groq.com/openai/v1";

// OpenAI-compatible models tried after Claude, in order. Each Groq model has its own rate limit, so chaining them adds headroom.
function fallbackLlms() {
  const list = [];
  if (env.GROQ_API_KEY) {
    const groqModels = (env.GROQ_MODELS || "openai/gpt-oss-120b,openai/gpt-oss-20b")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    for (const model of groqModels) {
      list.push({
        name: `groq:${model}`,
        baseUrl: GROQ_URL,
        apiKey: env.GROQ_API_KEY,
        model,
        extraBody: { reasoning_effort: model.startsWith("qwen/") ? "none" : "low" },
      });
    }
  }
  if (env.GEMINI_API_KEY) {
    for (const model of (env.GEMINI_MODELS || "gemini-3.1-flash-lite,gemini-3.8-flash").split(",").map((m) => m.trim()).filter(Boolean)) {
      list.push({
        name: `gemini:${model}`,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: env.GEMINI_API_KEY,
        model,
        extraBody: {},
      });
    }
  }
  if (env.OPENAI_API_KEY) {
    list.push({
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      extraBody: {},
    });
  }
  return list;
}

export const config = {
  port: Number(env.PORT) || 3000,
  isProd: env.NODE_ENV === "production",
  kit: {
    baseUrl: env.KIT_API_BASE || "https://ht.knowvally.com",
    participantKey: env.KIT_PARTICIPANT_KEY || "",
    timeoutMs: Number(env.KIT_TIMEOUT_MS) || 10000,
  },
  claude: env.ANTHROPIC_API_KEY
    ? {
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.CLAUDE_MODEL || "claude-opus-5-5",
        effort: env.CLAUDE_EFFORT || "low",
        timeoutMs: Number(env.CLAUDE_TIMEOUT_MS) || 30000,
      }
    : null,
  fallbackLlms: fallbackLlms(),
  stt: {
    groqKey: env.GROQ_API_KEY || "",
    openaiKey: env.OPENAI_API_KEY || "",
    deepgramKey: env.DEEPGRAM_API_KEY || "",
    timeoutMs: Number(env.STT_TIMEOUT_MS) || 15000,
  },
  sessionSecret: env.SESSION_SECRET || "",
  databaseUrl: env.DATABASE_URL || "",
  databaseSsl: env.DATABASE_SSL === "true",
  sqlitePath: env.SQLITE_PATH || "data/history.db",
  knowledgeRefreshMs: Number(env.KNOWLEDGE_REFRESH_MS) || 120000,
};
