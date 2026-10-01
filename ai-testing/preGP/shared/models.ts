/** Wire contracts shared by the PreGP frontend and backend: patient profile, transcript
 * messages, answer widgets, evidence-linked summaries and the AI gateway request shapes.
 * Application-only records (interviews, bookings, clinician review) live in the frontend.
 */
export interface PatientProfile {
  id: string;
  name: string;
  preferredName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  pronouns: string;
  conditions: string;
  medications: string;
  allergies: string;
}
export type AnswerValue = string | string[] | number;
export interface InterviewAnswer { questionId: string; value: AnswerValue; messageId: string; answeredAt: string }
export interface QuestionOption { value: string; label: string }
export type InputKind = 'text' | 'choice' | 'multi' | 'scale' | 'number' | 'date' | 'duration';
/** How the patient may answer one assistant message; conductors decide this per question. */
export interface InputSpec {
  kind: InputKind;
  options?: QuestionOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  minLabel?: string;
  maxLabel?: string;
  allowNotSure?: boolean;
  optional?: boolean;
  placeholder?: string;
}
export type ConsultationPhase = 'opening' | 'concern' | 'details' | 'history' | 'impact' | 'closing';
export type MessageSource = 'typed' | 'spoken' | 'selected';
export interface ConversationMessage {
  id: string;
  role: 'assistant' | 'patient';
  text: string;
  createdAt: string;
  /** Assistant: the topic this message asks about. Patient: the question this message answered. */
  questionId?: string;
  input?: InputSpec;
  phase?: ConsultationPhase;
  value?: AnswerValue;
  source?: MessageSource;
}
export type ConductorKind = 'scripted' | 'ai';
export type Confidence = 'stated' | 'inferred' | 'uncertain';
/** A verbatim quote from a transcript message or a profile field that supports a finding. */
export interface EvidenceRef { source: 'message' | 'profile'; ref: string; quote: string }
export interface Finding { id: string; label: string; value: string; reasoning: string; confidence: Confidence; evidence: EvidenceRef[] }
export interface RedFlagCheck { flag: string; status: 'reported' | 'denied' | 'not-discussed'; reasoning: string; evidence: EvidenceRef[] }
export interface FocusPoint { point: string; reasoning: string; evidence: EvidenceRef[] }
/** Versioned clinical guidance with an accountable review decision. */
export interface ClinicalSourceRecord {
  id: string;
  title: string;
  publisher: string;
  version: string;
  effectiveDate: string;
  reviewedBy: string;
  reviewStatus: 'approved' | 'pending' | 'rejected';
  excerpt: string;
}
/** One clinician-only SOAP section; evidence always points to the patient record. */
export interface SoapSection { text: string; confidence: Confidence; evidence: EvidenceRef[]; gaps: string[] }
/** Clinical guidance stays separate from patient transcript and profile citations. */
export interface SoapHandoff {
  subjective: SoapSection;
  objective: SoapSection;
  assessment: SoapSection;
  plan: SoapSection;
  sourceRefs: ClinicalSourceRecord[];
}
interface ConsultationSummaryBase {
  source: ConductorKind;
  model?: string;
  generatedAt: string;
  profileFingerprint: string;
  narrative: string;
  presentingComplaint: Finding;
  history: Finding[];
  redFlags: RedFlagCheck[];
  background: Finding[];
  impact: Finding[];
  suggestedFocus: FocusPoint[];
  gaps: string[];
}
/** Legacy stored summaries remain valid without a SOAP handoff. */
export type ConsultationSummary = (ConsultationSummaryBase & { version: 2; soap?: never }) | (ConsultationSummaryBase & { version: 3; soap: SoapHandoff });
/** What the AI gateway can do right now; false everywhere means scripted mode. */
export interface AiStatus { configured: boolean; speech: boolean; transcribe: boolean; model?: string }
/** A completed earlier conversation the guide may mention as background. */
export interface PriorConsultation { title: string; completedAt: string }
/** One assistant message: what to say, what it asks, how to answer and where the conversation is.
 * The model's private rationale is not part of it; parseAssistantTurn leaves it behind. */
export interface AssistantTurn { text: string; questionId: string | null; input: InputSpec | null; phase: ConsultationPhase; complete: boolean }
export interface TurnRequest { profile: PatientProfile; messages: ConversationMessage[]; priorConsultations: PriorConsultation[] }
export interface SummaryRequest { profile: PatientProfile; messages: ConversationMessage[] }
export interface VerificationFailure { location: string; reason: string; quote: string }
export interface SummaryResponse { summary: ConsultationSummary; verification: { total: number; verified: number; failures: VerificationFailure[] } }
