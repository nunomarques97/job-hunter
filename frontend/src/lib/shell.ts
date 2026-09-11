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

/** What the shell knows about the backend process. */
export type BackendStatus =
  | { state: 'starting'; port: number }
  | { state: 'ready'; port: number }
  | { state: 'failed'; port: number; failure: StartFailure };

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
