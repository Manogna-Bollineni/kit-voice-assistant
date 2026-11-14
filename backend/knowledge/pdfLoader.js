// Turns college PDF documents into clean text for the assistant.
import { extractText, getDocumentProxy } from 'unpdf';

export async function extractPdfText(bytes) {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return cleanText(text);
}

/** Drops repeated page headers/footers ("… · page 11 of 40") and extra blank lines. */
export function cleanText(text) {
  return text
    .split('\n')
    .filter((line) => !/·\s*page \d+ of \d+\s*$/i.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
