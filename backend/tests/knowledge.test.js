import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentDocuments, createKnowledgeBase, chunk } from '../knowledge/rag.js';
import { cleanText } from '../knowledge/pdfLoader.js';
import { silentLogger } from './helpers.js';

const DOCS = [
  { id: 1, title: 'Handbook 2025', type: 'handbook', version: '2025.1', effective_date: '2025-07-01', applies_to: {} },
  { id: 2, title: 'Handbook 2026', type: 'handbook', version: '2026.1', effective_date: '2026-07-01', applies_to: {} },
  { id: 3, title: 'Brochure 2026', type: 'brochure', version: '2026.1', effective_date: '2026-11-01', applies_to: {} },
  { id: 4, title: 'DBMS notes', type: 'lesson_notes', version: '2026.1', effective_date: '2026-10-22', applies_to: {} },
  { id: 5, title: 'Circular 12/2026', type: 'circular', version: '12/2026', effective_date: '2026-11-01', applies_to: {} },
];

test('keeps only the handbook edition in force and every circular', () => {
  const ids = selectCurrentDocuments(DOCS, '2026-11-21').map((d) => d.id);
  assert.ok(!ids.includes(1), 'superseded 2025 handbook is dropped');
  assert.deepEqual(ids.sort(), [2, 3, 4, 5]);
});

test('does not switch to a handbook that is not yet effective', () => {
  const future = { id: 9, title: 'Handbook 2027', type: 'handbook', version: '2027.1', effective_date: '2027-07-01', applies_to: {} };
  const ids = selectCurrentDocuments([...DOCS, future], '2026-11-21').map((d) => d.id);
  assert.ok(ids.includes(2) && !ids.includes(9));
});

test('circulars are ordered first so they are read before the handbook', () => {
  assert.equal(selectCurrentDocuments(DOCS, '2026-11-21')[0].type, 'circular');
});

test('cleanText strips repeated page footers', () => {
  const t = cleanText('Rule 4.1.1 text\nKIT Handbook 2026 · Edition 2026.1 · page 11 of 40\nmore');
  assert.equal(t, 'Rule 4.1.1 text\nmore');
});

function kitWith(docs, failDocs = false) {
  return {
    get: async (path) => {
      if (path === '/v1/today') return { date: '2026-11-21' };
      if (path === '/v1/documents') {
        if (failDocs) throw new Error('down');
        return docs;
      }
      const id = Number(path.split('/')[3]);
      return new TextEncoder().encode(`text of ${id} attendance minimum 75%`);
    },
  };
}
const extract = async (bytes) => new TextDecoder().decode(bytes);

test('public audience only sees the admissions brochure', async () => {
  const kb = createKnowledgeBase({ kit: kitWith(DOCS), extract, logger: silentLogger });
  await kb.refresh();
  const pub = kb.fullText('public');
  assert.match(pub, /Brochure 2026/);
  assert.doesNotMatch(pub, /Handbook|Circular|DBMS/);
  const member = kb.fullText('member');
  assert.match(member, /Handbook 2026/);
  assert.doesNotMatch(member, /Handbook 2025/);
});

test('a surprise circular appears after refresh and a failed refresh keeps old documents', async () => {
  const docs = [...DOCS];
  let fail = false;
  const kit = kitWith(docs);
  const kb = createKnowledgeBase({
    kit: { get: (p) => (fail && p === '/v1/documents' ? Promise.reject(new Error('down')) : kit.get(p)) },
    extract,
    logger: silentLogger,
  });
  await kb.refresh();
  docs.push({ id: 6, title: 'Circular 13/2026 surprise', type: 'circular', version: '13/2026', effective_date: '2026-11-20', applies_to: {}, is_surprise: true });
  await kb.refresh();
  assert.match(kb.fullText('member'), /Circular 13\/2026 surprise/);
  fail = true;
  await kb.refresh();
  assert.match(kb.fullText('member'), /Circular 13\/2026 surprise/);
});

test('small document sets are sent in full instead of excerpts', async () => {
  const kb = createKnowledgeBase({ kit: kitWith(DOCS), extract, logger: silentLogger });
  await kb.refresh();
  const out = kb.retrieve('public', 'anything', 3500);
  assert.match(out, /Brochure 2026/);
  assert.doesNotMatch(out, /excerpt/);
});

// Real PDF text has single newlines only; a past bug turned it into one oversized chunk that was never sent.
const LONG_HANDBOOK = [
  ...Array.from({ length: 60 }, (_, i) => `4.${i}.1 Filler rule about library fines and hostel timings number ${i}.`),
  '6.4.3 Within 5 working days after the event, the student must submit proof of participation for on-duty.',
  ...Array.from({ length: 60 }, (_, i) => `9.${i}.1 Another filler rule about fee instalments number ${i}.`),
].join('\n');

test('chunk splits single-newline text into bounded pieces at rule numbers', () => {
  const pieces = chunk({ meta: {}, text: LONG_HANDBOOK }, 1200);
  assert.ok(pieces.length > 4);
  assert.ok(pieces.every((p) => p.text.length <= 1300));
  assert.ok(!pieces.some((p) => /^\.\d/.test(p.text)), 'no stray regex capture fragments');
});

test('retrieve finds the matching rule inside a long document and stays within budget', async () => {
  const kit = {
    get: async (path) => {
      if (path === '/v1/today') return { date: '2026-11-21' };
      if (path === '/v1/documents') return DOCS.filter((d) => d.id !== 1);
      const id = Number(path.split('/')[3]);
      return new TextEncoder().encode(id === 2 ? LONG_HANDBOOK : `text of ${id}`);
    },
  };
  const kb = createKnowledgeBase({ kit, extract, logger: silentLogger });
  await kb.refresh();
  const out = kb.retrieve('member', 'deadline to submit proof of participation for on-duty', 2000);
  assert.match(out, /Circular 12\/2026/);
  assert.match(out, /6\.4\.3 Within 5 working days/);
  assert.ok(out.length <= 2600);
});
