/** The job detail modal: everything known about one posting, and what to do with it. */
import { useState } from 'react';

import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  CompanyMark,
  ErrorState,
  Modal,
  Notice,
  ScorePill,
  Skeleton,
  Tabs,
} from '../components/ui';
import { api } from '../lib/api';
import {
  RECOMMENDATION_LABELS,
  REMOTE_LABELS,
  SENIORITY_LABELS,
  dateTime,
  relative,
  salary,
  scoreBand,
} from '../lib/format';
import { useAsync } from '../lib/hooks';
import { useApp } from '../app/AppState';

const WEIGHT_LABELS: Record<string, string> = {
  skills: 'Skills overlap',
  role: 'Role match',
  seniority: 'Seniority fit',
  location: 'Location and arrangement',
  salary: 'Salary',
  freshness: 'How recent',
  model_adjustment: 'Model adjustment',
};

const WEIGHT_MAX: Record<string, number> = {
  skills: 38,
  role: 22,
  seniority: 14,
  location: 16,
  salary: 6,
  freshness: 4,
  model_adjustment: 8,
};

export function JobDetailPanel({
  jobId,
  onClose,
  onChanged,
}: {
  jobId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify, navigate } = useApp();
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const job = useAsync(() => api.jobs.detail(jobId), [jobId]);

  const act = async (name: string, action: () => Promise<unknown>, message: string) => {
    setBusy(name);
    try {
      await action();
      notify(message, 'success');
      job.reload();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
      setBusy(null);
    }
  };

  if (job.loading && !job.data) {
    return (
      <Modal title="Loading job" onClose={onClose} wide>
        <div className="col" style={{ gap: 12 }}>
          <Skeleton height={22} width="60%" />
          <Skeleton height={16} width="40%" />
          <Skeleton height={140} />
        </div>
      </Modal>
    );
  }

  if (job.error || !job.data) {
    return (
      <Modal title="Job" onClose={onClose} wide>
        <ErrorState message={job.error ?? 'That job could not be loaded.'} onRetry={job.reload} />
      </Modal>
    );
  }

  const detail = job.data;
  const score = detail.score;
  const pay = salary(detail.salary_min, detail.salary_max, detail.salary_currency);
  const canOpen = Boolean(detail.application_url || detail.canonical_url);

  return (
    <Modal
      title={detail.title}
      subtitle={`${detail.company}${detail.location ? ` · ${detail.location}` : ''}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button
            icon={detail.is_saved ? 'bookmarkFilled' : 'bookmark'}
            onClick={() =>
              act('save', () => api.jobs.save(detail.id, !detail.is_saved), detail.is_saved ? 'Removed from saved.' : 'Saved.')
            }
            busy={busy === 'save'}
          >
            {detail.is_saved ? 'Saved' : 'Save'}
          </Button>
          <Button
            variant="danger"
            icon="close"
            busy={busy === 'exclude'}
            onClick={() =>
              act('exclude', () => api.jobs.excludeCompany(detail.id), `Excluded ${detail.company}.`)
            }
          >
            Exclude company
          </Button>
          <div className="spacer" />
          {canOpen && (
            <Button
              icon="external"
              onClick={() => window.open(detail.application_url || detail.canonical_url, '_blank', 'noopener')}
            >
              Open posting
            </Button>
          )}
          <Button
            icon="refresh"
            busy={busy === 'score'}
            onClick={() => act('score', () => api.jobs.rescore(detail.id), 'Rescored against your profile.')}
          >
            Rescore
          </Button>
          <Button
            variant="primary"
            icon="documents"
            busy={busy === 'prepare'}
            onClick={() =>
              act(
                'prepare',
                () => api.applications.prepare(detail.id),
                'Application package prepared.',
              )
            }
          >
            {detail.has_application ? 'Regenerate package' : 'Prepare application'}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
        <CompanyMark name={detail.company} logoUrl={detail.company_logo_url} size={46} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge>{REMOTE_LABELS[detail.remote_type]}</Badge>
            <Badge>{SENIORITY_LABELS[detail.seniority] ?? detail.seniority}</Badge>
            {detail.employment_type && <Badge>{detail.employment_type}</Badge>}
            <Badge>{detail.source}</Badge>
            {detail.duplicate_count > 0 && (
              <Badge color="var(--status-info)" background="var(--status-info-bg)">
                Also on {detail.duplicate_count} other {detail.duplicate_count === 1 ? 'board' : 'boards'}
              </Badge>
            )}
          </div>
          <div className="row t-caption muted" style={{ gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
            {pay && (
              <span className="row" style={{ gap: 4 }}>
                <Icon name="trending" size={12} /> <span className="mono">{pay}</span>
              </span>
            )}
            <span className="row" style={{ gap: 4 }}>
              <Icon name="clock" size={12} /> Posted {relative(detail.posted_at ?? detail.discovered_at)}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <Icon name="search" size={12} /> Found {relative(detail.discovered_at)}
            </span>
          </div>
        </div>
        {score && (
          <div className="col" style={{ alignItems: 'flex-end', gap: 4, flex: 'none' }}>
            <ScorePill score={score.score} />
            <span className="t-caption" style={{ color: scoreBand(score.score).color }}>
              {RECOMMENDATION_LABELS[score.recommendation]}
            </span>
            <span className="t-caption muted">
              {score.method === 'hybrid' ? 'Scored with the model' : 'Scored without the model'}
            </span>
          </div>
        )}
      </div>

      {detail.is_excluded && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn">{detail.exclusion_reason || 'This posting is excluded.'}</Notice>
        </div>
      )}

      {detail.has_application && (
        <div style={{ marginBottom: 14 }}>
          <Notice
            tone="success"
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('applications')}>
                Open pipeline
              </Button>
            }
          >
            An application already exists for this posting.
          </Notice>
        </div>
      )}

      <Tabs
        tabs={[
          { id: 'overview', label: 'Description' },
          { id: 'match', label: 'Match analysis' },
          { id: 'requirements', label: 'Requirements' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ paddingTop: 16 }}>
        {tab === 'overview' && (
          <div className="col" style={{ gap: 16 }}>
            {detail.technologies.length > 0 && (
              <div className="col" style={{ gap: 7 }}>
                <span className="t-overline muted">Technologies named in the posting</span>
                <div className="chip-group">
                  {detail.technologies.map((tech) => {
                    const matched = score?.matched_skills.includes(tech);
                    return (
                      <span key={tech} className={`chip ${matched ? 'on' : ''}`}>
                        {matched && <Icon name="check" size={11} color="var(--status-success)" />}
                        {tech}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <Prose text={detail.description} empty="This source gave no description." />
            {detail.responsibilities && (
              <div className="col" style={{ gap: 7 }}>
                <span className="t-overline muted">Responsibilities</span>
                <Prose text={detail.responsibilities} empty="" />
              </div>
            )}
          </div>
        )}

        {tab === 'requirements' && (
          <Prose
            text={detail.requirements}
            empty="This posting did not separate its requirements from the description."
          />
        )}

        {tab === 'match' && (
          <div className="col" style={{ gap: 18 }}>
            {!score ? (
              <Notice tone="info">
                This posting has not been scored yet. Rescore to compare it against your profile.
              </Notice>
            ) : (
              <>
                <div className="col" style={{ gap: 9 }}>
                  <div className="row">
                    <span className="t-overline muted" style={{ flex: 1 }}>
                      How the score was built
                    </span>
                    <span className="t-caption muted">
                      Confidence {Math.round(score.confidence)}% based on how much the posting states
                    </span>
                  </div>
                  {Object.entries(score.breakdown).map(([key, value]) => {
                    const max = WEIGHT_MAX[key] ?? 10;
                    const share = Math.min(100, Math.abs(value / max) * 100);
                    const negative = value < 0;
                    return (
                      <div key={key} className="row" style={{ gap: 10 }}>
                        <span className="t-small secondary" style={{ width: 168 }}>
                          {WEIGHT_LABELS[key] ?? key}
                        </span>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${share}%`,
                              background: negative ? 'var(--status-danger)' : 'var(--accent)',
                            }}
                          />
                        </div>
                        <span className="mono t-small" style={{ width: 68, textAlign: 'right' }}>
                          {value.toFixed(1)} / {max}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="grid g-2" style={{ gap: 16 }}>
                  <SkillColumn
                    title="Matched skills"
                    items={score.matched_skills}
                    color="var(--status-success)"
                    empty="None of the listed technologies are on your profile."
                  />
                  <SkillColumn
                    title="Missing skills"
                    items={score.missing_skills}
                    color="var(--status-warn)"
                    empty="Nothing the posting asks for is missing from your profile."
                  />
                </div>

                <div className="grid g-2" style={{ gap: 16 }}>
                  <PointList title="Strengths" items={score.strengths} icon="check" color="var(--status-success)" />
                  <PointList title="Gaps" items={score.gaps} icon="alert" color="var(--status-warn)" />
                </div>

                {score.explanation && (
                  <div className="col" style={{ gap: 6 }}>
                    <span className="t-overline muted">Summary</span>
                    <p className="t-small secondary">{score.explanation}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="row t-caption muted" style={{ gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
        <span>Discovered {dateTime(detail.discovered_at)}</span>
        {detail.canonical_url && (
          <a
            href={detail.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
            className="row"
            style={{ gap: 4, color: 'var(--accent)' }}
          >
            <Icon name="external" size={11} /> Original posting
          </a>
        )}
      </div>
    </Modal>
  );
}

function Prose({ text, empty }: { text: string; empty: string }) {
  if (!text.trim()) {
    return empty ? <p className="t-small muted">{empty}</p> : null;
  }
  return (
    <div className="t-body secondary" style={{ whiteSpace: 'pre-wrap', lineHeight: '21px' }}>
      {text}
    </div>
  );
}

function SkillColumn({
  title,
  items,
  color,
  empty,
}: {
  title: string;
  items: string[];
  color: string;
  empty: string;
}) {
  return (
    <div className="col" style={{ gap: 7 }}>
      <span className="t-overline muted">
        {title} ({items.length})
      </span>
      {items.length === 0 ? (
        <p className="t-caption muted">{empty}</p>
      ) : (
        <div className="chip-group">
          {items.map((item) => (
            <span key={item} className="chip" style={{ color, borderColor: `${color}44` }}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PointList({
  title,
  items,
  icon,
  color,
}: {
  title: string;
  items: string[];
  icon: 'check' | 'alert';
  color: string;
}) {
  return (
    <div className="col" style={{ gap: 7 }}>
      <span className="t-overline muted">{title}</span>
      {items.length === 0 ? (
        <p className="t-caption muted">Nothing noted.</p>
      ) : (
        <ul className="col" style={{ gap: 5 }}>
          {items.map((item) => (
            <li key={item} className="row" style={{ gap: 7, alignItems: 'flex-start' }}>
              <Icon name={icon} size={13} color={color} style={{ marginTop: 3 }} />
              <span className="t-small secondary">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
