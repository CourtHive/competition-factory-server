import type { AuditRow } from '../db.js';

const SCHEDULE_METHODS = new Set([
  'bulkScheduleMatchUps',
  'scheduleMatchUp',
  'removeMatchUpScheduledTime',
  'setMatchUpScheduledTime',
  'addScheduledMatchUpTime',
  'scheduleProfileRounds',
  'clearScheduledMatchUps',
  'setMatchUpScheduledDate',
]);

export function condenseSchedulingChurn(rows: AuditRow[]) {
  const columns = [
    { key: 'occurredAt', title: 'Timestamp', type: 'date' },
    { key: 'userEmail', title: 'User', type: 'string' },
    { key: 'method', title: 'Action', type: 'string' },
    { key: 'matchUpCount', title: 'MatchUps Affected', type: 'number' },
    { key: 'description', title: 'Description', type: 'string' },
  ];

  const condensed: any[] = [];

  for (const row of rows) {
    const methods = Array.isArray(row.methods) ? row.methods : [];
    for (const m of methods) {
      if (!SCHEDULE_METHODS.has(m.method)) continue;

      let matchUpCount = 1;
      let description = m.method;

      if (m.method === 'bulkScheduleMatchUps') {
        matchUpCount = m.params?.scheduleElements?.length ?? m.params?.matchUpIds?.length ?? 0;
        description = `Bulk scheduled ${matchUpCount} matchUp(s)`;
      } else if (m.method === 'clearScheduledMatchUps') {
        description = 'Cleared all scheduled matchUps';
        matchUpCount = 0;
      } else if (m.method === 'scheduleProfileRounds') {
        description = 'Applied scheduling profile';
        matchUpCount = 0;
      } else {
        description = m.method.replace(/([A-Z])/g, ' $1').trim();
      }

      condensed.push({
        occurredAt: row.occurred_at,
        userEmail: row.user_email || '',
        method: m.method,
        matchUpCount,
        description,
      });
    }
  }

  return { columns, rows: condensed };
}
