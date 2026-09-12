/** The executive dashboard. */
import { Icon, type IconName } from '../components/Icon';
import { LineChart } from '../components/charts';
import {
  Badge,
  Button,
  Card,
  CardHead,
  CompanyMark,
  EmptyState,
  ErrorState,
  Notice,
  ScorePill,
  Skeleton,
  SkeletonRows,
  Spinner,
} from '../components/ui';
import { api } from '../lib/api';
import {
  greeting,
  number as formatNumber,
  percent,
  relative,
  salary,
  shortDate,
  STAGE_COLORS,
  STAGE_LABELS,
} from '../lib/format';
import { useAsync, useCountUp, usePolling } from '../lib/hooks';
import { useApp } from '../app/AppState';
import type { Dashboard, Job } from '../lib/types';

/** Stages the dashboard always shows, so the card reads as a pipeline rather
 *  than a list of whatever happens to be populated today. */
const DASHBOARD_PIPELINE_STAGES = [
  'discovered',
  'prepared',
  'action_required',
  'submitted',
  'interview',
  'offer',
  'rejected',
];

/** What a run actually does, shown before the first run so the card explains
 *  itself instead of sitting empty. */
const RUN_STEPS = [
  'Read every enabled job source',
  'Normalise and remove duplicates',
  'Score each posting against your profile',
  'Apply your limits and filters',
  'Prepare a CV and cover letter for what passes',
];

