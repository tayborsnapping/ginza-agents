export default {
  apps: [
    // === ALWAYS-ON SERVICES ===
    {
      name: 'cto-04-alerts',
      script: 'agents/cto-04-alerts/index.js',
      // Discord bot — runs continuously, PM2 keeps alive
    },

    // === SCHEDULED AGENTS (added in later sessions) ===
    // {
    //   name: 'cto-01-health',
    //   script: 'agents/cto-01-health/index.js',
    //   cron_restart: '5,35 * * * *',
    //   autorestart: false,
    // },
  ],
};
