import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, toolsForRole, TOOLS, isConfirmation } from '../agent/tools.js';
import { KitApiError } from '../services/collegeApi.js';

function fakeKit(impl = {}) {
  const calls = [];
  const rec = (method) => async (path, opts) => {
    calls.push({ method, path, opts });
    return impl[`${method} ${path}`]?.(opts) ?? { ok: true };
  };
  return { calls, get: rec('GET'), post: rec('POST') };
}

const studentCtx = (kit, userText = 'Yes, go ahead.') => ({ kit, token: 'jwt', role: 'student', user: { login_id: 'arjun' }, conversationId: 'c1', userText });

test('public role cannot see or run student/teacher tools', async () => {
  const names = toolsForRole('public').map((t) => t.name);
  assert.ok(names.includes('submit_admission_application'));
  for (const n of ['get_my_attendance', 'submit_leave_or_od_request', 'approve_student_request', 'get_my_profile']) {
    assert.ok(!names.includes(n), n);
  }
  const kit = fakeKit();
  const r = await executeTool('get_my_attendance', {}, { kit, role: 'public' });
  assert.equal(r.isError, true);
  assert.equal(kit.calls.length, 0);
});

test('students cannot run teacher approvals and teachers cannot submit leave', async () => {
  const kit = fakeKit();
  assert.equal((await executeTool('approve_student_request', { id: 1, user_confirmed: true }, studentCtx(kit))).isError, true);
  const teacher = { ...studentCtx(kit), role: 'teacher' };
  assert.equal((await executeTool('submit_leave_or_od_request', { user_confirmed: true }, teacher)).isError, true);
  assert.equal(kit.calls.length, 0);
});

test('every write tool requires explicit user confirmation', async () => {
  const writes = TOOLS.filter((t) => t.write);
  assert.ok(writes.length >= 6);
  for (const t of writes) {
    assert.ok(t.input_schema.required.includes('user_confirmed'), `${t.name} must require user_confirmed`);
    const kit = fakeKit();
    const r = await executeTool(t.name, { id: 1, drive_id: 1 }, { ...studentCtx(kit), role: t.roles[0] });
    assert.equal(r.isError, true);
    assert.match(r.content, /confirm/i);
    assert.equal(kit.calls.length, 0, `${t.name} must not call the API unconfirmed`);
  }
});

test('leave request validation catches bad input before calling the API', async () => {
  const kit = fakeKit();
  const base = { type: 'personal_leave', from_date: '2026-11-25', to_date: '2026-11-24', reason: 'x', user_confirmed: true };
  assert.match((await executeTool('submit_leave_or_od_request', base, studentCtx(kit))).content, /on or before/);
  assert.match(
    (await executeTool('submit_leave_or_od_request', { ...base, type: 'on_duty', to_date: '2026-11-25' }, studentCtx(kit))).content,
    /event_name/,
  );
  assert.match((await executeTool('submit_leave_or_od_request', { ...base, from_date: '25-11-2026' }, studentCtx(kit))).content, /YYYY-MM-DD/);
  assert.equal(kit.calls.length, 0);
});

test('confirmed leave request posts the right body with a stable idempotency key', async () => {
  const kit = fakeKit({ 'POST /v1/me/requests': () => ({ id: 77, status: 'pending' }) });
  const args = { type: 'on_duty', from_date: '2026-11-30', to_date: '2026-11-30', reason: ' Symposium ', event_name: 'TechFest', user_confirmed: true };
  const r1 = await executeTool('submit_leave_or_od_request', args, studentCtx(kit));
  await executeTool('submit_leave_or_od_request', args, studentCtx(kit));
  assert.equal(r1.isError, false);
  assert.match(r1.content, /"id":77/);
  const [a, b] = kit.calls;
  assert.deepEqual(a.opts.body, { type: 'on_duty', from_date: '2026-11-30', to_date: '2026-11-30', half_day: false, reason: 'Symposium', event_name: 'TechFest' });
  assert.equal(a.opts.token, 'jwt');
  assert.ok(a.opts.idempotencyKey);
  assert.equal(a.opts.idempotencyKey, b.opts.idempotencyKey, 'retries of the same request share one key');
});

test('admission application validates email and normalises fields', async () => {
  const kit = fakeKit();
  const ctx = { kit, role: 'public', conversationId: 'c2', userText: 'yes' };
  const bad = { full_name: 'Rohan', phone: '+91 9876543210', email: 'rohan at example', course_code: 'btech-cse', twelfth_percent: 88, user_confirmed: true };
  assert.match((await executeTool('submit_admission_application', bad, ctx)).content, /email/);
  const ok = await executeTool('submit_admission_application', { ...bad, email: 'Rohan@Example.com' }, ctx);
  assert.equal(ok.isError, false);
  assert.equal(kit.calls[0].opts.body.course_code, 'BTECH-CSE');
  assert.equal(kit.calls[0].opts.body.email, 'rohan@example.com');
});

test('college API errors are returned to the model, and 401 signals session expiry', async () => {
  let expired = false;
  const kit = fakeKit({
    'GET /v1/me/attendance': () => {
      throw new KitApiError(401, 'unauthorized', 'Token expired');
    },
  });
  const r = await executeTool('get_my_attendance', {}, { ...studentCtx(kit), onUnauthorized: () => (expired = true) });
  assert.equal(r.isError, true);
  assert.match(r.content, /Token expired/);
  assert.equal(expired, true);
});

test('reject requires a reason', async () => {
  const kit = fakeKit();
  const r = await executeTool('reject_student_request', { id: 5, reason: ' ', user_confirmed: true }, { kit, role: 'teacher', token: 't', conversationId: 'c', userText: 'yes' });
  assert.match(r.content, /reason/i);
  assert.equal(kit.calls.length, 0);
});

test('server blocks writes unless the latest user message is a yes, even if the model sets user_confirmed', async () => {
  const kit = fakeKit();
  const args = { id: 108, user_confirmed: true };
  for (const said of ['Actually, cancel that on-duty request.', 'No, wait.', "Don't do it yet", '']) {
    const r = await executeTool('cancel_my_request', args, studentCtx(kit, said));
    assert.equal(r.isError, true, said);
  }
  assert.equal(kit.calls.length, 0);
  assert.equal((await executeTool('cancel_my_request', args, studentCtx(kit, 'Yes, cancel it.'))).isError, false);
});

test('isConfirmation recognises common spoken yes and no', () => {
  for (const t of ['yes', 'Yeah go ahead', 'okay', 'Sure, submit it', 'haan', 'confirm']) assert.ok(isConfirmation(t), t);
  for (const t of ['no', 'Cancel my leave on Monday', 'wait a second', 'yes... no, stop', 'apply leave tomorrow']) assert.ok(!isConfirmation(t), t);
});
