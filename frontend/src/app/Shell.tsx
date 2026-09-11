/** The application shell: navigation rail, command bar and page host. */
import { useEffect, useRef, useState } from 'react';

import { Icon } from '../components/Icon';
import { Button, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAsync, useKeyboardShortcut } from '../lib/hooks';
import { NAV, useApp, type ViewId } from './AppState';

import { ActivityView } from '../views/ActivityView';
import { AnalyticsView } from '../views/AnalyticsView';
import { ApplicationsView } from '../views/ApplicationsView';
import { AutomationView } from '../views/AutomationView';
import { DashboardView } from '../views/DashboardView';
import { DocumentsView } from '../views/DocumentsView';
import { EmailView } from '../views/EmailView';
import { JobsView } from '../views/JobsView';
import { ProfileView } from '../views/ProfileView';
import { SettingsView } from '../views/SettingsView';

const VIEWS: Record<ViewId, () => JSX.Element | null> = {
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
};

export function Shell() {
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
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`rail-item ${view === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              title={collapsed ? item.label : undefined}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} size={18} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && item.id === 'automation' && isRunning && (
                <span className="rail-item-badge" style={{ color: 'var(--status-success)' }}>
                  live
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="rail-foot">
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
              placeholder="Search jobs, companies or locations"
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              aria-label="Search jobs"
            />
            <span className="kbd">Ctrl K</span>
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
            disabled={isRunning}
          >
            Run Automation
          </Button>
          <Button variant="ghost" icon="settings" title="Settings" onClick={() => navigate('settings')} />
        </header>

        <main className="page">
          <View />
        </main>
      </div>

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <Icon
              name={toast.tone === 'danger' ? 'alert' : toast.tone === 'success' ? 'check' : 'info'}
              size={16}
              color={
                toast.tone === 'danger'
                  ? 'var(--status-danger)'
                  : toast.tone === 'success'
                    ? 'var(--status-success)'
                    : toast.tone === 'warn'
                      ? 'var(--status-warn)'
                      : 'var(--status-info)'
              }
              style={{ marginTop: 1 }}
            />
            <span className="t-small" style={{ flex: 1 }}>
              {toast.message}
            </span>
            <button onClick={() => dismiss(toast.id)} title="Dismiss" style={{ color: 'var(--text-muted)' }}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === 'healthy') return 'All systems ready';
  if (status === 'degraded') return 'Running without the model';
  return 'Backend problem';
}
