// Loads college documents live from the API so new circulars ("surprise" documents) are picked up without a redeploy.
import { extractPdfText } from './pdfLoader.js';

const SINGLE_EDITION_TYPES = new Set(['handbook', 'brochure']);
const PUBLIC_TYPES = new Set(['brochure']);
const TYPE_ORDER = ['circular', 'notice', 'handbook', 'brochure', 'lesson_notes'];

function byNewest(a, b) {
  if (a.effective_date !== b.effective_date) return a.effective_date < b.effective_date ? 1 : -1;
  return String(b.version).localeCompare(String(a.version), undefined, { numeric: true });
}

/**
 * Keeps only the edition in force for handbook/brochure (newest effective on or before today),
 * and every circular, notice and lesson note.
 */
export function selectCurrentDocuments(docs, today) {
  const groups = new Map();
  for (const d of docs) {
    if (!groups.has(d.type)) groups.set(d.type, []);
    groups.get(d.type).push(d);
  }
  const selected = [];
  for (const [type, list] of groups) {
    if (SINGLE_EDITION_TYPES.has(type)) {
      const inForce = list.filter((d) => !today || d.effective_date <= today);
      const pool = inForce.length ? inForce : list;
      selected.push([...pool].sort(byNewest)[0]);
    } else {
      selected.push(...list);
    }
  }
  const rank = (t) => (TYPE_ORDER.includes(t) ? TYPE_ORDER.indexOf(t) : TYPE_ORDER.length);
  return selected.sort((a, b) => rank(a.type) - rank(b.type) || a.id - b.id);
}

function renderDoc({ meta, text }, today) {
  const status = today && meta.effective_date > today ? 'announced, not yet in force' : 'in force';
  return [
    `<document id="${meta.id}" title="${meta.title}" type="${meta.type}" version="${meta.version}" effective_date="${meta.effective_date}" status="${status}" applies_to='${JSON.stringify(meta.applies_to ?? {})}'>`,
    text,
    '</document>',
  ].join('\n');
}

const HEADING = /^(\d+(\.\d+)*\.?\s|Chapter \d|Table \d|Annexure [A-Z])/;

/** Line-based chunks of at most ~size chars, preferring to break at rule numbers and headings. */
export function chunk(doc, size = 1200) {
  const out = [];
  let buf = '';
  for (const line of doc.text.split('\n')) {
    const atHeading = HEADING.test(line.trim());
    if (buf && (buf.length + line.length > size || (atHeading && buf.length > size / 3))) {
      out.push(buf);
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) out.push(buf);
  return out.map((text) => ({ meta: doc.meta, text }));
}

const STOP = new Set('the a an and or of to in on for is are be can i my me what how when do does with at by it this that from'.split(' '));
const tokens = (s) => s.toLowerCase().match(/[a-z0-9.]+/g)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];

export function createKnowledgeBase({ kit, extract = extractPdfText, refreshMs = 120000, logger = console }) {
  const textCache = new Map();
  let snapshot = { today: null, docs: [], loadedAt: 0 };
  let inflight = null;
  let timer = null;

  async function load() {
    const [list, todayRes] = await Promise.all([kit.get('/v1/documents'), kit.get('/v1/today')]);
    const today = todayRes?.date ?? null;
    const chosen = selectCurrentDocuments(Array.isArray(list) ? list : [], today);
    const docs = await Promise.all(
      chosen.map(async (meta) => {
        const key = `${meta.id}:${meta.version}:${meta.effective_date}`;
        if (!textCache.has(key)) {
          const bytes = await kit.get(`/v1/documents/${meta.id}/file`, { binary: true });
          textCache.set(key, await extract(bytes));
        }
        return { meta, text: textCache.get(key) };
      }),
    );
    snapshot = { today, docs, loadedAt: Date.now() };
    logger.info?.(`[knowledge] loaded ${docs.length} documents: ${docs.map((d) => d.meta.title).join(' | ')}`);
    return snapshot;
  }

  async function refresh() {
    if (!inflight) {
      inflight = load()
        .catch((err) => {
          logger.error?.(`[knowledge] refresh failed, keeping previous documents: ${err.message}`);
          return snapshot;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  function docsFor(audience) {
    return snapshot.docs.filter((d) => audience !== 'public' || PUBLIC_TYPES.has(d.meta.type));
  }

  return {
    refresh,
    start() {
      timer = setInterval(refresh, refreshMs);
      timer.unref?.();
      return refresh();
    },
    stop() {
      clearInterval(timer);
    },
    status: () => ({ loadedAt: snapshot.loadedAt, documents: snapshot.docs.map((d) => d.meta) }),
    /** Full text of all documents for the audience; stable between refreshes so prompt caching works. */
    fullText(audience) {
      const docs = docsFor(audience);
      if (!docs.length) return '(No college documents could be loaded. Say you cannot check the rules right now.)';
      return docs.map((d) => renderDoc(d, snapshot.today)).join('\n\n');
    },
    /** Short keyword-ranked excerpt for smaller backup models; circulars always included. */
    retrieve(audience, query, maxChars = 9000) {
      const docs = docsFor(audience);
      const full = docs.map((d) => renderDoc(d, snapshot.today)).join('\n\n');
      if (full.length <= maxChars * 2) return full || '(No college documents could be loaded.)';
      const q = new Set(tokens(query));
      const always = docs.filter((d) => d.meta.type === 'circular');
      const chunks = docs.filter((d) => d.meta.type !== 'circular').flatMap((d) => chunk(d));
      const scored = chunks
        .map((c) => ({ c, score: tokens(c.text).reduce((s, t) => s + (q.has(t) ? 1 : 0), 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const parts = always.map((d) => renderDoc(d, snapshot.today));
      let used = parts.join('').length;
      for (const { c } of scored) {
        const block = `<excerpt from="${c.meta.title}" type="${c.meta.type}" version="${c.meta.version}">\n${c.text}\n</excerpt>`;
        if (used + block.length > maxChars) break;
        parts.push(block);
        used += block.length;
      }
      return parts.join('\n\n') || '(No matching document excerpts.)';
    },
  };
}
