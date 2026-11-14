// Conversation log: renders user and assistant messages (text only, never HTML).
import { el } from '../services/api.js';

export function createConversation() {
  const element = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });

  return {
    element,
    add(role, text, note) {
      const item = el('div', { class: `msg ${role}` }, el('span', { class: 'who' }, role === 'user' ? 'You' : 'Assistant'), el('p', {}, text));
      if (note) item.append(el('small', {}, note));
      element.append(item);
      element.scrollTop = element.scrollHeight;
    },
    clear() {
      element.replaceChildren();
    },
  };
}
