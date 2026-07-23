import { resolvePersonLink } from './personRule';
import { LEVEL_STANDARD, LEVEL_TIE, LEVEL_RUBBER } from './projectionConstants';

const TEAM = 'TEAM';
const PAIR = 'PAIR';

export interface MatchUpRowContext {
  tournamentId: string;
  providerId: string | undefined;
  published: boolean;
}

// ── tournaments ──────────────────────────────────────────────────────────────

export function tournamentRow(record: any): Record<string, any> {
  return {
    tournament_id: record?.tournamentId,
    tournament_name: record?.tournamentName ?? null,
    provider_id: record?.parentOrganisation?.organisationId ?? null,
    start_date: record?.startDate ?? null,
    end_date: record?.endDate ?? null,
    city: record?.tournamentContacts?.[0]?.city ?? record?.city ?? null,
  };
}

// ── venues ────────────────────────────────────────────────────────────────────

export function venueRow(venue: any): Record<string, any> {
  const address = venue?.addresses?.[0];
  const addressText = address
    ? [address.addressLine1, address.city, address.postalCode].filter(Boolean).join(', ')
    : null;
  return {
    venue_id: venue?.venueId,
    venue_name: venue?.venueName ?? venue?.venueAbbreviation ?? null,
    facility_id: venue?.facilityId ?? null,
    address: addressText,
  };
}

// ── match_ups + match_up_competitors ──────────────────────────────────────────

function winnerPerspectiveScore(matchUp: any): string | null {
  const score = matchUp?.score;
  if (!score) return null;
  if (matchUp?.winningSide === 2) return score.scoreStringSide2 ?? score.scoreStringSide1 ?? null;
  return score.scoreStringSide1 ?? score.scoreStringSide2 ?? null;
}

function scheduledDate(matchUp: any): string | null {
  return matchUp?.schedule?.scheduledDate ?? matchUp?.scheduledDate ?? null;
}

function venueId(matchUp: any): string | null {
  return matchUp?.schedule?.venueId ?? matchUp?.venueId ?? null;
}

/** One `match_ups` row from a hydrated matchUp. `level` distinguishes a normal
 *  matchUp (STANDARD) from a TEAM/dual container (TIE) and its nested rubbers
 *  (RUBBER); `parentMatchUpId` is set only for rubbers. */
function matchUpRow(
  matchUp: any,
  level: string,
  parentMatchUpId: string | null,
  ctx: MatchUpRowContext,
): Record<string, any> {
  return {
    match_up_id: matchUp?.matchUpId,
    tournament_id: ctx.tournamentId,
    provider_id: ctx.providerId ?? null,
    parent_match_up_id: parentMatchUpId,
    collection_id: matchUp?.collectionId ?? null,
    collection_position: matchUp?.collectionPosition ?? null,
    match_up_level: level,
    draw_id: matchUp?.drawId ?? null,
    event_id: matchUp?.eventId ?? null,
    structure_id: matchUp?.structureId ?? null,
    venue_id: venueId(matchUp),
    event_type: matchUp?.matchUpType ?? null,
    round_name: matchUp?.roundName ?? null,
    round_number: matchUp?.roundNumber ?? null,
    match_up_status: matchUp?.matchUpStatus ?? null,
    winning_side: matchUp?.winningSide ?? null,
    score_string: winnerPerspectiveScore(matchUp),
    tie_value: null,
    scheduled_date: scheduledDate(matchUp),
    published: ctx.published,
  };
}

/** Competitor rows for ONE side of a matchUp — per-INDIVIDUAL grain.
 *  Sides with no resolved participant (BYE/WALKOVER) yield no rows.
 *  `teamIdOverride` stamps a rubber player's competitor row with the team_id of
 *  its dual (from the parent TEAM matchUp side). */
function sideCompetitorRows(
  side: any,
  matchUpId: string,
  ctx: MatchUpRowContext,
  teamIdOverride: string | null,
): Record<string, any>[] {
  const participant = side?.participant;
  const participantId = participant?.participantId ?? side?.participantId;
  if (!participantId) return [];

  const sideNumber = side?.sideNumber;
  const participantType = participant?.participantType ?? null;

  if (participantType === PAIR && Array.isArray(participant?.individualParticipants)) {
    return participant.individualParticipants.map((individual: any, index: number) => {
      const link = resolvePersonLink(individual?.participantId, individual?.person?.personId);
      return {
        match_up_id: matchUpId,
        side_number: sideNumber,
        competitor_index: index,
        participant_type: PAIR,
        side_participant_id: participantId,
        individual_participant_id: individual?.participantId ?? null,
        person_id: link.personId,
        link_source: link.linkSource,
        team_id: teamIdOverride,
        provider_id: ctx.providerId ?? null,
        participant_name: individual?.participantName ?? null,
      };
    });
  }

  const isTeam = participantType === TEAM;
  const teamId = isTeam ? participant?.teamId ?? participantId : teamIdOverride;
  const link = isTeam ? { personId: null, linkSource: 'unresolved' } : resolvePersonLink(participantId, participant?.person?.personId);
  return [
    {
      match_up_id: matchUpId,
      side_number: sideNumber,
      competitor_index: 0,
      participant_type: participantType,
      side_participant_id: participantId,
      individual_participant_id: isTeam ? null : participantId,
      person_id: link.personId,
      link_source: link.linkSource,
      team_id: teamId,
      provider_id: ctx.providerId ?? null,
      participant_name: participant?.participantName ?? null,
    },
  ];
}

