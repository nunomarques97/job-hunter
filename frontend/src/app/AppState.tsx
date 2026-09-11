/**
 * Application state shared across screens: the current view, the toast queue and
 * the backend health banner.
 *
 * A hand-written store rather than a routing and state library. The app is ten
 * views inside one window, and the only routing it needs is a location hash: it
 * reopens where the user left off, and the window's back gesture steps between
 * views. A full router would add a dependency for nothing else.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { IconName } from '../components/Icon';

export type ViewId =
  | 'dashboard'
  | 'jobs'
  | 'applications'
  | 'documents'
  | 'automation'
  | 'analytics'
  | 'email'
  | 'profile'
  | 'activity'
  | 'settings'
  | 'diagnostics';

export interface NavItem {
  id: ViewId;
  label: string;
  icon: IconName;
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'jobs', label: 'Job Search', icon: 'search' },
  { id: 'applications', label: 'Applications', icon: 'applications' },
  { id: 'documents', label: 'CV & Cover Letter', icon: 'documents' },
  { id: 'automation', label: 'Automation', icon: 'automation' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warn' | 'danger';
  message: string;
}

/** Everything a screen can ask of the shell. */
interface AppContextValue {
  view: ViewId;
  /** Set when a screen is opened pointing at one record, such as a job id. */
  focus: number | null;
  navigate: (view: ViewId, focus?: number | null) => void;
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
  /** Bumped whenever something changed that other screens should re-read. */
  revision: number;
  invalidate: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Diagnostics is a real view with its own location, reached from Settings and
 * from the startup screen, but it is deliberately not in the rail: it is a
 * screen for when something is wrong, not the eleventh thing to do every day.
 */
const OFF_RAIL: ViewId[] = ['diagnostics'];

/** Which rail item is highlighted for a view that has no rail item of its own. */
export const RAIL_PARENT: Partial<Record<ViewId, ViewId>> = { diagnostics: 'settings' };

const VIEW_IDS = new Set<string>([...NAV.map((item) => item.id), ...OFF_RAIL]);

/** The view named in the location hash, so the window reopens where it was left
 *  and a screen can be linked to directly. */
function viewFromHash(): ViewId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return VIEW_IDS.has(raw) ? (raw as ViewId) : 'dashboard';
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>(viewFromHash);
  const [focus, setFocus] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [revision, setRevision] = useState(0);

  const navigate = useCallback((next: ViewId, nextFocus: number | null = null) => {
    setView(next);
    setFocus(nextFocus);
    if (viewFromHash() !== next) window.location.hash = `/${next}`;
    // A view change resets the page scroll; otherwise the new screen opens
    // halfway down where the previous one was left.
    document.querySelector('.page')?.scrollTo({ top: 0 });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, message }]);
      // Errors stay until dismissed; everything else clears itself.
      if (tone !== 'danger') {
        window.setTimeout(() => dismiss(id), 4200);
      }
    },
    [dismiss],
  );

  // The window's back and forward gestures move between views.
  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const invalidate = useCallback(() => setRevision((value) => value + 1), []);

  const value = useMemo(
    () => ({ view, focus, navigate, toasts, notify, dismiss, revision, invalidate }),
    [view, focus, navigate, toasts, notify, dismiss, revision, invalidate],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppStateProvider.');
  return context;
}
