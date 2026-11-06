import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, SVGProps } from 'react';
import type {
  CreateLinkRequest,
  CreateLinkResponse,
  Link,
  LinksResponse,
  UpdateLinkRequest,
  UpdateLinkResponse,
} from '../../shared/types.ts';
import HistoryDialog from './HistoryDialog.tsx';

type IconName =
  | 'link'
  | 'arrow'
  | 'copy'
  | 'check'
  | 'edit'
  | 'trash'
  | 'refresh'
  | 'pointer'
  | 'spark'
  | 'search'
  | 'external'
  | 'close';

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

function Icon({ name, size = 20, ...props }: IconProps) {
  const paths = {
    link: (
      <>
        <path d="m10 13 4-4" />
        <path
          d="m8 15-1.5 1.5a4.25 4.25 0 0 1-6-6L5 6a4.25 4.25 0 0 1 6 0m2 3 1.5-1.5a4.25 4.25 0 0 1 6 6L17 18a4.25 4.25 0 0 1-6 0"
          transform="translate(1 0)"
        />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    edit: (
      <>
        <path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.3 8a7 7 0 0 1 11.5-3L20 8M4 16l3.2 3A7 7 0 0 0 18.7 16" />
      </>
    ),
    pointer: (
      <>
        <path d="m5 3 14 9-7 1-3 7L5 3Zm7 10 5 7" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7L11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.link}
    </svg>
  );
}

function request(path: string, options: RequestInit & { method: 'DELETE' }): Promise<null>;
function request<T>(path: string, options?: RequestInit): Promise<T>;
async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : '';
    throw new Error(error || 'Something went wrong. Please try again.');
  }
  // Successful JSON is described by the shared API contract; validation stays on the server.
  return data;
}

function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  return error instanceof Error ? error.message || fallback : fallback;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Older browsers and restricted permissions can use the selection fallback.
    }
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  const previousFocus = document.activeElement;
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (previousFocus instanceof HTMLElement) previousFocus.focus();
  if (!copied)
    throw new Error('Could not copy automatically. Select and copy the short link instead.');
}

