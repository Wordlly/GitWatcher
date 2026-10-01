/** Strict JSON schemas for structured outputs: every property required, no extras,
 * optional fields expressed as null unions. Shapes mirror the shared contracts.
 */
const nullable = (type: string) => ({ type: [type, 'null'] });
const inputKinds = ['text', 'choice', 'multi', 'scale', 'number', 'date', 'duration'];
const phases = ['opening', 'concern', 'details', 'history', 'impact', 'closing'];

/** One assistant turn: a private rationale first (so the model plans before it writes), then what to say and how to answer. */
export const turnSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rationale', 'text', 'questionId', 'phase', 'complete', 'input'],
  properties: {
    rationale: { type: 'string', description: 'One sentence, never shown to the patient: what is known so far and why this is the most useful next question for this complaint.' },
    text: { type: 'string', description: 'A brief acknowledgement of the last reply in the patient\'s own words, then one question; or a short closing message when complete.' },
    questionId: { ...nullable('string'), description: 'Stable snake_case topic key for the question asked, e.g. onset, severity, red_flag_vision_loss. Null when no question is asked.' },
    phase: { type: 'string', enum: phases },
    complete: { type: 'boolean', description: 'True only for the closing message when enough has been gathered or the patient asked to finish.' },
    input: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['kind', 'options', 'min', 'max', 'step', 'unit', 'minLabel', 'maxLabel', 'allowNotSure', 'optional', 'placeholder'],
      properties: {
        kind: { type: 'string', enum: inputKinds },
        options: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['value', 'label'], properties: { value: { type: 'string' }, label: { type: 'string' } } }, description: 'Only for choice and multi: 2 to 7 short options that together answer the whole question.' },
        min: nullable('number'),
        max: nullable('number'),
        step: nullable('number'),
        unit: nullable('string'),
        minLabel: nullable('string'),
        maxLabel: nullable('string'),
        allowNotSure: nullable('boolean'),
        optional: nullable('boolean'),
        placeholder: nullable('string'),
      },
    },
  },
};

const evidence = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['source', 'ref', 'quote'], properties: { source: { type: 'string', enum: ['message', 'profile'] }, ref: { type: 'string', description: 'The patient message tag shown in square brackets (e.g. P3), or the profile field name.' }, quote: { type: 'string', description: 'An exact substring of the cited message or profile field.' } } } };
const finding = { type: 'object', additionalProperties: false, required: ['id', 'label', 'value', 'reasoning', 'confidence', 'evidence'], properties: { id: { type: 'string' }, label: { type: 'string' }, value: { type: 'string' }, reasoning: { type: 'string' }, confidence: { type: 'string', enum: ['stated', 'inferred', 'uncertain'] }, evidence } };

/** The evidence-linked clinician summary; the gateway adds version, source, model and timestamps. */
export const summarySchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative', 'presentingComplaint', 'history', 'redFlags', 'background', 'impact', 'suggestedFocus', 'gaps'],
  properties: {
    narrative: { type: 'string' },
    presentingComplaint: finding,
    history: { type: 'array', items: finding },
    redFlags: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['flag', 'status', 'reasoning', 'evidence'], properties: { flag: { type: 'string' }, status: { type: 'string', enum: ['reported', 'denied', 'not-discussed'] }, reasoning: { type: 'string' }, evidence } } },
    background: { type: 'array', items: finding },
    impact: { type: 'array', items: finding },
    suggestedFocus: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['point', 'reasoning', 'evidence'], properties: { point: { type: 'string' }, reasoning: { type: 'string' }, evidence } } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
};
