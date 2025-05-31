#!/bin/bash

# Guilded Shape Bot Management Script
# Usage: ./bot.sh [start|stop|restart|status|logs|monitor|update]

BOT_NAME="guilded-shape-bot"
PROJECT_DIR="/home/danbdreamz/ish"
LOG_DIR="$PROJECT_DIR/logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ensure logs directory exists
mkdir -p "$LOG_DIR"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check if PM2 is installed
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        print_error "PM2 is not installed. Installing PM2..."
        npm install -g pm2
        if [ $? -ne 0 ]; then
            print_error "Failed to install PM2. Please install it manually: npm install -g pm2"
            exit 1
        fi
    fi
}

# Function to start the bot
start_bot() {
    print_status "Starting $BOT_NAME..."
    cd "$PROJECT_DIR"
    
    # Check if bot is already running
    if pm2 describe "$BOT_NAME" &> /dev/null; then
        print_warning "$BOT_NAME is already running"
        pm2 show "$BOT_NAME"
        return
    fi
    
    # Start the bot using ecosystem config
    pm2 start ecosystem.config.js --env production
    
    if [ $? -eq 0 ]; then
        print_success "$BOT_NAME started successfully"
        pm2 show "$BOT_NAME"
    else
        print_error "Failed to start $BOT_NAME"
        exit 1
    fi
}

# Function to stop the bot
stop_bot() {
    print_status "Stopping $BOT_NAME..."
    
    pm2 stop "$BOT_NAME"
    pm2 delete "$BOT_NAME"
    
    if [ $? -eq 0 ]; then
        print_success "$BOT_NAME stopped successfully"
    else
        print_error "Failed to stop $BOT_NAME"
        exit 1
    fi
}

# Function to restart the bot
restart_bot() {
    print_status "Restarting $BOT_NAME..."
    
    if pm2 describe "$BOT_NAME" &> /dev/null; then
        pm2 restart "$BOT_NAME"
    else
        print_warning "$BOT_NAME is not running. Starting it now..."
        start_bot
        return
    fi
    
    if [ $? -eq 0 ]; then
        print_success "$BOT_NAME restarted successfully"
    else
        print_error "Failed to restart $BOT_NAME"
        exit 1
    fi
}

# Function to show bot status
show_status() {
    print_status "Checking $BOT_NAME status..."
    
    if pm2 describe "$BOT_NAME" &> /dev/null; then
        pm2 show "$BOT_NAME"
        echo ""
        pm2 monit
    else
        print_warning "$BOT_NAME is not running"
    fi
}

# Function to show logs
show_logs() {
    print_status "Showing logs for $BOT_NAME..."
    
    if pm2 describe "$BOT_NAME" &> /dev/null; then
        pm2 logs "$BOT_NAME" --lines 50
    else
        print_warning "$BOT_NAME is not running. Showing recent log files..."
        if [ -f "$LOG_DIR/combined.log" ]; then
            tail -50 "$LOG_DIR/combined.log"
        else
            print_error "No log files found"
        fi
    fi
}

# Function to monitor the bot
monitor_bot() {
    print_status "Opening PM2 monitor for $BOT_NAME..."
    pm2 monit
}

# Function to update and restart
update_bot() {
    print_status "Updating $BOT_NAME..."
    cd "$PROJECT_DIR"
    
    # Pull latest code (if using git)
    if [ -d ".git" ]; then
        print_status "Pulling latest code from git..."
        git pull
    fi
    
    # Install/update dependencies
    print_status "Installing dependencies..."
    npm install
    
    # Restart the bot
    if pm2 describe "$BOT_NAME" &> /dev/null; then
        print_status "Restarting bot with new code..."
        pm2 restart "$BOT_NAME"
        print_success "$BOT_NAME updated and restarted successfully"
    else
        print_warning "$BOT_NAME was not running. Starting it now..."
        start_bot
    fi
}

# Function to save PM2 configuration
save_pm2() {
    print_status "Saving PM2 configuration..."
    pm2 save
    pm2 startup
    print_success "PM2 configuration saved. The bot will auto-start on system reboot."
}

# Function to show help
show_help() {
    echo "Guilded Shape Bot Management Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start     Start the bot"
    echo "  stop      Stop the bot"
    echo "  restart   Restart the bot"
    echo "  status    Show bot status and monitoring"
    echo "  logs      Show recent logs"
    echo "  monitor   Open PM2 monitoring interface"
    echo "  update    Update code and restart bot"
    echo "  save      Save PM2 config for auto-startup"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start      # Start the bot"
    echo "  $0 logs       # View recent logs"
    echo "  $0 status     # Check if bot is running"
}

# Main script logic
case "$1" in
    start)
        check_pm2
        start_bot
        ;;
    stop)
        check_pm2
        stop_bot
        ;;
    restart)
        check_pm2
        restart_bot
        ;;
    status)
        check_pm2
        show_status
        ;;
    logs)
        show_logs
        ;;
    monitor)
        check_pm2
        monitor_bot
        ;;
    update)
        check_pm2
        update_bot
        ;;
    save)
        check_pm2
        save_pm2
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac