require('dotenv').config();

module.exports = {
  apps: [
    {
      env: { NODE_ENV: 'production' },
      script: 'build/src/main.js',
      name: 'Factory Server',
      watch: false,
    },
    {
      name: 'Score Relay',
      script: 'score-relay/dist/server.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
        RELAY_PORT: process.env.RELAY_PORT || '8384',
        CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
        STALE_MATCH_HOURS: process.env.STALE_MATCH_HOURS || '6',
        PRUNE_INTERVAL_MINUTES: process.env.PRUNE_INTERVAL_MINUTES || '30',
        FACTORY_SERVER_URL: process.env.FACTORY_SERVER_URL || 'http://localhost:8383',
        PERSIST_SCORES: process.env.PERSIST_SCORES || 'true',
        PROJECTION_API_KEY: process.env.PROJECTION_API_KEY || '',
        VIDEO_BOARD_UDP_TARGET: process.env.VIDEO_BOARD_UDP_TARGET || '',
      },
    },
    {
      name: 'Audit Worker',
      script: 'audit-worker/dist/index.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
        AUDIT_WORKER_PORT: process.env.AUDIT_WORKER_PORT || '8385',
      },
    },
    // TMX Assistant runs from its own repo with its own ecosystem.config.cjs.
    // Managed by mentat-push-tmx-assistant.sh, NOT by this file.
  ],
};
