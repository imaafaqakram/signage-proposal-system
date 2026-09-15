module.exports = {
  apps: [
    {
      name: 'luminus-app',
      script: 'server.js',
      cwd: '/opt/luminus-app',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '600M',
      autorestart: true
    }
  ]
}
