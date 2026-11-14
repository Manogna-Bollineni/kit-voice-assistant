import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { openSqliteStore } from '../database/db.js';
import { createSessionStore } from '../auth/security.js';
import { KitApiError } from '../services/collegeApi.js';
import { silentLogger } from './helpers.js';

let server;
let base;
let store;
const agentCalls = [];

const kit = {
  get: async (p) => (p === '/v1/college' ? { name: 'KIT' } : [{ code: 'BTECH-CSE' }]),
  login: async (id, pw) => {
    if (pw !== 'Kit@2026') throw new KitApiError(401, 'unauthorized', 'Invalid login ID or password.');
    return { access_token: `secret-jwt-${id}`, expires_in: 28800, user: { id: 1, login_id: id, full_name: id, role: id === 'lakshmi' ? 'teacher' : 'student' } };
  },
};
const agent = {
  hasProviders: () => true,
  respond: async (args) => {
    agentCalls.push(args);
    return { text: `reply to ${args.text}`, actions: [], provider: 'fake' };
  },
};
const transcriber = { available: () => true, transcribe: async () => ({ text: 'spoken words', provider: 'fake-stt' }) };
const knowledge = { status: () => ({ documents: [] }) };

before(async () => {
  store = await openSqliteStore(':memory:');
  const app = createApp({ kit, agent, transcriber, store, sessions: createSessionStore(), knowledge, logger: silentLogger });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await store.close();
});

function client() {
  const jar = {};
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      jar[k] = v;
    }
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}

test('login keeps the college token on the server', async () => {
  const c = client();
  const r = await c('/api/auth/login', { method: 'POST', body: { login_id: 'arjun', password: 'Kit@2026' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.login_id, 'arjun');
  assert.doesNotMatch(JSON.stringify(r.data), /secret-jwt/);
  assert.equal((await c('/api/me')).data.user.login_id, 'arjun');
});

test('wrong password gives a clear 401', async () => {
  const r = await client()('/api/auth/login', { method: 'POST', body: { login_id: 'arjun', password: 'nope' } });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /incorrect/);
});

test('member mode needs a login; public mode never gets a token', async () => {
  const c = client();
  assert.equal((await c('/api/assistant/text', { method: 'POST', body: { text: 'my attendance', mode: 'member' } })).status, 401);
  const r = await c('/api/assistant/text', { method: 'POST', body: { text: 'fees?', mode: 'public' } });
  assert.equal(r.status, 200);
  const call = agentCalls.at(-1);
  assert.equal(call.role, 'public');
  assert.equal(call.token, null);
});

test('logged-in member turn uses the session role and token', async () => {
  const c = client();
  await c('/api/auth/login', { method: 'POST', body: { login_id: 'lakshmi', password: 'Kit@2026' } });
  await c('/api/assistant/text', { method: 'POST', body: { text: 'pending requests?', mode: 'member' } });
  const call = agentCalls.at(-1);
  assert.equal(call.role, 'teacher');
  assert.equal(call.token, 'secret-jwt-lakshmi');
});

test('voice turn transcribes server-side and continues the same conversation', async () => {
  const c = client();
  const first = await c('/api/assistant/voice?mode=public', { method: 'POST', body: new Uint8Array(2000), headers: { 'content-type': 'audio/webm;codecs=opus' } });
  assert.equal(first.status, 200);
  assert.equal(first.data.transcript, 'spoken words');
  assert.equal(first.data.sttProvider, 'fake-stt');
  await c(`/api/assistant/voice?mode=public&conversationId=${first.data.conversationId}`, { method: 'POST', body: new Uint8Array(2000), headers: { 'content-type': 'audio/webm' } });
  assert.equal(agentCalls.at(-1).history.length, 2, 'second turn sees the first exchange');
  const hist = await c(`/api/history/${first.data.conversationId}`);
  assert.equal(hist.data.messages.length, 4);
});

test('too-short audio is rejected without calling speech or AI', async () => {
  const before = agentCalls.length;
  const r = await client()('/api/assistant/voice?mode=public', { method: 'POST', body: new Uint8Array(10), headers: { 'content-type': 'audio/webm' } });
  assert.equal(r.status, 400);
  assert.equal(agentCalls.length, before);
});

test('history is private to its owner', async () => {
  const alice = client();
  const bob = client();
  const r = await alice('/api/assistant/text', { method: 'POST', body: { text: 'my secret question', mode: 'public' } });
  const id = r.data.conversationId;
  assert.equal((await alice(`/api/history/${id}`)).status, 200);
  assert.equal((await bob(`/api/history/${id}`)).status, 404);
  assert.ok(!(await bob('/api/history')).data.conversations.some((c) => c.id === id));
  const hijack = await bob('/api/assistant/text', { method: 'POST', body: { text: 'continue', mode: 'public', conversationId: id } });
  assert.notEqual(hijack.data.conversationId, id, 'cannot append to someone else’s conversation');
});

test('security headers are set', async () => {
  const r = await client()('/api/health');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
});

test('health reports college system reachability from /v1/health', async () => {
  const r = await client()('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.collegeSystem.reachable, true);
});
