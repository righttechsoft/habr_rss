// viewer.ts
// Run with: deno run --allow-net --allow-read --allow-write viewer.ts
// Then open http://localhost:8000 in your browser

import { DatabaseSync } from "node:sqlite";
import { RssItem, RssItemWithImage } from "./viewer.types.ts";

// --- Global variable to track the previous batch GUIDs ---
let previousBatchGuids: string[] = [];
// --- End Global variable ---

const BATCH_SIZE = 10; // Adjust as needed

// Initialize database connection
let db: DatabaseSync;
try {
  console.log("Checking database directory...");
  try {
    const dbDir = Deno.statSync("db");
    console.log("Database directory exists:", dbDir.isDirectory);
  } catch (e) {
    console.log("Database directory does not exist, creating...");
    Deno.mkdirSync("db", { recursive: true });
  }
  
  console.log("Opening database...");
  db = new DatabaseSync("db/habr_articles.db");
  console.log("Database opened successfully");
  
  console.log("Creating table...");
  // Ensure table exists with all required columns
  const createTableStmt = db.prepare(`
    CREATE TABLE IF NOT EXISTS rss_items (
      guid TEXT PRIMARY KEY,
      title TEXT,
      link TEXT,
      description TEXT,
      pub_date TEXT,
      full_text TEXT,
      viewed INTEGER DEFAULT 0,
      ai_sumamry TEXT
    )
  `);
  createTableStmt.run();
  console.log("Table created successfully");
  
  // Test if we can prepare a simple query
  console.log("Testing database with simple query...");
  const testStmt = db.prepare("SELECT COUNT(*) as count FROM rss_items");
  const result = testStmt.get();
  console.log("Database test successful, row count:", result);
  
  console.log("Database initialized successfully");
} catch (error) {
  console.error("Error opening/initializing database:", error);
  if (error instanceof Error) {
    console.error("Error details:", error.message);
    console.error("Stack trace:", error.stack);
  }
  if (error && typeof error === 'object' && 'code' in error) {
    console.error("Error code:", (error as any).code);
  }
  Deno.exit(1);
}

function extractFirstImageUrl(description: string | null): string | null {
  if (!description) return null;
  // Simple regex to find the first img src.
  const match = description.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  // Ensure the URL is not wrapped in quotes (fix for potential data issues)
  if (match && match[1]) {
    let url = match[1];
    // Remove surrounding quotes if present (e.g., src="\"http://...\"
    url = url.replace(/^["'](.+(?=["']$))["']$/, '$1');
    return url;
  }
  return match ? match[1] : null;
}

function getUnviewedItems(offset: number, limit: number): RssItemWithImage[] {
  try {
    console.log(`[FETCH] Getting unviewed items: offset=${offset}, limit=${limit}`);
    
    const stmt = db.prepare(`
      SELECT guid, title, link, description, pub_date, viewed, ai_sumamry, full_text
      FROM rss_items
      WHERE viewed = 0
      ORDER BY pub_date ASC, guid ASC
      LIMIT ?
    `);
    const result = stmt.all(limit) as Array<{
      guid: string;
      title: string | null;
      link: string | null;
      description: string | null;
      pub_date: string | null;
      viewed: number;
      ai_sumamry: string | null;
      full_text: string | null;
    }>;

    console.log(`[FETCH] Query returned ${result.length} items`);

    const items: RssItemWithImage[] = [];
    const currentBatchGuids: string[] = [];
    
    for (const row of result) {
      const imageUrl = extractFirstImageUrl(row.description);
      
      // Store the GUID for marking as viewed later
      currentBatchGuids.push(row.guid);
      
      console.log(`[FETCH] Adding to batch: "${row.title?.substring(0, 60)}..." (viewed=${row.viewed}, has_full_text=${!!(row.full_text && row.full_text.trim())})`);

      items.push({
        guid: row.guid,
        title: row.title,
        link: row.link,
        description: row.description,
        pub_date: row.pub_date,
        viewed: row.viewed,
        ai_sumamry: row.ai_sumamry,
        full_text: row.full_text,
        imageUrl: imageUrl
      });
    }
    
    console.log(`[FETCH] Previous batch had ${previousBatchGuids.length} items`);
    console.log(`[FETCH] New batch has ${currentBatchGuids.length} items`);
    
    // Update the global variable with current batch GUIDs
    previousBatchGuids = currentBatchGuids;
    
    return items;
  } catch (error) {
    console.error("Database error in getUnviewedItems:", error);
    console.error("Query parameters: offset =", offset, "limit =", limit);
    throw error;
  }
}

