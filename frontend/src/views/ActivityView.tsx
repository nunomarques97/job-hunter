/** The activity log: the evidence trail behind every number in the product. */
import { useState } from 'react';

import { Icon, type IconName } from '../components/Icon';
import {
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from '../components/ui';
import { api } from '../lib/api';
import { dateTime, relative } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useApp } from '../app/AppState';

const LEVELS = [
  { id: '', label: 'Everything' },
  { id: 'success', label: 'Success' },
  { id: 'info', label: 'Info' },
  { id: 'warning', label: 'Warnings' },
  { id: 'error', label: 'Errors' },
];

const LEVEL_STYLE: Record<string, { color: string; background: string; icon: IconName }> = {
  success: { color: 'var(--status-success)', background: 'var(--status-success-bg)', icon: 'check' },
  info: { color: 'var(--status-info)', background: 'var(--status-info-bg)', icon: 'info' },
  warning: { color: 'var(--status-warn)', background: 'var(--status-warn-bg)', icon: 'alert' },
  error: { color: 'var(--status-danger)', background: 'var(--status-danger-bg)', icon: 'alert' },
};

export function ActivityView() {
  const { revision } = useApp();
  const [level, setLevel] = useState('');
  const activity = useAsync(() => api.analytics.activity({ level, limit: 200 }), [level, revision]);

  const grouped = groupByDay(activity.data ?? []);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Activity</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            Every state change the application recorded, newest first.
          </p>
        </div>
        <div className="spacer" />
        <Button icon="refresh" onClick={activity.reload}>
          Refresh
        </Button>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {LEVELS.map((option) => (
          <Chip key={option.id} active={level === option.id} onClick={() => setLevel(option.id)}>
            {option.label}
          </Chip>
        ))}
      </div>

      <Card>
        <CardHead
          title={`${activity.data?.length ?? 0} entries`}
          icon="activity"
          subtitle={level ? `Filtered to ${level}` : 'Unfiltered'}
        />
        <div className="card-body flush">
          {activity.loading && !activity.data ? (
            <SkeletonRows rows={8} />
          ) : activity.error ? (
            <ErrorState message={activity.error} onRetry={activity.reload} />
          ) : !activity.data?.length ? (
            <EmptyState
              icon="activity"
              title="Nothing recorded yet"
              body="Discovery, scoring, document generation and every pipeline move write a line here."
            />
          ) : (
            <div>
              {grouped.map(([day, entries]) => (
                <div key={day}>
                  <div
                    className="t-overline muted"
                    style={{
                      padding: '10px 20px 6px',
                      position: 'sticky',
                      top: 0,
                      background: 'var(--surface-1)',
                      zIndex: 1,
                    }}
                  >
                    {day}
                  </div>
                  <div className="rows">
                    {entries.map((entry) => {
                      const style = LEVEL_STYLE[entry.level] ?? LEVEL_STYLE.info;
                      return (
                        <div key={entry.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 'var(--r-sm)',
                              background: style.background,
                              display: 'grid',
                              placeItems: 'center',
                              flex: 'none',
                              marginTop: 1,
                            }}
                          >
                            <Icon name={style.icon} size={13} color={style.color} />
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="t-small">{entry.message}</div>
                            <div className="row t-caption muted" style={{ gap: 8, marginTop: 2 }}>
                              <span className="mono">{entry.event}</span>
                              {entry.run_id && <span>run {entry.run_id}</span>}
                              {Object.keys(entry.details ?? {}).length > 0 && (
                                <span className="truncate" style={{ maxWidth: 340 }}>
                                  {summarise(entry.details)}
                                </span>
                              )}
                            </div>
                          </div>
                          <span
                            className="t-caption muted"
                            title={dateTime(entry.created_at)}
                            style={{ flex: 'none' }}
                          >
                            {relative(entry.created_at)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function groupByDay<T extends { created_at: string }>(entries: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const date = new Date(entry.created_at.endsWith('Z') ? entry.created_at : `${entry.created_at}Z`);
    const key = Number.isNaN(date.getTime())
      ? 'Unknown date'
      : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()];
}

function summarise(details: Record<string, unknown>): string {
  return Object.entries(details)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}`)
    .join(' · ');
}
