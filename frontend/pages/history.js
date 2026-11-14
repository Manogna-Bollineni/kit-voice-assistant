import { api, el, renderNav } from '../services/api.js';

const user = await renderNav();
document.getElementById('scope').textContent = user ? `Conversations for ${user.full_name}` : 'Conversations from this browser. Log in to see your account history.';

const list = document.getElementById('list');
const detail = document.getElementById('detail');
const when = (iso) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

async function open(id, button) {
  list.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-current'));
  button.setAttribute('aria-current', 'true');
  detail.replaceChildren(el('p', { class: 'empty' }, 'Loading…'));
  try {
    const { conversation, messages } = await api(`/api/history/${encodeURIComponent(id)}`);
    detail.replaceChildren(
      el('h2', {}, conversation.title),
      ...messages.map((m) => {
        const done = m.actions.filter((a) => a.ok).map((a) => a.name.replaceAll('_', ' '));
        return el(
          'div',
          { class: `msg ${m.role}` },
          el('span', { class: 'who' }, `${m.role === 'user' ? 'You' : 'Assistant'} · ${when(m.createdAt)}`),
          el('p', {}, m.text),
          ...(done.length && m.role === 'assistant' ? [el('small', {}, `✓ ${done.join(', ')}`)] : []),
        );
      }),
    );
  } catch (err) {
    detail.replaceChildren(el('p', { class: 'error' }, err.message));
  }
}

try {
  const { conversations } = await api('/api/history');
  if (!conversations.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'No conversations yet.'));
  } else {
    list.replaceChildren(
      ...conversations.map((c) => {
        const b = el('button', { type: 'button' }, el('strong', {}, c.title), el('small', {}, `${c.mode === 'public' ? 'Public' : 'Logged in'} · ${c.messageCount} messages · ${when(c.updatedAt)}`));
        b.addEventListener('click', () => open(c.id, b));
        return el('li', {}, b);
      }),
    );
    list.querySelector('button')?.click();
  }
} catch (err) {
  list.replaceChildren(el('li', { class: 'error' }, `Could not load history: ${err.message}`));
}
