import Anthropic from '@anthropic-ai/sdk';
import { toAlternatingTurns } from '../../services/history.js';

const MAX_STEPS = 8;

export function createClaudeProvider({ apiKey, model, effort, timeoutMs, client }) {
  const anthropic = client ?? new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });

  return {
    name: 'claude',
    compactKnowledge: false,
    async run({ instructions, knowledgeText, context, history, userText, tools, executeTool }) {
      const system = [
        {
          type: 'text',
          text: `${instructions}\n\n<college_documents>\n${knowledgeText}\n</college_documents>`,
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: context },
      ];
      const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
      const messages = [
        ...toAlternatingTurns(history).map((m) => ({ role: m.role, content: m.text })),
        { role: 'user', content: userText },
      ];

      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await anthropic.beta.messages.create({
          model,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort },
          system,
          tools: toolDefs,
          messages,
        });

        if (res.stop_reason === 'refusal') {
          return { text: "Sorry, I can't help with that one. Is there something else about the college I can do?" };
        }
        const text = res.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join(' ')
          .trim();
        if (res.stop_reason !== 'tool_use') {
          return { text: text || 'Sorry, I could not put together an answer. Could you ask again?' };
        }

        messages.push({ role: 'assistant', content: res.content });
        const uses = res.content.filter((b) => b.type === 'tool_use');
        const results = await Promise.all(
          uses.map(async (u) => {
            const r = await executeTool(u.name, u.input);
            return { type: 'tool_result', tool_use_id: u.id, content: r.content, is_error: r.isError };
          }),
        );
        messages.push({ role: 'user', content: results });
      }
      return { text: 'That took more steps than I expected. Could you break the request into smaller parts?' };
    },
  };
}