function teamIdForSide(parentMatchUp: any, sideNumber: number): string | null {
  const side = (parentMatchUp?.sides ?? []).find((s: any) => s?.sideNumber === sideNumber);
  const participant = side?.participant;
  if (!participant) return null;
  return participant.teamId ?? participant.participantId ?? null;
}

export interface MatchUpRowSet {
  matchUpRows: Record<string, any>[];
  competitorRows: Record<string, any>[];
}

/** Flatten ONE hydrated matchUp into its match_ups + match_up_competitors rows.
 *  A TEAM matchUp descends into its `tieMatchUps` as RUBBER rows whose
 *  competitors carry the dual's team_id. */
export function matchUpRowSet(matchUp: any, ctx: MatchUpRowContext): MatchUpRowSet {
  const matchUpRows: Record<string, any>[] = [];
  const competitorRows: Record<string, any>[] = [];
  const matchUpId = matchUp?.matchUpId;
  if (!matchUpId) return { matchUpRows, competitorRows };

  const isTeam = matchUp?.matchUpType === TEAM || Array.isArray(matchUp?.tieMatchUps);
  const level = isTeam ? LEVEL_TIE : LEVEL_STANDARD;

  matchUpRows.push(matchUpRow(matchUp, level, null, ctx));
  for (const side of matchUp?.sides ?? []) {
    competitorRows.push(...sideCompetitorRows(side, matchUpId, ctx, null));
  }

  if (isTeam) {
    for (const rubber of matchUp?.tieMatchUps ?? []) {
      const rubberId = rubber?.matchUpId;
      if (!rubberId) continue;
      matchUpRows.push(matchUpRow(rubber, LEVEL_RUBBER, matchUpId, ctx));
      for (const side of rubber?.sides ?? []) {
        const teamId = teamIdForSide(matchUp, side?.sideNumber);
        competitorRows.push(...sideCompetitorRows(side, rubberId, ctx, teamId));
      }
    }
  }

  return { matchUpRows, competitorRows };
}

// ── entries ────────────────────────────────────────────────────────────────────

/** Project the entries fact for one tournament: every event entry (accepted,
 *  alternate, withdrawn, un-drawn) → an `entries` row, person resolved per the
 *  person rule. */
export function entryRows(record: any): Record<string, any>[] {
  const tournamentId = record?.tournamentId;
  const providerId = record?.parentOrganisation?.organisationId ?? null;
  if (!tournamentId) return [];

  const personByParticipantId = buildPersonIndex(record?.participants ?? []);
  const rows: Record<string, any>[] = [];
  for (const event of record?.events ?? []) {
    for (const entry of event?.entries ?? []) {
      const participantId = entry?.participantId;
      if (!participantId) continue;
      const link = resolvePersonLink(participantId, personByParticipantId.get(participantId));
      rows.push({
        tournament_id: tournamentId,
        event_id: event?.eventId ?? null,
        participant_id: participantId,
        person_id: link.personId,
        provider_id: providerId,
        entry_status: entry?.entryStatus ?? null,
      });
    }
  }
  return rows;
}

// participantId → personId map for entry person resolution. Includes INDIVIDUAL
// participants (the humans); PAIR/TEAM entries resolve to their own id (no
// person, correctly left unresolved by the person rule).
function buildPersonIndex(participants: any[]): Map<string, string | undefined> {
  const index = new Map<string, string | undefined>();
  for (const participant of participants) {
    if (participant?.participantId) index.set(participant.participantId, participant?.person?.personId);
  }
  return index;
}

// ── slim MODIFY_MATCHUP result update ─────────────────────────────────────────

/** Partial `match_ups` row for a MODIFY_MATCHUP notice — updates only the
 *  result fields (no flatten). Includes the NOT-NULL tournament_id so a first
 *  insert (read model behind) still satisfies the schema. */
export function matchUpResultRow(matchUp: any, tournamentId: string, providerId: string | undefined): Record<string, any> {
  return {
    match_up_id: matchUp?.matchUpId,
    tournament_id: tournamentId,
    provider_id: providerId ?? null,
    match_up_status: matchUp?.matchUpStatus ?? null,
    winning_side: matchUp?.winningSide ?? null,
    score_string: winnerPerspectiveScore(matchUp),
    scheduled_date: scheduledDate(matchUp),
  };
}
