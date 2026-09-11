/**
 * The icon set.
 *
 * Drawn here rather than pulled from a package: the product needs about thirty
 * glyphs, and shipping them inline keeps the bundle free of an icon dependency
 * and guarantees every glyph obeys DESIGN.md section 7 — 24px grid, 1.5px
 * stroke, round caps and joins, no fills.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'dashboard'
  | 'search'
  | 'applications'
  | 'documents'
  | 'automation'
  | 'analytics'
  | 'mail'
  | 'profile'
  | 'activity'
  | 'settings'
  | 'briefcase'
  | 'target'
  | 'sparkle'
  | 'play'
  | 'pause'
  | 'stop'
  | 'refresh'
  | 'plus'
  | 'check'
  | 'close'
  | 'alert'
  | 'info'
  | 'chevronRight'
  | 'chevronDown'
  | 'chevronLeft'
  | 'arrowUp'
  | 'arrowDown'
  | 'external'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'download'
  | 'edit'
  | 'trash'
  | 'filter'
  | 'pin'
  | 'clock'
  | 'building'
  | 'users'
  | 'trending'
  | 'inbox'
  | 'send'
  | 'file'
  | 'layers'
  | 'sliders'
  | 'upload'
  | 'eye'
  | 'copy'
  | 'history'
  | 'shield'
  | 'zap';

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5Z',
  search: 'M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM21 21l-4.35-4.35',
  applications: 'M8 3h8l1 4H7l1-4ZM5 7h14v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7ZM9 12h6M9 16h4',
  documents: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4ZM14 3v4h4M9 13h6M9 17h4',
  automation:
    'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Z',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  mail: 'M3 6h18v12H3V6ZM3 7l9 6 9-6',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
  briefcase: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8ZM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M3 13h18',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  play: 'M7 4.5 19 12 7 19.5v-15Z',
  pause: 'M9 4v16M15 4v16',
  stop: 'M6 6h12v12H6z',
  refresh: 'M3 12a9 9 0 0 1 15.3-6.4L21 8M21 4v4h-4M21 12a9 9 0 0 1-15.3 6.4L3 16M3 20v-4h4',
  plus: 'M12 5v14M5 12h14',
  check: 'M4 12.5 9 17.5 20 6.5',
  close: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 3 2.5 20h19L12 3ZM12 10v4M12 17.5v.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.5v.01',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  chevronLeft: 'M15 5l-7 7 7 7',
  arrowUp: 'M12 20V4M5 11l7-7 7 7',
  arrowDown: 'M12 4v16M5 13l7 7 7-7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  bookmark: 'M6 3h12v18l-6-4.5L6 21V3Z',
  bookmarkFilled: 'M6 3h12v18l-6-4.5L6 21V3Z',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16',
  edit: 'M16 3.5 20.5 8 8 20.5H3.5V16L16 3.5ZM13.5 6 18 10.5',
  trash: 'M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v8M14 10v8',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  pin: 'M12 21v-7M8.5 3h7l-1 6 3 3H6.5l3-3-1-6Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5.5l3.5 2',
  building: 'M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 10h4a1 1 0 0 1 1 1v10M8 7h3M8 11h3M8 15h3M2 21h20',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20a7 7 0 0 1 14 0M16.5 4.4a3.5 3.5 0 0 1 0 6.7M18 20a6.5 6.5 0 0 0-2-4.7',
  trending: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  inbox: 'M3 13h5l2 3h4l2-3h5M3 13 5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z',
  send: 'M21 3 3 10.5l7 3 3 7L21 3ZM10 14l4-4',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4ZM14 3v4h4',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5 12 22l9-4.5',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 3.5v5M8 9.5v5M16 15v5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  copy: 'M9 9h11v11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  history: 'M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4M12 7.5V12l3 2',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8.1-8 9-4.8-.9-8-4.5-8-9V6l8-3ZM9 12l2 2 4-4',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
  strokeWidth?: number;
  /** Native tooltip. An icon that is the only content of a control needs one. */
  title?: string;
}

export function Icon({
  name,
  size = 16,
  color = 'currentColor',
  style,
  className,
  strokeWidth = 1.5,
  title,
}: IconProps) {
  const path = PATHS[name] ?? PATHS.info;
  const filled = name === 'bookmarkFilled' || name === 'play' || name === 'stop';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none', ...style }}
      className={className}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={path} />
    </svg>
  );
}
