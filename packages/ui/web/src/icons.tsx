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
export const Globe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Svg>
);
/** The Quiesco lockup (docs/logo/logo.svg): ring and wordmark in the text colour, the dot in Signal. */
export const Lockup = ({ className = 'lockup' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 221 52" role="img" aria-label="Quiesco" focusable="false">
    <g transform="translate(-6.29 -5.221) scale(1.07)">
      <path fill="currentColor" d="M38.525,49.552 A22.25 22.25 0 1 1 50.552,37.525 A8.89 8.89 0 0 0 43.615,36.918 A15.75 15.75 0 1 0 37.918,42.615 A8.89 8.89 0 0 0 38.525 49.552 Z" />
      <circle cx="46.371" cy="45.371" r="6.25" fill="var(--signal)" />
    </g>
    <path fill="currentColor" d="M87.58 44.06L87.58 14.14L83.18 14.14L83.05 17.62C81.78 15.02 79.31 13.61 75.97 13.61C69.10 13.61 65.94 19.25 65.94 25.80C65.94 32.36 69.10 37.99 75.97 37.99C79.14 37.99 81.51 36.71 82.83 34.29L82.83 44.06ZM70.91 25.80C70.91 21.62 72.76 17.71 77.11 17.71C81.42 17.71 83.27 21.67 83.27 25.80C83.27 29.94 81.42 33.90 77.11 33.90C72.71 33.90 70.91 29.98 70.91 25.80ZM110.99 37.46L110.99 14.14L106.28 14.14L106.28 27.69C106.28 31.79 104.17 33.99 100.87 33.99C97.75 33.99 96.56 31.79 96.56 27.69L96.56 14.14L91.81 14.14L91.81 29.15C91.81 34.25 94.49 37.99 99.64 37.99C102.63 37.99 105.32 36.71 106.55 33.72L106.59 37.46ZM115.52 14.14L115.52 37.46L120.28 37.46L120.28 14.14ZM115.44 10.71L120.36 10.71L120.36 6.22L115.44 6.22ZM123.93 25.80C123.93 33.24 128.33 37.99 135.06 37.99C139.81 37.99 143.90 35.22 145.31 30.77L140.38 30.42C139.42 32.62 137.35 33.94 135.06 33.94C131.41 33.94 129.21 31.43 128.94 27.17L145.62 27.17L145.62 25.63C145.36 17.31 140.60 13.61 135.06 13.61C128.33 13.61 123.93 18.37 123.93 25.80ZM128.99 23.60C129.52 19.86 131.67 17.66 135.06 17.66C137.66 17.66 140.08 19.20 140.65 23.60ZM162.91 21.49L167.80 21.23C167.00 16.56 163.13 13.61 158.07 13.61C152.26 13.61 148.57 16.39 148.57 20.96C148.57 25.45 152.84 26.77 157.76 27.83C160.27 28.40 163.22 28.66 163.22 31.17C163.22 33.33 160.58 34.03 158.56 34.03C155.34 34.03 153.32 32.40 152.88 29.81L148.00 30.11C148.35 35.00 152.62 37.99 158.60 37.99C163.53 37.99 168.15 35.97 168.15 31.39C168.15 26.81 164.41 25.23 158.60 24.17C156.22 23.73 153.54 22.90 153.50 20.79C153.45 18.76 155.34 17.57 157.72 17.57C160.10 17.57 162.43 19.03 162.91 21.49ZM186.98 22.33L191.91 22.06C191.29 16.83 186.80 13.61 181.61 13.61C174.88 13.61 170.48 18.37 170.48 25.80C170.48 33.24 174.88 37.99 181.61 37.99C186.98 37.99 191.38 34.60 192.08 29.15L187.11 28.88C186.63 32.09 184.38 33.90 181.61 33.90C177.65 33.90 175.41 30.86 175.41 25.80C175.41 20.74 177.65 17.71 181.61 17.71C184.25 17.71 186.54 19.42 186.98 22.33ZM205.11 37.99C211.84 37.99 216.24 33.24 216.24 25.80C216.24 18.37 211.84 13.61 205.11 13.61C198.38 13.61 193.98 18.37 193.98 25.80C193.98 33.24 198.38 37.99 205.11 37.99ZM198.90 25.80C198.90 20.74 201.15 17.71 205.11 17.71C209.07 17.71 211.31 20.74 211.31 25.80C211.31 30.86 209.07 33.90 205.11 33.90C201.15 33.90 198.90 30.86 198.90 25.80Z" />
  </svg>
);

/** A test's status as a tinted dot with its icon; the label is given by the caller (text / aria-label). */
export function StatusDot({ status, size = 18 }: { status: RowStatus; size?: number }) {
  const inner = Math.round(size * 0.58);
  if (status === 'running')
    return (
      <span className="dot" style={{ width: size, height: size, background: 'var(--accent-soft)' }}>
        <span className="pulse" style={{ width: Math.round(size * 0.44), height: Math.round(size * 0.44), borderRadius: 999, background: 'var(--accent)' }} />
      </span>
    );
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
