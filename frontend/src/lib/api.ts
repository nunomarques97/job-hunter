/**
 * The API client.
 *
 * One place decides how a failure is described, so every screen shows the same
 * plain sentence rather than a stack trace or a status code. Nothing here
 * retries silently: a failed request surfaces, because a job list that quietly
 * shows stale data is worse than one that says it could not load.
 */
import type {
  Activity,
  Application,
  ApplicationDetail,
  AutomationConfig,
  AutomationRun,
  AutomationState,
  BoardColumn,
  Candidate,
  Completeness,
  Dashboard,
  DiscoveryResponse,
  DocumentDetail,
  DocumentSummary,
  EmailAccount,
  EmailMessage,
  EmailTemplate,
  Facets,
  FollowUp,
  Health,
  ImportPreview,
  Job,
  JobDetail,
  Overview,
  Page,
  SourceInfo,
} from './types';

/**
 * Where the backend lives.
 *
 * The dev server proxies `/api` to the backend, so a relative path is right
 * there. The packaged application serves the page from `tauri://localhost`,
 * where a relative path resolves against the bundle and never reaches the
 * backend, so it needs the absolute loopback address instead.
 *
 * The shell can override the port by setting `window.__JOB_HUNTER_API__`
 * before the bundle loads, which is what happens when the default port was
 * already taken.
 */
declare global {
  interface Window {
    __JOB_HUNTER_API__?: string;
  }
}

const DEFAULT_BACKEND = 'http://127.0.0.1:8756';

function resolveBase(): string {
  if (typeof window !== 'undefined' && window.__JOB_HUNTER_API__) {
    return `${window.__JOB_HUNTER_API__.replace(/\/$/, '')}/api`;
  }
  if (import.meta.env.DEV) return '/api';
  return `${DEFAULT_BACKEND}/api`;
}

const BASE = resolveBase();

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function describe(status: number, detail: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (Array.isArray(record) && record.length) {
      const first = record[0] as Record<string, unknown>;
      if (typeof first?.msg === 'string') return first.msg;
    }
  }
  if (status === 0) return 'The local backend is not responding. Is it running?';
  if (status === 404) return 'That item no longer exists.';
  if (status === 409) return 'That action conflicts with the current state.';
  if (status >= 500) return 'The local backend hit an error. The Activity log has the detail.';
  return `Request failed with status ${status}.`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(describe(0, null), 0, null);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail = (payload as { detail?: unknown } | null)?.detail ?? payload;
    throw new ApiError(describe(response.status, detail), response.status, detail);
  }
  return payload as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' });

