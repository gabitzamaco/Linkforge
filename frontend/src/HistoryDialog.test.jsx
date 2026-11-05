import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import App from './App.jsx';
import HistoryDialog from './HistoryDialog.jsx';

const link = {
  id: 'example',
  code: 'example',
  shortUrl: 'https://go.example.com/s/example',
  url: 'https://example.com/',
  clicks: 11,
  createdAt: '2026-11-01T12:00:00Z',
};

function historyData(days = 30, overrides = {}) {
  return {
    history: {
      code: link.code,
      timezone: 'UTC',
      days,
      asOf: '2026-11-05T12:00:00Z',
      trackingStartedAt: '2026-11-03T12:00:00Z',
      lifetimeClicks: 11,
      periodClicks: 3,
      buckets: Array.from({ length: days }, (_, index) => {
        const date = new Date(Date.UTC(2026, 10, 6 - days + index)).toISOString().slice(0, 10);
        return {
          date,
          clicks:
            date < '2026-11-03' ? null : date === '2026-11-05' ? (overrides.periodClicks ?? 3) : 0,
          partial: ['2026-11-03', '2026-11-05'].includes(date),
        };
      }),
      ...overrides,
    },
  };
}

function response(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('click count opens history, switches range, restores focus and resets on reopening', async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (url) =>
    response(url === '/api/links' ? { links: [link] } : historyData(url.endsWith('=7') ? 7 : 30)),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'View click history for example' });
  await user.click(trigger);
  expect((await screen.findByRole('dialog', { name: 'Click history' })).open).toBe(true);
  await screen.findByText('Lifetime clicks');
  expect(fetchMock).toHaveBeenCalledWith('/api/links/example/history?days=30', expect.any(Object));
  await user.selectOptions(screen.getByLabelText('Show activity for'), '7');
  await waitFor(() => expect(screen.getByText('Last 7 days', { selector: 'dt' })).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Click history' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await user.click(trigger);
  expect(screen.getByLabelText('Show activity for').value).toBe('30');
  const dialog = screen.getByRole('dialog', { name: 'Click history' });
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.queryByRole('dialog', { name: 'Click history' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('daily values expose UTC dates, untracked gaps, zero days and partial-day labels', async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => response(historyData(url.endsWith('=7') ? 7 : 30))),
  );
  render(<HistoryDialog link={link} onClose={() => {}} />);
  await screen.findByRole('img', { name: 'Daily redirect requests in UTC' });
  await user.selectOptions(screen.getByLabelText('Show activity for'), '7');
  await screen.findByText('Last 7 days', { selector: 'dt' });
  await user.click(screen.getByText('View daily values'));
  const table = screen.getByRole('table', { name: 'Daily click counts (UTC)' });
  expect(within(table).getAllByRole('row')).toHaveLength(8);
  expect(within(table).getAllByText('Unavailable')).toHaveLength(4);
  expect(within(table).getAllByText('Partial day')).toHaveLength(2);
  expect(within(table).getAllByText('0')).toHaveLength(2);
  expect(within(table).getByRole('rowheader', { name: 'Nov 5, 2026' })).toBeTruthy();
  expect(screen.getByText(/History available since/).textContent).toContain('UTC');
});

test('old range responses cannot replace the current range even when abort is ignored', async () => {
  const user = userEvent.setup();
  const oldRequest = deferred();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => oldRequest.promise)
    .mockResolvedValue(response(historyData(7, { lifetimeClicks: 77 })));
  vi.stubGlobal('fetch', fetchMock);
  render(<HistoryDialog link={link} onClose={() => {}} />);
  expect(screen.getByRole('status').textContent).toBe('Loading click history…');
  await user.selectOptions(screen.getByLabelText('Show activity for'), '7');
  await screen.findByText('77');
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => oldRequest.resolve(response(historyData(30, { lifetimeClicks: 99 }))));
  expect(screen.queryByText('99')).toBeNull();
  expect(screen.getByText('77')).toBeTruthy();
});

test('changing links aborts the old request and prevents its data appearing for the new link', async () => {
  const pending = deferred();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(response(historyData(30, { code: 'second', lifetimeClicks: 88 })));
  vi.stubGlobal('fetch', fetchMock);
  const { rerender } = render(<HistoryDialog key="example" link={link} onClose={() => {}} />);
  const second = { ...link, code: 'second', shortUrl: 'https://go.example.com/s/second' };
  rerender(<HistoryDialog key="second" link={second} onClose={() => {}} />);
  await screen.findByText('88');
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => pending.resolve(response(historyData(30, { lifetimeClicks: 99 }))));
  expect(screen.queryByText('99')).toBeNull();
  expect(screen.getByText(second.shortUrl)).toBeTruthy();
});

test('returning to a previous range shows loading rather than an old cached result', async () => {
  const user = userEvent.setup();
  const pending = deferred();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(historyData()))
    .mockImplementation(() => pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  render(<HistoryDialog link={link} onClose={() => {}} />);
  await screen.findByText('Lifetime clicks');
  await user.selectOptions(screen.getByLabelText('Show activity for'), '7');
  await user.selectOptions(screen.getByLabelText('Show activity for'), '30');
  expect(screen.getByRole('status').textContent).toBe('Loading click history…');
  expect(screen.queryByText('Lifetime clicks')).toBeNull();
  await act(async () => pending.resolve(response(historyData(30, { lifetimeClicks: 55 }))));
  await screen.findByText('55');
});

test('unmounting aborts work and ignores a late response', async () => {
  const pending = deferred();
  const fetchMock = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  const { unmount } = render(<HistoryDialog link={link} onClose={() => {}} />);
  unmount();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => pending.resolve(response(historyData())));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('failed loading can be retried and refreshing displays updated totals', async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(response(historyData()))
    .mockResolvedValueOnce(response(historyData(30, { lifetimeClicks: 45 })));
  vi.stubGlobal('fetch', fetchMock);
  render(<HistoryDialog link={link} onClose={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Please try again');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('Lifetime clicks');
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('45');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('no activity displays an empty message while retaining historical gaps', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response(historyData(30, { periodClicks: 0 }))),
  );
  render(<HistoryDialog link={link} onClose={() => {}} />);
  await screen.findByText('No clicks recorded in this period.');
  expect(screen.getByText(/Earlier dates are unavailable/)).toBeTruthy();
});

test('a deleted link has a specific message and no retry action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ error: 'This short link does not exist.' }, 404)),
  );
  render(<HistoryDialog link={link} onClose={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toContain('This link no longer exists');
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(true);
});
