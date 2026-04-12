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
  ],
};
