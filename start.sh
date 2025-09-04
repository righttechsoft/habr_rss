#!/bin/bash
set -e  # Exit on any error

echo "$(date): Starting application initialization..."

# Set up cron job for hourly tasks for the deno user
echo "$(date): Setting up cron job..."
echo "0 * * * * /app/hourly_tasks.sh 2>&1" | crontab -

# Check if db directory exists and is writable
echo "$(date): Checking database directory..."
if [ ! -d "/app/db" ]; then
    echo "$(date): Creating db directory..."
    mkdir -p /app/db
fi
if [ ! -w "/app/db" ]; then
    echo "$(date): ERROR: Database directory is not writable!"
    exit 1
fi

# Run initial fetch and AI summary on first startup
echo "$(date): Running initial fetch and AI summary..."
echo "$(date): Fetching articles..."
deno run -A fetch_articles.ts

# Run ai_summary if MISTRAL_API_KEY is set
if [ -n "$MISTRAL_API_KEY" ]; then
    echo "$(date): Generating AI summaries..."
    deno run -A ai_summary.ts
else
    echo "$(date): MISTRAL_API_KEY not set, skipping AI summary generation"
fi

echo "$(date): Initial setup completed"
echo "$(date): Starting viewer web application..."
exec deno run -A viewer.ts