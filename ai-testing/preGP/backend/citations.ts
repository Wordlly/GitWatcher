/** Keep summary citations pointing at real transcript messages. The model sees short
 * tags instead of UUIDs (which it mangles), tags are resolved back to ids after parsing,
 * and a quote cited against the wrong message is relinked to the one patient message
 * that actually contains it before verification runs.
 */
import { normaliseQuote } from '../shared/evidence.ts';
import type { ConsultationSummary, ConversationMessage, EvidenceRef } from '../shared/models.ts';

export interface TaggedTranscript { lines: string; ids: Map<string, string> }

/** Number patient and guide messages separately (P1, G1, …) and render the transcript for the prompt. */
export function tagTranscript(messages: ConversationMessage[]): TaggedTranscript {
  const ids = new Map<string, string>();
  const counts = { patient: 0, assistant: 0 };
  const lines = messages.map(message => {
    const tag = `${message.role === 'patient' ? 'P' : 'G'}${++counts[message.role]}`;
    ids.set(tag, message.id);
    return `[${tag}] ${message.role === 'assistant' ? 'GUIDE' : 'PATIENT'}: ${message.text}`;
  }).join('\n');
  return { lines, ids };
}

/** Replace message tags with real ids anywhere in the raw model output; unknown refs are left for verification to flag. */
export function resolveCitations<T>(value: T, ids: Map<string, string>): T {
  if (Array.isArray(value)) return value.map(item => resolveCitations(item, ids)) as T;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.source === 'message' && typeof record.ref === 'string') {
      const real = ids.get(record.ref.trim().toUpperCase());
      return (real ? { ...record, ref: real } : record) as T;
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolveCitations(item, ids)])) as T;
  }
  return value;
}

function contains(message: ConversationMessage, quote: string): boolean {
  return normaliseQuote(message.text).includes(quote);
}

function relink(ref: EvidenceRef, messages: ConversationMessage[]): EvidenceRef {
  if (ref.source !== 'message') return ref;
  const quote = normaliseQuote(ref.quote);
  const cited = messages.find(message => message.id === ref.ref);
  if (!quote || (cited && contains(cited, quote))) return ref;
  const holders = messages.filter(message => message.role === 'patient' && contains(message, quote));
  return holders.length === 1 ? { ...ref, ref: holders[0]!.id } : ref;
}

/** Point each message citation at the single patient message containing its quote when the cited one does not. */
export function relinkCitations(summary: ConsultationSummary, messages: ConversationMessage[]): ConsultationSummary {
  const fix = <T extends { evidence: EvidenceRef[] }>(item: T): T => ({ ...item, evidence: item.evidence.map(ref => relink(ref, messages)) });
  return {
    ...summary,
    presentingComplaint: fix(summary.presentingComplaint),
    history: summary.history.map(fix),
    redFlags: summary.redFlags.map(fix),
    background: summary.background.map(fix),
    impact: summary.impact.map(fix),
    suggestedFocus: summary.suggestedFocus.map(fix),
  };
}
