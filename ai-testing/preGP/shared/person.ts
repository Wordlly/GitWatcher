/** Small identity helpers shared by patient, clinician and summary code.
 * Ages are derived at display/generation time; no age is persisted.
 */
import type { PatientProfile } from './models.ts';

/** How the guide addresses the patient: preferred name, else first name, else a neutral word. */
export function addressName(profile: PatientProfile): string {
  return profile.preferredName.trim() || profile.name.trim().split(/\s+/)[0] || 'there';
}

/** Whole years between an ISO date of birth and a reference time; undefined for invalid input. */
export function ageFrom(dateOfBirth: string, at: number | string = Date.now()): number | undefined {
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  const reference = new Date(at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || !Number.isFinite(born.getTime()) || !Number.isFinite(reference.getTime())) return undefined;
  let age = reference.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday = reference.getUTCMonth() < born.getUTCMonth() || (reference.getUTCMonth() === born.getUTCMonth() && reference.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : undefined;
}
