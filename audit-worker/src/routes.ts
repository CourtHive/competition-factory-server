import { condenseAll, condenseOne, REPORT_TYPES } from './condense.js';
import { getSummary } from './db.js';

import type { Router } from 'express';
import type pg from 'pg';

export function registerRoutes(router: Router, pool: pg.Pool): void {
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', reportTypes: REPORT_TYPES });
  });

  // Condense all report types for a tournament
  router.post('/condense/:tournamentId', async (req, res) => {
    try {
      const results = await condenseAll(pool, req.params.tournamentId);
      res.json({ success: true, results });
    } catch (err: any) {
      console.error('[audit-worker] condenseAll failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Condense a specific report type for a tournament
  router.post('/condense/:tournamentId/:reportType', async (req, res) => {
    try {
      const result = await condenseOne(pool, req.params.tournamentId, req.params.reportType);
      if (result.error) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[audit-worker] condenseOne failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Fetch existing summary without re-condensing
  router.get('/summary/:tournamentId/:reportType', async (req, res) => {
    try {
      const summary = await getSummary(pool, req.params.tournamentId, req.params.reportType);
      if (!summary) {
        res.status(404).json({ error: 'No summary found' });
        return;
      }
      res.json({ success: true, ...summary.data, condensedAt: summary.condensed_at });
    } catch (err: any) {
      console.error('[audit-worker] getSummary failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
