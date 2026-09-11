/** Data loading and small shared behaviours.
 *
 * A hand-written loader rather than a data library: a desktop app with one
 * backend on localhost does not need a cache layer, and this keeps the
 * loading, error and stale states explicit, which is what DESIGN.md section 9
 * requires every screen to render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True while refetching with data already on screen, so the interface can
   *  keep showing the old rows rather than flashing a skeleton. */
  refreshing: boolean;
  reload: () => void;
  setData: (value: T | null) => void;
}

export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  const hasData = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    setError(null);

    loader()
      .then((value) => {
        if (cancelled || !mounted.current) return;
        setData(value);
        hasData.current = true;
      })
      .catch((exception: unknown) => {
        if (cancelled || !mounted.current) return;
        setError(exception instanceof ApiError ? exception.message : String(exception));
      })
      .finally(() => {
        if (cancelled || !mounted.current) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading, refreshing, reload, setData };
}

/** Delay a rapidly changing value, for search-as-you-type. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Poll while a condition holds. Used for a running automation pipeline. */
export function usePolling(callback: () => void, intervalMs: number, active: boolean): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => saved.current(), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
}

/** Count a number up once, for the dashboard's signature moment. */
export function useCountUp(target: number, durationMs = 420): number {
  const [value, setValue] = useState(target);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) {
      setValue(target);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || target === 0) {
      setValue(target);
      done.current = true;
      return;
    }
    done.current = true;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      // Ease out, so the number decelerates into place rather than snapping.
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}

export function useKeyboardShortcut(
  match: (event: KeyboardEvent) => boolean,
  handler: () => void,
): void {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (match(event)) {
        event.preventDefault();
        saved.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
