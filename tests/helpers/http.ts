import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

// Response bodies are tested against their API contract by each test's assertions.
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function required<T>(value: T): NonNullable<T> {
  assert.ok(value !== null && value !== undefined);
  return value;
}

export function localOrigin(server: { address(): AddressInfo | string | null }): string {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
