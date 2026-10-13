/** Deterministic patient-facing safety checks run before a generative turn request.
 * These gates keep emergency directions and assessment refusals independent of prompt
 * compliance or retrieved clinical guidance.
 */
export const emergencyTurnText = 'Your symptoms may need urgent help. Please call 111 now and ask for an ambulance. Do not wait for another message here.';
/** Recognize direct diagnosis, assessment and prompt-injection requests. */
export function detectAssessmentRequest(text: string): boolean {
  const value = text.toLocaleLowerCase().replace(/[’]/g, "'");
  return /\b(?:diagnos(?:e|is)|preliminary assessment|clinical assessment|(?:your|the) assessment|what(?:'s| is) your (?:medical )?(?:assessment|impression)|what do i have|what's wrong with me|what is wrong with me|what condition do i have|tell me the (?:likely )?cause|likely cause of|give me (?:a )?(?:diagnosis|assessment)|ignore (?:all )?(?:previous|prior|system)(?: instructions| prompts| rules)?|forget (?:all )?(?:previous|prior|system)(?: instructions| prompts| rules)?|override (?:the )?system(?: instructions| prompts| rules)?)\b/.test(value);
}
