module.exports = {
  apps: [
    {
      env: { NODE_ENV: 'production' },
      script: 'dist/main.js',
      name: 'Factory Server',
      watch: ['dist'],
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
