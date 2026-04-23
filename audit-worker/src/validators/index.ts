import { validateTournamentRecord } from './validateRecord.js';
import { getPendingRows, markSaveResult } from '../db.js';
import axios from 'axios';

import type pg from 'pg';

const POLL_INTERVAL_MS = 2000;
const SERVER_URL = process.env.FACTORY_SERVER_URL || 'http://localhost:8383';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

let polling = false;

export function startValidationLoop(pool: pg.Pool): void {
  if (polling) return;
  polling = true;
  console.log('[audit-worker] validation loop started');
  runLoop(pool);
}

async function runLoop(pool: pg.Pool): Promise<void> {
  while (polling) {
    try {
      await processPending(pool);
    } catch (err: any) {
      console.error('[audit-worker] validation loop error:', err.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function processPending(pool: pg.Pool): Promise<void> {
  const rows = await getPendingRows(pool);
  for (const row of rows) {
    await processOne(pool, row);
  }
}

async function processOne(pool: pg.Pool, row: any): Promise<void> {
  const { save_id: saveId, tournament_data: data, validation_level: level } = row;

  try {
    const result = await validateTournamentRecord(data, level);

    if (result.valid) {
      // Commit via server internal endpoint
      try {
        await axios.post(`${SERVER_URL}/factory/internal/commit-save`, { saveId }, {
          headers: { 'X-Internal-Key': INTERNAL_KEY },
          timeout: 30000,
        });
        await markSaveResult(pool, saveId, 'accepted', result.errors, result.warnings);
        console.log(`[audit-worker] save ${saveId} accepted`);
      } catch (commitErr: any) {
        console.error(`[audit-worker] commit failed for ${saveId}:`, commitErr.message);
        await markSaveResult(pool, saveId, 'rejected', [`Commit failed: ${commitErr.message}`], result.warnings);
      }
    } else {
      await markSaveResult(pool, saveId, 'rejected', result.errors, result.warnings);
      console.log(`[audit-worker] save ${saveId} rejected: ${result.errors.join('; ')}`);
    }
  } catch (err: any) {
    console.error(`[audit-worker] validation threw for ${saveId}:`, err.message);
    await markSaveResult(pool, saveId, 'rejected', [`Validation error: ${err.message}`], []);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
