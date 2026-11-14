import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSpeak, REPLY_MODES } from '../../frontend/services/speech.js';

test('voice replies follow the user setting: typed questions get text only by default', () => {
  assert.equal(shouldSpeak('auto', 'voice'), true, 'spoken question -> spoken reply');
  assert.equal(shouldSpeak('auto', 'text'), false, 'typed question -> text only');
  assert.equal(shouldSpeak('on', 'text'), true, 'always');
  assert.equal(shouldSpeak('off', 'voice'), false, 'never');
  assert.deepEqual(Object.keys(REPLY_MODES), ['auto', 'on', 'off']);
});

test('with only a Groq key, speech has two Groq models so one throttled model is not fatal', async () => {
  const { buildSttProviders } = await import('../voice/stt.js');
  const names = buildSttProviders({ groqKey: 'k' }).map((p) => p.name);
  assert.deepEqual(names, ['groq', 'groq-large']);
});
