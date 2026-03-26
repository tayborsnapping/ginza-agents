module.exports = {
  apps: [
    // === ALWAYS-ON SERVICES ===
    {
      name: 'cto-04-alerts',
      script: 'agents/cto-04-alerts/index.js',
      // Discord bot — runs continuously, PM2 keeps alive
    },

    // === SCHEDULED AGENTS ===
    {
      name: 'cto-01-health',
      script: 'agents/cto-01-health/index.js',
      cron_restart: '5,35 * * * *',   // Every 30 min (offset from agent schedules)
      autorestart: false,
    },
    {
      name: 'cfo-01-weekly',
      script: 'agents/cfo-01-weekly-report/index.js',
      cron_restart: '0 7 * * 1',      // Monday 7:00 AM ET
      autorestart: false,
    },
    {
      name: 'cfo-03-margin',
      script: 'agents/cfo-03-margin-watch/index.js',
      cron_restart: '0 6 * * *',      // Daily 6:00 AM ET
      autorestart: false,
    },
    {
      name: 'coo-01-invoice',
      script: 'agents/coo-01-invoice/index.js',
      cron_restart: '0 8 * * *',      // Daily 8:00 AM ET
      autorestart: false,
    },
  ],
};
