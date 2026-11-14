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

test('logged-in context includes the live calendar so rescheduled dates win over circular text', async () => {
  let context;
  const provider = { name: 'claude', run: async (p) => ((context = p.context), { text: 'ok' }) };
  const liveKit = {
    get: async (path) =>
      path === '/v1/today'
        ? { date: '2026-11-21', weekday_name: 'Saturday', timezone: 'Asia/Kolkata' }
        : [{ date: '2026-11-25', type: 'internal_exam', title: 'DBMS Internal Assessment Exam (Rescheduled)', subject_code: 'CS304', status: 'active' }],
  };
  const agent = createAgent({ providers: [provider], knowledge, kit: liveKit, logger: silentLogger });
  await agent.respond({ role: 'student', user: { login_id: 'arjun', full_name: 'Arjun K', role: 'student', programme: 'UG' }, token: 't', text: 'When is my DBMS exam?' });
  assert.match(context, /2026-11-25 internal_exam: DBMS Internal Assessment Exam \(Rescheduled\) \[CS304\]/);
  await agent.respond({ role: 'public', text: 'hi' });
  assert.doesNotMatch(context, /Upcoming calendar/, 'public visitors get no student calendar');
});

test('replies are cleaned for speech: markdown lists become one sentence, plain text untouched', async () => {
  const { toSpokenText } = await import('../services/history.js');
  assert.equal(toSpokenText('Bring these:\n\n- **10th** mark sheet\n- Aadhaar card\n- Photos.'), 'Bring these: 10th mark sheet, Aadhaar card, Photos.');
  assert.equal(toSpokenText('Your attendance is 76 percent.\nIn CS304 it is also 76.'), 'Your attendance is 76 percent.\nIn CS304 it is also 76.');
  assert.equal(toSpokenText('## Fees\n1. Tuition 1,25,000 rupees'), 'Fees\nTuition 1,25,000 rupees');
});

test('a failover reuses reads from the failed provider instead of calling the college system again', async () => {
  let calls = 0;
  const countingKit = { get: async (path) => (path === '/v1/me' ? (calls++, { name: 'Arjun' }) : kit.get(path)) };
  const callsProfile = (fail) => ({
    name: fail ? 'primary' : 'backup',
    run: async (p) => {
      await p.executeTool('get_my_profile', {});
      if (fail) throw new Error('timeout after tool');
      return { text: 'ok' };
    },
  });
  const agent = createAgent({ providers: [callsProfile(true), callsProfile(false)], knowledge, kit: countingKit, logger: silentLogger });
  const out = await agent.respond({ role: 'student', user: { login_id: 'arjun' }, token: 't', text: 'my profile' });
  assert.equal(calls, 1, 'profile fetched once');
  assert.equal(out.actions.length, 1, 'action logged once');
});

test('live calendar facts are cached between turns of the same session', async () => {
  let calendarCalls = 0;
  const cachingKit = { get: async (path) => (path === '/v1/calendar' ? (calendarCalls++, []) : kit.get(path)) };
  const provider = { name: 'p', run: async () => ({ text: 'ok' }) };
  const agent = createAgent({ providers: [provider], knowledge, kit: cachingKit, logger: silentLogger });
  for (let i = 0; i < 3; i++) await agent.respond({ role: 'student', user: { login_id: 'arjun' }, token: 't', text: 'hi' });
  assert.equal(calendarCalls, 1);
});

test('reads after a write in the same turn are fetched fresh, not reused', async () => {
  let listCalls = 0;
  const writeKit = {
    get: async (path) => (path === '/v1/me/requests' ? (listCalls++, []) : kit.get(path)),
    post: async () => ({ id: 7, status: 'cancelled' }),
  };
  const provider = {
    name: 'p',
    run: async (p) => {
      await p.executeTool('list_my_requests', {});
      await p.executeTool('cancel_my_request', { id: 7, user_confirmed: true });
      await p.executeTool('list_my_requests', {});
      return { text: 'ok' };
    },
  };
  const agent = createAgent({ providers: [provider], knowledge, kit: writeKit, logger: silentLogger });
  await agent.respond({ role: 'student', user: { login_id: 'arjun' }, token: 't', text: 'yes, cancel it' });
  assert.equal(listCalls, 2);
});

test('a rate-limited provider is skipped on the next turn, and used again when all are cooling down', async () => {
  let primaryCalls = 0;
  const primary = { name: 'big', run: async () => { primaryCalls++; throw new Error('big rate limited'); } };
  const backup = { name: 'small', run: async () => ({ text: 'ok' }) };
  const agent = createAgent({ providers: [primary, backup], knowledge, kit, logger: silentLogger });
  await agent.respond({ role: 'public', text: 'hi' });
  const second = await agent.respond({ role: 'public', text: 'hi again' });
  assert.equal(primaryCalls, 1, 'primary skipped while cooling down');
  assert.equal(second.provider, 'small');

  const lone = createAgent({ providers: [primary], knowledge, kit, logger: silentLogger });
  await assert.rejects(lone.respond({ role: 'public', text: 'a' }), AgentUnavailableError);
  await assert.rejects(lone.respond({ role: 'public', text: 'b' }), AgentUnavailableError);
  assert.equal(primaryCalls, 3, 'with every provider cooling down, it still tries rather than refusing');
});
