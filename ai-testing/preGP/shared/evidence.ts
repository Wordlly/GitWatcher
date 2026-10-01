/** Verify that summary citations quote the transcript or profile verbatim.
 * The gateway uses this for a repair pass; clinician and patient views re-run it and
 * never trust stored flags, so a hallucinated quote is always visible as unverified.
 */
import type { ConsultationSummary, ConversationMessage, EvidenceRef, PatientProfile } from './models.ts';

export interface Citation { location: string; ref: EvidenceRef }
export interface EvidenceFailure extends Citation { reason: string }
export interface EvidenceReport { total: number; verified: number; unverified: Set<string>; failures: EvidenceFailure[] }

const profileFields = ['name', 'preferredName', 'dateOfBirth', 'pronouns', 'conditions', 'medications', 'allergies'] as const;
const fingerprintFields = ['name', 'preferredName', 'dateOfBirth', 'pronouns', 'conditions', 'medications', 'allergies'] as const;

/** Lower-case, straighten quotes, collapse whitespace and drop edge punctuation so trivial drift still verifies. */
export function normaliseQuote(text: string): string {
  return text.toLocaleLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().replace(/^[\s.,;:!?…"']+|[\s.,;:!?…"']+$/g, '');
}

/** Stable identity for one citation so views can look up its verification result. */
export function evidenceKey(ref: EvidenceRef): string {
  return `${ref.source}:${ref.ref}:${normaliseQuote(ref.quote)}`;
}

/** Flatten every citation in a summary with a readable location such as `history:onset`. */
export function citations(summary: ConsultationSummary): Citation[] {
  const result: Citation[] = [];
  const add = (location: string, evidence: EvidenceRef[]) => { for (const ref of evidence) result.push({ location, ref }); };
  add(`presenting:${summary.presentingComplaint.id}`, summary.presentingComplaint.evidence);
  for (const finding of summary.history) add(`history:${finding.id}`, finding.evidence);
  for (const flag of summary.redFlags) add(`red-flag:${flag.flag}`, flag.evidence);
  for (const finding of summary.background) add(`background:${finding.id}`, finding.evidence);
  for (const finding of summary.impact) add(`impact:${finding.id}`, finding.evidence);
  summary.suggestedFocus.forEach((point, index) => add(`focus:${index + 1}`, point.evidence));
  return result;
}

/** Resolve the text a citation must quote; undefined when the reference does not exist. */
export function citedText(ref: EvidenceRef, messages: ConversationMessage[], profile: PatientProfile): string | undefined {
  if (ref.source === 'message') return messages.find(message => message.id === ref.ref)?.text;
  return (profileFields as readonly string[]).includes(ref.ref) ? profile[ref.ref as typeof profileFields[number]] : undefined;
}

/** Check every citation; a quote verifies only when it appears verbatim in the cited source. */
export function verifyEvidence(summary: ConsultationSummary, messages: ConversationMessage[], profile: PatientProfile): EvidenceReport {
  const all = citations(summary);
  const failures: EvidenceFailure[] = [];
  for (const citation of all) {
    const source = citedText(citation.ref, messages, profile);
    const quote = normaliseQuote(citation.ref.quote);
    if (source === undefined) failures.push({ ...citation, reason: citation.ref.source === 'message' ? 'The cited message does not exist in this transcript.' : 'The cited profile field does not exist.' });
    else if (!quote) failures.push({ ...citation, reason: 'The citation has no quote.' });
    else if (!normaliseQuote(source).includes(quote)) failures.push({ ...citation, reason: 'The quote does not appear verbatim in the cited source.' });
  }
  return { total: all.length, verified: all.length - failures.length, unverified: new Set(failures.map(failure => evidenceKey(failure.ref))), failures };
}

/** Fingerprint the profile facts a summary depends on, so booking can detect unreviewed edits. */
export function profileFingerprint(profile: PatientProfile): string {
  return JSON.stringify(fingerprintFields.map(field => profile[field].trim()));
}
