import { validateCategories, validateDrawIntegrity, validateScheduleIntegrity } from './domainValidators.js';

type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/** L1 — field presence checks. No engine required. */
function validateL1(record: any): ValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['tournamentRecord must be an object'], warnings: [] };
  }

  if (!record.tournamentId) errors.push('Missing tournamentId');
  if (!record.tournamentName) errors.push('Missing tournamentName');
  if (!record.startDate) errors.push('Missing startDate');
  if (!record.endDate) errors.push('Missing endDate');

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (record.startDate && !datePattern.test(record.startDate)) errors.push('startDate must be YYYY-MM-DD format');
  if (record.endDate && !datePattern.test(record.endDate)) errors.push('endDate must be YYYY-MM-DD format');
  if (record.startDate && record.endDate && record.startDate > record.endDate) {
    errors.push('startDate must be before or equal to endDate');
  }

  if (record.events && !Array.isArray(record.events)) errors.push('events must be an array');
  if (record.participants && !Array.isArray(record.participants)) errors.push('participants must be an array');

  return { valid: errors.length === 0, errors, warnings: [] };
}

/** L2 — engine round-trip validation. Loads the record into syncEngine and cross-checks. */
async function validateL2(record: any): Promise<ValidationResult> {
  const l1 = validateL1(record);
  if (!l1.valid) return l1;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Dynamic import to avoid loading the factory at module level
  const { syncEngine } = await import('tods-competition-factory');
  const engine = syncEngine;

  try {
    engine.reset();
    const stateResult = engine.setState(record);
    if (stateResult?.error) {
      errors.push(`Engine setState failed: ${stateResult.error.message || JSON.stringify(stateResult.error)}`);
      engine.reset();
      return { valid: false, errors, warnings };
    }

    // Verify tournament can be read back
    const { tournamentRecord } = engine.getTournament();
    if (!tournamentRecord) {
      errors.push('Engine returned no tournamentRecord after setState');
      engine.reset();
      return { valid: false, errors, warnings };
    }

    // Validate events
    const { events } = engine.getEvents();
    for (const event of events ?? []) {
      if (!event.eventId) errors.push(`Event missing eventId: ${event.eventName || 'unnamed'}`);
      if (!event.eventType) errors.push(`Event missing eventType: ${event.eventName || event.eventId}`);
    }

    // Validate participants
    const { participants } = engine.getParticipants({});
    const participantIds = new Set((participants ?? []).map((p: any) => p.participantId));
    for (const p of participants ?? []) {
      if (!p.participantId) errors.push('Participant missing participantId');
      if (!p.participantType) errors.push(`Participant ${p.participantId} missing participantType`);
    }

    // Cross-reference: entry participantIds must exist in participants
    for (const event of record.events ?? []) {
      for (const entry of event.entries ?? []) {
        if (entry.participantId && !participantIds.has(entry.participantId)) {
          errors.push(`Entry references unknown participantId ${entry.participantId} in event ${event.eventName || event.eventId}`);
        }
      }
    }

    // Warning: missing parentOrganisation
    if (!record.parentOrganisation) {
      warnings.push('parentOrganisation is missing — needed for provider scoping');
    }

    engine.reset();
  } catch (err: any) {
    errors.push(`Engine validation threw: ${err.message}`);
    try { engine.reset(); } catch { /* ignore */ }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** L3 — deep domain validation. Runs L2 + expanded domain checks. */
async function validateL3(record: any): Promise<ValidationResult> {
  const l2 = await validateL2(record);
  if (!l2.valid) return l2;

  const allWarnings = [...l2.warnings];
  const allErrors = [...l2.errors];

  const { syncEngine } = await import('tods-competition-factory');
  try {
    syncEngine.reset();
    syncEngine.setState(record);

    // matchUpFormat validation
    for (const event of record.events ?? []) {
      if (event.matchUpFormat) {
        try {
          const result = syncEngine.isValidMatchUpFormat({ matchUpFormat: event.matchUpFormat });
          if (!result?.valid) {
            allWarnings.push(`Event "${event.eventName}" has invalid matchUpFormat: ${event.matchUpFormat}`);
          }
        } catch {
          allWarnings.push(`Event "${event.eventName}" matchUpFormat validation threw`);
        }
      }
    }

    // Category validators
    const categoryResult = validateCategories(record, syncEngine);
    allErrors.push(...categoryResult.errors);
    allWarnings.push(...categoryResult.warnings);

    // Draw integrity validators
    const drawResult = validateDrawIntegrity(record);
    allErrors.push(...drawResult.errors);
    allWarnings.push(...drawResult.warnings);

    // Schedule integrity validators
    const scheduleResult = validateScheduleIntegrity(record);
    allErrors.push(...scheduleResult.errors);
    allWarnings.push(...scheduleResult.warnings);

    syncEngine.reset();
  } catch (err: any) {
    allWarnings.push(`L3 validation threw: ${err.message}`);
    try { syncEngine.reset(); } catch { /* ignore */ }
  }

  return { valid: allErrors.length === 0, errors: allErrors, warnings: allWarnings };
}

/** Main entry point. */
export async function validateTournamentRecord(
  record: any,
  level: string = 'L2',
): Promise<ValidationResult> {
  if (level === 'L1') return validateL1(record);
  if (level === 'L3') return await validateL3(record);
  return await validateL2(record);
}
