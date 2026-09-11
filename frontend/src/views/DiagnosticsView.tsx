/**
 * One honest screen for when the product is broken.
 *
 * The person who has to fix this is the only person who can, and the backend is
 * not his specialism. So everything he would otherwise have to find — which
 * interpreter, which package, which port, which model, which file — is on one
 * screen, read at runtime, with the exact command where there is one.
 *
 * The rule the screen is built around: nothing here may read healthier than it
 * is. Two states in particular are easy to get wrong and both are handled
 * explicitly. A backend the shell attached to rather than started writes its
 * output somewhere else, so its log tail here is empty however well it is
 * running, and the panel says that rather than showing the silence as a
 * symptom. A model runtime that never answered cannot tell us whether a tag is
 * installed, so the answer is "unknown", not "missing".
 *
 * The same component serves two places: the Settings screen, and the startup
 * screen when the backend never came up. It asks the shell and the API for
 * everything it shows, so the second case simply has fewer answers.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { IconName } from '../components/Icon';
import { Badge, Button, Card, CardHead, Notice, Skeleton } from '../components/ui';
import { useApp } from '../app/AppState';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import type { ModelStatus, SystemInfo } from '../lib/types';
import {
  backendLogTail,
  backendStatus,
  inShell,
  openLogFolder,
  type BackendStatus,
} from '../lib/shell';

/** How many log lines to show, and to include in a copied report. */
const LOG_LINES = 80;

/** How often the shell is re-asked while this screen is open. */
const SHELL_POLL_MS = 2000;

