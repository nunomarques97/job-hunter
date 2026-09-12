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
  backendRecheck,
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
    // Three things, because re-reading is not re-checking. The screen reloads,
    // the service is asked again — and the shell is told to bring its own next
    // check forward, which is what attaches this window again to a service that
    // has come back on the port. Without the third, "Check again" on a stopped
    // adopted backend would only redraw the same sentence.
    void backendRecheck();
    setNonce((value) => value + 1);
    info.reload();
    onRecheck?.();
  };

  const shellLines = useMemo(
    () => describeShell(status, logPath, info.data?.python_executable ?? null),
    [status, logPath, info.data],
  );

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
          {/* The instant arrives beside the sentence rather than inside it, so
              it can be printed on this machine's clock like every other time on
              this screen. A UTC stamp welded into the sentence used to sit two
              rows above the same moment in local time and disagree with it. */}
          <div className="t-small">
            {failure.summary}
            {failure.at && ` That was at ${localStamp(failure.at)}.`}
          </div>
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
  // Nothing was ever started: no spawn was attempted, so the port below is one
  // this window would have used rather than one anything is on.
  const nothingStarted = status?.state === 'failed' && status.provenance === 'pending';
  const origin = status?.origin ?? null;
  // An adopted backend resolves a pair it is not using — except when the
  // service turns out to be running the very same interpreter, which on a
  // one-machine install is the normal case. Calling that "not in use" sends
  // the reader looking for a second Python that does not exist. The live
  // answer is preferred; the one recorded before the service stopped is the
  // fallback, so the sentence survives the thing it describes.
  const live = info?.python_executable ?? null;
  const sameAsLive = samePath(resolved?.interpreter, live);
  const sameAsStopped = !live && samePath(resolved?.interpreter, origin?.interpreter);

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
                nothingStarted
                  ? 'the port this window would have used — nothing is listening on it'
                  : info && status && info.port !== status.port
                    ? `the service was configured for ${info.port}`
                    : undefined
              }
              mono
            />
            {status && <SupervisionRow status={status} />}
            <Row
              label="Python interpreter"
              value={resolved?.interpreter ?? '—'}
              hint={
                !resolved || resolved.in_use
                  ? undefined
                  : sameAsLive
                    ? 'the same interpreter the running service reports for itself'
                    : sameAsStopped
                      ? 'the same interpreter the service that stopped was running'
                      : 'not in use — this is what the window would have used'
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
            {origin && status?.state === 'failed' && (
              <>
                <div className="t-overline muted" style={{ marginTop: 4 }}>
                  Where that service was running
                </div>
                <Row label="Attached on" value={origin.address} mono />
                <Row
                  label="Its interpreter"
                  value={origin.interpreter ?? 'unknown'}
                  hint={
                    origin.interpreter
                      ? 'read from the service itself while it was still answering'
                      : 'it stopped before this window could ask'
                  }
                  mono
                />
                {origin.data_dir && <Row label="Its data folder" value={origin.data_dir} mono />}
              </>
            )}
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

/**
 * What is watching the service, and what it is still allowed to do about it.
 *
 * The restart is one per window session, not one per failure. A screen that
 * left that implicit would be read as "it will keep restarting", which is the
 * one thing it will not do — so the used restart is shown with the failure that
 * spent it and the time it happened.
 */
function SupervisionRow({ status }: { status: BackendStatus }) {
  const { supervision } = status;
  // Nothing was ever started, so there is nothing being watched and nothing to
  // restart. Saying "it cannot be restarted" here would answer a question
  // nobody asked about a process that never existed.
  const nothingStarted = status.state === 'failed' && status.provenance === 'pending';

  const value = supervision.reattaching
    ? `Still checking every ${supervision.poll_seconds} seconds, for the service to come back`
    : supervision.watching
      ? `Checked every ${supervision.poll_seconds} seconds`
      : nothingStarted
        ? 'Nothing to watch'
        : status.state === 'failed'
          ? 'Stopped — the failure above is the last thing it saw'
          : 'Not started yet';

  const hint = supervision.reattaching
    ? 'this window did not start that service and cannot restart it, but it can attach again: ' +
      'the moment a Job Hunter service answers on that port this window takes it up, reads what ' +
      'it says about itself, and carries on. That is not a restart and spends none of the budget.'
    : supervision.restart
      ? `the one automatic restart was used at ${localStamp(supervision.restart.at)} — ${
          supervision.restart.reason
        }. There is no second one in this window.`
      : supervision.reattached_at
        ? `the service this window attached to stopped, and this window attached again at ${localStamp(
            supervision.reattached_at,
          )}, to a different process answering on the same port. It read that one's own account of itself afresh. No restart was used: this window cannot restart what it did not start.`
        : nothingStarted
          ? 'no service was started, so nothing is being checked'
          : supervision.can_restart
            ? 'one automatic restart is available, once, for this window'
            : 'this window did not start the service, so it cannot restart it';

  return <Row label="Supervision" value={value} hint={hint} />;
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
  const grid = useRef<HTMLDivElement>(null);
  const zone = useMemo(zoneLabel, []);
  // Keyed off adoption rather than off `logs_captured`, which is also false
  // before anything has started. A backend that never launched is not a
  // backend this window attached to, and saying so would be a false sentence
  // on the one screen that must not have any.
  const adopted = status?.provenance === 'adopted';

  // Scrolled to the bottom, and then to a row boundary. A whole number of
  // 20px lines stops a line being cut in half, but not a line that wraps: the
  // top of the box would land on the second visual line of a two-line entry,
  // showing its tail with the timestamp above the fold and no way to tell.
  // Measuring where the rows actually start and padding the bottom by the
  // shortfall moves the fold onto the start of a whole entry.
  useEffect(() => {
    const box = bottom.current;
    const rows = grid.current;
    if (!box) return;
    // Measured without the previous nudge in place, so the correction is
    // computed from the real geometry rather than from itself.
    if (rows) rows.style.paddingBottom = '0px';
    box.scrollTo({ top: box.scrollHeight });
    const starts = Array.from(box.querySelectorAll<HTMLElement>('[data-logrow]')).map(
      (cell) => cell.offsetTop,
    );
    const top = box.scrollTop;
    const next = starts.find((start) => start > top);
    // A fold that already sits on a row start needs nothing. One that does not
    // is inside a wrapped entry, and the box is padded until the next whole
    // entry can reach the top edge.
    if (rows && next !== undefined && !starts.includes(top)) {
      rows.style.paddingBottom = `${next - top}px`;
    }
    box.scrollTo({ top: box.scrollHeight });
  }, [lines]);

  // Which of these lines this launch actually wrote. The file is a day long
  // and a launch is minutes, so the tail of it is usually somebody else's
  // afternoon — and an unlabelled log tail beside a failure reads as evidence
  // about that failure when it is nothing of the kind.
  const launchedAt = status?.launched_at ?? '';

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

  // The stamps are fixed-width UTC, so comparing them as text compares them as
  // times. A line the parser could not read carries no stamp and stays with
  // whatever came before it.
  const firstOfThisLaunch = useMemo(
    () => (launchedAt ? rows.findIndex((row) => row.utc && row.utc >= launchedAt) : -1),
    [rows, launchedAt],
  );
  const nothingFromThisLaunch = rows.length > 0 && firstOfThisLaunch === -1;

  return (
    <Card className="span-12">
      <CardHead
        title="Service log"
        icon="history"
        subtitle={`The end of today's file. Times converted to this machine's clock (${zone}); the file itself is in UTC.`}
      />
      <div className="card-body col" style={{ gap: 12 }}>
        {/* The path used to sit beside the subtitle, which at the standard
            window width cut the sentence off at "the file itself is in …" —
            losing UTC, the only word in it that carries information. On its
            own row both survive at any width. */}
        {path && (
          <span className="t-caption mono muted truncate" title={path}>
            {path}
          </span>
        )}
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
        {!adopted && nothingFromThisLaunch && (
          <Notice tone="info">
            <div className="t-small">This launch has written nothing to the log.</div>
            <div className="t-caption secondary">
              Every line below is the end of today's file, written before this window opened at{' '}
              {localStamp(launchedAt)}. None of it is evidence about what is wrong now.
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
            // Every cell is one 20px line, and nothing separates the rows but
            // that line height. A row gap would make the pitch uneven, and the
            // box is scrolled to the bottom against a height measured in whole
            // lines — which is what keeps the first line from being cut in
            // half by the top border.
            <div
              ref={grid}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                columnGap: 12,
                rowGap: 0,
              }}
            >
              {rows.map((row, index) => (
                <Fragment key={`${index}-${row.text}`}>
                  {index === firstOfThisLaunch && index > 0 && (
                    <span
                      className="t-caption mono muted"
                      style={{ gridColumn: '1 / -1', lineHeight: '20px' }}
                    >
                      ——— this window opened here ———
                    </span>
                  )}
                  <span
                    data-logrow=""
                    className="t-caption mono muted"
                    style={{ whiteSpace: 'nowrap', width: 92, lineHeight: '20px' }}
                    title={row.utc ? `${row.utc} in the file` : undefined}
                  >
                    {row.time || '·'}
                  </span>
                  <span
                    className="t-caption mono"
                    style={{
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      lineHeight: '20px',
                    }}
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

/** A `YYYY-MM-DD HH:MM:SSZ` stamp from the log, read on this machine's clock. */
function localStamp(utc: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})Z$/.exec(utc.trim());
  if (!match) return utc;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
  ).toLocaleTimeString();
}

/**
 * Whether two paths name the same file.
 *
 * Windows accepts either separator and ignores case, so two spellings of one
 * interpreter are common and comparing the strings as they arrive would report
 * a difference that does not exist.
 */
function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const normalise = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalise(left) === normalise(right);
}

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
function describeShell(
  status: BackendStatus | null,
  logPath: string,
  serviceInterpreter: string | null,
): string[] {
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
    `port              ${status.port}${
      status.state === 'failed' && status.provenance === 'pending'
        ? '  (would have been used — nothing was started on it)'
        : ''
    }`,
    `window opened     ${status.launched_at}`,
    `health poll       ${
      status.supervision.watching
        ? `every ${status.supervision.poll_seconds}s`
        : 'not running'
    }`,
    `restart           ${
      status.supervision.restart
        ? `used at ${status.supervision.restart.at} — ${status.supervision.restart.reason}`
        : status.supervision.can_restart
          ? 'available, once, for this window'
          : 'not possible — this window did not start the service'
    }`,
  ];
  if (status.resolved) {
    const service = serviceInterpreter ?? status.origin?.interpreter ?? null;
    const suffix = status.resolved.in_use
      ? ''
      : samePath(status.resolved.interpreter, service)
        ? '  (the same interpreter the service reports)'
        : '  (not in use — would have been used)';
    lines.push(`interpreter       ${status.resolved.interpreter}${suffix}`);
    lines.push(
      `backend package   ${status.resolved.package}${
        status.resolved.in_use ? '' : '  (resolved beside the interpreter above)'
      }`,
    );
  }
  if (status.origin) {
    lines.push(`attached on       ${status.origin.address}`);
    lines.push(`its interpreter   ${status.origin.interpreter ?? 'unknown'}`);
    if (status.origin.data_dir) lines.push(`its data folder   ${status.origin.data_dir}`);
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
