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
  return toSpokenText(text.replace(/\n?\[(Actions taken|Earlier actions)[\s\S]*$/i, ""));
}

/** Replies are read aloud, so markdown (bullets, bold, headings, tables) becomes plain sentences. */
export function toSpokenText(text = "") {
  const lines = text
    .replace(/\*\*|__|`/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|\|)/, "").replace(/\s*\|\s*/g, ", ").trim())
    .filter(Boolean);
  // A colon followed by list items reads naturally as one sentence: "…: a, b, c."
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && (prev.endsWith(":") || prev.endsWith(",")) && !/[.!?]$/.test(prev)) out[out.length - 1] = `${prev} ${line.replace(/[.;]$/, "")},`;
    else out.push(line);
  }
  return out.map((l) => l.replace(/,$/, ".")).join("\n").replace(/ ,/g, ",").trim();
}
