import type { AuditRow } from '../db.js';

export function condenseMutationLog(rows: AuditRow[]) {
  const columns = [
    { key: 'occurredAt', title: 'Timestamp', type: 'date' },
    { key: 'userEmail', title: 'User', type: 'string' },
    { key: 'source', title: 'Source', type: 'string' },
    { key: 'actionType', title: 'Action', type: 'string' },
    { key: 'methodNames', title: 'Methods', type: 'string' },
    { key: 'methodCount', title: '# Methods', type: 'number' },
    { key: 'status', title: 'Status', type: 'string' },
  ];

  const condensed = rows.map((row) => {
    const methods = Array.isArray(row.methods) ? row.methods : [];
    const methodNames = methods.map((m) => m.method).join(', ');

    return {
      occurredAt: row.occurred_at,
      userEmail: row.user_email || '',
      source: row.source || 'tmx',
      actionType: row.action_type,
      methodNames,
      methodCount: methods.length,
      status: row.status,
    };
  });

  return { columns, rows: condensed };
}
