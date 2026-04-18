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
      name: 'hive-db',
      script: 'node_modules/@gridspace/net-level/lib/server.js',
      args: 'net-level-server --host=0.0.0.0',
      watch: false,
      env: {
        NODE_ENV: 'production',
        DB_HOST: process.env.DB_HOST || '0.0.0.0',
        DB_PORT: process.env.DB_PORT || '3838',
        DB_USER: process.env.DB_USER || 'admin',
        DB_PASS: process.env.DB_PASS || 'adminpass',
      },
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
    // TMX Assistant runs from its own repo with its own ecosystem.config.cjs.
    // Managed by mentat-push-tmx-assistant.sh, NOT by this file.
  ],
};
