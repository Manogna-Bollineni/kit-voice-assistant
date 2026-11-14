import { config } from './config.js';
import { createKitClient } from './services/collegeApi.js';
import { createKnowledgeBase } from './knowledge/rag.js';
import { createAgent } from './agent/orchestrator.js';
import { createClaudeProvider } from './agent/llm/claude.js';
import { createOpenAICompatProvider } from './agent/llm/openaiCompat.js';
import { buildSttProviders, createTranscriber } from './voice/stt.js';
import { openStore } from './database/db.js';
import { createSessionStore } from './auth/security.js';
import { createApp } from './app.js';

if (!config.kit.participantKey) {
  console.error('KIT_PARTICIPANT_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const kit = createKitClient(config.kit);
const knowledge = createKnowledgeBase({ kit, refreshMs: config.knowledgeRefreshMs });

const providers = [];
if (config.claude) providers.push(createClaudeProvider(config.claude));
for (const llm of config.fallbackLlms) providers.push(createOpenAICompatProvider(llm));
if (!providers.length) console.warn('No AI provider key set (ANTHROPIC_API_KEY / GROQ_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY).');

const sttProviders = buildSttProviders(config.stt);
if (!sttProviders.length) console.warn('No speech-to-text key set (GROQ_API_KEY / DEEPGRAM_API_KEY / OPENAI_API_KEY).');

const store = await openStore(config);
const sessions = createSessionStore();
setInterval(() => sessions.sweep(), 10 * 60 * 1000).unref();

await knowledge.start();

const app = createApp({
  kit,
  agent: createAgent({ providers, knowledge, kit }),
  transcriber: createTranscriber(sttProviders),
  store,
  sessions,
  knowledge,
  secureCookies: config.isProd,
});

const server = app.listen(config.port, () => {
  console.log(
    `KIT assistant on http://localhost:${config.port} | AI: ${providers.map((p) => p.name).join(' -> ') || 'none'} | STT: ${sttProviders.map((p) => p.name).join(' -> ') || 'none'} | history: ${config.databaseUrl ? 'postgres' : 'sqlite'}`,
  );
});

function shutdown() {
  knowledge.stop();
  server.close(() => store.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
