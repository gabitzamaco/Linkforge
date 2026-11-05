import { useEffect, useRef, useState } from 'react';

function formatUtcDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function DailyChart({ buckets }) {
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
          {formatUtcDate(buckets[0].date)}
        </text>
        <text x="628" y="198" textAnchor="end">
          {formatUtcDate(buckets.at(-1).date)}
        </text>
      </svg>
      <figcaption>Daily redirect requests · UTC · Today is a partial day.</figcaption>
    </figure>
  );
}

export default function HistoryDialog({ link, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [days, setDays] = useState(30);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const requestKey = `${link.code}/${days}/${revision}`;
  const current = result?.key === requestKey ? result : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
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
        const data = await response.json();
        if (!active) return;
        if (!response.ok) {
          setResult({
            key: requestKey,
            error: data.error || 'Could not load click history.',
            missing: response.status === 404,
          });
        } else {
          setResult({ key: requestKey, history: data.history });
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') {
          setResult({ key: requestKey, error: 'Could not load click history. Please try again.' });
        }
      }
    }
    loadHistory();
    return () => {
      active = false;
      controller.abort();
    };
  }, [link.code, days, requestKey]);

  const history = current?.history;
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
            setDays(Number(event.target.value));
            setRevision((value) => value + 1);
          }}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button
          type="button"
          className="secondary-button"
          disabled={!current || current.missing}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      <div aria-busy={!current}>
        {!current && <p role="status">Loading click history…</p>}
        {current?.error && (
          <div className="history-error" role="alert">
            <p>
              {current.missing
                ? 'This link no longer exists. Close this window to return to your collection.'
                : current.error}
            </p>
            {!current.missing && (
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
