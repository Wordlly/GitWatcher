/** Versioned local clinical references used by intake prompts and patient closings.
 * This allowlist is curated from clinician-reviewed New Zealand guidance; runtime code
 * does not fetch sources or treat unreviewed material as clinical evidence.
 */
export interface ClinicalGuidanceSource {
  id: string;
  version: string;
  title: string;
  publisher: string;
  url: string;
  topics: string[];
  reviewedAt: string;
  reviewedBy: string;
  questionGuidance: string[];
  emergencyIndicators: string[];
  patientSuggestion?: string;
}

/** Bump when allowlisted guidance or its matching rules change. */
export const guidanceVersion = '2026-10-09.1';

const guidance: ClinicalGuidanceSource[] = [
  {
    id: 'healthify-headache',
    version: '1.0',
    title: 'Headache',
    publisher: 'Healthify He Puna Waiora',
    url: 'https://healthify.nz/health-a-z/h/headache',
    topics: ['headache', 'migraine', 'head pain'],
    reviewedAt: '2025-10-15',
    reviewedBy: 'Dr Ray Bose, Consultant Neurologist',
    questionGuidance: [
      'Clarify sudden or gradual onset and when the headache began.',
      'Ask where it is and what the pain feels like.',
      'Clarify severity, duration, frequency, triggers and what helps or worsens it.',
      'Check for relevant associated symptoms, including vision changes, confusion, fever, neck stiffness, vomiting or weakness.',
    ],
    emergencyIndicators: [
      'Sudden, very severe or worst-ever headache.',
      'Headache with blurred vision, confusion, fever, neck stiffness, head injury, vomiting or weakness.',
    ],
    patientSuggestion: 'Rest in a quiet, dim room and drink water to stay hydrated.',
  },
  {
    id: 'healthify-chest-pain',
    version: '1.0',
    title: 'Chest pain',
    publisher: 'Healthify He Puna Waiora',
    url: 'https://healthify.nz/health-a-z/c/chest-pain',
    topics: ['chest pain', 'chest tightness', 'chest pressure', 'heart attack'],
    reviewedAt: '2026-01-19',
    reviewedBy: 'Dr Grace Lee, FRNZCGP, Clinical Educator',
    questionGuidance: [
      'Clarify where the discomfort is, how it began and how it feels.',
      'Ask whether it spreads to the arms, back, neck or jaw.',
      'Ask about duration and accompanying symptoms such as nausea, sweating, dizziness or shortness of breath.',
      'Ask what makes it better or worse and about relevant heart history when safe to continue.',
    ],
    emergencyIndicators: [
      'Chest pain or pressure with shortness of breath, sweating, nausea, dizziness or pain spreading to the arms, back, neck or jaw.',
      'Chest pain or pressure lasting more than 10 minutes.',
      'The patient thinks they may be having a heart attack.',
    ],
  },
];

function normalise(text: string): string {
  return text.toLocaleLowerCase().replace(/[\r\n,;.!?]/g, ' | ').replace(/[^a-z0-9\s| -]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Return only allowlisted sources whose topic terms occur in the supplied text. */
export function findClinicalGuidance(text: string): ClinicalGuidanceSource[] {
  const value = normalise(text);
  return guidance.filter(source => source.topics.some(topic => value.includes(topic)));
}

function hasUndeniedMatch(text: string, subject: RegExp): boolean {
  return text.split('|').some((clause) => [...clause.matchAll(new RegExp(subject.source, 'gi'))].some((match) => {
    const prefix = clause.slice(0, match.index).split(/\b(?:but|however|although)\b/).at(-1) || '';
    return !/\b(?:no|not|never|without|denies|denied|do not have|don t have|does not have|doesn t have|is not|isn t|are not|aren t)\b/i.test(prefix.slice(-64));
  }));
}

/** Detect a narrow set of explicit emergency descriptions before any AI call. */
export function detectEmergency(text: string): boolean {
  const value = normalise(text);
  const heartAttack = /\b(?:having|might be having|may be having|could be having|possible|suspect) (?:a )?heart attack\b|\bthink.{0,24}\bheart attack\b/.test(value);
  const chest = /\b(?:chest pain|chest tightness|chest pressure|crushing chest discomfort)\b/;
  const associated = /\b(?:shortness of breath|short of breath|breathless|sweating|sweaty|nausea|dizzy|dizziness|pain (?:spreading|going) to (?:my )?(?:arm|jaw|back|neck))\b/;
  const clauses = value.split('|');
  const chestEmergency = hasUndeniedMatch(value, chest) && hasUndeniedMatch(value, associated);
  const prolongedChestPain = clauses.some((clause) => hasUndeniedMatch(clause, chest) && /\b(?:more than|over|longer than) (?:10|ten) minutes\b/.test(clause));
  const breathingEmergency = /\b(?:can t breathe|cannot breathe|unable to breathe|struggling to breathe|severe difficulty breathing|severe trouble breathing|breathless at rest)\b/.test(value);
  const strokeEmergency = /\b(?:face (?:is )?drooping|facial droop|one[- ]sided weakness|weakness on one side|slurred speech)\b/.test(value);
  const headacheEmergency = /\b(?:sudden|suddenly)\b.{0,28}\b(?:very severe|worst(?:[- ]ever)? headache|severe headache)\b/.test(value);
  const recentHeartAttack = heartAttack && hasUndeniedMatch(value, /\bheart attack\b/);
  return recentHeartAttack || chestEmergency || prolongedChestPain || breathingEmergency || strokeEmergency || headacheEmergency;
}

/** Return exact patient-facing advice from the first matching allowlisted source. */
export function patientSuggestionFor(text: string): { sourceId: string; sourceVersion: string; sourceTitle: string; sourcePublisher: string; sourceUrl: string; reviewedAt: string; reviewedBy: string; text: string } | undefined {
  const source = findClinicalGuidance(text).find(item => item.patientSuggestion);
  return source?.patientSuggestion ? { sourceId: source.id, sourceVersion: source.version, sourceTitle: source.title, sourcePublisher: source.publisher, sourceUrl: source.url, reviewedAt: source.reviewedAt, reviewedBy: source.reviewedBy, text: source.patientSuggestion } : undefined;
}
