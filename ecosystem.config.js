module.exports = {
  apps: [
    {
      name: 'surma-influencer-orders',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,            // keep at 1: the tracking cron runs inside the app
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', TZ: 'Asia/Kolkata' }, // logs and server clock in IST
    },
  ],
};
