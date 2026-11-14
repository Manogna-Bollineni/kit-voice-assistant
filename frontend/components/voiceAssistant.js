// Voice assistant: robot stage (waveform + mic), chat log, suggestions and typed input.
// Replies are read aloud according to the user's voice-reply setting (see services/speech.js).
import { el } from '../services/api.js';
import { REPLY_MODES, getReplyMode, setReplyMode, shouldSpeak, speak, stopSpeaking } from '../services/speech.js';
import { createMicButton } from './micButton.js';
import { createConversation } from './conversation.js';
import { icon } from './icons.js';

function sessionGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function sessionSet(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the conversation just won't survive a reload */
  }
}

/** Cycles Voice replies: when I speak → always → off. */
function replyModeToggle() {
  let mode = getReplyMode();
  const button = el('button', { type: 'button', class: 'voice-mode' });
  const render = () => {
    button.replaceChildren(icon(mode === 'off' ? 'mic' : 'volume', 14), REPLY_MODES[mode]);
    button.setAttribute('aria-label', `${REPLY_MODES[mode]}. Click to change.`);
    button.dataset.mode = mode;
  };
  button.addEventListener('click', () => {
    const order = Object.keys(REPLY_MODES);
    mode = order[(order.indexOf(mode) + 1) % order.length];
    setReplyMode(mode);
    if (mode === 'off') stopSpeaking();
    render();
  });
  render();
  return { element: button, get mode() { return mode; } };
}

/**
 * Mounts the assistant into root.
 * Options: mode ('public' | 'member'), greeting, suggestions, userInitials, layout ('split' | 'hero').
 * Returns { ask(text) } so buttons elsewhere on the page can send a question.
 */
/** Forget the open chat so the next login starts fresh; past chats stay on the History page. */
export function clearOpenConversation() {
  sessionSet('kit_conv_member', null);
}

export function mountAssistant(root, { mode, greeting, suggestions = [], userInitials, layout = 'split' }) {
  const convKey = `kit_conv_${mode}`;
  const hero = layout === 'hero';
  let conversationId = sessionGet(convKey);
  let busy = false;

  const card = el('div', { class: `va-card ${hero ? 'va-hero chat-empty' : ''}`, 'data-state': 'idle' });
  const setState = (state) => (card.dataset.state = state);
  const say = (text) => speak(text, { onStart: () => setState('speaking'), onEnd: () => card.dataset.state === 'speaking' && setState('idle') });
  const quiet = () => {
    stopSpeaking();
    if (card.dataset.state === 'speaking') setState('idle');
  };

  const conversation = createConversation({ userInitials, onListen: say });
  const log = { ...conversation, add: (...a) => (card.classList.remove('chat-empty'), conversation.add(...a)) };
  const status = el('p', { class: 'stage-status' }, hero ? 'Tap the mic to speak, or type below' : 'Tap the mic and speak');
  const setStatus = (text) => (status.textContent = text);
  const voiceMode = replyModeToggle();

  const mic = createMicButton({
    onStart: quiet,
    onAudio: (blob) => send(blob, blob.type, 'voice'),
    onStatus: setStatus,
    onRecording: (rec) => {
      if (rec) setState('listening');
      else if (card.dataset.state === 'listening') setState('idle');
    },
  });

  const wave = el('div', { class: 'wave', 'aria-hidden': 'true' }, ...Array.from({ length: 24 }, () => el('i')));
  const stage = el(
    'div',
    { class: 'stage' },
    el('div', { class: 'robot-wrap' }, el('img', { class: 'robot', src: '/images/robot.svg', alt: 'KIT assistant' })),
    wave,
    mic.element,
    status,
    voiceMode.element,
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

  async function handleResponse(res, askedBy) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    setBusy(false);
    setState('idle');
    if (data.conversationId) {
      conversationId = data.conversationId;
      sessionSet(convKey, conversationId);
    }
    if (askedBy === 'voice' && data.transcript) log.add('user', data.transcript);
    const reply = data.reply ?? data.error ?? 'Something went wrong. Please try again.';
    const done = (data.actions ?? []).filter((a) => a.write && a.ok).map((a) => a.name.replaceAll('_', ' '));
    log.add('assistant', reply, done.length ? `Done: ${done.join(', ')}` : undefined);
    if (shouldSpeak(voiceMode.mode, askedBy)) say(reply);
    setStatus(res.ok ? 'Tap the mic to reply' : 'Something went wrong — try again');
    if (data.sessionExpired) {
      log.add('assistant', 'Your session has expired. Please log in again.');
      setTimeout(() => (location.href = '/login'), 2500);
    }
  }

  async function send(body, contentType, askedBy) {
    setBusy(true, askedBy === 'voice' ? 'Transcribing and thinking…' : 'Thinking…');
    const params = new URLSearchParams({ mode });
    if (conversationId) params.set('conversationId', conversationId);
    try {
      const res = await fetch(`/api/assistant/${askedBy}?${params}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      await handleResponse(res, askedBy);
    } catch {
      setBusy(false);
      setState('idle');
      log.add('assistant', 'I could not reach the server. Check your connection and try again.');
      setStatus('Connection problem');
    }
  }

  function ask(text) {
    if (!text || busy) return;
    quiet();
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
    quiet();
    conversationId = null;
    sessionSet(convKey, null);
    log.clear();
    if (hero) card.classList.add('chat-empty');
    else if (greeting) log.add('assistant', greeting);
    setStatus('New conversation started');
  });

  // After a refresh, show the conversation that was open in this tab (history is for logged-in users only).
  async function restore() {
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(conversationId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const { messages } = await res.json();
      for (const m of messages ?? []) log.add(m.role, m.text);
      setStatus('Conversation restored — tap the mic to continue');
    } catch {
      conversationId = null;
      sessionSet(convKey, null);
    }
  }
  if (conversationId && mode === 'member') restore();

  return { ask };
}
