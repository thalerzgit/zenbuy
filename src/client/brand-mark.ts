/** Inline brand mark — clear ascending “up and to the right” chart for dark header. */
export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
  <defs>
    <linearGradient id="zb-bar" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="zb-peak" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#3d862d"/>
      <stop offset="100%" stop-color="#6fbf5c"/>
    </linearGradient>
    <linearGradient id="zb-line" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="70%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e8c547"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.88)" stroke-width="2"/>
  <!-- baseline -->
  <path d="M14 48 H50" stroke="rgba(255,255,255,0.22)" stroke-width="1.5" stroke-linecap="round"/>
  <!-- ascending bars (LL → UR) -->
  <rect x="15" y="40" width="5.5" height="8" rx="1.4" fill="url(#zb-bar)" opacity="0.55"/>
  <rect x="23" y="34" width="5.5" height="14" rx="1.4" fill="url(#zb-bar)" opacity="0.7"/>
  <rect x="31" y="27" width="5.5" height="21" rx="1.4" fill="url(#zb-bar)" opacity="0.85"/>
  <rect x="39" y="20" width="5.5" height="28" rx="1.4" fill="#ffffff"/>
  <rect x="47" y="13" width="5.5" height="35" rx="1.4" fill="url(#zb-peak)"/>
  <!-- trend line up-and-right -->
  <path d="M17.5 42.5 L25.5 36.5 L33.5 29.5 L41.5 22.5 L49.5 15.5" fill="none" stroke="url(#zb-line)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- peak spark (restrained) -->
  <circle cx="49.5" cy="15.5" r="2.2" fill="#e8c547"/>
  <path d="M49.5 11.2 V13.2 M49.5 17.8 V19.8 M45.2 15.5 H47.2 M51.8 15.5 H53.8" stroke="#e8c547" stroke-width="1.2" stroke-linecap="round" opacity="0.9"/>
</svg>`;
