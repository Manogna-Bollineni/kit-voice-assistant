import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, AgentUnavailableError } from '../agent/orchestrator.js';
import { recentActionNotes, stripInternalNotes } from '../services/history.js';
import { toAlternatingTurns } from '../services/history.js';
import { createTranscriber, SttUnavailableError } from '../voice/stt.js';
import { silentLogger } from './helpers.js';

const kit = { get: async () => ({ date: '2026-11-21', weekday_name: 'Saturday', timezone: 'Asia/Kolkata' }) };
const knowledge = { fullText: () => 'FULL', retrieve: () => 'EXCERPT' };

test('fails over to the backup provider when the primary throws', async () => {
  const seen = [];
  const primary = { name: 'claude', run: async () => { throw new Error('529 overloaded'); } };
  const backup = {
    name: 'groq',
    compactKnowledge: true,
    run: async (p) => {
      seen.push(p.knowledgeText);
      return { text: 'backup answer' };
    },
  };
  const agent = createAgent({ providers: [primary, backup], knowledge, kit, logger: silentLogger });
  const out = await agent.respond({ role: 'public', text: 'fees?' });
  assert.equal(out.provider, 'groq');
  assert.equal(out.text, 'backup answer');
  assert.deepEqual(seen, ['EXCERPT'], 'backup gets the compact knowledge excerpt');
});

test('throws AgentUnavailableError when every provider fails', async () => {
  const bad = { name: 'x', run: async () => { throw new Error('down'); } };
  const agent = createAgent({ providers: [bad], knowledge, kit, logger: silentLogger });
  await assert.rejects(agent.respond({ role: 'public', text: 'hi' }), AgentUnavailableError);
});

test('passes role-scoped tools, college date and records actions', async () => {
  let params;
  const provider = {
    name: 'claude',
    run: async (p) => {
      params = p;
      await p.executeTool('get_my_attendance', {});
      return { text: 'You are at 76%.' };
    },
  };
  const fakeKit = { get: async (path) => (path === '/v1/today' ? { date: '2026-11-21', weekday_name: 'Saturday', timezone: 'Asia/Kolkata' } : { overall_percentage: 76 }) };
  const agent = createAgent({ providers: [provider], knowledge, kit: fakeKit, logger: silentLogger });
  const out = await agent.respond({ role: 'student', user: { login_id: 'arjun', full_name: 'Arjun K', role: 'student', programme: 'UG' }, token: 't', text: 'attendance?' });
  assert.match(params.context, /2026-11-21/);
  assert.match(params.context, /B\.Tech/);
  assert.equal(params.knowledgeText, 'FULL');
  assert.ok(params.tools.some((t) => t.name === 'get_my_attendance'));
  assert.ok(!params.tools.some((t) => t.name === 'approve_student_request'));
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].ok, true);
});

test('earlier action results reach the context block and echoed notes are stripped', () => {
  const notes = recentActionNotes([{ role: 'assistant', text: 'Submitted.', actions: [{ name: 'submit_leave_or_od_request', args: { type: 'on_duty' }, ok: true, result: '{"id":42}' }] }]);
  assert.match(notes, /"id":42/);
  assert.equal(stripInternalNotes('Cancelled request 109.\n[Actions taken in this turn: cancel_my_request ...]'), 'Cancelled request 109.');
});

test('history is normalised to alternate and start with the user', () => {
  const turns = toAlternatingTurns([
    { role: 'assistant', text: 'greeting' },
    { role: 'user', text: 'a' },
    { role: 'user', text: 'b' },
    { role: 'assistant', text: 'c' },
    { role: 'user', text: 'dangling' },
  ]);
  assert.deepEqual(turns, [
    { role: 'user', text: 'a\nb' },
    { role: 'assistant', text: 'c' },
  ]);
});

test('speech-to-text falls back to the next service', async () => {
  const t = createTranscriber(
    [
      { name: 'groq', transcribe: async () => { throw new Error('500'); } },
      { name: 'deepgram', transcribe: async () => 'what is my attendance' },
    ],
    silentLogger,
  );
  assert.deepEqual(await t.transcribe(Buffer.alloc(10), 'audio/webm'), { text: 'what is my attendance', provider: 'deepgram' });
  const none = createTranscriber([{ name: 'groq', transcribe: async () => { throw new Error('x'); } }], silentLogger);
  await assert.rejects(none.transcribe(Buffer.alloc(1), 'audio/webm'), SttUnavailableError);
});
