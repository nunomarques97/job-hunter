/** Settings: backend health, model, sources and where the data lives. */
import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ErrorState,
  Notice,
  Skeleton,
} from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useApp } from '../app/AppState';

export function SettingsView() {
  const { revision, navigate } = useApp();
  const health = useAsync(() => api.health(), [revision]);
  const info = useAsync(() => api.info(), [revision]);
  const sources = useAsync(() => api.jobs.sources(), [revision]);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="t-h1">Settings</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            The state of the local backend, the model and every job source.
          </p>
        </div>
        <div className="spacer" />
        <Button icon="shield" variant="secondary" onClick={() => navigate('diagnostics')}>
          Diagnostics
        </Button>
        <Button icon="refresh" onClick={() => { health.reload(); info.reload(); }}>
          Re-check
        </Button>
      </div>

      <div className="grid g-12">
        <Card className="span-6" wash>
          <CardHead title="System health" icon="shield" />
          <div className="card-body col" style={{ gap: 12 }}>
            {health.loading && !health.data ? (
              <Skeleton height={120} />
            ) : health.error ? (
              <ErrorState message={health.error} onRetry={health.reload} />
            ) : health.data ? (
              <>
                <StatusLine
                  label="Local backend"
                  ok={health.data.status !== 'unhealthy'}
                  detail={`Version ${health.data.version}`}
                />
                <StatusLine
                  label="Database"
                  ok={health.data.database.status === 'healthy'}
                  detail={
                    health.data.database.detail ||
                    `${health.data.database.tables ?? 0} tables ready`
                  }
                />
                <StatusLine
                  label={`Model — ${health.data.llm.model}`}
                  ok={health.data.llm.status === 'healthy'}
                  warn={health.data.llm.status === 'degraded'}
                  detail={health.data.llm.detail}
                />

                {health.data.llm.status !== 'healthy' && (
                  <Notice
                    tone="warn"
                    action={
                      <Button size="sm" icon="shield" onClick={() => navigate('diagnostics')}>
                        Diagnostics
                      </Button>
                    }
                  >
                    The product works without the model. Scores fall back to the deterministic
                    calculation and documents come from templates, and both say which path they took.
                    Diagnostics names the model that is missing and the command that installs it.
                  </Notice>
                )}
              </>
            ) : null}
          </div>
        </Card>

        <Card className="span-6">
          <CardHead title="Where your data lives" icon="file" />
          <div className="card-body col" style={{ gap: 10 }}>
            {info.loading && !info.data ? (
              <Skeleton height={120} />
            ) : !info.data ? (
              // An empty card is its own kind of dishonesty: it reads as a
              // section with nothing in it rather than an answer nobody could
              // give. Only the service knows where it keeps things.
              <Notice tone="warn">
                <div className="t-small">The service is not answering.</div>
                <div className="t-caption secondary">
                  {info.error ?? 'It did not reply.'} Where the data, the database and the logs
                  live is what the service reports about itself, so nothing can be said about it
                  until it does. Diagnostics has the paths this window resolved.
                </div>
              </Notice>
            ) : (
              <>
                <InfoRow label="Data folder" value={info.data.data_dir} mono />
                <InfoRow label="Database" value={info.data.database.path || info.data.database.url} mono />
                <InfoRow label="Log folder" value={info.data.logs.dir} mono />
                <InfoRow label="Model provider" value={info.data.llm_provider} />
                <InfoRow label="Model" value={info.data.llm_model} mono />
                <InfoRow label="Python" value={info.data.python} mono />
                <InfoRow label="Platform" value={info.data.platform} />
                <Notice tone="info">
                  Everything stays on this machine. The application talks to job boards to read
                  postings and to your local model, and to nothing else.
                </Notice>
              </>
            )}
          </div>
        </Card>

        <Card className="span-12">
          <CardHead
            title="Job sources"
            icon="layers"
            subtitle="What each source can and cannot do"
          />
          <div className="card-body flush">
            {!sources.data ? (
              // The list of sources and what each one may do comes from the
              // service. A table of headers over nothing would read as "no
              // sources", which is a different and untrue statement.
              <div style={{ padding: '0 16px 16px' }}>
                {sources.loading ? (
                  <Skeleton height={120} />
                ) : (
                  <Notice tone="warn">
                    <div className="t-small">The service is not answering.</div>
                    <div className="t-caption secondary">
                      {sources.error ?? 'It did not reply.'} What each source can and cannot do is
                      declared by the service, so this table stays empty rather than showing an
                      answer this window invented.
                    </div>
                  </Notice>
                )}
              </div>
            ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Discovery</th>
                    <th>Submission</th>
                    <th>Credentials</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.data?.map((source) => (
                    <tr key={source.name}>
                      <td className="primary">{source.label}</td>
                      <td>
                        <Badge
                          color={source.can_discover ? 'var(--status-success)' : 'var(--text-muted)'}
                          background={
                            source.can_discover ? 'var(--status-success-bg)' : 'var(--surface-3)'
                          }
                          dot
                        >
                          {source.can_discover ? 'Yes' : 'No'}
                        </Badge>
                      </td>
                      <td>
                        <Badge
                          color={source.can_submit ? 'var(--status-success)' : 'var(--status-warn)'}
                          background={
                            source.can_submit ? 'var(--status-success-bg)' : 'var(--status-warn-bg)'
                          }
                          dot
                        >
                          {source.can_submit ? 'Supported' : 'Manual'}
                        </Badge>
                      </td>
                      <td>{source.requires_credentials ? 'Required' : 'None'}</td>
                      <td style={{ maxWidth: 520, whiteSpace: 'normal', lineHeight: '18px', padding: '10px 12px' }}>
                        {source.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </Card>

        <Card className="span-12">
          <CardHead title="What this application will not do" icon="shield" />
          <div className="card-body grid g-3" style={{ gap: 14 }}>
            <Boundary
              title="No fabricated claims"
              body="A CV or letter may state only what your profile says. Generated text is checked against your declared facts, and a document that adds an employer, date or technology is held back."
            />
            <Boundary
              title="No unsanctioned submission"
              body="An application is transmitted only where the employer published a mechanism for it. Everything else is prepared and marked action required, with the package kept for you."
            />
            <Boundary
              title="No working around controls"
              body="Sources are read through the public endpoints their publishers document. Nothing here authenticates as someone else, evades a rate limit, or works around any access control."
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatusLine({
  label,
  ok,
  warn,
  detail,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}) {
  const color = ok ? 'var(--status-success)' : warn ? 'var(--status-warn)' : 'var(--status-danger)';
  const background = ok
    ? 'var(--status-success-bg)'
    : warn
      ? 'var(--status-warn-bg)'
      : 'var(--status-danger-bg)';
  return (
    <div className="row" style={{ gap: 10 }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 'var(--r-sm)',
          background,
          display: 'grid',
          placeItems: 'center',
          flex: 'none',
        }}
      >
        <Icon name={ok ? 'check' : 'alert'} size={14} color={color} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="t-small">{label}</div>
        <div className="t-caption muted">{detail}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
      <span className="t-caption muted" style={{ width: 110, flex: 'none' }}>
        {label}
      </span>
      <span
        className={`t-caption ${mono ? 'mono' : ''}`}
        style={{ wordBreak: 'break-all', color: 'var(--text-secondary)' }}
      >
        {value}
      </span>
    </div>
  );
}

function Boundary({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="col"
      style={{
        gap: 5,
        padding: 14,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
      }}
    >
      <div className="row" style={{ gap: 7 }}>
        <Icon name="shield" size={14} color="var(--accent)" />
        <span className="t-small" style={{ fontWeight: 600 }}>
          {title}
        </span>
      </div>
      <span className="t-caption secondary">{body}</span>
    </div>
  );
}
