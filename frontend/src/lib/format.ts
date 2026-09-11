/** Formatting helpers.
 *
 * Numbers the user reads are formatted in one place so a salary, a score and a
 * count never disagree about their shape between two screens.
 */

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
};

/** A salary range, or an honest blank when the posting did not state one. */
export function salary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string,
): string {
  if (!min && !max) return '';
  const symbol = CURRENCY_SYMBOL[currency] ?? (currency ? `${currency} ` : '');
  const short = (value: number) =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));
  if (min && max && min !== max) return `${symbol}${short(min)}–${symbol}${short(max)}`;
  return `${symbol}${short((max ?? min) as number)}`;
}

export function number(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-GB');
}

export function percent(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

/** Relative time, in the terms a job hunter actually thinks in. */
export function relative(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return plural(months, 'month');
  return plural(Math.round(months / 12), 'year');
}

/** "1 month ago", not "1 months ago". */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The colour band a match score falls in, per DESIGN.md. */
export function scoreBand(score: number): {
  color: string;
  background: string;
  label: string;
} {
  if (score >= 85)
    return { color: 'var(--status-success)', background: 'var(--status-success-bg)', label: 'Strong' };
  if (score >= 70)
    return { color: 'var(--status-info)', background: 'var(--status-info-bg)', label: 'Good' };
  if (score >= 55)
    return { color: 'var(--status-warn)', background: 'var(--status-warn-bg)', label: 'Fair' };
  return { color: 'var(--score-weak)', background: 'var(--status-neutral-bg)', label: 'Weak' };
}

export const STAGE_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  eligible: 'Eligible',
  ready: 'Ready',
  prepared: 'Prepared',
  submitted: 'Submitted',
  follow_up: 'Follow up',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  closed: 'Closed',
  action_required: 'Action required',
};

export const STAGE_COLORS: Record<string, { color: string; background: string }> = {
  discovered: { color: 'var(--status-pipeline)', background: 'var(--status-pipeline-bg)' },
  eligible: { color: 'var(--status-pipeline)', background: 'var(--status-pipeline-bg)' },
  ready: { color: 'var(--status-info)', background: 'var(--status-info-bg)' },
  prepared: { color: 'var(--status-info)', background: 'var(--status-info-bg)' },
  submitted: { color: 'var(--status-info)', background: 'var(--status-info-bg)' },
  follow_up: { color: 'var(--status-warn)', background: 'var(--status-warn-bg)' },
  interview: { color: 'var(--status-success)', background: 'var(--status-success-bg)' },
  offer: { color: 'var(--status-success)', background: 'var(--status-success-bg)' },
  rejected: { color: 'var(--status-danger)', background: 'var(--status-danger-bg)' },
  closed: { color: 'var(--status-neutral)', background: 'var(--status-neutral-bg)' },
  action_required: { color: 'var(--status-warn)', background: 'var(--status-warn-bg)' },
};

export const REMOTE_LABELS: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On site',
  unknown: 'Not stated',
};

export const SENIORITY_LABELS: Record<string, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  principal: 'Principal',
  executive: 'Executive',
  unknown: 'Not stated',
};

export const RECOMMENDATION_LABELS: Record<string, string> = {
  strong_apply: 'Strong match',
  apply: 'Worth applying',
  maybe: 'Borderline',
  skip: 'Poor fit',
};

/** Initials for the company monogram used when a source gives no logo. */
export function monogram(name: string): string {
  const words = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
