import { BrandMark } from '@/components/icon/Icon';
import s from './BrandLockup.module.css';

/** The wordmark image is 4.71 : 1; it sits at 0.68 of the cube's height, as in the Strtm logo lockup. */
const WORD_RATIO = 4.709;
const WORD_SCALE = 0.684;

/**
 * The full Strtm logo: cube, "Strtm" wordmark, and the tagline beneath it.
 * `size` is the cube's height; everything else scales from it.
 * `tone="auto"` follows the theme (navy wordmark on light, a light copy on dark);
 * `tone="onDark"` always uses the light copy, for panels that stay dark in both themes.
 * The tagline is live text so it stays legible at small sizes.
 * `hoverLine` (the signed-in role, in the sidebar) replaces the tagline while the logo is hovered.
 */
export function BrandLockup({ size = 38, tone = 'auto', tagline = true, hoverLine }: { size?: number; tone?: 'auto' | 'onDark'; tagline?: boolean; hoverLine?: string }) {
  const wordH = Math.round(size * WORD_SCALE);
  const wordW = Math.round(wordH * WORD_RATIO);
  const swap = tagline && Boolean(hoverLine);
  return (
    <span className={swap ? `${s.lockup} ${s.swap}` : s.lockup} style={{ gap: Math.round(size * 0.26) }}>
      <BrandMark size={size} label="" />
      <span className={s.text} style={{ width: wordW, gap: Math.max(2, Math.round(size * 0.1)) }}>
        {tone === 'onDark' ? (
          <img className={s.word} src="/logo-wordmark-light.webp" width={wordW} height={wordH} alt="Strtm" draggable={false} />
        ) : (
          <>
            <img className={`${s.word} ${s.onLight}`} src="/logo-wordmark.webp" width={wordW} height={wordH} alt="Strtm" draggable={false} />
            <img className={`${s.word} ${s.onDark}`} src="/logo-wordmark-light.webp" width={wordW} height={wordH} alt="" aria-hidden="true" draggable={false} />
          </>
        )}
        {tagline ? (
          <span className={s.lines} style={{ fontSize: size * 0.2237 }}>
            <span className={`${s.tagline} ${s.line}`}>The Adaptive Business OS</span>
            {/* Also shown in the account menu, so screen readers hear it there rather than twice. */}
            {swap ? <span className={`${s.tagline} ${s.line} ${s.hoverLine}`} aria-hidden="true">{hoverLine}</span> : null}
          </span>
        ) : null}
      </span>
    </span>
  );
}
