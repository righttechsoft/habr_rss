import { DatabaseSync } from "node:sqlite";
import * as xml from "https://deno.land/x/xml@2.1.1/mod.ts";

interface RssItem {
  guid?: string;
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
}

async function fetchRss(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function parseRss(xmlText: string): RssItem[] {
  const parsed = xml.parse(xmlText);
  const items: RssItem[] = [];
  
  // Navigate to the items. Structure is rss -> channel -> item[]
  const channel = (parsed as any).rss?.channel;
  if (!channel) {
    console.error("Invalid RSS structure: 'rss.channel' not found.");
    return items;
  }

  const rawItems = Array.isArray(channel.item) ? channel.item : [channel.item];
  
  for (const item of rawItems) {
    // Heuristic: Use guid as unique ID, fallback to link
    const guid = item.guid?.["#text"] || item.guid || undefined;
    const link = item.link || undefined;
    const id = guid || link;

    if (!id) {
      console.warn("Skipping item with no guid or link:", item.title);
      continue;
    }

    items.push({
      guid: id,
      title: item.title || undefined,
      link: item.link || undefined,
      description: item.description || undefined,
      pubDate: item.pubDate || undefined,
    });
  }

  return items;
}

function initializeDatabase(dbPath: string): DatabaseSync {
  // Ensure db directory exists
  try {
    Deno.mkdirSync("db", { recursive: true });
  } catch (error) {
    // Directory might already exist, ignore error
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
  
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    CREATE TABLE IF NOT EXISTS rss_items (
      guid TEXT PRIMARY KEY,
      title TEXT,
      link TEXT,
      description TEXT,
      pub_date TEXT,
      viewed INTEGER DEFAULT 0,
      ai_sumamry TEXT
    )
  `).run();
  return db;
}

function insertNewItem(db: DatabaseSync, item: RssItem): boolean {
  // Using INSERT OR IGNORE to skip existing records based on GUID
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO rss_items (guid, title, link, description, pub_date) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(
    item.guid || null, 
    item.title || null, 
    item.link || null, 
    item.description || null, 
    item.pubDate || null
  );
  // `result` contains the last inserted row ID. If 0, it means it was ignored.
  return result.lastInsertRowid > 0;
}


async function main() {
  const rssUrl = "https://habr.com/ru/rss/articles/";
  const dbPath = "db/habr_articles.db";

  console.log("Fetching RSS feed...");
  let rssData: string;
  try {
    rssData = await fetchRss(rssUrl);
  } catch (error) {
    console.error("Error fetching RSS:", error);
    Deno.exit(1);
  }

  console.log("Parsing RSS feed...");
  let items: RssItem[];
  try {
    items = parseRss(rssData);
    console.log(`Found ${items.length} items in the RSS feed.`);
  } catch (error) {
    console.error("Error parsing RSS:", error);
    Deno.exit(1);
  }

  console.log("Initializing database...");
  let db: DatabaseSync;
  try {
    db = initializeDatabase(dbPath);
  } catch (error) {
    console.error("Error initializing database:", error);
    Deno.exit(1);
  }

  console.log("Processing items...");
  let addedCount = 0;
  for (const item of items) {
    if (insertNewItem(db, item)) {
      addedCount++;
      // Optional: Log added items
      // console.log(`Added: ${item.title}`);
    }
  }

  console.log(`Finished. Added ${addedCount} new items to the database.`);
  db.close();

  // Send healthcheck ping after successful completion
  const healthcheckUrl = Deno.env.get("HEALTHCHECK_URL");
  if (healthcheckUrl) {
    try {
      const pingResponse = await fetch(healthcheckUrl);
      if (pingResponse.ok) {
        console.log("Healthcheck ping sent successfully");
      } else {
        console.log("Healthcheck ping failed:", pingResponse.status);
      }
    } catch (error) {
      console.log("Error sending healthcheck ping:", error);
    }
  }

}

if (import.meta.main) {
  main();
}