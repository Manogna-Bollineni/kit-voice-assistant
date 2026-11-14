import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqliteStore, RECORD_TABLES } from '../database/db.js';
import { executeTool, RECORD_TABLE_FOR } from '../agent/tools.js';

const REQUEST = {
  id: 109, student_id: 100, student_name: 'Arjun K', class_code: 'CSE-2A', type: 'on_duty', from_date: '2026-12-04', to_date: '2026-12-04',
  half_day: false, reason: 'Hackathon', event_name: 'SIH', status: 'pending', decided_by: null, decision_note: null, created_at: '2026-11-14T06:00:00Z',
};

test('records are stored with the API schema columns and updated in place by id', async () => {
  const store = await openSqliteStore(':memory:');
  assert.equal(await store.saveRecord('requests', REQUEST, 'conv-1'), true);
  await store.saveRecord('requests', { ...REQUEST, status: 'approved', decided_by: 97, decision_note: 'OK' }, 'conv-2');
  const rows = await store.records('requests');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'approved');
  assert.equal(rows[0].decided_by, 97);
  assert.equal(rows[0].half_day, 0);
  assert.equal(rows[0].conversation_id, 'conv-1', 'keeps the conversation that created it');
  await store.close();
});

test('users, applications and placement registrations tables exist and accept API payloads', async () => {
  const store = await openSqliteStore(':memory:');
  await store.saveRecord('users', { id: 100, login_id: 'arjun', full_name: 'Arjun K', role: 'student', department: 'CSE', class_id: 41, class_code: 'CSE-2A', programme: 'UG', year_of_study: 2, notes: null });
  await store.saveRecord('admission_applications', { id: 5, full_name: 'Rohan', phone: '+91 9876543210', email: 'r@x.in', course_code: 'BTECH-ECE', twelfth_percent: 72.5, status: 'submitted', created_at: 'now' }, 'c');
  await store.saveRecord('placement_registrations', { id: 7, drive_id: 26, company: 'TCS', student_id: 100, registered_at: 'now' }, 'c');
  assert.equal((await store.records('users'))[0].login_id, 'arjun');
  assert.equal((await store.records('admission_applications'))[0].twelfth_percent, 72.5);
  assert.equal((await store.records('placement_registrations'))[0].company, 'TCS');
  assert.equal(await store.saveRecord('requests', { reason: 'no id' }), false);
  assert.equal(await store.saveRecord('not_a_table', { id: 1 }), false);
  await store.close();
});

test('every write tool maps to a known table', () => {
  for (const table of Object.values(RECORD_TABLE_FOR)) assert.ok(RECORD_TABLES[table], table);
});

test('successful writes are recorded; failed or blocked ones are not; a storage failure does not fail the action', async () => {
  const saved = [];
  const kit = { post: async () => REQUEST, get: async () => ({}) };
  const ctx = (userText, onRecord) => ({ kit, token: 't', role: 'student', user: { login_id: 'arjun' }, conversationId: 'c', userText, onRecord });
  const args = { type: 'on_duty', from_date: '2026-12-04', to_date: '2026-12-04', reason: 'Hackathon', event_name: 'SIH', user_confirmed: true };

  await executeTool('submit_leave_or_od_request', args, ctx('yes', (t, d) => saved.push([t, d.id])));
  assert.deepEqual(saved, [['requests', 109]]);

  await executeTool('submit_leave_or_od_request', args, ctx('submit it', (t, d) => saved.push([t, d.id])));
  assert.equal(saved.length, 1, 'blocked without a yes, so nothing recorded');

  const r = await executeTool('submit_leave_or_od_request', args, ctx('yes', async () => { throw new Error('db down'); }));
  assert.equal(r.isError, false);
});
