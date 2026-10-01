/** Runtime contracts for turns and summaries produced by the AI gateway. The backend
 * parses model output through these checks before answering and the browser parses the
 * response again, so malformed JSON is never rendered.
 */
import type { AssistantTurn, ConsultationSummary, InputSpec, PatientProfile, QuestionOption } from './models.ts';
import { addressName } from './person.ts';
import { sentencesOf } from './text.ts';
import { isRecord, validInputSpec, validSoapHandoff, validSummary } from './validation.ts';

const phases = ['opening', 'concern', 'details', 'history', 'impact', 'closing'];
export const unexpectedResponse = 'The assistant returned an unexpected response. Please try again.';
/** The open question every conversation starts with, whatever the model proposes, and how it is answered. */
export const openingQuestion = 'What would you like to talk about today? Tell me in your own words.';
export const openingInput: InputSpec = { kind: 'text', placeholder: 'In your own words…' };

/** Remove null-valued properties recursively; strict JSON schemas use null for optional fields. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== null).map(([key, item]) => [key, stripNulls(item)])) as T;
  }
  return value;
}

function cleanOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  const result: QuestionOption[] = [];
  for (const item of value) {
    const option = item as { value?: unknown; label?: unknown } | null;
    if (!option || typeof option.value !== 'string' || typeof option.label !== 'string') continue;
    const optionValue = option.value.trim();
    const label = option.label.trim();
    if (optionValue && label && !result.some(existing => existing.value === optionValue)) result.push({ value: optionValue, label });
  }
  return result;
}

/** Coerce a model-supplied input specification into one the widgets can render, or drop it. */
function normaliseInput(value: unknown): InputSpec | null {
  if (!value || typeof value !== 'object') return null;
  const input = { ...(value as Record<string, unknown>) };
  const options = cleanOptions(input.options);
  if (input.kind === 'choice' || input.kind === 'multi') {
    if (options.length < 2) input.kind = 'text';
    else input.options = options;
  }
  if (input.kind !== 'choice' && input.kind !== 'multi') delete input.options;
  if (input.kind === 'scale') {
    const min = typeof input.min === 'number' ? input.min : 0;
    const max = typeof input.max === 'number' && input.max > min ? input.max : Math.max(min + 1, 10);
    input.min = min;
    input.max = max;
  }
  return validInputSpec(input) ? input : null;
}

/** Validate and normalise a turn from the model; throws a readable error when unusable.
 * The private `rationale` the backend schema makes the model write first is not part of the
 * turn and is left behind here, so it never reaches the browser.
 */
export function parseAssistantTurn(value: unknown): AssistantTurn {
  const turn = stripNulls(value) as Record<string, unknown> | undefined;
  if (!turn || typeof turn !== 'object' || typeof turn.text !== 'string' || !turn.text.trim() || typeof turn.complete !== 'boolean') throw new Error(unexpectedResponse);
  const phase = typeof turn.phase === 'string' && phases.includes(turn.phase) ? turn.phase as AssistantTurn['phase'] : 'details';
  const questionId = typeof turn.questionId === 'string' && turn.questionId.trim() ? turn.questionId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : null;
  // A question without a widget is still a question: default to free text so the reply is recorded against it.
  const input = turn.complete ? null : normaliseInput(turn.input) ?? (questionId ? { kind: 'text' } : null);
  return { text: turn.text.trim(), questionId: questionId || null, input, phase: turn.complete ? 'closing' : phase, complete: turn.complete };
}

/** Force the first turn of a conversation to ask for today's concern as free text.
 * The patient must state the problem in their own words before any follow-up, so the model's
 * greeting is kept but everything from its first question on gives way to the open question:
 * a model may otherwise open on an earlier consultation ("How is the knee today?"). The reply
 * is recorded under `concern` so titles and completion behave the same as in scripted
 * conversations.
 */
export function ensureOpeningQuestion(turn: AssistantTurn, profile: PatientProfile): AssistantTurn {
  const sentences = sentencesOf(turn.text);
  const firstQuestion = sentences.findIndex(sentence => sentence.includes('?'));
  const greeting = (firstQuestion < 0 ? sentences : sentences.slice(0, firstQuestion)).join(' ') || `Hi ${addressName(profile)}`;
  const lead = /[.!?…][”"']?$/.test(greeting) ? greeting : `${greeting}.`;
  return { text: `${lead} ${openingQuestion}`, questionId: 'concern', input: { ...openingInput }, phase: 'concern', complete: false };
}

const summaryLists = ['history', 'redFlags', 'background', 'impact', 'suggestedFocus', 'gaps'] as const;
const evidenceLists = ['history', 'redFlags', 'background', 'impact', 'suggestedFocus'] as const;

/** Only an absent legacy list means empty; explicit null and version 3 omissions are invalid. */
function fillLists(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const summary = { ...(value as Record<string, unknown>) };
  if (summary.version !== 2) return summary;
  for (const key of summaryLists) if (!(key in summary)) summary[key] = [];
  const withEvidence = (item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? { evidence: [], ...(item as Record<string, unknown>) } : item;
  summary.presentingComplaint = withEvidence(summary.presentingComplaint);
  for (const key of evidenceLists) if (Array.isArray(summary[key])) summary[key] = summary[key].map(withEvidence);
  return summary;
}

/** Validate a summary from the model or the gateway; throws a readable error when unusable. */
export function parseSummary(value: unknown): ConsultationSummary {
  if (isRecord(value) && ((value.version === 2 && 'soap' in value) || (value.version === 3 && !validSoapHandoff(value.soap)))) throw new Error(unexpectedResponse);
  const summary = stripNulls(fillLists(value));
  if (!validSummary(summary)) throw new Error(unexpectedResponse);
  return summary;
}
