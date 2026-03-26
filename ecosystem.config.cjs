module.exports = {
  apps: [
    // === ALWAYS-ON SERVICES ===
    {
      name: 'cto-04-alerts',
      script: 'agents/cto-04-alerts/index.js',
      // Discord bot — runs continuously, PM2 keeps alive
    },
    {
      name: 'cto-03-dashboard',
      script: 'agents/cto-03-dashboard/index.js',
      // Mission Control dashboard — Express server, always-on
      env: {
        DASHBOARD_PORT: '3737',
      },
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
      cron_restart: '15 6 * * *',     // Daily 6:15 AM ET (offset from CFO-01 to avoid Shopify rate limits)
      autorestart: false,
    },
    {
      name: 'coo-01-invoice',
      script: 'agents/coo-01-invoice/index.js',
      cron_restart: '0 8 * * *',      // Daily 8:00 AM ET
      autorestart: false,
    },
    {
      name: 'coo-02-shopify',
      script: 'agents/coo-02-shopify-entry/index.js',
      // Triggered by COO-01 completion (runner.triggerAgent), not cron
      autorestart: false,
      env: {
        COO02_DRY_RUN: 'true',       // Default: dry-run mode ON
      },
    },
    {
      name: 'coo-03-descriptions',
      script: 'agents/coo-03-descriptions/index.js',
      // Triggered by COO-02 completion (runner.triggerAgent), not cron
      autorestart: false,
      env: {
        COO03_DRY_RUN: 'true',       // Default: dry-run mode ON
      },
    },
  ],
};
