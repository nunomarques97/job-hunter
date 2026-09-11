/**
 * What the window shows before the backend answers, and whenever it stops.
 *
 * The window is on screen within a second of launch now, so something has to
 * be there. This is that something: the shell's own furniture in its loading
 * state, one card saying what is happening, and the log as it is written. When
 * the backend cannot start, the same card carries the reason and the remedy —
 * both written by the shell in Rust, never composed here, so the sentence in
 * the window is the sentence in the log.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from '../components/Icon';
import { Button, Card, CardHead, Notice, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { backendLogTail, backendStatus, inShell, type StartFailure } from '../lib/shell';

/** How often to ask whether the backend is up, while waiting for it. */
const POLL_WAITING_MS = 400;

/** How often to check it is still up, once it is. Blueprint section 14.3. */
const POLL_READY_MS = 10000;

/** How long to wait before saying out loud that this is taking too long. */
const TIMEOUT_MS = 20000;

/** Consecutive failed health checks before a running app is called down. */
const FAILURES_BEFORE_DOWN = 2;

/** How long one health probe may take before it counts as unanswered. */
const PROBE_TIMEOUT_MS = 3000;

/**
 * Give up on a promise that may never settle.
 *
 * The shell adopts anything listening on its port, so the thing being asked
 * for health may be a socket that accepts the connection and then says
 * nothing. `fetch` waits on that indefinitely, which froze this screen on
 * "waiting" forever instead of letting it time out.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The service did not answer.')), ms);
    work.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

type Phase =
  | { kind: 'waiting' }
  | { kind: 'timeout' }
  | { kind: 'failed'; failure: StartFailure }
  | { kind: 'ready' };

export function StartupView({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [elapsed, setElapsed] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [logPath, setLogPath] = useState('');

  const began = useRef(Date.now());
  const misses = useRef(0);
  const checking = useRef(false);
  const ready = phase.kind === 'ready';

  const check = useCallback(async () => {
    // A probe can outlive the interval that started it, and a queue of them
    // helps nobody.
    if (checking.current) return;
    checking.current = true;
    try {
      // The shell knows about the process; the API knows whether it is
      // serving. Both are asked, because only one of them can report a Python
      // that was never there.
      const status = await backendStatus();
      if (status?.state === 'failed') {
        setPhase({ kind: 'failed', failure: status.failure });
        return;
      }

      try {
        await withTimeout(api.health(), PROBE_TIMEOUT_MS);
        misses.current = 0;
        setPhase({ kind: 'ready' });
      } catch {
        misses.current += 1;
        setPhase((current) => {
          if (current.kind === 'failed') return current;
          if (current.kind === 'ready') {
            // A single missed check is a hiccup, not an outage.
            if (misses.current < FAILURES_BEFORE_DOWN) return current;
            began.current = Date.now();
            return { kind: 'waiting' };
          }
          const waited = Date.now() - began.current;
          return waited >= TIMEOUT_MS ? { kind: 'timeout' } : { kind: 'waiting' };
        });
      }
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    let live = true;
    const tick = () => {
      if (live) void check();
    };
    tick();
    const timer = window.setInterval(tick, ready ? POLL_READY_MS : POLL_WAITING_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [check, ready]);

  // The counter and the log only matter while something is wrong or pending.
  //
  // The timeout is decided here rather than in the health check, because a
  // check that never settles would otherwise leave this screen waiting for
  // ever with a counter that keeps climbing past twenty seconds.
  useEffect(() => {
    if (ready) return;
    const tick = window.setInterval(() => {
      const waited = Date.now() - began.current;
      setElapsed(waited / 1000);
      if (waited >= TIMEOUT_MS) {
        setPhase((current) => (current.kind === 'waiting' ? { kind: 'timeout' } : current));
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [ready]);

  useEffect(() => {
    if (ready) return;
    let live = true;
    const read = async () => {
      const tail = await backendLogTail(60);
      if (!live || !tail) return;
      setLog(tail.lines);
      setLogPath(tail.path);
    };
    void read();
    const timer = window.setInterval(() => void read(), 1000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [ready]);

  const retry = () => {
    misses.current = 0;
    began.current = Date.now();
    setElapsed(0);
    setPhase({ kind: 'waiting' });
    void check();
  };

  if (ready) return <>{children}</>;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="rail-brand">
          <span className="rail-mark">
            <Icon name="briefcase" size={17} color="#fff" />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="t-h3 truncate">Job Hunter</div>
            <div className="t-caption muted truncate">Find. Match. Apply. Faster.</div>
          </div>
        </div>
        <div className="rail-nav" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="row" style={{ gap: 12, height: 40, padding: '0 12px' }}>
              <Skeleton height={18} width={18} radius={6} />
              <Skeleton height={12} width={`${46 + ((index * 13) % 34)}%`} />
            </div>
          ))}
        </div>
      </nav>

      <div className="main">
        <header className="commandbar">
          <Skeleton height={34} width={360} radius={10} />
          <div className="spacer" />
          <Skeleton height={34} width={132} radius={10} />
        </header>

        <main className="page">
          <div className="page-inner">
            {phase.kind === 'failed' ? (
              <FailureCard failure={phase.failure} onRetry={retry} log={log} logPath={logPath} />
            ) : (
              <WaitingCard
                timedOut={phase.kind === 'timeout'}
                elapsed={elapsed}
                log={log}
                logPath={logPath}
                onRetry={retry}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function WaitingCard({
  timedOut,
  elapsed,
  log,
  logPath,
  onRetry,
}: {
  timedOut: boolean;
  elapsed: number;
  log: string[];
  logPath: string;
  onRetry: () => void;
}) {
  return (
    <Card wash style={{ maxWidth: 720 }}>
      <CardHead
        icon="zap"
        title="Starting the local service…"
        subtitle="Job Hunter keeps everything on this machine. The window opens first; the service follows."
        action={<Elapsed seconds={elapsed} />}
      />
      <div className="card-body col" style={{ gap: 16 }}>
        {timedOut ? (
          <Notice
            tone="warn"
            action={
              <Button icon="refresh" size="sm" onClick={onRetry}>
                Check again
              </Button>
            }
          >
            <div className="t-small">The local service has not answered in 20 seconds.</div>
            <div className="t-caption secondary">
              It may still be starting. The log below is the best clue to what it is doing.
            </div>
          </Notice>
        ) : (
          <div className="row" style={{ gap: 12 }}>
            <Spinner size={16} />
            <span className="t-small secondary">Waiting for the service to answer.</span>
          </div>
        )}
        <LogTail lines={log} path={logPath} />
      </div>
    </Card>
  );
}

function FailureCard({
  failure,
  onRetry,
  log,
  logPath,
}: {
  failure: StartFailure;
  onRetry: () => void;
  log: string[];
  logPath: string;
}) {
  return (
    <Card style={{ maxWidth: 720 }}>
      <CardHead
        icon="alert"
        title={
          failure.kind === 'stopped'
            ? 'Job Hunter lost its local service'
            : 'Job Hunter cannot start its local service'
        }
        subtitle="Nothing is lost. Your data is on disk and the window picks it up once the service runs."
      />
      <div className="card-body col" style={{ gap: 16 }}>
        <Notice
          tone="danger"
          action={
            <Button icon="refresh" size="sm" onClick={onRetry}>
              Check again
            </Button>
          }
        >
          <div className="t-small">{failure.summary}</div>
          <div className="t-caption secondary">{failure.remedy}</div>
        </Notice>

        {failure.probed.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <div className="t-overline muted">Looked at</div>
            <div className="col" style={{ gap: 4 }}>
              {failure.probed.map((path) => (
                <div key={path} className="t-caption mono muted truncate" title={path}>
                  {path}
                </div>
              ))}
            </div>
          </div>
        )}

        <LogTail lines={log} path={logPath} />
      </div>
    </Card>
  );
}

function Elapsed({ seconds }: { seconds: number }) {
  return (
    <span className="t-caption mono muted" title="Time since this window opened">
      {seconds.toFixed(1)}s
    </span>
  );
}

function LogTail({ lines, path }: { lines: string[]; path: string }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollTo({ top: bottom.current.scrollHeight });
  }, [lines]);

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="t-overline muted">Service log</span>
        <div className="spacer" />
        {path && (
          <span className="t-caption mono muted truncate" title={path} style={{ maxWidth: 380 }}>
            {path}
          </span>
        )}
      </div>
      <div className="logtail t-caption mono" ref={bottom}>
        {lines.length === 0 ? (
          <span className="muted">
            {inShell()
              ? 'Nothing written yet.'
              : 'The log is only readable from the desktop window.'}
          </span>
        ) : (
          lines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)
        )}
      </div>
    </div>
  );
}
