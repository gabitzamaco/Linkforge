import { useEffect, useRef, useState } from 'react';
import type {
  HistoryBucket,
  HistoryDays,
  HistoryResponse,
  Link,
  LinkHistory,
} from '../../shared/types.ts';

function formatUtcDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function DailyChart({ buckets }: { buckets: HistoryBucket[] }) {
  const firstBucket = buckets[0];
  const lastBucket = buckets.at(-1);
  if (!firstBucket || !lastBucket) return null;
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.clicks ?? 0));
  const step = 580 / buckets.length;
  return (
    <figure className="history-chart">
      <svg viewBox="0 0 640 210" role="img" aria-label="Daily redirect requests in UTC">
        <text x="26" y="20">
          {maximum.toLocaleString()}
        </text>
        <text x="26" y="174">
          0
        </text>
        <line x1="48" x2="628" y1="170" y2="170" className="history-axis" />
        {buckets.map((bucket, index) => {
          const height = ((bucket.clicks ?? 0) / maximum) * 140;
          return (
            <rect
              key={bucket.date}
              x={50 + index * step}
              y={bucket.clicks === null ? 164 : 170 - Math.max(2, height)}
              width={Math.max(3, step - 5)}
              height={bucket.clicks === null ? 6 : Math.max(2, height)}
              rx="2"
              className={bucket.clicks === null ? 'history-unavailable' : 'history-bar'}
            >
              <title>
                {formatUtcDate(bucket.date)}: {bucket.clicks ?? 'Unavailable'}
                {bucket.partial ? ' (partial day)' : ''}
              </title>
            </rect>
          );
        })}
        <text x="48" y="198">
          {formatUtcDate(firstBucket.date)}
        </text>
        <text x="628" y="198" textAnchor="end">
          {formatUtcDate(lastBucket.date)}
        </text>
      </svg>
      <figcaption>Daily redirect requests · UTC · Today is a partial day.</figcaption>
    </figure>
  );
}

interface HistoryDialogProps {
  link: Link;
  onClose: () => void;
}

type HistoryResult =
  | { key: string; status: 'success'; history: LinkHistory }
  | { key: string; status: 'error'; error: string; missing: boolean };

export default function HistoryDialog({ link, onClose }: HistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [days, setDays] = useState<HistoryDays>(30);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<HistoryResult | null>(null);
  const requestKey = `${link.code}/${days}/${revision}`;
  const current = result?.key === requestKey ? result : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function loadHistory() {
      try {
        const response = await fetch(
          `/api/links/${encodeURIComponent(link.code)}/history?days=${days}`,
          { signal: controller.signal },
        );
        const data: unknown = await response.json();
        if (!active) return;
        if (!response.ok) {
          setResult({
            key: requestKey,
            status: 'error',
            error:
              data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
                ? data.error || 'Could not load click history.'
                : 'Could not load click history.',
            missing: response.status === 404,
          });
        } else {
          setResult({
            key: requestKey,
            status: 'success',
            history: (data as HistoryResponse).history,
          });
        }
      } catch (error) {
        if (active && !(error instanceof Error && error.name === 'AbortError')) {
          setResult({
            key: requestKey,
            status: 'error',
            error: 'Could not load click history. Please try again.',
            missing: false,
          });
        }
      }
    }
    loadHistory();
    return () => {
      active = false;
      controller.abort();
    };
  }, [link.code, days, requestKey]);

  const history = current?.status === 'success' ? current.history : null;
  const failure = current?.status === 'error' ? current : null;
  return (
    <dialog
      ref={dialogRef}
      className="delete-dialog history-dialog"
      aria-labelledby="history-title"
      aria-describedby="history-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="history-heading">
        <div>
          <div className="section-label">LINK ACTIVITY</div>
          <h2 id="history-title">Click history</h2>
        </div>
        <button ref={closeRef} className="secondary-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p id="history-description" className="history-link">
        {link.shortUrl}
      </p>
      <div className="history-tools">
        <label htmlFor="history-range">Show activity for</label>
        <select
          id="history-range"
          value={days}
          onChange={(event) => {
            const nextDays = Number(event.target.value);
            if (nextDays !== 7 && nextDays !== 30) return;
            setDays(nextDays);
            setRevision((value) => value + 1);
          }}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button
          type="button"
          className="secondary-button"
          disabled={!current || failure?.missing}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      <div aria-busy={!current}>
        {!current && <p role="status">Loading click history…</p>}
        {failure?.error && (
          <div className="history-error" role="alert">
            <p>
              {failure.missing
                ? 'This link no longer exists. Close this window to return to your collection.'
                : failure.error}
            </p>
            {!failure.missing && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {history && (
          <>
            <dl className="history-totals">
              <div>
                <dt>Last {days} days</dt>
                <dd>{history.periodClicks.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Lifetime clicks</dt>
                <dd>{history.lifetimeClicks.toLocaleString()}</dd>
              </div>
            </dl>
            <p>
              History available since{' '}
              {new Date(history.trackingStartedAt).toLocaleString(undefined, { timeZone: 'UTC' })}{' '}
              UTC. Earlier dates are unavailable. Lifetime totals may include older clicks.
            </p>
            {history.periodClicks === 0 && <p role="status">No clicks recorded in this period.</p>}
            <DailyChart buckets={history.buckets} />
            <details className="history-daily-values">
              <summary>View daily values</summary>
              <div className="history-table-scroll">
                <table>
                  <caption>Daily click counts (UTC)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date (UTC)</th>
                      <th scope="col">Clicks</th>
                      <th scope="col">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.buckets.map((bucket) => (
                      <tr key={bucket.date}>
                        <th scope="row">{formatUtcDate(bucket.date)}</th>
                        <td>
                          {bucket.clicks === null ? 'Unavailable' : bucket.clicks.toLocaleString()}
                        </td>
                        <td>
                          {bucket.clicks === null
                            ? 'Before tracking'
                            : bucket.partial
                              ? 'Partial day'
                              : 'Full day'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p>Counts include automated requests and are not unique visitors.</p>
          </>
        )}
      </div>
    </dialog>
  );
}
