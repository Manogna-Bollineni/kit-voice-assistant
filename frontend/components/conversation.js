// Conversation log: chat bubbles with avatars (robot for the assistant, initials for the user). Text only, never HTML.
import { el } from '../services/api.js';

export function createConversation({ userInitials = 'You' } = {}) {
  const element = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });

  const avatar = (role) =>
    role === 'assistant' ? el('img', { class: 'msg-avatar bot', src: '/images/robot.svg', alt: '' }) : el('span', { class: 'msg-avatar user' }, userInitials);

  return {
    element,
    add(role, text, note) {
      const bubble = el('div', { class: 'bubble' }, el('p', {}, text), note ? el('small', { class: 'done' }, note) : null);
      element.append(el('div', { class: `msg ${role}` }, avatar(role), bubble));
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