// --- New function to mark a batch as viewed using stored GUIDs ---
function markPreviousBatchAsViewed(): void {
  if (previousBatchGuids.length === 0) {
    console.log("[MARK] No previous batch to mark as viewed");
    return;
  }
  
  console.log(`[MARK] Marking ${previousBatchGuids.length} items as viewed`);
  
  try {
    // Create placeholders for the IN clause
    const placeholders = previousBatchGuids.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE rss_items
      SET viewed = 1
      WHERE guid IN (${placeholders})
    `);
    const result = stmt.run(...previousBatchGuids);
    console.log(`[MARK] Successfully marked ${result.changes} items as viewed (expected: ${previousBatchGuids.length})`);

    // Always log which articles were marked as viewed
    const checkStmt = db.prepare(`
      SELECT guid, title, viewed FROM rss_items
      WHERE guid IN (${placeholders})
    `);
    const checkResult = checkStmt.all(...previousBatchGuids) as Array<{guid: string, title: string, viewed: number}>;
    console.log(`[MARK] Articles marked as viewed:`);
    checkResult.forEach(row => {
      const title = row.title?.substring(0, 60) || 'Unknown title';
      console.log(`[MARK] ✓ "${title}..." (viewed=${row.viewed})`);
    });

    if (result.changes !== previousBatchGuids.length) {
      console.warn(`[MARK] WARNING: Expected to mark ${previousBatchGuids.length} items but only marked ${result.changes}`);
    }
  } catch (error) {
    console.error("[MARK] Error marking batch as viewed:", error);
  }
}
// --- End New function ---

function escapeHtml(text: string | null): string {
  if (text === null) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncateDescription(description: string | null, maxLength: number = 300): string {
  if (!description) return '';
  // Strip HTML tags for truncation
  let plainText = description.replace(/<[^>]*>/g, '');
  
  // Decode common HTML entities
  plainText = plainText
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»');
    
  // Clean up multiple spaces
  plainText = plainText.replace(/\s+/g, ' ').trim();
  
  if (plainText.length <= maxLength) {
    return plainText;
  }
  return plainText.substring(0, maxLength) + '...';
}

async function loadHtmlTemplate(): Promise<string> {
  try {
    const htmlContent = await Deno.readTextFile("./viewer.html");
    return htmlContent;
  } catch (error) {
    console.error("Error loading HTML template:", error);
    return "<html><body><h1>Error loading template</h1></body></html>";
  }
}

async function loadStaticFile(filePath: string): Promise<string> {
  try {
    return await Deno.readTextFile(filePath);
  } catch (error) {
    console.error(`Error loading file ${filePath}:`, error);
    throw error;
  }
}

// HTTP server
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/api/articles' && req.method === 'GET') {
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const limit = parseInt(url.searchParams.get('limit') || `${BATCH_SIZE}`);

    console.log(`[API] /api/articles request: offset=${offset}, limit=${limit}`);
    console.log(`[API] Current previousBatchGuids count: ${previousBatchGuids.length}`);

    try {
        // --- Mark the *previous* batch as viewed before fetching new items ---
        markPreviousBatchAsViewed();

        // Fetch new items (this also updates previousBatchGuids for next request)
        const articles = getUnviewedItems(offset, limit);
        
        console.log(`[API] Returning ${articles.length} articles to client`);
        
        return new Response(JSON.stringify(articles), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    } catch (error) {
      console.error('[API] Error fetching articles:', error);
      return new Response(JSON.stringify({ error: 'Failed to fetch articles' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }

  // API endpoint to mark final batch when reaching end of feed
  if (url.pathname === '/api/mark-final-batch' && req.method === 'POST') {
    try {
      markPreviousBatchAsViewed();
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (error) {
      console.error('Error marking final batch:', error);
      return new Response(JSON.stringify({ error: 'Failed to mark final batch' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }

  // API endpoint to serve cached full text content
  if (url.pathname.startsWith('/api/cached/') && req.method === 'GET') {
    const encodedGuid = url.pathname.slice('/api/cached/'.length);
    const guid = decodeURIComponent(encodedGuid);
    console.log(`[CACHED] Request for encoded GUID: ${encodedGuid}`);
    console.log(`[CACHED] Decoded GUID: ${guid}`);

    try {
      const stmt = db.prepare('SELECT title, full_text FROM rss_items WHERE guid = ?');
      const result = stmt.get(guid) as { title: string | null; full_text: string | null } | undefined;

      console.log(`[CACHED] Query result:`, result);
      console.log(`[CACHED] Has result: ${!!result}`);
      console.log(`[CACHED] Has full_text: ${!!(result?.full_text)}`);
      console.log(`[CACHED] Full text length: ${result?.full_text?.length || 0}`);

      if (!result) {
        console.log(`[CACHED] No record found for GUID: ${guid}`);
        return new Response('Article not found', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (!result.full_text) {
        console.log(`[CACHED] No full_text for GUID: ${guid}`);
        return new Response('Cached content not available for this article', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(result.title || 'Cached Article')}</title>
</head>
<body>
    <h1>${escapeHtml(result.title || 'Cached Article')}</h1>
    <div class="content">${result.full_text}</div>
</body>
</html>`;

      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('Error serving cached content:', error);
      return new Response('Error serving cached content', {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }

  if (url.pathname === '/') {
    const userAgent = req.headers.get('user-agent') || 'Unknown';

    // Skip detailed logging for curl requests (healthchecks)
    if (userAgent.toLowerCase().startsWith('curl/')) {
      console.log(`[HEALTHCHECK] ${new Date().toISOString()} - Healthcheck request from ${userAgent}`);
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // Reset tracking on page load/reload to avoid marking based on stale previous request data
    previousBatchGuids = [];
    const htmlTemplate = await loadHtmlTemplate();
    return new Response(htmlTemplate, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // Serve static files
  if (url.pathname === '/viewer.css') {
    try {
      const cssContent = await loadStaticFile('./viewer.css');
      return new Response(cssContent, {
        headers: { 'Content-Type': 'text/css; charset=utf-8' }
      });
    } catch (error) {
      return new Response('CSS file not found', { status: 404 });
    }
  }

  if (url.pathname === '/viewer.js') {
    try {
      let jsContent = await loadStaticFile('./viewer.js');
      // Replace the hardcoded batch size with the actual value
      jsContent = jsContent.replace('const batchSize = 10;', `const batchSize = ${BATCH_SIZE};`);
      return new Response(jsContent, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
      });
    } catch (error) {
      return new Response('JS file not found', { status: 404 });
    }
  }

  return new Response('Not Found', { status: 404 });
}

const port = parseInt(Deno.env.get("PORT") || "8000");
console.log(`Server running on http://localhost:\${port}`);
Deno.serve({ port }, handler);
