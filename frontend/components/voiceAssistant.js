// Voice assistant: robot stage (waveform + mic), chat log, suggestions and typed input. Speaks replies aloud.
import { el } from '../services/api.js';
import { createMicButton } from './micButton.js';
import { createConversation } from './conversation.js';
import { icon } from './icons.js';

function storageGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the conversation just won't survive a reload */
  }
}

/**
 * Mounts the assistant into root. Options: mode ('public' | 'member'), greeting, suggestions, userInitials, compact.
 * Returns { ask(text) } so buttons elsewhere on the page can send a question.
 */
export function mountAssistant(root, { mode, greeting, suggestions = [], userInitials, compact = false, layout = 'split' }) {
  const convKey = `kit_conv_${mode}`;
  let conversationId = storageGet(convKey);
  let busy = false;

  const hero = layout === 'hero';
  const card = el('div', { class: `va-card ${compact ? 'compact' : ''} ${hero ? 'va-hero chat-empty' : ''}`, 'data-state': 'idle' });
  const setState = (state) => (card.dataset.state = state);
  const conversation = createConversation({ userInitials });
  const log = { ...conversation, add: (...a) => (card.classList.remove('chat-empty'), conversation.add(...a)) };
  const status = el('p', { class: 'stage-status' }, hero ? 'Tap the mic to speak, or type below' : 'Tap the mic and speak');
  const setStatus = (text) => (status.textContent = text);

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return setState('idle');
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang?.startsWith('en')) ?? null;
    u.rate = 1.05;
    u.onstart = () => setState('speaking');
    u.onend = u.onerror = () => card.dataset.state === 'speaking' && setState('idle');
    window.speechSynthesis.speak(u);
  }
  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    if (card.dataset.state === 'speaking') setState('idle');
  };

  const mic = createMicButton({
    onStart: stopSpeaking,
    onAudio: (blob) => send(blob, blob.type, 'voice'),
    onStatus: setStatus,
    onRecording: (rec) => {
      if (rec) setState('listening');
      else if (card.dataset.state === 'listening') setState('idle');
    },
  });

  const wave = el('div', { class: 'wave', 'aria-hidden': 'true' }, ...Array.from({ length: 24 }, (_, i) => el('i')));
  const stage = el(
    'div',
    { class: 'stage' },
    el('div', { class: 'robot-wrap' }, el('img', { class: 'robot', src: '/images/robot.svg', alt: 'KIT assistant' })),
    wave,
    mic.element,
    status,
  );

  const input = el('input', { type: 'text', name: 'text', placeholder: 'Type your question…', maxlength: '1000', 'aria-label': 'Type your question', autocomplete: 'off' });
  const sendBtn = el('button', { type: 'submit', class: 'btn', 'aria-label': 'Send' }, icon('arrow', 18));
  const form = el('form', { class: 'composer' }, input, sendBtn);
  const reset = el('button', { type: 'button', class: 'link' }, 'New conversation');
  const tips = suggestions.length ? el('div', { class: 'chips' }, ...suggestions.map((s) => el('button', { type: 'button', class: 'chip' }, s))) : null;

  const chat = el('div', { class: 'chat' }, el('div', { class: 'chat-head' }, el('strong', {}, 'Conversation'), reset), log.element, tips, form);
  card.append(stage, chat);
  root.replaceChildren(card);
  if (greeting && !hero) log.add('assistant', greeting);

  function setBusy(value, message) {
    busy = value;
    mic.setBusy(value);
    sendBtn.disabled = value;
    if (value) setState('thinking');
    log.typing(value);
    if (message) setStatus(message);
  }

  async function handleResponse(res, kind) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    setBusy(false);
    if (data.conversationId) {
      conversationId = data.conversationId;
      storageSet(convKey, conversationId);
    }
    if (kind === 'voice' && data.transcript) log.add('user', data.transcript);
    const reply = data.reply ?? data.error ?? 'Something went wrong. Please try again.';
    const done = (data.actions ?? []).filter((a) => a.write && a.ok).map((a) => a.name.replaceAll('_', ' '));
    log.add('assistant', reply, done.length ? `Done: ${done.join(', ')}` : undefined);
    setState('idle');
    speak(reply);
    setStatus(res.ok ? 'Tap the mic to reply' : 'Something went wrong — try again');
    if (data.sessionExpired) {
      log.add('assistant', 'Your session has expired. Please log in again.');
      setTimeout(() => (location.href = '/login'), 2500);
    }
  }

  async function send(body, contentType, kind) {
    setBusy(true, kind === 'voice' ? 'Transcribing and thinking…' : 'Thinking…');
    const params = new URLSearchParams({ mode });
    if (conversationId) params.set('conversationId', conversationId);
    try {
      const res = await fetch(`/api/assistant/${kind}?${params}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      await handleResponse(res, kind);
    } catch {
      setBusy(false);
      setState('idle');
      log.add('assistant', 'I could not reach the server. Check your connection and try again.');
      setStatus('Connection problem');
    }
  }

  function ask(text) {
    if (!text || busy) return;
    stopSpeaking();
    log.add('user', text);
    send(JSON.stringify({ text }), 'application/json', 'text');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    ask(text);
  });
  tips?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) ask(chip.textContent);
  });
  reset.addEventListener('click', () => {
    stopSpeaking();
    conversationId = null;
    storageSet(convKey, null);
    log.clear();
    if (hero) card.classList.add('chat-empty');
    else if (greeting) log.add('assistant', greeting);
    setStatus('New conversation started');
  });

  return { ask };
}
