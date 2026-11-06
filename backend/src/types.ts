import type { HistoryDays, LinkHistory, StoredLink } from '../../shared/types.ts';

export interface SqlQuery {
  text: string;
  values?: unknown[];
}

// Adapters return rows rather than provider-specific query result objects.
export interface Database {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<Row[]>;
  transaction(queries: SqlQuery[]): Promise<Record<string, unknown>[][]>;
  close(): Promise<void>;
}

export interface Store {
  check(): Promise<void>;
  list(): Promise<StoredLink[]>;
  get(code: string): Promise<StoredLink | null>;
  create(input: { code: string; url: string }): Promise<StoredLink | null>;
  update(code: string, url: string): Promise<StoredLink | null>;
  delete(code: string): Promise<boolean>;
  visit(code: string): Promise<StoredLink | null>;
  history(code: string, days?: HistoryDays): Promise<LinkHistory | null>;
  close(): Promise<void>;
}
