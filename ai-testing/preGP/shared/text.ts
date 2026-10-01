/** Plain-text helpers shared by the transcript view and the AI contracts, so both agree on
 * where one sentence ends and the next begins.
 */
/** Sentences of a passage: each ends at a full stop, exclamation or question mark (with any
 * closing quote); a final unpunctuated fragment counts as one too. */
export function sentencesOf(text: string): string[] {
  return (text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+[”"']?|[^.!?]+$/g) ?? []).map(sentence => sentence.trim()).filter(Boolean);
}
