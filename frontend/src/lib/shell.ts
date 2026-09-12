/**
 * The desktop shell's side of the window.
 *
 * The renderer has no Tauri npm package, by the same rule that keeps the rest
 * of its dependencies to React alone. `withGlobalTauri` puts the invoke bridge
 * on `window` instead, and everything below goes through this one module so a
 * screen never reaches for a global itself.
 *
 * Every call answers `null` when the page is open in a browser rather than in
 * the shell, which is what `npm run dev:frontend` does. A screen that asks for
 * shell information degrades to what the API alone can tell it.
 */

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: Invoke } };
  }
}

/**
 * Where the running backend came from.
 *
 * `spawned` is a child this shell owns. `adopted` is a backend that was already
 * listening when the window opened, which the shell attached to and does not
 * own: it survives the window, cannot be restarted, and its output goes
 * wherever it was started from rather than into the shell's log file. The
 * diagnostic panel has to say which of the two it is looking at.
 */
export type Provenance = 'pending' | 'spawned' | 'adopted';

/** The interpreter and backend package the shell resolved as a pair. */
export interface Resolved {
  interpreter: string;
  package: string;
  /** False for an adopted backend: this is the pair the shell *would* have
   *  used, not the one that is running. */
  in_use: boolean;
}

/**
 * Where an adopted backend was running from, asked of it while it still
 * answered.
 *
 * A process this window did not start leaves nothing behind when it stops. This
 * is the only record of it, and it is what the panel has to show instead of
 * offering a restart it cannot perform.
 */
export interface Origin {
  /** The address this window attached to. */
  address: string;
  /** The interpreter the service reported as its own, if it answered. */
  interpreter: string | null;
  /** The data directory it reported as its own, if it answered. */
  data_dir: string | null;
}

/** The one automatic restart, once it has been used. */
export interface Restart {
  /** The UTC stamp the log file uses. */
  at: string;
  /** The failed poll that caused it. */
  reason: string;
}

/**
 * What supervision is doing, and what it is still able to do.
 *
 * Rendered rather than inferred. One restart is a rule about a window session,
 * so a screen that implies another one is coming — or that offers a restart for
 * a process this window never started — would be saying something untrue on the
 * one screen that must not.
 */
export interface Supervision {
  watching: boolean;
  poll_seconds: number;
  /** False for an adopted backend: this window has no handle to restart. */
  can_restart: boolean;
  /** The restart, once spent. `null` means it is still available. */
  restart: Restart | null;
}

/** Facts every backend state carries, whatever the state is. */
interface BackendFacts {
  port: number;
  provenance: Provenance;
  /** Whether this backend's output reaches the shell's log file. False for an
   *  adopted process, which is why its log tail can be empty while it is
   *  perfectly healthy. */
  logs_captured: boolean;
  resolved: Resolved | null;
  origin: Origin | null;
  supervision: Supervision;
  /** When this window opened, in the log file's own UTC stamp. The panel uses
   *  it to say which log lines were written before this launch. */
  launched_at: string;
}

/** What the shell knows about the backend process. */
export type BackendStatus =
  | ({ state: 'starting' } & BackendFacts)
  | ({ state: 'ready' } & BackendFacts)
  | ({ state: 'failed'; failure: StartFailure } & BackendFacts);

/**
 * A failure as the shell describes it.
 *
 * The wording is decided in Rust and rendered here unchanged, so the sentence
 * in the window is the sentence in the log.
 */
export interface StartFailure {
  kind: string;
  summary: string;
  remedy: string;
  probed: string[];
}

export interface LogTail {
  path: string;
  lines: string[];
}

function invoker(): Invoke | null {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core?.invoke ?? null;
}

/** True when the page is running inside the desktop shell. */
export const inShell = (): boolean => invoker() !== null;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  const invoke = invoker();
  if (!invoke) return null;
  try {
    return (await invoke(command, args)) as T;
  } catch {
    // A command that fails tells us nothing the caller can act on, and the
    // shell has already written the detail to the log.
    return null;
  }
}

export function backendStatus(): Promise<BackendStatus | null> {
  return call<BackendStatus>('backend_status');
}

export function backendLogTail(count = 60): Promise<LogTail | null> {
  return call<LogTail>('backend_log_tail', { count });
}

/**
 * Open the log directory in the file manager.
 *
 * Resolves to the path that was opened, or `null` outside the desktop window
 * and when the shell could not open it — the caller says so rather than
 * claiming a folder appeared.
 */
export function openLogFolder(): Promise<string | null> {
  return call<string>('open_log_folder');
}
