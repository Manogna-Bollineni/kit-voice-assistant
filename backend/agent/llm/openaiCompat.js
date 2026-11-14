// LLM provider over any OpenAI-compatible Chat Completions endpoint (Groq, Gemini, OpenAI).
import { toAlternatingTurns } from '../../services/history.js';

const MAX_STEPS = 6;
const MAX_RATE_LIMIT_WAIT_MS = 8000;

/** First sentence only: the detailed rules live in the system prompt, and small rate limits count every token. */
export function shortDescription(text) {
  const first = text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text;
  return first.trim();
}

export class RateLimitedError extends Error {}

function retryAfterMs(res) {
  const s = Number(res.headers.get('retry-after'));
  return Number.isFinite(s) ? s * 1000 : Infinity;
}

export function createOpenAICompatProvider({
  name,
  baseUrl,
  apiKey,
  model,
  extraBody = {},
  knowledgeChars = 3500,
  timeoutMs = 25000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  async function complete(body, attempt = 0) {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...extraBody }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) {
      // A short wait is cheaper than switching models mid-turn; a long one means fail over.
      const wait = retryAfterMs(res);
      if (attempt === 0 && wait <= MAX_RATE_LIMIT_WAIT_MS) {
        await sleep(wait);
        return complete(body, 1);
      }
      throw new RateLimitedError(`${name} rate limited`);
    }
    if (res.status >= 500 && attempt === 0) {
      // Overloaded models (503) often recover within a second.
      await sleep(1000);
      return complete(body, 1);
    }
    if (!res.ok) throw new Error(`${name} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  return {
    name,
    compactKnowledge: true,
    knowledgeChars,
    async run({ instructions, knowledgeText, context, history, userText, tools, executeTool }) {
      const messages = [
        { role: 'system', content: `${instructions}\n\n<college_documents>\n${knowledgeText}\n</college_documents>\n\n${context}` },
        ...toAlternatingTurns(history).map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: userText },
      ];
      const toolDefs = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: shortDescription(t.description), parameters: t.input_schema },
      }));

      for (let step = 0; step < MAX_STEPS; step++) {
        const data = await complete({ model, messages, tools: toolDefs, tool_choice: 'auto', max_tokens: 1000 });
        const msg = data?.choices?.[0]?.message;
        if (!msg) throw new Error(`${name} returned no message`);
        if (!msg.tool_calls?.length) {
          const text = (msg.content ?? '').trim();
          if (!text) throw new Error(`${name} returned an empty reply`);
          return { text };
        }

        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
        const results = await Promise.all(
          msg.tool_calls.map(async (call) => {
            let args;
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'Arguments were not valid JSON' }) };
            }
            const r = await executeTool(call.function.name, args);
            return { role: 'tool', tool_call_id: call.id, content: r.content };
          }),
        );
        messages.push(...results);
      }
      return { text: 'That took more steps than I expected. Could you break the request into smaller parts?' };
    },
  };
}
