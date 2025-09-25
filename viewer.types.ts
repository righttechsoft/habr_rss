export interface RssItem {
  guid: string;
  title: string | null;
  link: string | null;
  description: string | null;
  pub_date: string | null;
  viewed: number;
  ai_sumamry?: string | null;
}

export interface RssItemWithImage extends RssItem {
  imageUrl: string | null;
  full_text?: string | null;
}