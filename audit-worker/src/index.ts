import { startValidationLoop } from './validators/index.js';
import { registerRoutes } from './routes.js';
import { createPool } from './db.js';
import { config } from 'dotenv';
import express from 'express';

// Load .env from the parent server directory
config({ path: '../.env' });

const app = express();
const port = Number(process.env.AUDIT_WORKER_PORT) || 8385;

app.use(express.json({ limit: '50mb' }));

const pool = createPool();

// Verify database connectivity on startup
pool.query('SELECT 1')
  .then(() => {
    console.log('[audit-worker] Postgres connected');
    startValidationLoop(pool);
  })
  .catch((err) => console.error('[audit-worker] Postgres connection failed:', err.message));

const router = express.Router();
registerRoutes(router, pool);
app.use('/', router);

app.listen(port, () => {
  console.log(`[audit-worker] listening on port ${port}`);
});
