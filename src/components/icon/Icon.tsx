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

/** The Acme logo. `size` is its height; it is wider than tall (about 1.4 : 1), so the width follows. */
export const BRAND_LOGO_RATIO = 1.404;
export function BrandMark({ size = 32, label = 'Acme logo', src = '/logo.webp' }: { size?: number; label?: string; src?: string }) {
  return (
    <img
      src={src}
      width={Math.round(size * BRAND_LOGO_RATIO)}
      height={size}
      alt={label}
      decoding="async"
      draggable={false}
      style={{ flex: 'none', display: 'block', width: 'auto', height: size }}
    />
  );
}
