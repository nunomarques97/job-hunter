/**
 * Whether the backend is answering, and what the window shows while it is not.
 *
 * The window is on screen within a second of launch, so something has to be
 * there before the service is. This decides what: one card saying what is
 * happening while it is still plausibly on its way, and the diagnostic panel
 * once waiting has turned into a problem — the shell reported a failure, or
 * twenty seconds passed with no answer. The panel is the screen for a backend
 * that is not there, and there is no reason to show anything less complete just
 * because the app has not opened yet.
 *
 * What it no longer does is draw its own chrome. It used to render a skeleton
 * rail, a skeleton search field and no footer, which is the loading state of a
 * window whose labels are static text and never needed the backend at all. The
 * real shell renders in every state now and is told the condition instead, so
 * the rail says which screens cannot open and why, and Settings and the panel
 * stay reachable with the mouse.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Card, CardHead, Notice, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { Shell } from '../app/Shell';
import { backendStatus, type StartFailure } from '../lib/shell';
import { DiagnosticsView } from './DiagnosticsView';

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

export function StartupView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [elapsed, setElapsed] = useState(0);

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

  const retry = () => {
    misses.current = 0;
    began.current = Date.now();
    setElapsed(0);
    setPhase({ kind: 'waiting' });
    void check();
  };

  if (ready) return <Shell />;

  // The same shell, told what is wrong with it. The condition is one sentence
  // because it is read in three places — the rail, the footer and the tooltip
  // on every screen that cannot open — and they must not word it three ways.
  const starting = phase.kind === 'waiting';
  const condition = starting
    ? 'The local service is still starting.'
    : 'The local service is not running.';
  const short = starting ? 'Service starting' : 'Service not running';

  const page: ReactNode = starting ? (
    <div className="page-inner">
      <WaitingCard elapsed={elapsed} />
    </div>
  ) : (
    // Failed, or twenty seconds with no answer. Either way the question has
    // stopped being "is it nearly there" and started being "what is wrong",
    // which is the panel's question.
    <DiagnosticsView onRecheck={retry} />
  );

  return <Shell offline={{ condition, short, page }} />;
}

function WaitingCard({ elapsed }: { elapsed: number }) {
  return (
    <Card wash style={{ maxWidth: 720 }}>
      <CardHead
        icon="zap"
        title="Starting the local service…"
        subtitle="Job Hunter keeps everything on this machine. The window opens first; the service follows."
        action={<Elapsed seconds={elapsed} />}
      />
      <div className="card-body col" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <Spinner size={16} />
          <span className="t-small secondary">Waiting for the service to answer.</span>
        </div>
        <Notice tone="info">
          If it has not answered in twenty seconds this screen turns into Diagnostics, which says
          what it was looking for and where.
        </Notice>
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
