/** Automation: controls, guard rails and the live pipeline. */
import { useEffect, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardHead,
  ErrorState,
  Field,
  Notice,
  Skeleton,
  Switch,
  TagInput,
  TextInput,
} from '../components/ui';
import { api } from '../lib/api';
import { dateTime, number as formatNumber, relative } from '../lib/format';
import { useAsync, usePolling } from '../lib/hooks';
import { useApp } from '../app/AppState';
import type { AutomationConfig } from '../lib/types';

const STAGE_LABELS: Record<string, string> = {
  discover: 'Discover',
  normalize: 'Normalise',
  deduplicate: 'Deduplicate',
  score: 'Score',
  filter: 'Filter',
  prepare: 'Prepare',
  submit: 'Submit',
  track: 'Track',
  follow_up: 'Follow up',
  analyze: 'Analyse',
};

export function AutomationView() {
  const { notify, revision, invalidate } = useApp();
  const state = useAsync(() => api.automation.state(), [revision]);
  const stages = useAsync(() => api.automation.stages(), []);
  const runs = useAsync(() => api.automation.runs(), [revision]);
  const sources = useAsync(() => api.jobs.sources(), []);

  const [draft, setDraft] = useState<AutomationConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (state.data && !draft) setDraft(state.data.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);

  const running = state.data?.is_running ?? false;
  usePolling(
    () => {
      state.reload();
      runs.reload();
    },
    2500,
    running,
  );

  const act = async (name: string, action: () => Promise<unknown>, message: string) => {
    setBusy(name);
    try {
      await action();
      notify(message, 'success');
      state.reload();
      runs.reload();
      invalidate();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = async (changes: Partial<AutomationConfig>) => {
    if (!draft) return;
    const next = { ...draft, ...changes };
    setDraft(next);
    try {
      await api.automation.saveConfig(changes);
      invalidate();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
      state.reload();
    }
  };

  if (state.loading && !state.data) return <div className="page-inner"><Skeleton height={420} /></div>;
  if (state.error || !state.data || !draft)
    return (
      <div className="page-inner">
        <ErrorState message={state.error ?? 'Automation state could not load.'} onRetry={state.reload} />
      </div>
    );

  const current = state.data.current_run ?? runs.data?.items[0] ?? null;
  const stageList = stages.data ?? Object.keys(STAGE_LABELS);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Automation</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            One run walks the whole pipeline. Nothing leaves your machine unless you switch dry run off
            and connect a delivery channel.
          </p>
        </div>
      </div>

      {draft.emergency_stop && (
        <div style={{ marginBottom: 16 }}>
          <Notice
            tone="danger"
            action={
              <Button
                size="sm"
                variant="secondary"
                busy={busy === 'release'}
                onClick={() => act('release', () => api.automation.emergencyStop(false), 'Emergency stop released.')}
              >
                Release
              </Button>
            }
          >
            <strong style={{ fontWeight: 600 }}>Emergency stop is engaged.</strong> No run will start,
            and a run in flight halts at its next stage boundary.
          </Notice>
        </div>
      )}

      <div className="grid g-12">
        {/* Controls */}
        <Card className="span-8" wash>
          <CardHead
            title="Run control"
            icon="automation"
            action={
              <Badge
                color={running ? 'var(--status-success)' : 'var(--text-muted)'}
                background={running ? 'var(--status-success-bg)' : 'var(--surface-3)'}
                dot
              >
                {running ? (state.data.is_paused ? 'Paused' : 'Running') : 'Idle'}
              </Badge>
            }
          />
          <div className="card-body col" style={{ gap: 16 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                icon="play"
                disabled={running || draft.emergency_stop}
                busy={busy === 'run'}
                onClick={() => act('run', () => api.automation.run(), 'Run started.')}
              >
                Run now
              </Button>
              <Button
                icon="pause"
                disabled={!running || state.data.is_paused}
                busy={busy === 'pause'}
                onClick={() => act('pause', () => api.automation.pause(), 'Paused between stages.')}
              >
                Pause
              </Button>
              <Button
                icon="play"
                disabled={!state.data.is_paused}
                busy={busy === 'resume'}
                onClick={() => act('resume', () => api.automation.resume(), 'Resumed.')}
              >
                Resume
              </Button>
              <Button
                icon="stop"
                disabled={!running}
                busy={busy === 'stop'}
                onClick={() => act('stop', () => api.automation.stop(), 'Run stopped.')}
              >
                Stop
              </Button>
              <div className="spacer" />
              <Button
                variant="danger"
                icon="alert"
                busy={busy === 'estop'}
                onClick={() =>
                  act(
                    'estop',
                    () => api.automation.emergencyStop(!draft.emergency_stop),
                    draft.emergency_stop ? 'Emergency stop released.' : 'Emergency stop engaged.',
                  )
                }
              >
                {draft.emergency_stop ? 'Release emergency stop' : 'Emergency stop'}
              </Button>
            </div>

            {/* Pipeline strip */}
            <div className="col" style={{ gap: 8 }}>
              <span className="t-overline muted">Pipeline</span>
              <div className="stage-strip" style={{ flexWrap: 'wrap', rowGap: 4 }}>
                {stageList.map((stage, index) => {
                  const entry = current?.stages?.[stage];
                  const isActive = current?.current_stage === stage && running;
                  const isDone = entry?.status === 'completed';
                  return (
                    <div key={stage} className="row" style={{ flex: 'none' }}>
                      {index > 0 && <span className="stage-link" />}
                      <div
                        className={`stage-pip ${isActive ? 'active' : isDone ? 'done' : ''}`}
                        title={entry?.note ?? ''}
                      >
                        <span
                          className="dot"
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: isActive
                              ? 'var(--accent)'
                              : isDone
                                ? 'var(--status-success)'
                                : 'var(--surface-3)',
                            flex: 'none',
                          }}
                        />
                        {STAGE_LABELS[stage] ?? stage}
                        {entry && entry.count > 0 && (
                          <span className="mono" style={{ fontSize: 10.5 }}>
                            {entry.count}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {current && (
              <div className="grid g-4" style={{ gap: 10 }}>
                <RunStat label="Discovered" value={current.jobs_discovered} />
                <RunStat label="Scored" value={current.jobs_scored} />
                <RunStat label="Passed filters" value={current.jobs_eligible} />
                <RunStat label="Prepared" value={current.packages_prepared} />
              </div>
            )}

            {!current && (
              <div className="col" style={{ gap: 7, paddingBottom: 4 }}>
                <span className="t-small muted">
                  No run yet. Pressing Run now walks every stage above in one pass.
                </span>
                <span className="t-caption muted">
                  {draft.dry_run
                    ? 'Dry run is on, so packages are prepared and nothing is sent.'
                    : 'Dry run is off. Anything with a sanctioned delivery channel may be sent.'}
                </span>
              </div>
            )}

            {current?.summary && <p className="t-small secondary">{current.summary}</p>}
            {current?.errors?.length ? (
              <Notice tone="warn">
                Some sources could not be read: {current.errors.slice(0, 3).join(' ')}
              </Notice>
            ) : null}
          </div>
        </Card>

        {/* Safety */}
        <Card className="span-4">
          <CardHead title="Safety" icon="shield" />
          <div className="card-body col" style={{ gap: 4 }}>
            <Switch
              checked={draft.dry_run}
              onChange={(value) => saveConfig({ dry_run: value })}
              label="Dry run"
              hint="Prepare everything, send nothing. Leave this on until you have reviewed a few packages."
            />
            <Switch
              checked={draft.enabled}
              onChange={(value) => saveConfig({ enabled: value })}
              label="Scheduled runs"
              hint="Allow runs to start on a schedule rather than only when you press Run now."
            />
            <div style={{ height: 8 }} />
            <Notice tone="info">
              Submission happens only where an employer publishes a mechanism for it. Everything else is
              prepared and marked action required, with the package kept for you.
            </Notice>
          </div>
        </Card>

        {/* Guard rails */}
        <Card className="span-6">
          <CardHead title="Limits and thresholds" icon="sliders" />
          <div className="card-body grid g-2" style={{ gap: 14 }}>
            <Field label="Applications per day" hint="Checked before every submission decision.">
              <TextInput
                type="number"
                value={String(draft.daily_application_limit)}
                onChange={(value) => saveConfig({ daily_application_limit: Number(value) || 0 })}
              />
            </Field>
            <Field label="Postings per day">
              <TextInput
                type="number"
                value={String(draft.daily_discovery_limit)}
                onChange={(value) => saveConfig({ daily_discovery_limit: Number(value) || 0 })}
              />
            </Field>
            <Field label="Minimum score to prepare" hint="Below this, nothing is generated.">
              <TextInput
                type="number"
                value={String(draft.min_score)}
                onChange={(value) => saveConfig({ min_score: Number(value) || 0 })}
              />
            </Field>
            <Field label="Minimum score to submit">
              <TextInput
                type="number"
                value={String(draft.min_score_to_submit)}
                onChange={(value) => saveConfig({ min_score_to_submit: Number(value) || 0 })}
              />
            </Field>
            <Field label="Minimum salary">
              <TextInput
                type="number"
                value={draft.min_salary ? String(draft.min_salary) : ''}
                onChange={(value) => saveConfig({ min_salary: value ? Number(value) : null })}
              />
            </Field>
            <Field label="Follow up after (days)">
              <TextInput
                type="number"
                value={String(draft.follow_up_after_days)}
                onChange={(value) => saveConfig({ follow_up_after_days: Number(value) || 7 })}
              />
            </Field>
          </div>
        </Card>

        {/* Filters */}
        <Card className="span-6">
          <CardHead title="What to look for" icon="filter" />
          <div className="card-body col" style={{ gap: 14 }}>
            <Field label="Search terms" hint="Leave empty to use your target roles.">
              <TagInput
                values={draft.search_terms}
                onChange={(values) => saveConfig({ search_terms: values })}
              />
            </Field>
            <Field label="Locations">
              <TagInput
                values={draft.location_filters}
                onChange={(values) => saveConfig({ location_filters: values })}
              />
            </Field>
            <Field label="Role must contain">
              <TagInput
                values={draft.role_filters}
                onChange={(values) => saveConfig({ role_filters: values })}
              />
            </Field>
            <Field label="Excluded companies">
              <TagInput
                values={draft.excluded_companies}
                onChange={(values) => saveConfig({ excluded_companies: values })}
              />
            </Field>
            <Switch
              checked={draft.remote_only}
              onChange={(value) => saveConfig({ remote_only: value })}
              label="Remote roles only"
            />
          </div>
        </Card>

        {/* Sources */}
        <Card className="span-5">
          <CardHead title="Sources" icon="layers" />
          <div className="card-body col" style={{ gap: 8 }}>
            {sources.data?.map((source) => {
              const on = draft.enabled_sources.includes(source.name);
              return (
                <button
                  key={source.name}
                  className="row"
                  onClick={() =>
                    saveConfig({
                      enabled_sources: on
                        ? draft.enabled_sources.filter((item) => item !== source.name)
                        : [...draft.enabled_sources, source.name],
                    })
                  }
                  style={{
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--r-md)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    background: on ? 'var(--accent-ghost)' : 'var(--surface-2)',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  <span className={`switch ${on ? 'on' : ''}`} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="t-small" style={{ display: 'block' }}>
                      {source.label}
                    </span>
                    <span className="t-caption muted">{source.note}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Run history */}
        <Card className="span-7">
          <CardHead title="Run history" icon="history" />
          <div className="card-body flush">
            {!runs.data?.items.length ? (
              <p className="t-small muted" style={{ padding: '16px 20px' }}>
                No runs yet.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Status</th>
                      <th className="num">Found</th>
                      <th className="num">Scored</th>
                      <th className="num">Prepared</th>
                      <th className="num">Needs you</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.data.items.map((run) => (
                      <tr key={run.id}>
                        <td className="primary" title={dateTime(run.started_at)}>
                          {relative(run.started_at)}
                        </td>
                        <td>
                          <Badge
                            color={
                              run.status === 'completed'
                                ? 'var(--status-success)'
                                : run.status === 'failed'
                                  ? 'var(--status-danger)'
                                  : 'var(--status-warn)'
                            }
                            background={
                              run.status === 'completed'
                                ? 'var(--status-success-bg)'
                                : run.status === 'failed'
                                  ? 'var(--status-danger-bg)'
                                  : 'var(--status-warn-bg)'
                            }
                          >
                            {run.status}
                          </Badge>
                          {run.dry_run && (
                            <span className="t-caption muted" style={{ marginLeft: 6 }}>
                              dry run
                            </span>
                          )}
                        </td>
                        <td className="num">{formatNumber(run.jobs_discovered)}</td>
                        <td className="num">{formatNumber(run.jobs_scored)}</td>
                        <td className="num">{formatNumber(run.packages_prepared)}</td>
                        <td className="num" style={{ color: run.action_required ? 'var(--status-warn)' : undefined }}>
                          {formatNumber(run.action_required)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="col"
      style={{
        gap: 2,
        padding: '10px 12px',
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border)',
      }}
    >
      <span className="mono" style={{ fontSize: 18, fontWeight: 620 }}>
        {formatNumber(value)}
      </span>
      <span className="t-caption muted">{label}</span>
    </div>
  );
}
