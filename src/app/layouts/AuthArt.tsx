import s from './AuthArt.module.css';

/**
 * The sign-in screen's picture: a live video interview with the things Acme tracks around it
 * (the schedule, a match score, hiring progress, the offer). Drawn as a vector so it stays
 * sharp at any size and weighs almost nothing.
 */
export function AuthArt() {
  return (
    <svg
      className={s.art}
      viewBox="0 0 620 520"
      role="img"
      aria-label="An interview in progress on a video call, with the interview time, a candidate match score, hiring progress and a sent offer"
      fontFamily="var(--font-sans)"
    >
      <defs>
        <linearGradient id="aa-win" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14419F" />
          <stop offset="1" stopColor="#0A2262" />
        </linearGradient>
        <linearGradient id="aa-tileA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
        <linearGradient id="aa-tileB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#1A3FA8" />
        </linearGradient>
        <linearGradient id="aa-offer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F7BFF" />
          <stop offset="1" stopColor="#0B4FD1" />
        </linearGradient>
        <radialGradient id="aa-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#9CC4FF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#9CC4FF" stopOpacity="0" />
        </radialGradient>
        <clipPath id="aa-clipA"><rect x="92" y="118" width="190" height="170" rx="14" /></clipPath>
        <clipPath id="aa-clipB"><rect x="294" y="118" width="164" height="170" rx="14" /></clipPath>
      </defs>

      {/* sparkles */}
      <g className={s.sparkle} stroke="#BBD6FF" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        <path d="M24 150v14M17 157h14" />
        <path d="M598 96v10M593 101h10" />
        <path d="M44 360v10M39 365h10" />
      </g>

      {/* the call window */}
      <g className={s.win}>
        <rect x="64" y="60" width="420" height="320" rx="24" fill="url(#aa-win)" stroke="#6EA4FF" strokeOpacity="0.35" />
        <circle cx="92" cy="88" r="4" fill="#fff" opacity="0.35" />
        <circle cx="108" cy="88" r="4" fill="#fff" opacity="0.35" />
        <circle cx="124" cy="88" r="4" fill="#fff" opacity="0.35" />
        <text x="148" y="92.5" fill="#fff" fontSize="12.5" fontWeight="600" opacity="0.92">Interview · Product Designer</text>
        <rect x="392" y="77" width="66" height="22" rx="11" fill="#34D399" fillOpacity="0.18" />
        <circle cx="406" cy="88" r="4" fill="#34D399" className={s.live} />
        <text x="416" y="92.3" fill="#C9F7E4" fontSize="11.5" fontWeight="600">24:18</text>

        {/* candidate */}
        <g clipPath="url(#aa-clipA)">
          <rect x="92" y="118" width="190" height="170" fill="url(#aa-tileA)" />
          <circle cx="187" cy="190" r="84" fill="url(#aa-glow)" />
          <circle cx="187" cy="190" r="48" fill="#DCE8FF" />
          <circle cx="187" cy="190" r="48" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="3" />
          <text x="187" y="201" textAnchor="middle" fill="#1D4ED8" fontSize="30" fontWeight="700">MC</text>
        </g>
        <rect x="92" y="118" width="190" height="170" rx="14" fill="none" stroke="#8EC1FF" strokeWidth="2.5" />
        <rect x="102" y="256" width="104" height="24" rx="12" fill="#06113A" fillOpacity="0.62" />
        <g className={s.wave} fill="#7CC0FF">
          <rect x="113" y="263" width="3" height="10" rx="1.5" />
          <rect x="119" y="260" width="3" height="16" rx="1.5" />
          <rect x="125" y="264" width="3" height="8" rx="1.5" />
        </g>
        <text x="136" y="272.3" fill="#fff" fontSize="11.5" fontWeight="600">Maya Chen</text>

        {/* interviewer */}
        <g clipPath="url(#aa-clipB)">
          <rect x="294" y="118" width="164" height="170" fill="url(#aa-tileB)" />
          <circle cx="376" cy="190" r="78" fill="url(#aa-glow)" opacity="0.8" />
          <circle cx="376" cy="190" r="44" fill="#CDEFE6" />
          <text x="376" y="200" textAnchor="middle" fill="#0F766E" fontSize="27" fontWeight="700">DR</text>
        </g>
        <rect x="304" y="256" width="108" height="24" rx="12" fill="#06113A" fillOpacity="0.62" />
        <circle cx="318" cy="268" r="3.5" fill="#fff" opacity="0.8" />
        <text x="327" y="272.3" fill="#fff" fontSize="11.5" fontWeight="600">Daniel Reyes</text>

        {/* controls */}
        <g fill="#fff" fillOpacity="0.14">
          <circle cx="167" cy="336" r="21" />
          <circle cx="219" cy="336" r="21" />
          <circle cx="271" cy="336" r="21" />
        </g>
        <g stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <rect x="163" y="324" width="8" height="14" rx="4" />
          <path d="M158 336a9 9 0 0 0 18 0M167 345v4" />
          <rect x="210" y="330" width="13" height="12" rx="3" />
          <path d="M223 334l6-3.5v11l-6-3.5z" />
          <rect x="262" y="328" width="18" height="13" rx="2.5" />
          <path d="M271 349v-3M266 349h10" />
        </g>
        <rect x="309" y="316" width="96" height="40" rx="20" fill="#EF4444" />
        <path d="M330 340c3-5 11-5 14 0l-3 2c-2-2-6-2-8 0z" fill="#fff" />
        <text x="352" y="341.3" fill="#fff" fontSize="13" fontWeight="700">End</text>
      </g>

      {/* floating card: the time */}
      <g className={s.f1}>
        <rect x="350" y="16" width="226" height="80" rx="18" fill="#fff" />
        <rect x="366" y="32" width="48" height="48" rx="13" fill="#E6F0FF" />
        <g stroke="#1A6BFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <rect x="378" y="44" width="24" height="23" rx="5" />
          <path d="M378 52h24M385 41v6M395 41v6" />
        </g>
        <circle cx="390" cy="60" r="2.4" fill="#1A6BFF" />
        <text x="428" y="52" fill="#0B1B3F" fontSize="14.5" fontWeight="700">Final interview</text>
        <text x="428" y="71" fill="#5B6284" fontSize="12.5" fontWeight="500">Today · 2:30 PM</text>
      </g>

      {/* floating card: match score */}
      <g className={s.f2}>
        <rect x="446" y="206" width="148" height="132" rx="20" fill="#fff" />
        <circle cx="520" cy="260" r="29" fill="none" stroke="#E3ECFF" strokeWidth="9" />
        <circle cx="520" cy="260" r="29" fill="none" stroke="#1A6BFF" strokeWidth="9" strokeLinecap="round" strokeDasharray="167.6 182.2" transform="rotate(-90 520 260)" />
        <text x="520" y="267" textAnchor="middle" fill="#0B1B3F" fontSize="21" fontWeight="800">92</text>
        <text x="520" y="315" textAnchor="middle" fill="#5B6284" fontSize="12" fontWeight="600">Match score</text>
        <rect x="486" y="322" width="68" height="0" />
      </g>

      {/* floating card: hiring progress */}
      <g className={s.f3}>
        <rect x="24" y="398" width="316" height="110" rx="20" fill="#fff" />
        <text x="46" y="428" fill="#0B1B3F" fontSize="13.5" fontWeight="700">Maya Chen · Product Designer</text>
        <path d="M62 458h86M148 458h84M232 458h46" stroke="#1A6BFF" strokeWidth="3" strokeLinecap="round" />
        <path d="M278 458h22" stroke="#D5E2FB" strokeWidth="3" strokeLinecap="round" />
        <g fill="#1A6BFF">
          <circle cx="62" cy="458" r="10" />
          <circle cx="148" cy="458" r="10" />
          <circle cx="232" cy="458" r="10" />
        </g>
        <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M57.5 458.5l3.2 3.2 6-6.4" />
          <path d="M143.5 458.5l3.2 3.2 6-6.4" />
        </g>
        <circle cx="232" cy="458" r="4" fill="#fff" />
        <circle cx="232" cy="458" r="15" fill="#1A6BFF" opacity="0.16" />
        <circle cx="300" cy="458" r="10" fill="#fff" stroke="#BCD0F5" strokeWidth="2.5" />
        <g fill="#5B6284" fontSize="11" fontWeight="600" textAnchor="middle">
          <text x="62" y="488">Applied</text>
          <text x="148" y="488">Screening</text>
          <text x="232" y="488">Interview</text>
          <text x="300" y="488">Offer</text>
        </g>
      </g>

      {/* floating card: the offer */}
      <g className={s.f4}>
        <rect x="360" y="400" width="214" height="70" rx="18" fill="url(#aa-offer)" />
        <circle cx="394" cy="435" r="17" fill="#fff" fillOpacity="0.2" />
        <path d="M386 435.5l6 6 11-12" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <text x="422" y="431" fill="#fff" fontSize="15" fontWeight="700">Offer sent</text>
        <text x="422" y="450" fill="#D6E6FF" fontSize="12" fontWeight="500">Waiting for Maya</text>
      </g>
    </svg>
  );
}
