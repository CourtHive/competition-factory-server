import { syncEngine } from 'tods-competition-factory';

export type ValidationLevel = 'L1' | 'L2' | 'L3';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * L1 — Minimal field-presence validation.
 * Catches gross malformation without loading the engine.
 */
export function validateL1(tournamentRecord: any): ValidationResult {
  const errors: string[] = [];

  if (!tournamentRecord || typeof tournamentRecord !== 'object') {
    return { valid: false, errors: ['tournamentRecord must be an object'], warnings: [] };
  }

  if (!tournamentRecord.tournamentId) errors.push('tournamentId is required');
  if (!tournamentRecord.tournamentName) errors.push('tournamentName is required');
  if (!tournamentRecord.startDate) errors.push('startDate is required');
  if (!tournamentRecord.endDate) errors.push('endDate is required');

  if (tournamentRecord.startDate && !DATE_REGEX.test(tournamentRecord.startDate)) {
    errors.push('startDate must be YYYY-MM-DD format');
  }
  if (tournamentRecord.endDate && !DATE_REGEX.test(tournamentRecord.endDate)) {
    errors.push('endDate must be YYYY-MM-DD format');
  }
  if (tournamentRecord.startDate && tournamentRecord.endDate && tournamentRecord.startDate > tournamentRecord.endDate) {
    errors.push('startDate must be before or equal to endDate');
  }

  if (tournamentRecord.events && !Array.isArray(tournamentRecord.events)) {
    errors.push('events must be an array');
  }
  if (tournamentRecord.participants && !Array.isArray(tournamentRecord.participants)) {
    errors.push('participants must be an array');
  }

  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * L2 — Structural validation via engine round-trip.
 * Loads the record into a syncEngine instance and verifies
 * events, participants, and draws are queryable.
 */
function validateEngineRoundTrip(engine: any, tournamentRecord: any): { errors: string[]; bail: boolean } {
  const errors: string[] = [];
  try {
    const stateResult = engine.setState(tournamentRecord);
    if (stateResult?.error) {
      errors.push(`Engine setState failed: ${JSON.stringify(stateResult.error)}`);
      return { errors, bail: true };
    }
  } catch (err) {
    errors.push(`Engine setState threw: ${(err as Error).message}`);
    return { errors, bail: true };
  }

  try {
    const tournament = engine.getTournament();
    if (!tournament?.tournamentRecord) {
      errors.push('Engine could not read back the tournament record');
    }
  } catch (err) {
    errors.push(`Engine getTournament threw: ${(err as Error).message}`);
  }

  return { errors, bail: false };
}

function validateEvents(engine: any, events: any[]): string[] {
  const errors: string[] = [];
  try {
    const eventsResult = engine.getEvents();
    if (eventsResult?.error) {
      errors.push(`Engine getEvents failed: ${JSON.stringify(eventsResult.error)}`);
    }
  } catch (err) {
    errors.push(`Event query threw: ${(err as Error).message}`);
  }

  for (const event of events) {
    if (!event.eventId) errors.push('Event missing eventId');
    if (!event.eventType) errors.push(`Event ${event.eventId ?? '?'} missing eventType`);

    for (const dd of event.drawDefinitions ?? []) {
      if (!dd.drawId) errors.push(`DrawDefinition missing drawId in event ${event.eventId}`);
    }
  }

  return errors;
}

function validateParticipants(engine: any, participants: any[]): string[] {
  const errors: string[] = [];
  for (const p of participants) {
    if (!p.participantId) errors.push('Participant missing participantId');
    if (!p.participantType) errors.push(`Participant ${p.participantId ?? '?'} missing participantType`);
  }

  try {
    const participantsResult = engine.getParticipants();
    if (participantsResult?.error) {
      errors.push(`Engine getParticipants failed: ${JSON.stringify(participantsResult.error)}`);
    }
  } catch (err) {
    errors.push(`Participant query threw: ${(err as Error).message}`);
  }

  return errors;
}

function validateEntryReferences(events: any[], participants: any[]): string[] {
  const errors: string[] = [];
  const participantIds = new Set(participants.map((p: any) => p.participantId));

  for (const event of events) {
    for (const entry of event.entries ?? []) {
      if (entry.participantId && !participantIds.has(entry.participantId)) {
        errors.push(`Entry in event ${event.eventId} references unknown participantId ${entry.participantId}`);
      }
    }
  }

  return errors;
}

export function validateL2(tournamentRecord: any): ValidationResult {
  const l1 = validateL1(tournamentRecord);
  if (!l1.valid) return l1;

  const errors: string[] = [];
  const warnings: string[] = [];
  const engine = syncEngine;
  engine.reset();

  const roundTrip = validateEngineRoundTrip(engine, tournamentRecord);
  errors.push(...roundTrip.errors);
  if (roundTrip.bail) return { valid: false, errors, warnings };

  if (tournamentRecord.events?.length) {
    errors.push(...validateEvents(engine, tournamentRecord.events));
  }

  if (tournamentRecord.participants?.length) {
    errors.push(...validateParticipants(engine, tournamentRecord.participants));
  }

  for (const v of tournamentRecord.venues ?? []) {
    if (!v.venueId) errors.push('Venue missing venueId');
  }

  if (tournamentRecord.events?.length && tournamentRecord.participants?.length) {
    errors.push(...validateEntryReferences(tournamentRecord.events, tournamentRecord.participants));
  }

  if (!tournamentRecord.parentOrganisation) {
    warnings.push('parentOrganisation is missing — tournament will not be scoped to a provider');
  }

  engine.reset();
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * L3 — Deep domain validation.
 * Extends L2 with matchUpFormat, category, and tieFormat checks.
 */
export function validateL3(tournamentRecord: any): ValidationResult {
  const l2 = validateL2(tournamentRecord);
  if (!l2.valid) return l2;

  const warnings = [...l2.warnings];
  const engine = syncEngine;
  engine.setState(tournamentRecord);

  for (const event of tournamentRecord.events ?? []) {
    if (event.matchUpFormat) {
      try {
        const valid = engine.isValidMatchUpFormat({ matchUpFormat: event.matchUpFormat });
        if (!valid) warnings.push(`Event ${event.eventId} has invalid matchUpFormat: ${event.matchUpFormat}`);
      } catch {
        warnings.push(`Event ${event.eventId} matchUpFormat validation threw`);
      }
    }
  }

  engine.reset();
  return { valid: l2.errors.length === 0, errors: l2.errors, warnings };
}

/**
 * Validate a tournament record at the specified level.
 */
export function validateTournamentRecord(
  tournamentRecord: any,
  level: ValidationLevel = 'L2',
): ValidationResult {
  if (level === 'L1') return validateL1(tournamentRecord);
  if (level === 'L3') return validateL3(tournamentRecord);
  return validateL2(tournamentRecord);
}
