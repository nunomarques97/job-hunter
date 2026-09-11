/**
 * Interface primitives.
 *
 * Everything a screen is allowed to compose from. A screen that needs a shape
 * not in this file adds it here first, so a one-off style cannot drift away
 * from DESIGN.md.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { Icon, type IconName } from './Icon';
import { scoreBand } from '../lib/format';

/* ---------- Card ---------- */

export function Card({
  children,
  className = '',
  style,
  wash = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  wash?: boolean;
}) {
  return (
    <div className={`card ${wash ? 'wash' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
}

export function CardHead({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="card-head">
      {icon && <Icon name={icon} size={18} color="var(--text-secondary)" />}
      <div style={{ minWidth: 0 }}>
        <h2 className="t-h2 truncate">{title}</h2>
        {subtitle && <p className="t-small secondary truncate">{subtitle}</p>}
      </div>
      {action && <div style={{ marginLeft: 'auto', flex: 'none' }}>{action}</div>}
    </div>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  disabled,
  busy,
  title,
  type = 'button',
  style,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  style?: CSSProperties;
}) {
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  const iconOnly = !children && (icon || iconRight);
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${sizeClass} ${iconOnly ? 'btn-icon' : ''}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      aria-label={iconOnly ? title : undefined}
      style={style}
    >
      {busy ? (
        <Spinner size={size === 'sm' ? 12 : 14} />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />
      )}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="14 42"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

/* ---------- Badges ---------- */

export function Badge({
  children,
  color = 'var(--text-secondary)',
  background = 'var(--surface-3)',
  dot = false,
}: {
  children: ReactNode;
  color?: string;
  background?: string;
  dot?: boolean;
}) {
  return (
    <span className="badge" style={{ color, background }}>
      {dot && <span className="dot" style={{ background: color }} />}
      {children}
    </span>
  );
}

/** The match score. Colour always accompanies the number, never replaces it. */
export function ScorePill({ score, showLabel = false }: { score: number; showLabel?: boolean }) {
  const band = scoreBand(score);
  return (
    <span className="score" style={{ color: band.color, background: band.background }}>
      {Math.round(score)}
      {showLabel ? ` · ${band.label}` : '% match'}
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  if (!onClick) return <span className={`chip ${active ? 'on' : ''}`}>{children}</span>;
  return (
    <button type="button" className={`chip ${active ? 'on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------- States ---------- */

export function Skeleton({
  height = 16,
  width = '100%',
  radius = 6,
  style,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius, ...style }} />;
}

/** Skeleton rows matching the real row height and count, per DESIGN.md §9. */
export function SkeletonRows({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="col" style={{ gap: 1 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="row"
          style={{ gap: 12, padding: '0 20px', height, boxSizing: 'border-box' }}
        >
          <Skeleton height={34} width={34} radius={10} />
          <div className="col" style={{ gap: 6, flex: 1 }}>
            <Skeleton height={13} width={`${55 + ((index * 7) % 30)}%`} />
            <Skeleton height={11} width={`${30 + ((index * 11) % 25)}%`} />
          </div>
          <Skeleton height={24} width={64} radius={999} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} color="var(--text-muted)" className="icon" />
      <h3 className="t-h3">{title}</h3>
      <p className="t-small secondary" style={{ maxWidth: 380 }}>
        {body}
      </p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <Icon name="alert" size={32} color="var(--status-danger)" className="icon" />
      <h3 className="t-h3">That did not load</h3>
      <p className="t-small secondary" style={{ maxWidth: 420 }}>
        {message}
      </p>
      {onRetry && (
        <Button icon="refresh" onClick={onRetry} style={{ marginTop: 8 }}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({
  tone = 'info',
  icon,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success';
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  const fallback: Record<string, IconName> = {
    info: 'info',
    warn: 'alert',
    danger: 'alert',
    success: 'check',
  };
  return (
    <div className={`notice notice-${tone}`}>
      <Icon name={icon ?? fallback[tone]} size={16} style={{ marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
    </div>
  );
}

/* ---------- Forms ---------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="t-caption muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className="input"
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="textarea"
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      className="switch-row"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={`switch ${checked ? 'on' : ''}`} />
      <span style={{ minWidth: 0 }}>
        <span className="t-body" style={{ display: 'block' }}>
          {label}
        </span>
        {hint && <span className="t-caption muted">{hint}</span>}
      </span>
    </button>
  );
}

/** A list of short strings edited as chips. Used for skills, targets, exclusions. */
export function TagInput({
  values,
  onChange,
  placeholder = 'Type and press Enter',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const raw = inputRef.current?.value.trim();
    if (!raw) return;
    // Accept a pasted comma-separated list in one go.
    const additions = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item && !values.includes(item));
    if (additions.length) onChange([...values, ...additions]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="chip-group">
        {values.map((value) => (
          <span key={value} className="chip on">
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              title={`Remove ${value}`}
              style={{ display: 'flex', color: 'var(--text-muted)' }}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        {!values.length && <span className="t-caption muted">Nothing added yet.</span>}
      </div>
      <input
        ref={inputRef}
        className="input"
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/* ---------- Tabs ---------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="mono muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="t-h2 truncate">{title}</h2>
            {subtitle && <p className="t-small secondary truncate">{subtitle}</p>}
          </div>
          <Button variant="ghost" icon="close" onClick={onClose} title="Close" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Company mark ---------- */

export function CompanyMark({
  name,
  logoUrl,
  size = 34,
}: {
  name: string;
  logoUrl?: string;
  size?: number;
}) {
  const initials = (() => {
    const words = (name || '?').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  })();

  return (
    <span className="logo" style={{ width: size, height: size }} title={name}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          onError={(event) => {
            // Fall back to the monogram rather than showing a broken image.
            (event.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        initials
      )}
    </span>
  );
}

/* ---------- Progress bar ---------- */

export function Bar({
  value,
  max,
  color = 'var(--accent)',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const share = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${share}%`, background: color }} />
    </div>
  );
}
