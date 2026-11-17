import React from 'react';

export const VsLogoIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="none" style={{ flexShrink: 0 }}>
    <path d="M188 26 L232 46 L232 210 L188 230 L188 26 Z" fill="#C77DFF" />
    <path d="M188 26 L80 132 L38 100 L22 108 L22 148 L38 156 L80 124 L188 230 Z" fill="#7B3FE4" />
    <path d="M188 26 L188 82 L80 184 L38 156 L22 148 L22 108 L38 100 L80 134 L188 26 Z" fill="#A865FF" />
  </svg>
);

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
