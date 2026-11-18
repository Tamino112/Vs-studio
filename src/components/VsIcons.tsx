import React from 'react';

export const VsLogoIcon: React.FC<{ size?: number }> = ({ size = 18 }) => {
  const uid = React.useId().replace(/:/g, '');
  const clipId = `vs-clip-${uid}`;
  const clipRectId = `vs-rect-${uid}`;
  const maskId = `vs-mask-${uid}`;
  const gradE = `vs-ge-${uid}`;
  const gradG = `vs-gg-${uid}`;
  const gradI = `vs-gi-${uid}`;
  const filterD = `vs-fd-${uid}`;
  const filterF = `vs-ff-${uid}`;
  const filterH = `vs-fh-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 193 193" fill="none" style={{ flexShrink: 0 }}>
      <defs>
        <path id={clipRectId} fill="#fff" d="M8.271 8.271h176.457v176.457H8.271z" />
        <clipPath id={clipId}>
          <use href={`#${clipRectId}`} />
        </clipPath>
        <mask id={maskId} width="177" height="177" x="8" y="8" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
          <path fill="#fff" d="m40.621 157.524-29.408-22.057a7.284 7.284 0 0 1-2.941-5.881V63.414a7.287 7.287 0 0 1 2.941-5.88l29.408-22.058a6.658 6.658 0 0 0-2.02 5.881v110.286a6.66 6.66 0 0 0 2.02 5.881Z" />
          <path fill="#fff" d="M181.456 38.895a7.39 7.39 0 0 0-4.081-1.213 7.139 7.139 0 0 0-5.073 2.057l-.513.515L113.117 96.5l-32.462 31.137-30.034 28.784-.515.516a7.137 7.137 0 0 1-5.073 2.059 7.386 7.386 0 0 1-4.412-1.472l-29.408-22.057a7.346 7.346 0 0 0 9.998-1.103l32.644-37.9 26.8-31.1 46.946-54.52a7.238 7.238 0 0 1 5.55-2.572 7.385 7.385 0 0 1 4.08 1.213l44.225 29.41Z" />
          <path fill="#fff" d="m181.456 154.105-44.114 29.41a7.447 7.447 0 0 1-9.667-1.323l-47.02-54.555-26.8-31.173-32.644-37.867a7.386 7.386 0 0 0-9.998-1.064l29.408-22.057a7.39 7.39 0 0 1 4.411-1.472 7.132 7.132 0 0 1 5.074 2.06l.515.515 30.034 28.785L113.117 96.5l58.672 56.246.513.515a7.136 7.136 0 0 0 5.073 2.057 7.387 7.387 0 0 0 4.081-1.213Z" />
          <path fill="#fff" d="M184.729 45.032v102.936a7.375 7.375 0 0 1-3.273 6.137l-44.114 29.41a7.383 7.383 0 0 0 3.272-6.14V15.625a7.44 7.44 0 0 0-3.383-6.14l44.225 29.41a7.419 7.419 0 0 1 3.273 6.137Z" />
        </mask>
        <linearGradient id={gradE} x1="151.642" x2="20.614" y1="8.271" y2="140.148" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7252AA" />
          <stop offset="1" stopColor="#7252AA" />
        </linearGradient>
        <linearGradient id={gradG} x1="24.814" x2="147.966" y1="40.437" y2="178.293" gradientUnits="userSpaceOnUse">
          <stop stopColor="#AE7FE2" />
          <stop offset="1" stopColor="#9A70D4" />
        </linearGradient>
        <linearGradient id={gradI} x1="160.457" x2="160.457" y1="5.936" y2="183.367" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D59DFF" />
          <stop offset="1" stopColor="#C18EF1" />
        </linearGradient>
        <filter id={filterD} width="180.604" height="161.087" x="6.032" y="4.386" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy=".246" />
          <feGaussianBlur stdDeviation=".246" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.24 0" />
          <feBlend in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="1.295" />
          <feGaussianBlur stdDeviation="2.59" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.22 0" />
          <feBlend in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
        <filter id={filterF} width="180.604" height="161.085" x="6.032" y="30.118" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy=".246" />
          <feGaussianBlur stdDeviation=".246" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.24 0" />
          <feBlend in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy="1.295" />
          <feGaussianBlur stdDeviation="2.59" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.22 0" />
          <feBlend in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
        <filter id={filterH} width="78.583" height="205.117" x="121.688" y="-6.059" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset />
          <feGaussianBlur stdDeviation=".13" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.24 0" />
          <feBlend in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset />
          <feGaussianBlur stdDeviation="7.771" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0" />
          <feBlend in2="effect1_dropShadow" result="effect2_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect2_dropShadow" result="shape" />
        </filter>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g mask={`url(#${maskId})`}>
          <path fill="#5E438F" d="m40.621 157.524-29.408-22.057a7.292 7.292 0 0 1-2.941-5.881V63.414a7.287 7.287 0 0 1 2.941-5.88l29.408-22.058a6.658 6.658 0 0 0-2.02 5.881v110.286a6.66 6.66 0 0 0 2.02 5.881Z" />
          <g filter={`url(#${filterD})`}>
            <path fill={`url(#${gradE})`} d="M181.455 38.895a7.385 7.385 0 0 0-4.08-1.213 7.147 7.147 0 0 0-5.073 2.057l-.513.515-31.25 29.962L113.117 96.5l-32.463 31.137-30.033 28.784-.516.516a7.137 7.137 0 0 1-5.073 2.059 7.386 7.386 0 0 1-4.411-1.472l-29.408-22.057a7.346 7.346 0 0 0 9.997-1.103l16.471-19.115 16.174-18.785 26.8-31.1 46.945-54.52a7.251 7.251 0 0 1 5.55-2.572 7.39 7.39 0 0 1 4.081 1.213l44.224 29.41Z" />
          </g>
          <g filter={`url(#${filterF})`}>
            <path fill={`url(#${gradG})`} d="m181.455 154.105-44.114 29.411a7.443 7.443 0 0 1-9.666-1.324l-47.02-54.555-26.8-31.173-16.173-18.748L21.21 58.598a7.387 7.387 0 0 0-9.997-1.065L40.62 35.477a7.389 7.389 0 0 1 4.411-1.472 7.128 7.128 0 0 1 5.073 2.06l.516.515 30.033 28.785L113.117 96.5l27.461 26.323 31.211 29.923.513.516a7.155 7.155 0 0 0 5.073 2.056 7.382 7.382 0 0 0 4.08-1.213Z" />
          </g>
          <g filter={`url(#${filterH})`}>
            <path fill={`url(#${gradI})`} d="M184.729 45.032v102.935a7.38 7.38 0 0 1-3.273 6.138l-44.115 29.41a7.383 7.383 0 0 0 3.273-6.14V15.625a7.44 7.44 0 0 0-3.383-6.14l44.225 29.41a7.428 7.428 0 0 1 3.273 6.137Z" />
          </g>
        </g>
      </g>
    </svg>
  );
};

