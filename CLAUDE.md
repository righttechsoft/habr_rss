# Habr RSS Reader

Deno-based RSS feed aggregator for Habr (Russian tech news platform) with optional AI-powered summaries via Mistral AI.

## Tech Stack

- **Runtime:** Deno (v1.46.3+)
- **Backend:** TypeScript
- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Database:** SQLite (synchronous via `node:sqlite`)
- **AI Service:** Mistral AI API (optional)

## Project Structure

```
habr_rss/
├── db/                     # SQLite database directory
│   └── habr_articles.db    # Main database
├── static/                 # Static assets (favicons, manifest)
├── fetch_articles.ts       # RSS fetcher (entry point)
├── ai_summary.ts           # AI summary generator (entry point)
├── check_availability.ts   # Link availability checker (entry point)
├── viewer.ts               # Web server (entry point)
├── viewer.types.ts         # TypeScript type definitions
├── viewer.html             # HTML template
├── viewer.js               # Frontend JavaScript
├── viewer.css              # Frontend styling
├── Dockerfile              # Docker containerization
├── start.sh                # Container startup script
├── hourly_tasks.sh         # Cron task runner
├── habr_rss.conf           # Supervisor configuration
├── .env                    # Environment variables
└── crontab                 # Cron scheduling (every 10 min)
```

## Entry Points

| Script | Command | Purpose |
|--------|---------|---------|
| `fetch_articles.ts` | `deno run --allow-net --allow-read --allow-write --allow-env fetch_articles.ts` | Fetches RSS feed from Habr, stores new articles in SQLite |
| `ai_summary.ts` | `deno run --allow-net --allow-read --allow-write --allow-env ai_summary.ts` | Generates AI summaries for unviewed articles |
| `check_availability.ts` | `deno run --allow-net --allow-read --allow-write check_availability.ts` | Checks if article links return 403, marks unavailable |
| `viewer.ts` | `deno run --allow-net --allow-read --allow-write --allow-env viewer.ts` | Starts HTTP server on port 8000 |

Windows batch files: `fetch.bat`, `view.bat`

## Database Schema

```sql
CREATE TABLE rss_items (
  guid TEXT PRIMARY KEY,      -- Unique article identifier
  title TEXT,                 -- Article title
  link TEXT,                  -- Article URL
  description TEXT,           -- Article preview (HTML)
  pub_date TEXT,              -- Publication date
  viewed INTEGER DEFAULT 0,   -- View status (0=unviewed, 1=viewed)
  ai_sumamry TEXT,            -- AI summary (note: typo preserved for compatibility)
  full_text TEXT,             -- Cached full article HTML
  unavailable INTEGER DEFAULT 0  -- Link returns 403 (0=available, 1=unavailable)
)
```

**Important:** Column name `ai_sumamry` has a typo - keep as-is for data compatibility.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve HTML template, reset view tracking |
| `/viewer.css` | GET | Serve stylesheet |
| `/viewer.js` | GET | Serve frontend JS (BATCH_SIZE injected) |
| `/api/articles` | GET | Fetch unviewed articles with pagination (`offset`, `limit` params) |
| `/api/mark-final-batch` | POST | Mark remaining articles as viewed |
| `/api/cached/:guid` | GET | Serve cached article HTML |
| `/static/*` | GET | Serve static assets (favicons, manifest) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MISTRAL_API_KEY` | No | - | Mistral AI API key for summaries |
| `PORT` | No | 8000 | HTTP server port |
| `SERVER_URL` | No | http://localhost:PORT | Base URL for cached article links |
| `HEALTHCHECK_URL` | No | - | Optional monitoring webhook |

## Architecture Notes

### View Tracking
- Deferred batch-based approach: articles marked as viewed when the *next* batch is fetched
- Prevents premature marking if user closes browser immediately
- Final batch marked via explicit API call

### Batch Processing
- Frontend loads 10 articles at a time (BATCH_SIZE constant in viewer.ts)
- AI summary processes 5 articles per batch with delays
- Prevents API rate limiting

### Data Flow
1. `fetch_articles.ts` → Inserts new RSS items (INSERT OR IGNORE)
2. `check_availability.ts` → Checks unread article links, marks 403s as unavailable
3. `ai_summary.ts` → Fetches full content, calls Mistral, updates summary
4. `viewer.ts` → Serves articles, tracks views, provides cached content

## Dependencies

- `https://deno.land/x/xml@2.1.1/mod.ts` - XML parsing for RSS
- `npm:cheerio` - HTML parsing for article extraction
- `node:sqlite` - SQLite synchronous API (Deno built-in)

## Development

Run locally:
```bash
# Fetch articles
deno run -A fetch_articles.ts

# Check article availability
deno run -A check_availability.ts

# Generate AI summaries (requires MISTRAL_API_KEY in .env)
deno run -A ai_summary.ts

# Start web server
deno run -A viewer.ts
```

Docker:
```bash
docker build -t habr-rss .
docker run -p 8000:8000 -v ./db:/app/db habr-rss
```

## Code Style

- TypeScript with explicit types
- Synchronous SQLite operations
- Simple error handling with console logging
- No external frameworks for frontend