export function DashboardView() {
  const { navigate, revision, invalidate, notify } = useApp();
  const state = useAsync<Dashboard>(() => api.analytics.dashboard(), [revision]);

  // While a run is in progress the figures move, so the dashboard follows it.
  usePolling(state.reload, 4000, state.data?.automation.is_running ?? false);

  if (state.loading && !state.data) return <DashboardSkeleton />;
  if (state.error && !state.data)
    return (
      <div className="page-inner">
        <ErrorState message={state.error} onRetry={state.reload} />
      </div>
    );
  if (!state.data) return null;

  const { candidate, overview, pipeline, daily, recent_matches, automation, insights } = state.data;
  const firstName = candidate.full_name.trim().split(/\s+/)[0] || 'there';
  const maxPipeline = Math.max(1, ...pipeline.map((item) => item.count));

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="t-display">
            {greeting()}
            {candidate.full_name ? `, ${firstName}` : ''}
          </h1>
          <p className="t-body secondary" style={{ marginTop: 2 }}>
            {overview.jobs_discovered > 0
              ? `${formatNumber(overview.strong_matches)} strong ${
                  overview.strong_matches === 1 ? 'match' : 'matches'
                } waiting out of ${formatNumber(overview.jobs_discovered)} postings.`
              : 'Nothing discovered yet. Run a search to start filling your queue.'}
          </p>
        </div>
        <div className="spacer" />
        {state.refreshing && (
          <span className="row t-caption muted" style={{ gap: 6 }}>
            <Spinner size={12} /> Updating
          </span>
        )}
      </div>

      {!candidate.completeness.ready_for_generation && (
        <div style={{ marginBottom: 16 }}>
          <Notice
            tone="warn"
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('profile')}>
                Complete profile
              </Button>
            }
          >
            Your profile is {candidate.completeness.percent}% complete. Document generation stays off
            until these are filled in: {candidate.completeness.missing.slice(0, 3).join(', ')}.
          </Notice>
        </div>
      )}

      {/* KPI row */}
      <div className="grid g-4" style={{ marginBottom: 16 }}>
        <Kpi
          icon="search"
          color="var(--status-pipeline)"
          background="var(--status-pipeline-bg)"
          value={overview.jobs_discovered}
          label="Jobs found"
          delta={overview.jobs_discovered_this_week}
          deltaLabel="this week"
        />
        <Kpi
          icon="documents"
          color="var(--status-info)"
          background="var(--status-info-bg)"
          value={overview.applications_submitted}
          label="Applications sent"
          delta={overview.applications_submitted_this_week}
          deltaLabel="this week"
        />
        <Kpi
          icon="users"
          color="var(--status-success)"
          background="var(--status-success-bg)"
          value={overview.interviews}
          label="Interviews"
          sub={
            overview.interview_rate.denominator
              ? `${percent(overview.interview_rate.value)} of sent`
              : undefined
          }
        />
        <Kpi
          icon="target"
          color="var(--status-warn)"
          background="var(--status-warn-bg)"
          value={overview.offers}
          label="Offers"
          sub={
            overview.offer_rate.denominator
              ? `${percent(overview.offer_rate.value)} of sent`
              : undefined
          }
        />
      </div>

      <div className="grid g-12">
        {/* Recent matches */}
        <Card className="span-7" wash>
          <CardHead
            title="Recent job matches"
            subtitle="Ranked against your profile"
            action={
              <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => navigate('jobs')}>
                View all
              </Button>
            }
          />
          <div className="card-body flush">
            {recent_matches.length === 0 ? (
              <EmptyState
                icon="search"
                title="No matches yet"
                body="Run a search and every posting found gets scored against your profile."
                action={
                  <Button variant="primary" icon="search" onClick={() => navigate('jobs')}>
                    Search for jobs
                  </Button>
                }
              />
            ) : (
              <div className="rows">
                {recent_matches.map((job) => (
                  <MatchRow key={job.id} job={job} onOpen={() => navigate('jobs', job.id)} />
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Pipeline */}
        <Card className="span-5">
          <CardHead
            title="Application pipeline"
            action={
              <Button
                size="sm"
                variant="ghost"
                iconRight="chevronRight"
                onClick={() => navigate('applications')}
              >
                View all
              </Button>
            }
          />
          <div className="card-body">
            {pipeline.every((item) => item.count === 0) ? (
              <div className="col" style={{ gap: 10, paddingBottom: 8 }}>
                <p className="t-small muted">
                  Applications appear here once you prepare a package for a job.
                </p>
                {DASHBOARD_PIPELINE_STAGES.map((stage) => (
                  <div key={stage} className="row" style={{ gap: 10, opacity: 0.45 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: (STAGE_COLORS[stage] ?? STAGE_COLORS.closed).color,
                        flex: 'none',
                      }}
                    />
                    <span className="t-small" style={{ width: 104 }}>
                      {STAGE_LABELS[stage] ?? stage}
                    </span>
                    <div className="bar-track" />
                    <span className="mono t-small muted" style={{ width: 30, textAlign: 'right' }}>
                      0
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="col" style={{ gap: 9 }}>
                {pipeline
                  .filter(
                    (item) =>
                      item.count > 0 || DASHBOARD_PIPELINE_STAGES.includes(item.stage),
                  )
                  .map((item) => {
                    const tone = STAGE_COLORS[item.stage] ?? STAGE_COLORS.closed;
                    return (
                      <button
                        key={item.stage}
                        className="row"
                        style={{ gap: 10, width: '100%' }}
                        onClick={() => navigate('applications')}
                      >
                        <span
                          className="dot"
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: tone.color,
                            flex: 'none',
                          }}
                        />
                        <span className="t-small" style={{ width: 104, textAlign: 'left' }}>
                          {STAGE_LABELS[item.stage] ?? item.stage}
                        </span>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${Math.max(item.count ? 4 : 0, (item.count / maxPipeline) * 100)}%`,
                              background: tone.color,
                            }}
                          />
                        </div>
                        <span
                          className="mono t-small"
                          style={{ width: 30, textAlign: 'right', color: 'var(--text-primary)' }}
                        >
                          {item.count}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </Card>

        {/* Activity over time */}
        <Card className="span-7">
          <CardHead title="Activity over time" subtitle="Last 30 days" />
          <div className="card-body">
            <LineChart
              labels={daily.map((point) => shortDate(point.date))}
              series={[
                {
                  key: 'jobs',
                  label: 'Jobs discovered',
                  color: 'var(--status-pipeline)',
                  values: daily.map((point) => point.jobs),
                },
                {
                  key: 'applications',
                  label: 'Applications sent',
                  color: 'var(--accent)',
                  values: daily.map((point) => point.applications),
                },
              ]}
            />
          </div>
        </Card>

        {/* Automation status */}
        <Card className="span-5">
          <CardHead
            title="Automation"
            icon="automation"
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="play"
                disabled={automation.is_running || automation.emergency_stop}
                onClick={async () => {
                  try {
                    await api.automation.run();
                    notify('Automation run started.', 'success');
                    invalidate();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error), 'danger');
                  }
                }}
              >
                Run now
              </Button>
            }
          />
          <div className="card-body">
            {automation.emergency_stop ? (
              <Notice tone="danger">
                Emergency stop is engaged. No run will start until you release it in Automation.
              </Notice>
            ) : automation.is_running ? (
              <Notice tone="info" icon="refresh">
                A run is in progress
                {automation.last_run?.current_stage
                  ? `, currently at the ${automation.last_run.current_stage} stage.`
                  : '.'}
              </Notice>
            ) : automation.last_run ? (
              <div className="col" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Badge
                    color={automation.last_run.status === 'completed'
                      ? 'var(--status-success)'
                      : 'var(--status-warn)'}
                    background={automation.last_run.status === 'completed'
                      ? 'var(--status-success-bg)'
                      : 'var(--status-warn-bg)'}
                    dot
                  >
                    {automation.last_run.status}
                  </Badge>
                  <span className="t-caption muted">
                    Last run {relative(automation.last_run.finished_at ?? automation.last_run.started_at)}
                  </span>
                  {automation.dry_run && <Badge>Dry run</Badge>}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <RunLine label="Postings discovered" value={automation.last_run.jobs_discovered} />
                  <RunLine label="Scored against your profile" value={automation.last_run.jobs_scored} />
                  <RunLine label="Passed your filters" value={automation.last_run.jobs_eligible} />
                  <RunLine label="Packages prepared" value={automation.last_run.packages_prepared} />
                  <RunLine
                    label="Need you to finish them"
                    value={automation.last_run.action_required}
                    warn
                  />
                </div>
              </div>
            ) : (
              <div className="col" style={{ gap: 10, paddingBottom: 4 }}>
                <p className="t-small muted">
                  No run yet. One run walks the whole pipeline in a single pass.
                </p>
                <div className="col" style={{ gap: 7 }}>
                  {RUN_STEPS.map((step, index) => (
                    <div key={step} className="row" style={{ gap: 9 }}>
                      <span
                        className="mono t-caption muted"
                        style={{ width: 14, textAlign: 'right', flex: 'none' }}
                      >
                        {index + 1}
                      </span>
                      <span className="t-small secondary">{step}</span>
                    </div>
                  ))}
                </div>
                {automation.dry_run && (
                  <span className="t-caption muted">
                    Dry run is on, so a run prepares everything and sends nothing.
                  </span>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Quick actions */}
        <Card className="span-4">
          <CardHead title="Quick actions" icon="zap" />
          <div className="card-body">
            <div className="grid g-2" style={{ gap: 8 }}>
              <QuickAction icon="search" label="Search for jobs" onClick={() => navigate('jobs')} />
              <QuickAction icon="documents" label="Generate CV" onClick={() => navigate('documents')} />
              <QuickAction icon="mail" label="Cover letters" onClick={() => navigate('documents')} />
              <QuickAction icon="sliders" label="Automation rules" onClick={() => navigate('automation')} />
            </div>
          </div>
        </Card>

        {/* Insights */}
        <Card className="span-8" wash>
          <CardHead title="Insights" icon="sparkle" subtitle="Computed from your own data" />
          <div className="card-body">
            {insights.length === 0 ? (
              <p className="t-small muted">
                Insights appear once there is enough activity to say something useful.
              </p>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {insights.map((insight) => (
                  <Notice
                    key={insight.title}
                    tone={insight.level === 'success' ? 'success' : insight.level === 'warning' ? 'warn' : 'info'}
                    action={
                      insight.action && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(insight.action!.view as never)}
                        >
                          {insight.action.label}
                        </Button>
                      )
                    }
                  >
                    <strong style={{ fontWeight: 600 }}>{insight.title}</strong>
                    <div className="t-small" style={{ opacity: 0.85, marginTop: 2 }}>
                      {insight.body}
                    </div>
                  </Notice>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  color,
  background,
  value,
  label,
  delta,
  deltaLabel,
  sub,
}: {
  icon: IconName;
  color: string;
  background: string;
  value: number;
  label: string;
  delta?: number;
  deltaLabel?: string;
  sub?: string;
}) {
  const animated = useCountUp(value);
  return (
    <Card wash>
      <div className="kpi">
        <span className="kpi-icon" style={{ background }}>
          <Icon name={icon} size={20} color={color} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span className="t-metric">{formatNumber(animated)}</span>
            {delta !== undefined && delta > 0 && (
              <span className="kpi-delta" style={{ color: 'var(--status-success)' }}>
                <Icon name="arrowUp" size={11} />+{delta}
              </span>
            )}
          </div>
          <div className="t-small secondary truncate">{label}</div>
          {(sub || (delta !== undefined && delta > 0)) && (
            <div className="t-caption muted truncate">{sub ?? deltaLabel}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

function MatchRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const pay = salary(job.salary_min, job.salary_max, job.salary_currency);
  return (
    <button className="list-row" onClick={onOpen}>
      <CompanyMark name={job.company} logoUrl={job.company_logo_url} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="t-h3 truncate">{job.title}</div>
        <div className="row t-caption muted" style={{ gap: 8, marginTop: 1 }}>
          <span className="truncate" style={{ maxWidth: 130 }}>
            {job.company}
          </span>
          {job.location && (
            <>
              <span>·</span>
              <span className="truncate" style={{ maxWidth: 150 }}>
                {job.location}
              </span>
            </>
          )}
          {pay && (
            <>
              <span>·</span>
              <span className="mono">{pay}</span>
            </>
          )}
        </div>
      </div>
      {job.score && <ScorePill score={job.score.score} />}
      <span className="t-caption muted" style={{ width: 68, textAlign: 'right' }}>
        {relative(job.posted_at ?? job.discovered_at)}
      </span>
    </button>
  );
}

function RunLine({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Icon
        name={value > 0 ? 'check' : 'close'}
        size={13}
        color={value > 0 ? (warn ? 'var(--status-warn)' : 'var(--status-success)') : 'var(--text-muted)'}
      />
      <span className="t-small secondary" style={{ flex: 1 }}>
        {label}
      </span>
      <span className="mono t-small" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="row"
      onClick={onClick}
      style={{
        gap: 10,
        padding: '12px 14px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        width: '100%',
        textAlign: 'left',
        transition: 'background var(--t-state) var(--ease-in)',
      }}
    >
      <Icon name={icon} size={16} color="var(--text-secondary)" />
      <span className="t-small truncate">{label}</span>
    </button>
  );
}

function DashboardSkeleton() {
  return (
    <div className="page-inner">
      <div className="col" style={{ gap: 8, marginBottom: 20 }}>
        <Skeleton height={30} width={320} />
        <Skeleton height={18} width={420} />
      </div>
      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <div className="kpi">
              <Skeleton height={38} width={38} radius={10} />
              <div className="col" style={{ gap: 7, flex: 1 }}>
                <Skeleton height={26} width={84} />
                <Skeleton height={13} width={110} />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div className="grid g-12">
        <Card className="span-7">
          <CardHead title="Recent job matches" />
          <div className="card-body flush">
            <SkeletonRows rows={6} />
          </div>
        </Card>
        <Card className="span-5">
          <CardHead title="Application pipeline" />
          <div className="card-body col" style={{ gap: 12 }}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} height={14} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
