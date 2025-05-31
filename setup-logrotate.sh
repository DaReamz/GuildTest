#!/bin/bash

# PM2 Log Rotation Setup Script
# This script sets up automatic log rotation for your Guilded bot

echo "Setting up PM2 log rotation..."

# Install PM2 log rotate module
pm2 install pm2-logrotate

# Configure log rotation settings
pm2 set pm2-logrotate:max_size 10M          # Rotate when log file reaches 10MB
pm2 set pm2-logrotate:retain 7              # Keep 7 rotated files
pm2 set pm2-logrotate:compress true         # Compress rotated files
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss  # Date format for rotated files
pm2 set pm2-logrotate:workerInterval 30     # Check every 30 seconds
pm2 set pm2-logrotate:rotateInterval 0 0 * * *  # Rotate daily at midnight
pm2 set pm2-logrotate:rotateModule true     # Also rotate PM2 module logs

echo "PM2 log rotation configured successfully!"
echo ""
echo "Current PM2 log rotation settings:"
pm2 conf pm2-logrotate

echo ""
echo "Log rotation is now active. Your bot logs will be automatically rotated when they exceed 10MB."
echo "Compressed old logs will be kept for 7 rotations, and daily rotation will occur at midnight."