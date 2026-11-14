import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKitClient, KitApiError } from '../services/collegeApi.js';
import { fakeFetch } from './helpers.js';

const make = (routes) => {
  const fetchImpl = fakeFetch(routes);
  return { kit: createKitClient({ baseUrl: 'https://kit.test', participantKey: 'pk', fetchImpl }), fetchImpl };
};

test('sends participant key, bearer token and idempotency key', async () => {
  const { kit, fetchImpl } = make({ 'POST /v1/me/requests': { id: 1 } });
  await kit.post('/v1/me/requests', { token: 'jwt', body: { a: 1 }, idempotencyKey: 'idem' });
  const h = fetchImpl.calls[0].init.headers;
  assert.equal(h['X-Participant-Key'], 'pk');
  assert.equal(h.Authorization, 'Bearer jwt');
  assert.equal(h['Idempotency-Key'], 'idem');
  assert.equal(fetchImpl.calls[0].init.body, '{"a":1}');
});

test('drops empty query params', async () => {
  const { kit, fetchImpl } = make({ 'GET /v1/calendar': [] });
  await kit.get('/v1/calendar', { query: { from: '2026-11-01', to: undefined, x: '' } });
  assert.equal(fetchImpl.calls[0].url.search, '?from=2026-11-01');
});

test('normalises college error JSON into KitApiError', async () => {
  const { kit } = make({
    'POST /v1/me/requests': { status: 409, body: { error: { code: 'exam_day', message: 'No leave on exam days', field: 'from_date' } } },
  });
  await assert.rejects(kit.post('/v1/me/requests', { body: {} }), (err) => {
    assert.ok(err instanceof KitApiError);
    assert.equal(err.status, 409);
    assert.equal(err.code, 'exam_day');
    assert.equal(err.field, 'from_date');
    return true;
  });
});

test('normalises FastAPI validation errors', async () => {
  const { kit } = make({ 'POST /v1/auth/login': { status: 422, body: { detail: [{ loc: ['body', 'password'], msg: 'Field required' }] } } });
  await assert.rejects(kit.login('a', ''), /password: Field required/);
});

test('retries a GET once on 5xx but never retries a POST', async () => {
  let gets = 0;
  let posts = 0;
  const { kit } = make({
    'GET /v1/courses': () => (++gets === 1 ? { status: 502, body: {} } : [{ code: 'BTECH-CSE' }]),
    'POST /v1/me/requests': () => {
      posts++;
      return { status: 503, body: {} };
    },
  });
  assert.deepEqual(await kit.get('/v1/courses'), [{ code: 'BTECH-CSE' }]);
  await assert.rejects(kit.post('/v1/me/requests', { body: {} }));
  assert.equal(gets, 2);
  assert.equal(posts, 1);
});

test('network failure becomes an "unreachable" error', async () => {
  const kit = createKitClient({ baseUrl: 'https://kit.test', participantKey: 'pk', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(kit.get('/v1/today'), (err) => err.code === 'unreachable');
});
