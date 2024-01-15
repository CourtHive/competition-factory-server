module.exports = {
  apps: [
    {
      env: { NODE_ENV: 'production' },
      script: 'dist/main.js',
      name: 'Factory Server',
      watch: ['dist'],
    },
  ],
};
