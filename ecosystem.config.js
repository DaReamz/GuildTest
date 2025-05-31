module.exports = {
  apps: [
    {
      // Application name
      name: 'guilded-shape-bot',
      
      // Script to run
      script: 'index.js',
      
      // Current working directory
      cwd: '/home/danbdreamz/ish',
      
      // Environment variables
      env: {
        NODE_ENV: 'production',
        // PM2 will automatically load from your .env file path specified in index.js
      },
      
      // Instance configuration
      instances: 1, // Single instance for Discord/Guilded bots to avoid conflicts
      exec_mode: 'fork', // Use fork mode instead of cluster for this type of application
      
      // Auto-restart configuration
      watch: false, // Set to true if you want to restart on file changes (not recommended for production)
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        'active_channels.json'
      ],
      
      // Restart policies
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M', // Restart if memory exceeds 512MB
      
      // Error handling
      restart_delay: 4000, // Wait 4 seconds before restart
      exponential_backoff_restart_delay: 100, // Exponential backoff
      
      // Logging configuration
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Advanced settings
      kill_timeout: 5000, // Time to wait before force killing
      listen_timeout: 8000, // Time to wait for listen event
      shutdown_with_message: true,
      
      // Node.js specific options
      node_args: [
        '--max-old-space-size=256', // Limit heap size to 256MB
        '--unhandled-rejections=strict'
      ],
      
      // PM2+ monitoring (optional - requires PM2+ account)
      pmx: true,
      
      // Health monitoring
      health_check_grace_period: 3000,
      
      // Process behavior
      vizion: false, // Disable git metadata
      post_update: ['npm install'], // Commands to run after update
      
      // Custom environment for different stages
      env_development: {
        NODE_ENV: 'development',
        DEBUG: 'guilded:*'
      },
      
      env_staging: {
        NODE_ENV: 'staging'
      },
      
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ],
  
  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'danbdreamz',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:username/repo.git', // Replace with your actual repo
      path: '/home/danbdreamz/ish',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /home/danbdreamz/ish/logs'
    }
  }
};