#!/bin/bash
echo "$(date): Running hourly tasks..."

# Run fetch_articles
echo "$(date): Fetching articles..."
cd /app
deno run -A fetch_articles.ts

# Run ai_summary if MISTRAL_API_KEY is set
if [ -n "$MISTRAL_API_KEY" ]; then
    echo "$(date): Generating AI summaries..."
    deno run -A ai_summary.ts
else
    echo "$(date): MISTRAL_API_KEY not set, skipping AI summary generation"
fi

echo "$(date): Hourly tasks completed"