/** Build a query string, dropping empty values so the URL stays readable. */
function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, String(item)));
    } else if (typeof value === 'boolean') {
      if (value) search.set(key, 'true');
    } else {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export interface JobQuery {
  q?: string;
  sources?: string[];
  companies?: string[];
  locations?: string[];
  remote_types?: string[];
  seniorities?: string[];
  technologies?: string[];
  min_score?: number;
  min_salary?: number;
  saved_only?: boolean;
  include_excluded?: boolean;
  include_duplicates?: boolean;
  sort?: string;
  direction?: string;
  page?: number;
  page_size?: number;
}

export const api = {
  health: () => get<Health>('/health'),
  info: () => get<Record<string, unknown>>('/info'),

  profile: {
    read: () => get<Candidate>('/profile/'),
    save: (candidate: Partial<Candidate>) => put<Candidate>('/profile/', candidate),
    completeness: () => get<Completeness>('/profile/completeness'),
    masterCv: () => get<{ content: string }>('/profile/master-cv'),
    saveMasterCv: () => post<{ message: string }>('/profile/master-cv'),
    importText: (text: string) => post<ImportPreview>('/profile/import/text', { text }),
    importFile: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${BASE}/profile/import`, { method: 'POST', body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new ApiError(
          describe(response.status, (payload as { detail?: unknown })?.detail),
          response.status,
          payload,
        );
      }
      return payload as ImportPreview;
    },
  },

  jobs: {
    search: (params: JobQuery) => get<Page<Job>>(`/jobs/${query(params as Record<string, unknown>)}`),
    detail: (id: number) => get<JobDetail>(`/jobs/${id}`),
    facets: () => get<Facets>('/jobs/facets'),
    sources: () => get<SourceInfo[]>('/jobs/sources'),
    discover: (body: {
      sources?: string[];
      terms?: string[];
      locations?: string[];
      remote_only?: boolean;
      greenhouse_boards?: string[];
      lever_boards?: string[];
    }) => post<DiscoveryResponse>('/jobs/discover', body),
    rescore: (id: number, useModel = true) =>
      post<JobDetail>(`/jobs/${id}/score?use_model=${useModel}`),
    save: (id: number, saved: boolean) =>
      post<{ message: string }>(`/jobs/${id}/save?saved=${saved}`),
    excludeCompany: (id: number) => post<{ message: string }>(`/jobs/${id}/exclude-company`),
  },

  applications: {
    list: (params: { stage?: string; page?: number; page_size?: number } = {}) =>
      get<Page<Application>>(`/applications/${query(params)}`),
    board: () => get<{ columns: BoardColumn[]; total: number }>('/applications/board'),
    detail: (id: number) => get<ApplicationDetail>(`/applications/${id}`),
    createFromJob: (jobId: number) => post<ApplicationDetail>(`/applications/from-job/${jobId}`),
    prepare: (jobId: number, regenerate = false) =>
      post<{ application: ApplicationDetail; blocked_reason: string }>(
        `/applications/${jobId}/prepare`,
        { regenerate },
      ),
    setStage: (id: number, stage: string, reason = '', boardPosition?: number) =>
      patch<ApplicationDetail>(`/applications/${id}/stage`, {
        stage,
        reason,
        board_position: boardPosition,
      }),
    update: (id: number, body: Record<string, unknown>) =>
      patch<ApplicationDetail>(`/applications/${id}`, body),
    archive: (id: number) => del<{ message: string }>(`/applications/${id}`),
  },

  documents: {
    list: (params: { kind?: string; job_id?: number; current_only?: boolean } = {}) =>
      get<Page<DocumentSummary>>(`/documents/${query(params)}`),
    detail: (id: number) => get<DocumentDetail>(`/documents/${id}`),
    versions: (id: number) => get<DocumentSummary[]>(`/documents/${id}/versions`),
    restore: (id: number) => post<DocumentDetail>(`/documents/${id}/restore`),
    edit: (id: number, content: string) => patch<DocumentDetail>(`/documents/${id}`, { content }),
    generateCv: (jobId: number) => post<DocumentDetail>(`/documents/generate/cv/${jobId}`),
    generateCoverLetter: (jobId: number) =>
      post<DocumentDetail>(`/documents/generate/cover-letter/${jobId}`),
    exportUrl: (id: number, fmt: 'md' | 'txt' | 'html') =>
      `${BASE}/documents/${id}/export?fmt=${fmt}`,
    remove: (id: number) => del<{ message: string }>(`/documents/${id}`),
  },

  automation: {
    state: () => get<AutomationState>('/automation/state'),
    stages: () => get<string[]>('/automation/stages'),
    config: () => get<AutomationConfig>('/automation/config'),
    saveConfig: (body: Partial<AutomationConfig>) =>
      put<AutomationConfig>('/automation/config', body),
    run: () => post<AutomationState>('/automation/run'),
    start: () => post<AutomationState>('/automation/start'),
    pause: () => post<AutomationState>('/automation/pause'),
    resume: () => post<AutomationState>('/automation/resume'),
    stop: () => post<AutomationState>('/automation/stop'),
    emergencyStop: (engage: boolean) =>
      post<AutomationState>(`/automation/emergency-stop?engage=${engage}`),
    runs: () => get<Page<AutomationRun>>('/automation/runs'),
  },

  analytics: {
    dashboard: () => get<Dashboard>('/analytics/dashboard'),
    overview: () => get<Overview>('/analytics/overview'),
    pipeline: () => get<{ stage: string; count: number }[]>('/analytics/pipeline'),
    daily: (days = 30) => get<{ date: string; jobs: number; applications: number }[]>(
      `/analytics/daily?days=${days}`,
    ),
    sources: () =>
      get<
        {
          source: string;
          jobs: number;
          average_score: number | null;
          applications: number;
          submitted: number;
        }[]
      >(
        '/analytics/sources',
      ),
    funnel: () => get<{ stage: string; count: number; share: number }[]>('/analytics/funnel'),
    geography: () => get<{ country: string; count: number }[]>('/analytics/geography'),
    salary: () =>
      get<{ count: number; min: number; p25: number; median: number; p75: number; max: number }>(
        '/analytics/salary',
      ),
    technologies: () => get<{ technology: string; count: number }[]>('/analytics/technologies'),
    activity: (params: { level?: string; event?: string; limit?: number } = {}) =>
      get<Activity[]>(`/analytics/activity${query(params)}`),
  },

  email: {
    accounts: () => get<EmailAccount[]>('/email/accounts'),
    createAccount: (body: Record<string, unknown>) =>
      post<{ id: number; message: string }>('/email/accounts', body),
    deleteAccount: (id: number) => del<{ message: string }>(`/email/accounts/${id}`),
    messages: (folder: string) => get<Page<EmailMessage>>(`/email/messages?folder=${folder}`),
    createDraft: (body: Record<string, unknown>) =>
      post<{ id: number; message: string }>('/email/drafts', body),
    sendDraft: (id: number) => post<{ message: string }>(`/email/drafts/${id}/send`),
    templates: () => get<EmailTemplate[]>('/email/templates'),
    createTemplate: (body: Record<string, unknown>) =>
      post<{ id: number; message: string }>('/email/templates', body),
    followUps: () => get<FollowUp[]>('/email/follow-ups'),
  },
};
