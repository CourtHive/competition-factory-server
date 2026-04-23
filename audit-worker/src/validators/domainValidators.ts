/**
 * Deep domain validators (L3) for tournament records.
 * Each returns { errors, warnings } — all are run and results merged.
 */

type ValidationResult = { errors: string[]; warnings: string[] };

export function validateCategories(record: any, engine: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const event of record.events ?? []) {
    const category = event.category;
    if (!category) continue;

    const { ageMin, ageMax, ratingMin, ratingMax, ratingType } = category;

    // Check participant ages against category bounds
    if (ageMin || ageMax) {
      const entries = event.entries ?? [];
      for (const entry of entries) {
        const participant = (record.participants ?? []).find((p: any) => p.participantId === entry.participantId);
        const birthDate = participant?.person?.birthDate;
        if (!birthDate) continue;

        const age = calculateAge(birthDate, record.startDate || new Date().toISOString().slice(0, 10));
        if (ageMin && age < ageMin) {
          warnings.push(`${participant.participantName || entry.participantId} is ${age} — below category minimum ${ageMin} for event "${event.eventName}"`);
        }
        if (ageMax && age > ageMax) {
          warnings.push(`${participant.participantName || entry.participantId} is ${age} — above category maximum ${ageMax} for event "${event.eventName}"`);
        }
      }
    }

    // Check participant ratings against category rating bounds
    if (ratingType && (ratingMin || ratingMax)) {
      const entries = event.entries ?? [];
      for (const entry of entries) {
        const participant = (record.participants ?? []).find((p: any) => p.participantId === entry.participantId);
        if (!participant) continue;

        const rating = findRating(participant, ratingType, event.eventType);
        if (rating === undefined) continue;

        if (ratingMin && rating < ratingMin) {
          warnings.push(`${participant.participantName || entry.participantId} rating ${rating} below minimum ${ratingMin} for event "${event.eventName}"`);
        }
        if (ratingMax && rating > ratingMax) {
          warnings.push(`${participant.participantName || entry.participantId} rating ${rating} above maximum ${ratingMax} for event "${event.eventName}"`);
        }
      }
    }
  }

  return { errors, warnings };
}

export function validateDrawIntegrity(record: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const participantIds = new Set((record.participants ?? []).map((p: any) => p.participantId));

  for (const event of record.events ?? []) {
    for (const draw of event.drawDefinitions ?? []) {
      for (const structure of draw.structures ?? []) {
        const assignments = structure.positionAssignments ?? [];

        // Check for duplicate participantIds in position assignments
        const assignedIds = assignments.map((a: any) => a.participantId).filter(Boolean);
        const seen = new Set<string>();
        for (const id of assignedIds) {
          if (seen.has(id)) {
            errors.push(`Duplicate participantId ${id} in draw "${draw.drawName}" structure "${structure.structureName}"`);
          }
          seen.add(id);
        }

        // Check that assigned participantIds exist in the tournament
        for (const id of assignedIds) {
          if (!participantIds.has(id)) {
            errors.push(`Position assignment references unknown participantId ${id} in draw "${draw.drawName}"`);
          }
        }

        // Check seed assignments reference valid participantIds
        for (const seed of structure.seedAssignments ?? []) {
          if (seed.participantId && !participantIds.has(seed.participantId)) {
            errors.push(`Seed assignment references unknown participantId ${seed.participantId} in draw "${draw.drawName}"`);
          }
        }
      }

      // Check structure links reference valid structureIds
      const structureIds = new Set((draw.structures ?? []).map((s: any) => s.structureId));
      for (const link of draw.links ?? []) {
        if (link.source?.structureId && !structureIds.has(link.source.structureId)) {
          errors.push(`Link references unknown source structureId ${link.source.structureId} in draw "${draw.drawName}"`);
        }
        if (link.target?.structureId && !structureIds.has(link.target.structureId)) {
          errors.push(`Link references unknown target structureId ${link.target.structureId} in draw "${draw.drawName}"`);
        }
      }
    }
  }

  return { errors, warnings };
}

export function validateScheduleIntegrity(record: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const startDate = record.startDate;
  const endDate = record.endDate;
  if (!startDate || !endDate) return { errors, warnings };

  // Collect all scheduled matchUps and check dates
  for (const event of record.events ?? []) {
    for (const draw of event.drawDefinitions ?? []) {
      for (const structure of draw.structures ?? []) {
        for (const matchUp of structure.matchUps ?? []) {
          const scheduledDate = matchUp.timeItems?.find((t: any) => t.itemType === 'SCHEDULE.TIME.SCHEDULED')?.itemDate
            || matchUp.schedule?.scheduledDate;

          if (scheduledDate) {
            if (scheduledDate < startDate || scheduledDate > endDate) {
              warnings.push(`MatchUp scheduled on ${scheduledDate} is outside tournament dates ${startDate}–${endDate}`);
            }
          }
        }
      }
    }
  }

  return { errors, warnings };
}

function calculateAge(birthDate: string, referenceDate: string): number {
  const birth = new Date(birthDate);
  const ref = new Date(referenceDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function findRating(participant: any, ratingType: string, eventType: string): number | undefined {
  const scaleType = eventType === 'DOUBLES' ? 'DOUBLES' : 'SINGLES';
  const ratings = participant.timeItems?.filter((t: any) =>
    t.itemType?.startsWith(`SCALE.RATING.${scaleType}`) && t.itemType?.includes(ratingType),
  );
  if (!ratings?.length) return undefined;
  const latest = ratings.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  return latest?.itemValue;
}
