// Conversation log: chat bubbles with avatars (robot for the assistant, initials for the user). Text only, never HTML.
import { el } from '../services/api.js';
import { icon } from './icons.js';

/** onListen(text): optional; adds a "read aloud" button to each assistant reply. */
export function createConversation({ userInitials = 'You', onListen } = {}) {
  const element = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });

  const avatar = (role) =>
    role === 'assistant' ? el('img', { class: 'msg-avatar bot', src: '/images/robot.svg', alt: '' }) : el('span', { class: 'msg-avatar user' }, userInitials);

  function listenButton(text) {
    const b = el('button', { type: 'button', class: 'listen', 'aria-label': 'Read this reply aloud', title: 'Read aloud' }, icon('volume', 16));
    b.addEventListener('click', () => onListen(text));
    return b;
  }

  return {
    element,
    add(role, text, note) {
      const bubble = el('div', { class: 'bubble' }, el('p', {}, text), note ? el('small', { class: 'done' }, note) : null);
      const extras = role === 'assistant' && onListen ? listenButton(text) : null;
      element.append(el('div', { class: `msg ${role}` }, avatar(role), bubble, extras));
      element.scrollTop = element.scrollHeight;
    },
    typing(on) {
      element.querySelector('.msg.typing')?.remove();
      if (on) {
        element.append(el('div', { class: 'msg assistant typing' }, avatar('assistant'), el('div', { class: 'bubble' }, el('span', { class: 'dots', 'aria-label': 'Assistant is thinking' }, el('i'), el('i'), el('i')))));
        element.scrollTop = element.scrollHeight;
      }
    },
    clear() {
      element.replaceChildren();
    },
  };
}
