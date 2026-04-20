import type { AuditRow } from '../db.js';

const DRAW_METHODS = new Set([
  'generateDrawDefinition',
  'assignDrawPosition',
  'removeDrawPosition',
  'assignSeedPositions',
  'addDrawDefinition',
  'deleteDrawDefinitions',
  'automatedPositioning',
  'swapDrawPositionAssignments',
  'alternateDrawPositionAssignment',
  'luckyLoserDrawPositionAssignment',
  'withdrawParticipantAtDrawPosition',
  'modifyDrawDefinition',
  'modifySeedAssignments',
  'setDrawParticipantRepresentativeIds',
  'removeSeeding',
]);

export function condenseDrawRevisions(rows: AuditRow[]) {
  const columns = [
    { key: 'occurredAt', title: 'Timestamp', type: 'date' },
    { key: 'userEmail', title: 'User', type: 'string' },
    { key: 'method', title: 'Action', type: 'string' },
    { key: 'drawId', title: 'Draw', type: 'string' },
    { key: 'description', title: 'Description', type: 'string' },
  ];

  const condensed: any[] = [];

  for (const row of rows) {
    const methods = Array.isArray(row.methods) ? row.methods : [];
    for (const m of methods) {
      if (!DRAW_METHODS.has(m.method)) continue;

      const drawId = m.params?.drawId || '';
      const description = buildDescription(m.method, m.params);

      condensed.push({
        occurredAt: row.occurred_at,
        userEmail: row.user_email || '',
        method: m.method,
        drawId,
        description,
      });
    }
  }

  return { columns, rows: condensed };
}

function buildDescription(method: string, params: any): string {
  if (!params) return method;

  switch (method) {
    case 'assignDrawPosition':
      return `Assigned position ${params.drawPosition ?? ''} to participant`;
    case 'removeDrawPosition':
      return `Removed position ${params.drawPosition ?? ''}`;
    case 'swapDrawPositionAssignments':
      return `Swapped positions ${params.drawPositions?.join(' ↔ ') ?? ''}`;
    case 'withdrawParticipantAtDrawPosition':
      return `Withdrew participant at position ${params.drawPosition ?? ''}`;
    case 'generateDrawDefinition':
      return `Generated draw (size: ${params.drawSize ?? ''})`;
    case 'deleteDrawDefinitions':
      return `Deleted draw(s)`;
    case 'assignSeedPositions':
    case 'modifySeedAssignments':
      return `Modified seeding`;
    default:
      return method.replace(/([A-Z])/g, ' $1').trim();
  }
}
