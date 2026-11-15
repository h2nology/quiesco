/** Line icons (Lucide-style, inline SVG: no icon font, no network). Decorative: aria-hidden. */
import type { ReactNode } from 'react';

import type { RowStatus } from './model';

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function Svg({ size = 16, className, strokeWidth = 2, children, fill = 'none' }: IconProps & { children: ReactNode; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} focusable="false">
      {children}
    </svg>
  );
}

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);
export const X = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const Skip = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 5 7 7-7 7M14 5v14" />
  </Svg>
);
export const Spinner = (p: IconProps) => (
  <Svg {...p} className={`spin ${p.className ?? ''}`}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
);
export const Dashed = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
  </Svg>
);
export const Play = (p: IconProps) => (
  <Svg {...p} fill="currentColor" strokeWidth={0}>
    <path d="M7 4v16l13-8z" />
  </Svg>
);
export const Stop = (p: IconProps) => (
  <Svg {...p} fill="currentColor" strokeWidth={0}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </Svg>
);
export const Moon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </Svg>
);
export const Sun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const Chevron = ({ open, ...p }: IconProps & { open: boolean }) => (
  <Svg {...p}>
    <path d={open ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} />
  </Svg>
);
export const Device = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
export const Rerun = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);
export const Alert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.5" />
  </Svg>
);
export const Refresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
);
export const Logo = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.5}>
    <path d="M5 12h14M5 7h9M5 17h6" />
  </Svg>
);

/** A test's status as a tinted dot with its icon; the label is given by the caller (text / aria-label). */
export function StatusDot({ status, size = 18 }: { status: RowStatus; size?: number }) {
  const inner = Math.round(size * 0.58);
  if (status === 'running') return <Spinner size={size} strokeWidth={2.5} className="accent" />;
  if (status === 'queued' || status === 'idle' || status === 'notRun')
    return (
      <span className="faint" style={{ display: 'inline-flex' }}>
        <Dashed size={size} />
      </span>
    );
  const [bg, fg, icon] =
    status === 'passed'
      ? ['var(--passed-soft)', 'var(--passed)', <Check key="i" size={inner} strokeWidth={3.5} />]
      : status === 'failed'
        ? ['var(--failed-soft)', 'var(--failed)', <X key="i" size={inner} strokeWidth={3.5} />]
        : ['var(--skipped-soft)', 'var(--skipped)', <Skip key="i" size={inner} strokeWidth={3.5} />];
  return (
    <span className="dot" style={{ width: size, height: size, background: bg, color: fg }}>
      {icon}
    </span>
  );
}
