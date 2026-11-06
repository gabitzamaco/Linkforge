export interface StoredLink {
  id: string;
  code: string;
  url: string;
  createdAt: string;
  clicks: number;
  lastClickedAt: string | null;
}

export interface Link extends StoredLink {
  shortUrl: string;
}

export type HistoryDays = 7 | 30;

export interface HistoryBucket {
  date: string;
  clicks: number | null;
  partial: boolean;
}

export interface LinkHistory {
  code: string;
  timezone: 'UTC';
  days: HistoryDays;
  asOf: string;
  trackingStartedAt: string;
  lifetimeClicks: number;
  periodClicks: number;
  buckets: HistoryBucket[];
}

export interface CreateLinkRequest {
  url: string;
  customCode?: string;
}

export interface UpdateLinkRequest {
  url: string;
}

export interface HealthResponse {
  status: 'ok';
}

export interface LinksResponse {
  links: Link[];
}

export interface CreateLinkResponse {
  link: Link;
}

export interface UpdateLinkResponse {
  data: Link;
}

export interface HistoryResponse {
  history: LinkHistory;
}

export interface ApiErrorResponse {
  error: string;
}
