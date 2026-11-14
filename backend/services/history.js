/** Normalises stored history into user/assistant turns that start with the user and alternate. */
export function toAlternatingTurns(history = []) {
  const out = [];
  for (const m of history) {
    if (!m?.text || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (!out.length && m.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += `\n${m.text}`;
    else out.push({ role: m.role, text: m.text });
  }
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}

/** Compact log of actions from earlier turns (ids, statuses) for the context block, so follow-ups like "cancel it" work. */
export function recentActionNotes(messages = [], limit = 6) {
  const notes = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.actions ?? [])
    .slice(-limit)
    .map((a) => `${a.name}(${JSON.stringify(a.args)}) -> ${a.ok ? "ok" : "error"}: ${a.result}`);
  return notes.join("\n");
}

/** Removes internal notes a model might echo back into a spoken reply. */
export function stripInternalNotes(text = "") {
  return text.replace(/\n?\[(Actions taken|Earlier actions)[\s\S]*$/i, "").trim();
}
