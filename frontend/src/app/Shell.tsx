/** The application shell: navigation rail, command bar and page host. */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

import { Icon } from '../components/Icon';
import { Button, Spinner, Toasts } from '../components/ui';
import { api } from '../lib/api';
import { useAsync, useKeyboardShortcut } from '../lib/hooks';
import { NAV, RAIL_PARENT, useApp, type ViewId } from './AppState';

import { ActivityView } from '../views/ActivityView';
import { AnalyticsView } from '../views/AnalyticsView';
import { ApplicationsView } from '../views/ApplicationsView';
import { AutomationView } from '../views/AutomationView';
import { DashboardView } from '../views/DashboardView';
import { DiagnosticsView } from '../views/DiagnosticsView';
import { DocumentsView } from '../views/DocumentsView';
import { EmailView } from '../views/EmailView';
import { JobsView } from '../views/JobsView';
import { ProfileView } from '../views/ProfileView';
import { SettingsView } from '../views/SettingsView';

const VIEWS: Record<ViewId, ComponentType> = {
  dashboard: DashboardView,
  jobs: JobsView,
  applications: ApplicationsView,
  documents: DocumentsView,
  automation: AutomationView,
  analytics: AnalyticsView,
  email: EmailView,
  profile: ProfileView,
  activity: ActivityView,
  settings: SettingsView,
  diagnostics: DiagnosticsView,
};

/**
 * What the shell shows when the backend is not answering.
 *
 * The chrome used to be replaced by a skeleton of itself in this state: ten
 * blank pills where the labels are, a grey block where the search is, no
 * footer. A skeleton means "this is arriving"; nothing was arriving, and for a
 * backend that has failed nothing ever will. Every label in the rail is static
 * text that needs no service, so the rail renders itself, says which of its
 * screens cannot work and why, and keeps the two that can — Settings and the
 * panel it leads to — reachable with the mouse.
 */
export interface Offline {
  /** The condition, as one sentence. Shown in the rail note and in tooltips. */
  condition: string;
  /** The same condition in two or three words, for the footer, where the
   *  sentence would truncate into an ellipsis and say nothing at all. */
  short: string;
  /** What to show in the page area for a screen that needs the service. */
  page: ReactNode;
}

/** The screens that need no backend, so they stay live when there is none. */
const WORKS_OFFLINE = new Set<ViewId>(['settings', 'diagnostics']);