export const SolutionIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <rect x="2" y="2" width="12" height="12" rx="1.5" fill="#7C52B5" stroke="#B68DF2" strokeWidth="1" />
    <path d="M5 5h6v6H5z" fill="#D9C2FF" opacity="0.85" />
    <path d="M8 5v6M5 8h6" stroke="#5A368F" strokeWidth="1.2" />
  </svg>
);

export const CSharpProjectIcon: React.FC<{ size?: number; kind?: 'exe' | 'web' | 'test' | 'lib' }> = ({
  size = 16,
  kind = 'exe',
}) => {
  const accent = kind === 'web' ? '#3794FF' : kind === 'test' ? '#89D185' : '#68B723';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#252526" stroke={accent} strokeWidth="1.2" />
      <rect x="1.5" y="2.5" width="13" height="3" fill={accent} />
      <text x="4" y="11.5" fill={accent} fontSize="6.5" fontWeight="700" fontFamily="sans-serif">
        C#
      </text>
    </svg>
  );
};

export const CSharpFileIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path d="M3 1.5h7l3 3V14.5H3V1.5z" fill="#252526" stroke="#68B723" strokeWidth="1.1" />
    <text x="4.3" y="11.8" fill="#89D185" fontSize="6" fontWeight="700" fontFamily="sans-serif">
      C#
    </text>
  </svg>
);

export const NuGetIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <rect x="2" y="2" width="12" height="12" rx="3" fill="#004880" stroke="#4FC1FF" strokeWidth="1" />
    <circle cx="6.2" cy="6.2" r="1.4" fill="#FFFFFF" />
    <circle cx="10.2" cy="9.8" r="2.2" fill="#FFFFFF" />
  </svg>
);
