// ai_summary.ts
// Run with: deno run --allow-net --allow-read --allow-write --allow-env ai_summary.ts

import { DatabaseSync } from "node:sqlite";
import * as cheerio from "npm:cheerio";

interface ArticleRecord {
  guid: string;
  title: string | null;
  link: string | null;
  description: string | null;
  pub_date: string | null;
  viewed: number;
  ai_sumamry: string | null;
  full_text: string | null;
}

// Initialize database connection
let db: DatabaseSync;
try {
  db = new DatabaseSync("db/habr_articles.db");
} catch (error) {
  console.error("Error opening database:", error);
  Deno.exit(1);
}

// Ensure the ai_sumamry column exists (note: column name has typo but keeping it for consistency)
try {
  db.prepare("ALTER TABLE rss_items ADD COLUMN ai_sumamry TEXT").run();
} catch (error) {
  // Column probably already exists, ignore error
}

// Ensure the full_text column exists
try {
  db.prepare("ALTER TABLE rss_items ADD COLUMN full_text TEXT").run();
} catch (error) {
  // Column probably already exists, ignore error
}

function getArticlesNeedingSummary(limit: number = 5): ArticleRecord[] {
  const stmt = db.prepare(`
    SELECT guid, title, link, description, pub_date, viewed, ai_sumamry, full_text
    FROM rss_items
    WHERE viewed = 0
    AND (ai_sumamry IS NULL OR ai_sumamry = '')
    AND link IS NOT NULL
    ORDER BY pub_date ASC, guid ASC
    LIMIT ?
  `);

  const result = stmt.all(limit);
  return result as unknown as ArticleRecord[];
}

async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    console.log(`Fetching article: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const html = await response.text();
    return html;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  }
}

function extractArticleBody(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const articleBody = $('.article-formatted-body');
    
    if (articleBody.length === 0) {
      console.warn("No .article-formatted-body found in the page");
      return null;
    }
    
    // Extract text content and clean it up
    let content = articleBody.text();
    
    // Clean up whitespace and newlines
    content = content
      .replace(/\s+/g, ' ')
      .trim();
    
    if (content.length < 100) {
      console.warn("Article content too short, might not be the right content");
      return null;
    }
    
    return content;
  } catch (error) {
    console.error("Error extracting article body:", error);
    return null;
  }
}

async function generateSummary(content: string, title: string): Promise<string | null> {
  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) {
    console.error("MISTRAL_API_KEY environment variable not set");
    return null;
  }
  
  try {
    const prompt = `Сделай краткое описание (2-3 предложения) о статье под названием "${title}":

${content.substring(0, 3000)}...

Summary:`;

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      console.error(`Mistral API error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    
    if (!summary) {
      console.error("No summary returned from Mistral API");
      return null;
    }
    
    return summary;
  } catch (error) {
    console.error("Error calling Mistral API:", error);
    return null;
  }
}

function saveSummaryAndFullText(guid: string, summary: string, fullText: string): boolean {
  try {
    const stmt = db.prepare("UPDATE rss_items SET ai_sumamry = ?, full_text = ? WHERE guid = ?");
    const result = stmt.run(summary, fullText, guid);
    return result.changes > 0;
  } catch (error) {
    console.error(`Error saving summary and full text for ${guid}:`, error);
    return false;
  }
}

async function processArticle(article: ArticleRecord): Promise<boolean> {
  if (!article.link) {
    console.warn(`Article ${article.guid} has no link`);
    return false;
  }
  
  console.log(`Processing: ${article.title}`);
  
  // Fetch the article HTML
  const html = await fetchArticleContent(article.link);
  if (!html) {
    return false;
  }
  
  // Extract article content
  const content = extractArticleBody(html);
  if (!content) {
    return false;
  }
  
  console.log(`Extracted ${content.length} characters of content`);
  
  // Generate AI summary
  const summary = await generateSummary(content, article.title || "Untitled");
  if (!summary) {
    return false;
  }
  
  console.log(`Generated summary: ${summary.substring(0, 100)}...`);
  
  // Save summary and full text to database
  const saved = saveSummaryAndFullText(article.guid, summary, html);
  if (saved) {
    console.log(`✓ Summary and full text saved for: ${article.title}`);
    return true;
  } else {
    console.error(`✗ Failed to save summary and full text for: ${article.title}`);
    return false;
  }
}

const LOCK_FILE = "db/ai_summary.lock";

async function main() {
  // Prevent concurrent runs
  try {
    Deno.statSync(LOCK_FILE);
    console.log("Already running (lock file exists), exiting.");
    return;
  } catch {
    Deno.writeTextFileSync(LOCK_FILE, String(Date.now()));
  }

  try {
    await run();
  } finally {
    try { Deno.removeSync(LOCK_FILE); } catch { /* ignore */ }
  }
}

async function run() {
  console.log("Starting AI summary generation...");

  // Check if API key is available
  if (!Deno.env.get("MISTRAL_API_KEY")) {
    console.error("MISTRAL_API_KEY environment variable is required");
    Deno.exit(1);
  }
  
  const batchSize = 5; // Process 5 articles at a time
  let totalProcessed = 0;
  let successCount = 0;
  
  while (true) {
    const articles = getArticlesNeedingSummary(batchSize);
    
    if (articles.length === 0) {
      console.log("No more articles need summaries");
      break;
    }
    
    console.log(`Found ${articles.length} articles needing summaries`);
    
    for (const article of articles) {
      const success = await processArticle(article);
      totalProcessed++;
      
      if (success) {
        successCount++;
      }
      
      // Add a small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // If we processed fewer articles than batch size, we're done
    if (articles.length < batchSize) {
      break;
    }
  }
  
  console.log(`\nCompleted! Processed ${totalProcessed} articles, ${successCount} successful summaries generated.`);
  db.close();
}

if (import.meta.main) {
  main();
}