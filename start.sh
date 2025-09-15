#!/bin/bash
set -e

# Run initial tasks in background
(
    echo "$(date): Running initial fetch and AI summary in background..."
    deno run -A fetch_articles.ts 2>&1
    if [ -n "$MISTRAL_API_KEY" ]; then
        deno run -A ai_summary.ts 2>&1
    fi
    echo "$(date): Background initialisation completed"
) &

echo "$(date): Starting viewer web application..."
exec deno run -A viewer.ts