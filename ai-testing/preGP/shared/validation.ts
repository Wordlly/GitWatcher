/** Runtime checks for the shared contracts, applied to model output on the backend and to
 * persisted or received data in the browser. Guards are exported so the frontend can
 * validate its own records with the same vocabulary.
 */
import type { ClinicalSourceRecord, ConsultationSummary, ConversationMessage, InputSpec, PatientProfile, SoapHandoff, SoapSection } from './models.ts';

export type RecordValue = Record<string, unknown>;
const inputKinds = ['text', 'choice', 'multi', 'scale', 'number', 'date', 'duration'];
const phases = ['opening', 'concern', 'details', 'history', 'impact', 'closing'];
const conductors = ['scripted', 'ai'];

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** True when every listed key holds a string. */
export function allStrings(value: RecordValue, keys: string[]): boolean { return keys.every(key => typeof value[key] === 'string'); }
/** True when the object has no keys outside the allowed list. */
export function onlyKeys(value: RecordValue, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
/** True for a string that parses as a date. */
export function isTimestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
/** True when the value is one of the listed strings. */
export function oneOf(value: unknown, options: string[]): boolean { return typeof value === 'string' && options.includes(value); }
/** Accept an absent value, otherwise apply the check. */
export function optional(value: unknown, check: (item: unknown) => boolean): boolean { return value === undefined || check(value); }
/** True for a finite number. */
export function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
/** True when no two records share an id. */
export function uniqueIds(values: { id: string }[]): boolean { return new Set(values.map(value => value.id)).size === values.length; }
/** True for a string, finite number or array of strings: the values a widget can produce. */
export function isAnswerValue(value: unknown): boolean { return typeof value === 'string' || isFiniteNumber(value) || (Array.isArray(value) && value.every(item => typeof item === 'string')); }

/** Check a profile's complete string fields, nonempty identity and valid optional birth date. */
export function validProfile(value: unknown): value is PatientProfile {
  const keys = ['id', 'name', 'preferredName', 'dateOfBirth', 'email', 'phone', 'pronouns', 'conditions', 'medications', 'allergies'];
  if (!isRecord(value) || !allStrings(value, keys) || !onlyKeys(value, keys) || !String(value.id).trim() || !String(value.name).trim()) return false;
  if (!value.dateOfBirth) return true;
  const date = String(value.dateOfBirth);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && isTimestamp(date) && new Date(date).toISOString().slice(0, 10) === date && Date.parse(date) <= Date.now();
}

/** Check an answer widget specification from storage or from a conductor. */
export function validInputSpec(value: unknown): value is InputSpec {
  if (!isRecord(value) || !onlyKeys(value, ['kind', 'options', 'min', 'max', 'step', 'unit', 'minLabel', 'maxLabel', 'allowNotSure', 'optional', 'placeholder']) || !oneOf(value.kind, inputKinds)) return false;
  const option = (item: unknown) => isRecord(item) && onlyKeys(item, ['value', 'label']) && allStrings(item, ['value', 'label']) && !!item.value && !!item.label;
  return optional(value.options, items => Array.isArray(items) && items.length > 0 && items.every(option) && new Set(items.map(item => (item as RecordValue).value)).size === items.length)
    && [value.min, value.max, value.step].every(item => optional(item, isFiniteNumber))
    && [value.unit, value.minLabel, value.maxLabel, value.placeholder].every(item => optional(item, item => typeof item === 'string'))
    && [value.allowNotSure, value.optional].every(item => optional(item, item => typeof item === 'boolean'));
}

/** Check a transcript: ordered messages with unique ids and role-appropriate fields. */
export function validMessages(value: unknown): value is ConversationMessage[] {
  if (!Array.isArray(value)) return false;
  for (const message of value) {
    if (!isRecord(message) || !onlyKeys(message, ['id', 'role', 'text', 'createdAt', 'questionId', 'input', 'phase', 'value', 'source']) || !allStrings(message, ['id', 'text']) || !message.id || !oneOf(message.role, ['assistant', 'patient']) || !isTimestamp(message.createdAt)) return false;
    if (!optional(message.questionId, item => typeof item === 'string' && !!item) || !optional(message.phase, item => oneOf(item, phases))) return false;
    if (message.role === 'assistant' && (!optional(message.input, validInputSpec) || message.value !== undefined || message.source !== undefined)) return false;
    if (message.role === 'patient' && (message.input !== undefined || message.phase !== undefined || !optional(message.value, isAnswerValue) || !optional(message.source, item => oneOf(item, ['typed', 'spoken', 'selected'])))) return false;
  }
  return uniqueIds(value as { id: string }[]);
}

function validEvidence(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isRecord(item) && onlyKeys(item, ['source', 'ref', 'quote']) && oneOf(item.source, ['message', 'profile']) && allStrings(item, ['ref', 'quote']) && !!item.ref);
}

