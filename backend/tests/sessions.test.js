import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { openSqliteStore } from '../database/db.js';
import { createSessionStore, safeNextPath } from '../auth/security.js';
import { silentLogger } from './helpers.js';

const user = { id: 100, login_id: 'arjun', full_name: 'Arjun K', role: 'student' };

test('sessions survive a server restart (refresh after redeploy keeps you logged in)', async () => {
  const db = await openSqliteStore(':memory:');
  const before = createSessionStore({ persist: db, secret: 's3cret', logger: silentLogger });
  const id = await before.create('college-jwt', user, 28800);
  const afterRestart = createSessionStore({ persist: db, secret: 's3cret', logger: silentLogger });
  const s = await afterRestart.get(id);
  assert.equal(s.token, 'college-jwt');
  assert.equal(s.user.login_id, 'arjun');
  await db.close();
});

test('the database never stores the raw session id or a readable token', async () => {
  const db = await openSqliteStore(':memory:');
  const sessions = createSessionStore({ persist: db, secret: 's3cret', logger: silentLogger });
  const id = await sessions.create('college-jwt-SECRET', user, 28800);
  const row = await db.loadSession(createHash('sha256').update(id).digest('hex'));
  assert.ok(row, 'stored under the hash of the id');
  assert.doesNotMatch(row.data, /college-jwt-SECRET|arjun/, 'token and user are encrypted');
  assert.equal(await db.loadSession(id), undefined, 'the raw id is not a key');
  await db.close();
});

test('wrong secret, expiry and logout all end the session', async () => {
  const db = await openSqliteStore(':memory:');
  let clock = 1_000_000;
  const a = createSessionStore({ persist: db, secret: 'one', now: () => clock, logger: silentLogger });
  const id = await a.create('t', user, 60);
  assert.equal(await createSessionStore({ persist: db, secret: 'two', logger: silentLogger }).get(id), null, 'cannot decrypt with another secret');
  clock += 61_000;
  assert.equal(await a.get(id), null, 'expired');
  const id2 = await a.create('t', user, 600);
  await a.destroy(id2);
  assert.equal(await createSessionStore({ persist: db, secret: 'one', now: () => clock, logger: silentLogger }).get(id2), null, 'logged out everywhere');
  await db.close();
});

test('post-login redirect only allows same-site paths', () => {
  assert.equal(safeNextPath('/history'), '/history');
  assert.equal(safeNextPath('/assistant?ask=hi'), '/assistant?ask=hi');
  for (const bad of ['//evil.com', 'https://evil.com', '/api/history', 'javascript:alert(1)', '', null]) assert.equal(safeNextPath(bad), '/assistant', String(bad));
});
