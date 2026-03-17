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
      script: 'npx',
      args: 'net-level-server',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
