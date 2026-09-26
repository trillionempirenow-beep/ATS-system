import type { CSSProperties } from 'react';
import { ICONS, type IconName } from './icons';

export type { IconName };

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Set only when the icon carries meaning on its own. */
  label?: string;
}

export function Icon({ name, size = 18, className, style, label }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none', ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export function BrandMark({ size = 32, label = 'Acme logo' }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label} style={{ flex: 'none' }}>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M9 23 16 8l7 15M11.9 18h8.2" fill="none" stroke="var(--primary-fg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
