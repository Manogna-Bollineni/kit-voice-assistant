import { api, el, currentUser, formatDate } from '../services/api.js';
import { mountShell } from '../services/layout.js';
import { icon } from '../components/icons.js';

const user = await currentUser();
if (!user) {
  location.replace('/login?next=/history');
  throw new Error('redirecting');
}
const content = mountShell(user, { active: 'history' });

const TAGS = [
  [/attendance|absent|bunk|percent/i, 'Attendance'],
  [/on.?duty|\bod\b|leave|cancel/i, 'Leave & OD'],
  [/placement|drive|zoho|tcs|freshworks|register/i, 'Placements'],
  [/exam|timetable|subject|dbms|normali|assessment|cgpa/i, 'Academics'],
  [/admission|apply|fee|course|eligib|document|scholarship|hostel/i, 'Admissions'],
  [/approve|reject|pending|request/i, 'Requests'],
];
const tagFor = (title) => TAGS.find(([re]) => re.test(title))?.[1] ?? 'General';

const search = el('input', { type: 'search', placeholder: 'Search conversations…', 'aria-label': 'Search conversations' });
const list = el('div', { class: 'history-list' }, el('p', { class: 'empty' }, 'Loading…'));
content.append(
  el(
    'div',
    { class: 'card pad history-card' },
    el(
      'div',
      { class: 'card-head' },
      el('div', {}, el('h1', {}, 'Conversation history'), el('p', { class: 'muted' }, `Your conversations, ${user.full_name}`)),
      el('label', { class: 'field search' }, icon('search', 18), search),
    ),
    list,
  ),
);

async function toggle(row, c) {
  const open = row.nextElementSibling?.classList.contains('transcript');
  list.querySelectorAll('.transcript').forEach((t) => t.remove());
  list.querySelectorAll('.history-row').forEach((r) => r.setAttribute('aria-expanded', 'false'));
  if (open) return;
  row.setAttribute('aria-expanded', 'true');
  const box = el('div', { class: 'transcript' }, el('p', { class: 'muted' }, 'Loading…'));
  row.after(box);
  try {
    const { messages } = await api(`/api/history/${encodeURIComponent(c.id)}`);
    box.replaceChildren(
      ...messages.map((m) => {
        const done = (m.actions ?? []).filter((a) => a.ok).map((a) => a.name.replaceAll('_', ' '));
        return el('div', { class: `t-msg ${m.role}` }, el('small', {}, `${m.role === 'user' ? 'You' : 'Assistant'} · ${formatDate(m.createdAt, true)}`), el('p', {}, m.text), done.length && m.role === 'assistant' ? el('small', { class: 'done' }, `Done: ${done.join(', ')}`) : null);
      }),
    );
  } catch (err) {
    box.replaceChildren(el('p', { class: 'error' }, err.message));
  }
}

let all = [];
function render() {
  const q = search.value.trim().toLowerCase();
  const rows = all.filter((c) => !q || c.title.toLowerCase().includes(q) || tagFor(c.title).toLowerCase().includes(q));
  if (!rows.length) return list.replaceChildren(el('p', { class: 'empty' }, all.length ? 'No conversations match your search.' : 'No conversations yet. Talk to the assistant and they will appear here.'));
  list.replaceChildren(
    ...rows.map((c) => {
      const row = el(
        'button',
        { type: 'button', class: 'history-row', 'aria-expanded': 'false' },
        el('span', { class: 'row-icon' }, icon('mic', 18)),
        el('span', { class: 'row-title' }, c.title),
        el('span', { class: 'row-date' }, formatDate(c.updatedAt, true)),
        el('span', { class: 'tag' }, tagFor(c.title)),
        el('span', { class: 'row-go' }, icon('play', 14)),
      );
      row.addEventListener('click', () => toggle(row, c));
      row.dataset.id = c.id;
      return row;
    }),
  );
}

search.addEventListener('input', render);
try {
  all = (await api('/api/history')).conversations;
  render();
  // Opened from a Recent conversations link: expand that conversation.
  const wanted = decodeURIComponent(location.hash.slice(1));
  const target = wanted && [...list.querySelectorAll('.history-row')].find((r) => r.dataset.id === wanted);
  if (target) {
    toggle(target, all.find((c) => c.id === wanted));
    target.scrollIntoView({ block: 'center' });
  }
} catch (err) {
  list.replaceChildren(el('p', { class: 'error' }, `Could not load history: ${err.message}`));
}
