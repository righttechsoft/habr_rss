// check_availability.ts
// Run with: deno run --allow-net --allow-read --allow-write check_availability.ts
// Checks if article links are still accessible (403 = unavailable)

import { DatabaseSync } from "node:sqlite";

interface ArticleRecord {
  guid: string;
  title: string | null;
  link: string | null;
}

// Initialize database connection
let db: DatabaseSync;
try {
  db = new DatabaseSync("db/habr_articles.db");
} catch (error) {
  console.error("Error opening database:", error);
  Deno.exit(1);
}

// Ensure the unavailable column exists
try {
  db.prepare("ALTER TABLE rss_items ADD COLUMN unavailable INTEGER DEFAULT 0").run();
  console.log("Added 'unavailable' column to rss_items");
} catch (_error) {
  // Column probably already exists, ignore error
}

function getUnreadArticles(): ArticleRecord[] {
  const stmt = db.prepare(`
    SELECT guid, title, link
    FROM rss_items
    WHERE viewed = 0
    AND link IS NOT NULL
    ORDER BY pub_date ASC, guid ASC
  `);

  return stmt.all() as ArticleRecord[];
}

async function checkLinkAvailability(url: string): Promise<{ available: boolean; status: number }> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HabrRSSChecker/1.0)"
      }
    });

    return {
      available: response.status !== 403,
      status: response.status
    };
  } catch (error) {
    // Network error - treat as available (might be temporary)
    console.error(`Network error checking ${url}:`, error);
    return { available: true, status: 0 };
  }
}

function updateAvailability(guid: string, unavailable: boolean): boolean {
  try {
    const stmt = db.prepare("UPDATE rss_items SET unavailable = ? WHERE guid = ?");
    const result = stmt.run(unavailable ? 1 : 0, guid);
    return result.changes > 0;
  } catch (error) {
    console.error(`Error updating availability for ${guid}:`, error);
    return false;
  }
}

async function main() {
  console.log("Starting availability check...");

  const articles = getUnreadArticles();

  if (articles.length === 0) {
    console.log("No unread articles to check");
    db.close();
    return;
  }

  console.log(`Found ${articles.length} unread articles to check`);

  let availableCount = 0;
  let unavailableCount = 0;

  for (const article of articles) {
    if (!article.link) continue;

    const { available, status } = await checkLinkAvailability(article.link);
    const unavailable = !available;

    updateAvailability(article.guid, unavailable);

    if (unavailable) {
      unavailableCount++;
      console.log(`✗ [${status}] Unavailable: ${article.title?.substring(0, 60)}...`);
    } else {
      availableCount++;
      console.log(`✓ [${status}] Available: ${article.title?.substring(0, 60)}...`);
    }

    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\nCompleted! ${availableCount} available, ${unavailableCount} unavailable`);
  db.close();
}

if (import.meta.main) {
  main();
}
