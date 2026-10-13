/** Deterministic patient-facing safety checks run before a generative turn request.
 * These gates keep emergency directions and assessment refusals independent of prompt
 * compliance or retrieved clinical guidance.
 */
export const emergencyTurnText = 'Your symptoms may need urgent help. Please call 111 now and ask for an ambulance. Do not wait for another message here.';
/** Recognize direct diagnosis, assessment and prompt-injection requests. */
export function detectAssessmentRequest(text: string): boolean {
  const value = text.toLocaleLowerCase().replace(/[’]/g, "'");
  return /\b(?:can you |could you |please )?(?:diagnose me|give me (?:a )?diagnosis|tell me (?:my|the) diagnosis|make (?:a )?diagnosis|assess me|give me (?:a )?(?:preliminary |clinical )?assessment)|\bwhat(?:'s| is) my diagnosis\b|\bwhat diagnosis do i have\b|\bwhat(?:'s| is) your (?:medical )?(?:assessment|impression)|\bwhat do i have\b|\bwhat's wrong with me\b|\bwhat is wrong with me\b|\bwhat condition do i have\b|\btell me the (?:likely )?cause\b|\blikely cause of\b|\bignore (?:all )?(?:previous|prior|system)(?: instructions| prompts| rules)?\b|\bforget (?:all )?(?:previous|prior|system)(?: instructions| prompts| rules)?\b|\boverride (?:the )?system(?: instructions| prompts| rules)?\b/.test(value);
}
