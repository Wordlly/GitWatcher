/** Runtime contracts for turns and summaries produced by the AI gateway. The backend
 * parses model output through these checks before answering and the browser parses the
 * response again, so malformed JSON is never rendered.
 */
import type { AssistantTurn, ConsultationSummary, InputSpec, PatientProfile, QuestionOption } from './models.ts';
import { addressName } from './person.ts';
import { sentencesOf } from './text.ts';
import { validInputSpec, validSummary } from './validation.ts';

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
  return { text: turn.text.trim(), questionId: questionId || null, input, phase: turn.complete ? 'closing' : phase, complete: turn.complete, ...(turn.emergency === true ? { emergency: true } : {}) };
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

/** An omitted list means an empty one: a constrained decoder (Nova) leaves out a required list it has nothing to fill. */
function fillLists(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const summary = { ...(value as Record<string, unknown>) };
  for (const key of summaryLists) summary[key] ??= [];
  const withEvidence = (item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? { evidence: [], ...(item as Record<string, unknown>) } : item;
  summary.presentingComplaint = withEvidence(summary.presentingComplaint);
  for (const key of evidenceLists) if (Array.isArray(summary[key])) summary[key] = summary[key].map(withEvidence);
  const legacyMeasurements = Array.isArray(summary.history) ? summary.history.filter(item => item && typeof item === 'object' && /^(?:temp|temperature|measured temperature)$/i.test(String((item as Record<string, unknown>).label ?? (item as Record<string, unknown>).id))) : [];
  const legacySubjectiveHistory = Array.isArray(summary.history) ? summary.history.filter(item => !legacyMeasurements.includes(item)) : [];
  const legacySafety = Array.isArray(summary.redFlags) ? summary.redFlags.filter(item => item && typeof item === 'object').map(item => {
    const flag = item as Record<string, unknown>;
    const status = flag.status === 'reported' ? 'Reported' : flag.status === 'denied' ? 'Denied' : 'Not discussed';
    const id = String(flag.flag ?? 'safety').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return { id: `safety_${id}`, label: String(flag.flag ?? 'Safety area'), value: status, reasoning: String(flag.reasoning ?? ''), confidence: flag.status === 'not-discussed' ? 'uncertain' : 'stated', evidence: Array.isArray(flag.evidence) ? flag.evidence : [] };
  }) : [];
  if (!summary.soap || typeof summary.soap !== 'object' || Array.isArray(summary.soap)) {
    summary.soap = { subjective: [summary.presentingComplaint, ...legacySubjectiveHistory, ...(summary.background as unknown[]), ...(summary.impact as unknown[]), ...legacySafety], objective: legacyMeasurements, assessment: [], plan: summary.suggestedFocus };
  } else {
    const soap = summary.soap as Record<string, unknown>;
    soap.subjective ??= [summary.presentingComplaint, ...legacySubjectiveHistory, ...(summary.background as unknown[]), ...(summary.impact as unknown[]), ...legacySafety];
    soap.objective ??= legacyMeasurements;
    soap.assessment ??= [];
    soap.plan ??= summary.suggestedFocus;
    if (Array.isArray(soap.subjective)) soap.subjective = soap.subjective.map(withEvidence);
    if (Array.isArray(soap.objective)) soap.objective = soap.objective.map(withEvidence);
    if (Array.isArray(soap.assessment)) soap.assessment = soap.assessment.map(withEvidence);
    if (Array.isArray(soap.plan)) soap.plan = soap.plan.map(withEvidence);
  }
  return summary;
}

/** Validate a summary from the model or the gateway; throws a readable error when unusable. */
export function parseSummary(value: unknown): ConsultationSummary {
  const summary = fillLists(stripNulls(value));
  if (!validSummary(summary)) throw new Error(unexpectedResponse);
  return summary;
}
