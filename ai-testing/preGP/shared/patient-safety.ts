/** Patient-facing text guards shared by the gateway and browser transcript renderer.
 * The output check prevents clinician-only assessment language from reaching a patient.
 */
export const assessmentRefusalText = 'I can’t diagnose or provide a clinical assessment, but I can help capture what you would like your GP to know.';

/** Detect likely diagnosis or assessment language in generated assistant text. */
export function containsPatientAssessment(text: string): boolean {
  return /\b(?:diagnos(?:e|is)|preliminary assessment|clinical assessment|differential|medical impression|symptoms? suggest|consistent with|likely (?:cause|diagnosis|to be)|you (?:may|might|could) have|you are likely to have|sounds like (?:a|an)|could be (?:a|an)|might be (?:a|an))\b/i.test(text);
}
