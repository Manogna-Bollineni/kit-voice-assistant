// Runs one conversational turn: builds context, picks tools for the role, and fails over across AI providers.
import { toolsForRole, executeTool } from "./tools.js";
import { stableInstructions, contextBlock } from "./prompts.js";
import { stripInternalNotes } from "../services/history.js";

export class AgentUnavailableError extends Error {}

function summarise(name, args, result) {
  const { user_confirmed: _c, ...shown } = args ?? {};
  return {
    name,
    args: shown,
    ok: !result.isError,
    write: Boolean(result.write),
    result: result.content.slice(0, 300),
  };
}

export function createAgent({
  providers,
  knowledge,
  kit,
  logger = console,
  todayTtlMs = 60000,
}) {
  let todayCache = { value: null, at: 0 };

  async function today() {
    if (todayCache.value && Date.now() - todayCache.at < todayTtlMs)
      return todayCache.value;
    try {
      todayCache = { value: await kit.get("/v1/today"), at: Date.now() };
    } catch (err) {
      logger.warn?.(`[agent] could not fetch college date: ${err.message}`);
    }
    return todayCache.value;
  }

  return {
    hasProviders: () => providers.length > 0,
    async respond({
      role,
      user,
      token,
      text,
      history = [],
      recentActions = "",
      conversationId,
      onUnauthorized,
      onRecord,
    }) {
      const audience = role === "public" ? "public" : "member";
      const tools = toolsForRole(role);
      const actions = [];
      const ctx = {
        kit,
        token,
        user,
        role,
        conversationId,
        onUnauthorized,
        onRecord,
        logger,
        userText: text,
      };
      const run = async (name, args) => {
        const result = await executeTool(name, args, ctx);
        actions.push(summarise(name, args, result));
        return result;
      };
      const base = {
        instructions: stableInstructions(role),
        context: contextBlock({ today: await today(), user, recentActions }),
        history,
        userText: text,
        tools,
        executeTool: run,
      };

      const failures = [];
      for (const provider of providers) {
        const started = Date.now();
        try {
          const recentUserText = history
            .filter((m) => m.role === "user")
            .slice(-2)
            .map((m) => m.text)
            .join(" ");
          const knowledgeText = provider.compactKnowledge
            ? knowledge.retrieve(audience, `${recentUserText} ${text}`, provider.knowledgeChars)
            : knowledge.fullText(audience);
          const out = await provider.run({ ...base, knowledgeText });
          logger.info?.(
            `[agent] ${provider.name} answered in ${Date.now() - started}ms with ${actions.length} action(s)`,
          );
          return { text: stripInternalNotes(out.text), actions, provider: provider.name };
        } catch (err) {
          logger.error?.(
            `[agent] ${provider.name} failed after ${Date.now() - started}ms: ${err.message}`,
          );
          failures.push(provider.name);
        }
      }
      throw new AgentUnavailableError(
        `All AI providers failed (${failures.join(", ") || "none configured"})`,
      );
    },
  };
}