export function Shell({ offline }: { offline?: Offline } = {}) {
  const { view, navigate, toasts, dismiss, notify, invalidate, revision } = useApp();
  const [collapsed, setCollapsed] = useState(window.innerWidth < 1100);
  const [running, setRunning] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const health = useAsync(() => api.health(), [revision]);
  const profile = useAsync(() => api.profile.read(), [revision]);
  const automation = useAsync(() => api.automation.state(), [revision]);

  useEffect(() => {
    const onResize = () => setCollapsed(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useKeyboardShortcut(
    (event) => (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k',
    () => searchRef.current?.focus(),
  );

  const submitSearch = () => {
    // The command bar is a jump-to-search, so it hands the term to Job Search
    // rather than filtering whatever screen happens to be open.
    window.sessionStorage.setItem('job-search-term', searchTerm);
    navigate('jobs');
  };

  const runAutomation = async () => {
    setRunning(true);
    try {
      await api.automation.run();
      notify('Automation run started.', 'success');
      navigate('automation');
      invalidate();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
      setRunning(false);
    }
  };

  const View = VIEWS[view];
  // With no service, a screen that needs one gives way to the condition itself:
  // the waiting card, or the diagnostic panel. Settings and Diagnostics are
  // exempt, which is what makes the panel reachable by clicking rather than
  // only by waiting for it to appear.
  const displaced = Boolean(offline) && !WORKS_OFFLINE.has(view);
  // Diagnostics has no rail item of its own, so the item it belongs under stays
  // lit rather than the rail going blank. Nothing is lit while the page has
  // been displaced: the rail would otherwise point at a screen that is not the
  // one on show.
  const railView = displaced ? null : RAIL_PARENT[view] ?? view;
  const isRunning = automation.data?.is_running ?? false;
  const name = profile.data?.full_name?.trim() || 'Your profile';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <nav className="rail" aria-label="Main">
        <div className="rail-brand">
          <span className="rail-mark">
            <Icon name="briefcase" size={17} color="#fff" />
          </span>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div className="t-h3 truncate">Job Hunter</div>
              <div className="t-caption muted truncate">Find. Match. Apply. Faster.</div>
            </div>
          )}
        </div>

        <div className="rail-nav">
          {offline && !collapsed && (
            <div className="rail-note" role="status">
              <Icon name="alert" size={13} color="var(--status-warn)" />
              <span>
                {offline.condition} The screens below read from it and cannot open. Settings, and
                Diagnostics under it, still work.
              </span>
            </div>
          )}
          {NAV.map((item) => {
            // Disabled, not hidden and not faked. A rail that drops what it
            // cannot do looks like a smaller product; one that leaves it
            // clickable takes the user to an empty screen.
            const blocked = Boolean(offline) && !WORKS_OFFLINE.has(item.id);
            return (
              <button
                key={item.id}
                className={`rail-item ${railView === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
                disabled={blocked}
                title={
                  blocked
                    ? `${item.label} needs the local service. ${offline?.condition ?? ''}`
                    : collapsed
                      ? item.label
                      : undefined
                }
                aria-current={railView === item.id ? 'page' : undefined}
              >
                <Icon name={item.icon} size={18} />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {/* A marker rather than a word per row. The reason is written
                    once, above the group; ten copies of it would push the
                    longest label — "CV & Cover Letter" — into an ellipsis, and
                    a label nobody can read is the defect this is fixing. */}
                {!collapsed && blocked && (
                  <span className="rail-item-mark">
                    <Icon name="alert" size={13} />
                  </span>
                )}
                {!collapsed && item.id === 'automation' && isRunning && (
                  <span className="rail-item-badge" style={{ color: 'var(--status-success)' }}>
                    live
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="rail-foot">
          {offline ? (
            // The footer used to disappear in this state, which read as a
            // window still assembling itself. It is the one piece of chrome
            // that already had a status line in it, so it says the condition
            // and leads to the screen that explains it.
            <button
              className="rail-user"
              onClick={() => navigate('diagnostics')}
              title={offline.condition}
            >
              <span className="avatar" style={{ background: 'var(--status-danger-bg)' }}>
                <Icon name="alert" size={15} color="var(--status-danger)" />
              </span>
              {!collapsed && (
                <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <span className="t-small truncate" style={{ display: 'block' }}>
                    {offline.short}
                  </span>
                  <span className="t-caption muted truncate" style={{ display: 'block' }}>
                    Open Diagnostics
                  </span>
                </span>
              )}
              {!collapsed && <Icon name="chevronRight" size={14} color="var(--text-muted)" />}
            </button>
          ) : (
          <button className="rail-user" onClick={() => navigate('profile')}>
            <span className="avatar">{initials || '—'}</span>
            {!collapsed && (
              <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <span className="t-small truncate" style={{ display: 'block' }}>
                  {name}
                </span>
                <span className="t-caption muted truncate" style={{ display: 'block' }}>
                  {health.data ? statusLabel(health.data.status) : 'Checking…'}
                </span>
              </span>
            )}
            {!collapsed && <Icon name="chevronRight" size={14} color="var(--text-muted)" />}
          </button>
          )}
        </div>
      </nav>

      <div className="main">
        <header className="commandbar">
          <Button
            variant="ghost"
            icon={collapsed ? 'chevronRight' : 'chevronLeft'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={() => setCollapsed((value) => !value)}
          />

          <div className="search">
            <span className="search-icon">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={searchRef}
              value={searchTerm}
              // The field is the same field, saying what it cannot do. It was a
              // grey block here, which is a promise that a search box is on its
              // way to a window where searching is the thing that is broken.
              placeholder={
                offline
                  ? 'Search needs the local service, which is not answering'
                  : 'Search jobs, companies or locations'
              }
              disabled={Boolean(offline)}
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              aria-label="Search jobs"
            />
            {!offline && <span className="kbd">Ctrl K</span>}
          </div>

          <div className="spacer" />

          {health.data && health.data.status !== 'healthy' && (
            <button
              className="badge"
              onClick={() => navigate('settings')}
              style={{
                color: health.data.status === 'degraded' ? 'var(--status-warn)' : 'var(--status-danger)',
                background:
                  health.data.status === 'degraded'
                    ? 'var(--status-warn-bg)'
                    : 'var(--status-danger-bg)',
              }}
              title={health.data.llm.detail || health.data.database.detail}
            >
              <span className="dot" style={{ background: 'currentColor' }} />
              {health.data.status === 'degraded' ? 'Model offline' : 'Backend problem'}
            </button>
          )}

          {isRunning && (
            <button className="badge" onClick={() => navigate('automation')}
              style={{ color: 'var(--status-success)', background: 'var(--status-success-bg)' }}>
              <Spinner size={11} />
              Run in progress
            </button>
          )}

          <Button
            variant="primary"
            icon="play"
            onClick={runAutomation}
            busy={running}
            disabled={isRunning || Boolean(offline)}
            title={
              offline
                ? `An automation run needs the local service. ${offline.condition}`
                : undefined
            }
          >
            Run Automation
          </Button>
          <Button variant="ghost" icon="settings" title="Settings" onClick={() => navigate('settings')} />
        </header>

        <main className="page">{displaced ? offline?.page : <View />}</main>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === 'healthy') return 'All systems ready';
  if (status === 'degraded') return 'Running without the model';
  return 'Backend problem';
}