export function DiagnosticsView({
  onRecheck,
}: {
  /** Called by "Check again" on top of this screen's own reload, so the startup
   *  screen can retry the health probe that is keeping it up. */
  onRecheck?: () => void;
}) {
  const { notify } = useApp();
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [logPath, setLogPath] = useState('');
  const [copying, setCopying] = useState(false);

  const info = useAsync(() => api.info(), [nonce]);

  // The shell is asked repeatedly rather than once: the port decision, the
  // spawn and the failure all land after this screen has already mounted.
  useEffect(() => {
    let live = true;
    const read = async () => {
      const [shellStatus, tail] = await Promise.all([backendStatus(), backendLogTail(LOG_LINES)]);
      if (!live) return;
      setStatus(shellStatus);
      if (tail) {
        setLog(tail.lines);
        setLogPath(tail.path);
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), SHELL_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [nonce]);

  const recheck = () => {
    setNonce((value) => value + 1);
    info.reload();
    onRecheck?.();
  };

  const shellLines = useMemo(() => describeShell(status, logPath), [status, logPath]);

  const copy = async () => {
    setCopying(true);
    try {
      // The backend assembles it, because every line has to leave through the
      // same redaction filter the log writes through.
      const report = await api.diagnostics(shellLines, log);
      await navigator.clipboard.writeText(report.text);
      notify('Diagnostics copied to the clipboard.', 'success');
    } catch {
      // The local service is the thing that is broken, which is exactly when
      // this button matters. The window assembles what it knows instead, says
      // so at the top of the report, and leaves out everything it would have
      // had to ask the service for.
      const fallback = [
        'Job Hunter — diagnostics',
        '',
        'The local service did not answer, so this report was assembled by the',
        'window. It carries only what the desktop shell knows and the log lines',
        'already written to disk. Nothing the service holds is in it.',
        '',
        'Desktop shell',
        '-------------',
        ...shellLines,
        '',
        'Log tail',
        '--------',
        ...log,
      ].join('\n');
      try {
        await navigator.clipboard.writeText(fallback);
        notify('The service is not answering. Copied what the window knows.', 'warn');
      } catch {
        notify('The clipboard is not available in this window.', 'danger');
      }
    } finally {
      setCopying(false);
    }
  };

  const openFolder = async () => {
    const opened = await openLogFolder();
    if (opened) notify(`Opened ${opened}`, 'success');
    else notify('The log folder can only be opened from the desktop window.', 'warn');
  };

  const failure = status?.state === 'failed' ? status.failure : null;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="t-h1">Diagnostics</h1>
          <p className="t-small secondary" style={{ marginTop: 2 }}>
            What Job Hunter is running, where it keeps things, and what is wrong when something is.
          </p>
        </div>
        <div className="spacer" />
        <Button icon="external" variant="secondary" onClick={() => void openFolder()}>
          Open log folder
        </Button>
        <Button icon="copy" variant="secondary" onClick={() => void copy()} disabled={copying}>
          Copy diagnostics
        </Button>
        <Button icon="refresh" onClick={recheck}>
          Check again
        </Button>
      </div>

      {failure && (
        <Notice tone="danger">
          <div className="t-small">{failure.summary}</div>
          <div className="t-caption secondary">{failure.remedy}</div>
          {failure.probed.length > 0 && (
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              <div className="t-overline muted">Looked at</div>
              {failure.probed.map((path) => (
                <div key={path} className="t-caption mono muted" style={{ wordBreak: 'break-all' }}>
                  {path}
                </div>
              ))}
            </div>
          )}
        </Notice>
      )}

      <div className="grid g-12" style={{ marginTop: failure ? 16 : 0 }}>
        <ServiceCard status={status} info={info.data} />
        <ModelCard llm={info.data?.llm ?? null} loading={info.loading} error={info.error} />
        <FilesCard info={info.data} loading={info.loading} />
        <LogCard lines={log} path={logPath || info.data?.logs.path || ''} status={status} />
      </div>
    </div>
  );
}

/* ---------- The local service ---------- */

function ServiceCard({ status, info }: { status: BackendStatus | null; info: SystemInfo | null }) {
  const outside = !inShell();
  const adopted = status?.provenance === 'adopted';
  const resolved = status?.resolved ?? null;

  const state = (() => {
    if (outside) return { label: 'Unknown', tone: 'neutral' as const };
    if (!status) return { label: 'Asking…', tone: 'neutral' as const };
    if (status.state === 'ready') return { label: 'Running', tone: 'success' as const };
    if (status.state === 'starting') return { label: 'Starting', tone: 'info' as const };
    return { label: 'Not running', tone: 'danger' as const };
  })();

  return (
    <Card className="span-6" wash>
      <CardHead
        title="Local service"
        icon="zap"
        subtitle="The Python backend this window talks to"
        action={<StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
      />
      <div className="card-body col" style={{ gap: 12 }}>
        {outside ? (
          <Notice tone="info">
            This page is open in a browser rather than in the Job Hunter window, so the desktop
            shell cannot be asked about the process. Everything below the model comes from the
            service itself and is accurate.
          </Notice>
        ) : (
          <>
            <Row
              label="Process"
              value={
                adopted
                  ? 'Attached to a service that was already running'
                  : status?.provenance === 'spawned'
                    ? 'Started by this window'
                    : status?.state === 'failed'
                      ? 'No service was started'
                      : 'Not settled yet'
              }
            />
            {adopted && (
              <Notice tone="warn">
                <div className="t-small">
                  This window did not start the service, so it does not own it.
                </div>
                <ul
                  className="t-caption secondary"
                  style={{ margin: '6px 0 0', paddingLeft: 16, lineHeight: '18px' }}
                >
                  <li>It keeps running after this window closes.</li>
                  <li>This window cannot restart it if it stops.</li>
                  <li>
                    Its output does not reach the log file below, so the log tail stays empty or
                    stale however healthy the service is. Read the terminal it was started from.
                  </li>
                </ul>
              </Notice>
            )}
            <Row
              label="Port"
              value={status ? String(status.port) : '—'}
              hint={
                info && status && info.port !== status.port
                  ? `the service was configured for ${info.port}`
                  : undefined
              }
              mono
            />
            <Row
              label="Python interpreter"
              value={resolved?.interpreter ?? '—'}
              hint={
                resolved && !resolved.in_use
                  ? 'not in use — this is what the window would have used'
                  : undefined
              }
              mono
            />
            <Row
              label="Backend package"
              value={resolved?.package ?? '—'}
              hint={
                resolved && !resolved.in_use ? 'resolved beside the interpreter above' : undefined
              }
              mono
            />
          </>
        )}
        {info && (
          <>
            <Row label="Service version" value={`${info.app_name} ${info.version}`} />
            <Row
              label="Running on"
              value={`Python ${info.python} — ${info.platform}`}
              hint={`the service's own interpreter: ${info.python_executable}`}
              mono
            />
          </>
        )}
      </div>
    </Card>
  );
}

/* ---------- The model ---------- */

function ModelCard({
  llm,
  loading,
  error,
}: {
  llm: ModelStatus | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card className="span-6">
      <CardHead
        title="Model"
        icon="sparkle"
        subtitle="Which model each stage calls, and whether it is installed"
        action={
          llm ? (
            <StatusBadge tone={llm.reachable ? 'success' : 'danger'}>
              {llm.reachable ? 'Reachable' : 'Not reachable'}
            </StatusBadge>
          ) : undefined
        }
      />
      <div className="card-body col" style={{ gap: 12 }}>
        {loading && !llm ? (
          <Skeleton height={180} />
        ) : error || !llm ? (
          <Notice tone="warn">
            <div className="t-small">The service could not be asked about the model.</div>
            <div className="t-caption secondary">
              {error ?? 'It is not answering.'} Nothing can be said about which models are
              installed until it does.
            </div>
          </Notice>
        ) : (
          <>
            <Row label="Runtime" value={`${llm.provider} at ${llm.base_url}`} mono />
            <div className="t-caption muted">{llm.detail}</div>

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Model</th>
                    <th>Installed</th>
                  </tr>
                </thead>
                <tbody>
                  {llm.stages.map((stage) => (
                    <tr key={stage.stage}>
                      <td className="primary">
                        {stage.label}
                        {stage.pinned && (
                          <span className="t-caption muted" style={{ marginLeft: 6 }}>
                            pinned
                          </span>
                        )}
                      </td>
                      <td className="mono">{stage.model}</td>
                      <td>
                        {stage.installed === null ? (
                          <StatusBadge tone="neutral">Unknown</StatusBadge>
                        ) : stage.installed ? (
                          <StatusBadge tone="success">Yes</StatusBadge>
                        ) : (
                          <StatusBadge tone="danger">Missing</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {llm.missing_models.length > 0 && (
              <Notice tone="warn">
                <div className="t-small">
                  {llm.missing_models.length === 1
                    ? `${llm.missing_models[0]} is configured but not installed.`
                    : `${llm.missing_models.length} configured models are not installed.`}
                </div>
                <div className="t-caption secondary">
                  Scoring falls back to the deterministic calculation and documents come from
                  templates until this is fixed. Both say so where they appear. Run:
                </div>
                <div className="col" style={{ gap: 4, marginTop: 6 }}>
                  {llm.pull_commands.map((command) => (
                    <code key={command} className="t-caption mono" style={{ userSelect: 'all' }}>
                      {command}
                    </code>
                  ))}
                </div>
              </Notice>
            )}

            <div className="col" style={{ gap: 6 }}>
              <div className="t-overline muted">Installed on this machine</div>
              {llm.installed_models.length === 0 ? (
                <div className="t-caption muted">
                  {llm.reachable
                    ? 'Ollama is running and has no models.'
                    : 'Unknown — Ollama did not answer.'}
                </div>
              ) : (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {llm.installed_models.map((model) => (
                    <span key={model} className="chip mono">
                      {model}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Row label="Context window" value={`${llm.num_ctx} tokens per request`} mono />
          </>
        )}
      </div>
    </Card>
  );
}

/* ---------- Where things are on disk ---------- */

function FilesCard({
  info,
  loading,
}: {
  info: SystemInfo | null;
  loading: boolean;
}) {
  return (
    <Card className="span-12">
      <CardHead title="Files" icon="file" subtitle="Everything Job Hunter writes, and where" />
      <div className="card-body grid g-2" style={{ gap: 12 }}>
        {loading && !info ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Skeleton height={80} />
          </div>
        ) : !info ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <Notice tone="warn">
              The service is not answering, so it cannot say where it keeps things.
            </Notice>
          </div>
        ) : (
          <>
            <Row label="Data folder" value={info.data_dir} mono />
            <Row
              label="Database"
              value={info.database.path || info.database.url}
              hint={
                info.database.exists
                  ? `${bytes(info.database.size_bytes)} on disk`
                  : 'this file does not exist yet'
              }
              mono
            />
            <Row label="Log folder" value={info.logs.dir} mono />
            <Row
              label="Today's log"
              value={info.logs.path}
              hint={
                info.logs.exists
                  ? `${bytes(info.logs.size_bytes)} on disk`
                  : 'nothing has been written to it'
              }
              mono
            />
          </>
        )}
      </div>
    </Card>
  );
}

/* ---------- The log ---------- */

/**
 * The log is written in UTC, which is right: it is sortable, and one file never
 * mixes two clocks. It is unreadable in front of a person on a Tuesday evening,
 * so it is converted here — and the column says which is which, because a
 * timestamp whose zone is a guess is worse than no timestamp.
 */
/**
 * Two shapes reach the file. The shell writes its own lines stamped first
 * (`2026-09-11 20:51:13Z SHELL …`), and it copies the backend's stdout through
 * with its tag in front of the backend's own stamp (`BACKEND 2026-09-11
 * 20:12:03Z INFO …`). An optional leading tag covers both, and the tag stays in
 * the line so it is still obvious which side wrote it.
 */
const LINE = /^(?:([A-Z]+)\s+)?(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})Z\s?(.*)$/;

function zoneLabel(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = -new Date().getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  const utc = `UTC${sign}${hours}:${minutes}`;
  return zone ? `${zone}, ${utc}` : utc;
}

function LogCard({
  lines,
  path,
  status,
}: {
  lines: string[];
  path: string;
  status: BackendStatus | null;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const zone = useMemo(zoneLabel, []);
  // Keyed off adoption rather than off `logs_captured`, which is also false
  // before anything has started. A backend that never launched is not a
  // backend this window attached to, and saying so would be a false sentence
  // on the one screen that must not have any.
  const adopted = status?.provenance === 'adopted';

  useEffect(() => {
    bottom.current?.scrollTo({ top: bottom.current.scrollHeight });
  }, [lines]);

  const rows = useMemo(
    () =>
      lines.map((line) => {
        const match = LINE.exec(line);
        if (!match) return { time: '', utc: '', text: line };
        const [, tag, year, month, day, hour, minute, second, rest] = match;
        const when = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
        return {
          time: when.toLocaleTimeString(),
          utc: `${year}-${month}-${day} ${hour}:${minute}:${second}Z`,
          text: tag ? `${tag} ${rest}` : rest,
        };
      }),
    [lines],
  );

  return (
    <Card className="span-12">
      <CardHead
        title="Service log"
        icon="history"
        subtitle={`Times converted to this machine's clock (${zone}). The file itself is in UTC.`}
        action={
          path ? (
            <span
              className="t-caption mono muted truncate"
              title={path}
              style={{ maxWidth: 420 }}
            >
              {path}
            </span>
          ) : undefined
        }
      />
      <div className="card-body col" style={{ gap: 12 }}>
        {adopted && (
          <Notice tone="warn">
            <div className="t-small">This service's output is not being captured.</div>
            <div className="t-caption secondary">
              The window attached to a service it did not start, so nothing that service writes
              reaches this file. Whatever is below was left by an earlier run. It is not a sign
              that anything is wrong.
            </div>
          </Notice>
        )}
        <div className="row" style={{ gap: 12 }}>
          <span
            className="t-overline muted"
            style={{ width: 104, flex: 'none', whiteSpace: 'nowrap' }}
          >
            Time — local
          </span>
          <span className="t-overline muted">Line</span>
        </div>
        <div className="logtail" ref={bottom}>
          {rows.length === 0 ? (
            <span className="t-caption mono muted">
              {inShell()
                ? 'Nothing has been written to today\u2019s log.'
                : 'The log is only readable from the desktop window.'}
            </span>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                columnGap: 12,
                rowGap: 4,
              }}
            >
              {rows.map((row, index) => (
                <Fragment key={`${index}-${row.text}`}>
                  <span
                    className="t-caption mono muted"
                    style={{ whiteSpace: 'nowrap', width: 92 }}
                    title={row.utc ? `${row.utc} in the file` : undefined}
                  >
                    {row.time || '·'}
                  </span>
                  <span
                    className="t-caption mono"
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {row.text}
                  </span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ---------- Shared pieces ---------- */

type Tone = 'success' | 'info' | 'warn' | 'danger' | 'neutral';

const TONES: Record<Tone, { color: string; background: string; icon: IconName }> = {
  success: { color: 'var(--status-success)', background: 'var(--status-success-bg)', icon: 'check' },
  info: { color: 'var(--status-info)', background: 'var(--status-info-bg)', icon: 'info' },
  warn: { color: 'var(--status-warn)', background: 'var(--status-warn-bg)', icon: 'alert' },
  danger: { color: 'var(--status-danger)', background: 'var(--status-danger-bg)', icon: 'alert' },
  neutral: { color: 'var(--text-muted)', background: 'var(--surface-3)', icon: 'info' },
};

function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { color, background } = TONES[tone];
  return (
    <Badge color={color} background={background} dot>
      {children}
    </Badge>
  );
}

/** One label, one value, and an optional qualifier the value must not imply. */
function Row({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
      <span className="t-caption muted" style={{ width: 132, flex: 'none' }}>
        {label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          className={`t-caption ${mono ? 'mono' : ''}`}
          style={{ wordBreak: 'break-all', color: 'var(--text-secondary)' }}
        >
          {value}
        </span>
        {hint && <div className="t-caption muted">{hint}</div>}
      </span>
    </div>
  );
}

/** The shell's side of the report, as the lines the backend redacts and returns. */
function describeShell(status: BackendStatus | null, logPath: string): string[] {
  if (!status) {
    return inShell()
      ? ['state             the desktop shell has not answered yet']
      : ['state             not running in the desktop window, so the shell cannot be asked'];
  }
  const lines = [
    `state             ${status.state}`,
    `process           ${
      status.provenance === 'adopted'
        ? 'attached to a service this window did not start'
        : status.provenance === 'spawned'
          ? 'started by this window'
          : status.state === 'failed'
            ? 'none was started'
            : 'not settled yet'
    }`,
    `logs captured     ${
      status.provenance === 'adopted'
        ? 'no — the service writes wherever it was started from'
        : status.logs_captured
          ? 'yes'
          : 'nothing is running to capture'
    }`,
    `port              ${status.port}`,
  ];
  if (status.resolved) {
    const suffix = status.resolved.in_use ? '' : '  (not in use — would have been used)';
    lines.push(`interpreter       ${status.resolved.interpreter}${suffix}`);
    lines.push(`backend package   ${status.resolved.package}${suffix}`);
  }
  if (logPath) lines.push(`log file          ${logPath}`);
  if (status.state === 'failed') {
    lines.push(`failure           ${status.failure.kind}: ${status.failure.summary}`);
    lines.push(`remedy            ${status.failure.remedy}`);
    for (const path of status.failure.probed) lines.push(`looked at         ${path}`);
  }
  return lines;
}

function bytes(value: number): string {
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