function displayUrl(value: string) {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Just created'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function App() {
  const [links, setLinks] = useState<Link[]>([]);
  const [url, setUrl] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [copiedCode, setCopiedCode] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Link | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [editTarget, setEditTarget] = useState<Link | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState('');
  const [historyTarget, setHistoryTarget] = useState<Link | null>(null);
  const urlInput = useRef<HTMLInputElement | null>(null);
  const modalRef = useRef<HTMLDialogElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editModalRef = useRef<HTMLDialogElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadingRef = useRef(true);
  const mutationRef = useRef(false);
  const loadSequence = useRef(0);

  const loadLinks = useCallback(async (sequence: number, signal?: AbortSignal) => {
    try {
      const data = await request<LinksResponse>('/api/links', { signal });
      if (sequence !== loadSequence.current) return;
      setLinks(data.links);
      setHasLoaded(true);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(
        errorMessage(error, 'Cannot reach the server. Make sure the backend is running.'),
      );
    } finally {
      if (sequence === loadSequence.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  function refreshLinks() {
    if (mutationRef.current) return;
    const sequence = ++loadSequence.current;
    loadingRef.current = true;
    setLoading(true);
    setLoadError('');
    loadLinks(sequence);
  }

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++loadSequence.current;
    loadLinks(sequence, controller.signal);
    return () => {
      loadSequence.current += 1;
      controller.abort();
      clearTimeout(copyTimer.current);
    };
  }, [loadLinks]);

  useEffect(() => {
    if (deleteTarget) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [deleteTarget]);

  useEffect(() => {
    if (editTarget) {
      editModalRef.current?.showModal();
      editInputRef.current?.focus();
    } else {
      editModalRef.current?.close();
    }
  }, [editTarget]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingRef.current || mutationRef.current || !hasLoaded) return;
    mutationRef.current = true;
    setFormError('');
    setNotice('');
    setSaving(true);
    try {
      const data = await request<CreateLinkResponse>('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          ...(customCode.trim() ? { customCode: customCode.trim() } : {}),
        } satisfies CreateLinkRequest),
      });
      setLinks((current) => [data.link, ...current]);
      setUrl('');
      setCustomCode('');
      setNotice('Your short link is ready to share.');
      urlInput.current?.focus();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  }

  async function handleCopy(link: Link) {
    try {
      await copyText(link.shortUrl);
      setCopiedCode(link.code);
      setNotice('Short link copied to clipboard.');
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedCode(''), 2500);
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }

  function closeDelete() {
    if (deleting) return;
    modalRef.current?.close();
    setDeleteTarget(null);
    setDeleteError('');
    deleteTriggerRef.current?.focus();
  }

  async function handleDelete() {
    if (loadingRef.current || mutationRef.current || !deleteTarget) return;
    mutationRef.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await request(`/api/links/${encodeURIComponent(deleteTarget.code)}`, { method: 'DELETE' });
      setLinks((current) => current.filter((link) => link.code !== deleteTarget.code));
      setNotice('Link deleted. Its short URL will no longer redirect.');
      modalRef.current?.close();
      setDeleteTarget(null);
      urlInput.current?.focus();
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      mutationRef.current = false;
      setDeleting(false);
    }
  }

  function restoreEditFocus() {
    requestAnimationFrame(() => {
      if (editTriggerRef.current?.isConnected) editTriggerRef.current.focus();
      else urlInput.current?.focus();
    });
  }

  function closeEdit() {
    if (updating) return;
    editModalRef.current?.close();
    setEditTarget(null);
    setEditError('');
    restoreEditFocus();
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingRef.current || mutationRef.current || !editTarget) return;
    mutationRef.current = true;
    setUpdating(true);
    setEditError('');
    try {
      const { data } = await request<UpdateLinkResponse>(
        `/api/links/${encodeURIComponent(editTarget.code)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: editUrl.trim() } satisfies UpdateLinkRequest),
        },
      );
      setLinks((current) => current.map((link) => (link.code === editTarget.code ? data : link)));
      editModalRef.current?.close();
      setEditTarget(null);
      setNotice('Link updated. Your short URL now redirects to the new destination.');
      restoreEditFocus();
    } catch (error) {
      setEditError(errorMessage(error));
    } finally {
      mutationRef.current = false;
      setUpdating(false);
    }
  }

  const totalClicks = links.reduce((total, link) => total + Number(link.clicks || 0), 0);
  const activeLinks = links.filter((link) => link.clicks > 0).length;
  const filteredLinks = links.filter((link) =>
    `${link.url} ${link.code}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Linkforge home">
          <span className="brand-icon">
            <Icon name="link" size={22} />
          </span>
          linkforge<span className="brand-period">.</span>
        </a>
        <span className="workspace-label">
          <span className="status-dot" /> Your link workspace
        </span>
        <a href="#your-links" className="header-link">
          Your links <Icon name="arrow" size={16} />
        </a>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div className="eyebrow">
            <span className="eyebrow-line" /> A LITTLE LESS LINK. A LOT MORE POSSIBILITY.
          </div>
          <h1 id="page-title">
            Good things come
            <br />
            in <span>short links.</span>
            <svg
              className="heading-spark"
              width="43"
              height="48"
              viewBox="0 0 43 48"
              aria-hidden="true"
            >
              <path
                d="m8 34 15-20M4 21l5-15m14 34 14-5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </h1>
          <p className="intro-description">
            Turn long, unwieldy URLs into clean, memorable links.
            <br className="desktop-break" /> Make something worth sharing.
          </p>
          <div className="intro-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="art-link">
              <Icon name="link" size={52} />
            </div>
            <span className="art-star">✳</span>
            <span className="art-pill">
              <span /> Less is more.
            </span>
          </div>
        </section>

        <section className="create-panel" aria-labelledby="create-title">
          <div className="panel-heading">
            <span className="small-icon">
              <Icon name="spark" size={19} />
            </span>
            <div>
              <h2 id="create-title">Your next great link starts here</h2>
              <p>Paste a destination. Give it a little personality.</p>
            </div>
            <span className="step-badge">01 / CREATE</span>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field destination-field">
                <label htmlFor="destination">Destination URL</label>
                <div className="input-wrap">
                  <Icon name="link" size={19} />
                  <input
                    ref={urlInput}
                    id="destination"
                    type="url"
                    placeholder="https://example.com/something-worth-sharing"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    required
                    maxLength={8192}
                    autoComplete="url"
                    aria-describedby={formError ? 'form-error' : undefined}
                  />
                </div>
              </div>
              <div className="field alias-field">
                <label htmlFor="alias">
                  Custom alias <span>(optional)</span>
                </label>
                <div className="input-wrap alias-input">
                  <span className="alias-prefix">/s/</span>
                  <input
                    id="alias"
                    type="text"
                    placeholder="your-big-idea"
                    value={customCode}
                    onChange={(event) => setCustomCode(event.target.value)}
                    minLength={3}
                    maxLength={32}
                    pattern={'[A-Za-z0-9_\\-]{3,32}'}
                    title="Use 3–32 letters, numbers, hyphens, or underscores."
                    aria-describedby="alias-help"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>
              </div>
              <button
                className="primary-button shorten-button"
                type="submit"
                disabled={loading || saving || deleting || updating || !hasLoaded}
              >
                {saving ? 'Creating…' : 'Shorten link'}
                <Icon name="arrow" size={18} />
              </button>
            </div>
            <div className="form-footer">
              <span id="alias-help">
                <Icon name="check" size={13} /> HTTP & HTTPS links supported{' '}
                <span className="footer-dot">·</span> Aliases use 3–32 letters, numbers, - or _
              </span>
              <span className="form-tag">Long URL. Short story.</span>
            </div>
            {formError && (
              <p id="form-error" className="error-message" role="alert">
                {formError}
              </p>
            )}
          </form>
        </section>

        <section className="stats-grid" aria-label="Link statistics" aria-busy={loading}>
          <div className="stat-card">
            <div>
              <span className="stat-label">Links created</span>
              <strong>{loading || !hasLoaded ? '—' : links.length.toLocaleString()}</strong>
              <span className="stat-note">Small links, ready to travel</span>
            </div>
            <span className="stat-icon">
              <Icon name="link" size={21} />
            </span>
          </div>
          <div className="stat-card">
            <div>
              <span className="stat-label">Total clicks</span>
              <strong>{loading || !hasLoaded ? '—' : totalClicks.toLocaleString()}</strong>
              <span className="stat-note">Every visit is a connection</span>
            </div>
            <span className="stat-icon peach">
              <Icon name="pointer" size={21} />
            </span>
          </div>
          <div className="stat-card">
            <div>
              <span className="stat-label">Links with visits</span>
              <strong>{loading || !hasLoaded ? '—' : activeLinks.toLocaleString()}</strong>
              <span className="stat-note">Your ideas, out in the world</span>
            </div>
            <span className="stat-icon lilac">
              <Icon name="external" size={20} />
            </span>
          </div>
        </section>

        <section id="your-links" className="links-section" aria-labelledby="links-title">
          <div className="links-heading">
            <div>
              <div className="section-label">YOUR COLLECTION</div>
              <h2 id="links-title">
                Little links. Big potential.
                <span className="count-badge">{hasLoaded ? links.length : '—'}</span>
              </h2>
            </div>
            <div className="collection-tools">
              <div className="search-box">
                <Icon name="search" size={17} />
                <input
                  aria-label="Search links"
                  placeholder="Find a link…"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <button
                type="button"
                className={`icon-button refresh-button ${loading ? 'is-loading' : ''}`}
                onClick={refreshLinks}
                disabled={loading || saving || deleting || updating}
                aria-label="Refresh links"
                title="Refresh links and click counts"
              >
                <Icon name="refresh" size={17} />
              </button>
            </div>
          </div>
          {loadError && (
            <div className="load-error" role="alert">
              <p>{loadError}</p>
              <button
                type="button"
                className="text-button"
                onClick={refreshLinks}
                disabled={loading || saving || deleting || updating}
              >
                Try again <Icon name="refresh" size={15} />
              </button>
            </div>
          )}
          <div className="links-table" aria-busy={loading}>
            <div className="table-head" aria-hidden="true">
              <span>LINK / DESTINATION</span>
              <span>CREATED</span>
              <span>CLICKS</span>
              <span>ACTIONS</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <span className="loading-ring" />
                <h3>Gathering your links…</h3>
                <p>Your collection will be here in a moment.</p>
              </div>
            ) : !hasLoaded ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Icon name="refresh" size={28} />
                </div>
                <h3>Your collection could not be loaded</h3>
                <p>Try again to view your links and current click counts.</p>
              </div>
            ) : filteredLinks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Icon name={search ? 'search' : 'link'} size={28} />
                </div>
                <h3>{search ? 'No links found' : 'A fresh start for your next big idea'}</h3>
                <p>
                  {search
                    ? 'Try another destination or alias.'
                    : 'Create your first short link above. We’ll keep it right here.'}
                </p>
                {!search && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => urlInput.current?.focus()}
                  >
                    Make your first link <Icon name="arrow" size={16} />
                  </button>
                )}
              </div>
            ) : (
              <ul className="link-list">
                {filteredLinks.map((link) => (
                  <li className="link-row" key={link.id || link.code}>
                    <div className="link-cell">
                      <span className="link-row-icon">
                        <Icon name="link" size={18} />
                      </span>
                      <div className="link-details">
                        <a
                          className="short-link"
                          href={link.shortUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={link.shortUrl}
                        >
                          {displayUrl(link.shortUrl)}
                          <Icon name="external" size={12} />
                        </a>
                        <a
                          className="destination-link"
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          title={link.url}
                        >
                          {link.url}
                        </a>
                      </div>
                    </div>
                    <span className="date-cell">{formatDate(link.createdAt)}</span>
                    <button
                      type="button"
                      className="clicks-cell history-trigger"
                      aria-label={`View click history for ${link.code}`}
                      title="View click history"
                      onClick={() => setHistoryTarget(link)}
                    >
                      <Icon name="pointer" size={14} />
                      {Number(link.clicks || 0).toLocaleString()}
                      <span className="mobile-click-label">clicks</span>
                    </button>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="copy-button edit-button"
                        disabled={loading || saving || deleting || updating}
                        onClick={(event) => {
                          editTriggerRef.current = event.currentTarget;
                          setEditUrl(link.url);
                          setEditError('');
                          setNotice('');
                          setEditTarget(link);
                        }}
                        aria-label={`Edit link ${link.code}`}
                      >
                        <Icon name="edit" size={15} />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        className={`copy-button ${copiedCode === link.code ? 'copied' : ''}`}
                        onClick={() => handleCopy(link)}
                        aria-label={`Copy link ${link.code}`}
                      >
                        <Icon name={copiedCode === link.code ? 'check' : 'copy'} size={15} />
                        <span>{copiedCode === link.code ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        className="icon-button delete-button"
                        type="button"
                        disabled={loading || saving || deleting || updating}
                        onClick={(event) => {
                          deleteTriggerRef.current = event.currentTarget;
                          setDeleteTarget(link);
                        }}
                        aria-label={`Delete link ${link.code}`}
                        title="Delete link"
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="table-footer">
              <span>
                {hasLoaded ? (
                  <>
                    {filteredLinks.length} {filteredLinks.length === 1 ? 'link' : 'links'}
                    {search ? ` matching “${search}”` : ' in your collection'}
                  </>
                ) : (
                  'Collection unavailable'
                )}
              </span>
              <span>
                <span className="status-dot" /> Stored on your server
              </span>
            </div>
          </div>
        </section>

        <aside className="tip-banner">
          <span className="tip-icon">
            <Icon name="spark" size={22} />
          </span>
          <p>
            <strong>A link with a little personality.</strong> Custom aliases make your links easier
            to remember and a little more you.
          </p>
          <span className="tip-decoration" aria-hidden="true">
            ↗
          </span>
        </aside>
      </main>

      <footer className="site-footer">
        <span>Made for the things worth sharing.</span>
        <span>
          LINKFORGE <span className="footer-spark">✳</span> LESS LINK. MORE POSSIBILITY.
        </span>
      </footer>
      <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">
        {notice && (
          <>
            <Icon name="check" size={17} />
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <Icon name="close" size={15} />
            </button>
          </>
        )}
      </div>

      {historyTarget && (
        <HistoryDialog
          key={historyTarget.code}
          link={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}
      <dialog
        ref={editModalRef}
        className="delete-dialog edit-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeEdit();
        }}
        aria-labelledby="edit-title"
        aria-describedby="edit-description"
      >
        <div className="dialog-icon edit-dialog-icon">
          <Icon name="edit" size={24} />
        </div>
        <h2 id="edit-title">Edit destination</h2>
        <p id="edit-description">
          Choose a new destination for <strong>{editTarget?.shortUrl}</strong>. Your short URL and
          click statistics stay the same.
        </p>
        <form onSubmit={handleUpdate} aria-busy={updating}>
          <div className="field edit-destination-field">
            <label htmlFor="edit-destination">New destination URL</label>
            <div className="input-wrap">
              <Icon name="link" size={19} />
              <input
                ref={editInputRef}
                id="edit-destination"
                type="url"
                value={editUrl}
                onChange={(event) => setEditUrl(event.target.value)}
                required
                maxLength={8192}
                autoComplete="url"
                disabled={updating}
                aria-invalid={Boolean(editError)}
                aria-describedby={editError ? 'edit-error' : 'edit-description'}
              />
            </div>
          </div>
          {editError && (
            <p id="edit-error" className="error-message" role="alert">
              {editError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={closeEdit}
              disabled={updating}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={updating}>
              {updating ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={modalRef}
        className="delete-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeDelete();
        }}
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <div className="dialog-icon">
          <Icon name="trash" size={24} />
        </div>
        <h2 id="delete-title">Delete this link?</h2>
        <p id="delete-description">
          The short link <strong>{deleteTarget?.code}</strong> will stop redirecting. This cannot be
          undone.
        </p>
        {deleteError && (
          <p className="error-message" role="alert">
            {deleteError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={closeDelete}
            disabled={deleting}
            autoFocus
          >
            Keep link
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete link'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