function validFinding(value: unknown): boolean {
  return isRecord(value) && onlyKeys(value, ['id', 'label', 'value', 'reasoning', 'confidence', 'evidence']) && allStrings(value, ['id', 'label', 'value', 'reasoning']) && !!value.id && !!value.label && oneOf(value.confidence, ['stated', 'inferred', 'uncertain']) && validEvidence(value.evidence);
}

/** Check the metadata and closed shape of a governed clinical source. */
export function validClinicalSourceRecord(value: unknown): value is ClinicalSourceRecord {
  const fields = ['id', 'title', 'publisher', 'version', 'effectiveDate', 'reviewedBy', 'reviewStatus', 'excerpt'];
  if (!isRecord(value) || !onlyKeys(value, fields) || !allStrings(value, fields) || !['id', 'title', 'publisher', 'version', 'reviewedBy', 'excerpt'].every(key => String(value[key]).trim())) return false;
  const date = String(value.effectiveDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && isTimestamp(date) && new Date(date).toISOString().slice(0, 10) === date && oneOf(value.reviewStatus, ['approved', 'pending', 'rejected']);
}

/** Check that a SOAP section has only patient evidence and explicit gaps. */
export function validSoapSection(value: unknown): value is SoapSection {
  return isRecord(value) && onlyKeys(value, ['text', 'confidence', 'evidence', 'gaps']) && typeof value.text === 'string' && !!value.text.trim() && oneOf(value.confidence, ['stated', 'inferred', 'uncertain']) && validEvidence(value.evidence) && Array.isArray(value.gaps) && value.gaps.every(gap => typeof gap === 'string');
}

/** Check a clinician-only handoff without treating clinical sources as patient quotes. */
export function validSoapHandoff(value: unknown): value is SoapHandoff {
  if (!isRecord(value) || !onlyKeys(value, ['subjective', 'objective', 'assessment', 'plan', 'sourceRefs']) || ![value.subjective, value.objective, value.assessment, value.plan].every(validSoapSection)) return false;
  const objective = value.objective as SoapSection;
  // Without evidence, the whole Objective statement must say data were not collected.
  if (!objective.evidence.length && !['No objective data collected.', 'No examination data collected.', 'No vital signs or examination data collected.'].includes(objective.text.trim())) return false;
  return Array.isArray(value.sourceRefs) && value.sourceRefs.every(source => validClinicalSourceRecord(source) && source.reviewStatus === 'approved') && uniqueIds(value.sourceRefs as ClinicalSourceRecord[]);
}

/** Check either a stored version 2 summary or a complete version 3 SOAP summary. */
export function validSummary(value: unknown): value is ConsultationSummary {
  if (!isRecord(value) || !onlyKeys(value, ['version', 'source', 'model', 'generatedAt', 'profileFingerprint', 'narrative', 'presentingComplaint', 'history', 'redFlags', 'background', 'impact', 'suggestedFocus', 'gaps', 'soap'])) return false;
  if ((value.version !== 2 && value.version !== 3) || (value.version === 2 && value.soap !== undefined) || (value.version === 3 && !validSoapHandoff(value.soap)) || !oneOf(value.source, conductors) || !optional(value.model, item => typeof item === 'string') || !isTimestamp(value.generatedAt) || !allStrings(value, ['profileFingerprint', 'narrative'])) return false;
  if (!validFinding(value.presentingComplaint) || ![value.history, value.background, value.impact].every(items => Array.isArray(items) && items.every(validFinding))) return false;
  if (!Array.isArray(value.redFlags) || !value.redFlags.every(flag => isRecord(flag) && onlyKeys(flag, ['flag', 'status', 'reasoning', 'evidence']) && allStrings(flag, ['flag', 'reasoning']) && !!flag.flag && oneOf(flag.status, ['reported', 'denied', 'not-discussed']) && validEvidence(flag.evidence))) return false;
  if (!Array.isArray(value.suggestedFocus) || !value.suggestedFocus.every(point => isRecord(point) && onlyKeys(point, ['point', 'reasoning', 'evidence']) && allStrings(point, ['point', 'reasoning']) && !!point.point && validEvidence(point.evidence))) return false;
  return Array.isArray(value.gaps) && value.gaps.every(gap => typeof gap === 'string');
}
