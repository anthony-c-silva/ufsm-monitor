import React, { useId } from "react";

// Marca do SONDAR: varredura de radar com sondas distribuídas nos anéis.
export function LogoMark({ size = 28 }) {
  const id = "sg" + useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3d8bfd" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#101826" stroke={`url(#${id})`} strokeWidth="1.5" />
      <circle cx="16" cy="16" r="11" stroke={`url(#${id})`} strokeWidth="1.3" opacity="0.35" />
      <circle cx="16" cy="16" r="6" stroke={`url(#${id})`} strokeWidth="1.3" opacity="0.55" />
      <path d="M16 16 L16 5 A11 11 0 0 1 25.53 10.5 Z" fill={`url(#${id})`} opacity="0.28" />
      <path d="M16 16 L25.53 10.5" stroke={`url(#${id})`} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.1" fill={`url(#${id})`} />
      <circle cx="25.53" cy="10.5" r="2" fill="#34d399" />
      <circle cx="12.24" cy="26.34" r="1.5" fill={`url(#${id})`} opacity="0.75" />
      <circle cx="10.36" cy="13.95" r="1.5" fill={`url(#${id})`} opacity="0.75" />
    </svg>
  );
}

export default function Logo({ size = 28, subtitle = null }) {
  return (
    <div className="sondar-logo">
      <LogoMark size={size} />
      <div className="sondar-text">
        <span className="sondar-name" style={{ fontSize: Math.round(size * 0.62) }}>SONDAR</span>
        {subtitle && <span className="sondar-sub">{subtitle}</span>}
      </div>
    </div>
  );
}
