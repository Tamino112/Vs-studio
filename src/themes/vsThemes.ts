import type * as monaco from 'monaco-editor';
import { VsThemeId } from '../types/ide';

export interface VsThemeTokens {
  id: VsThemeId;
  label: string;
  cssVars: Record<string, string>;
  monacoBase: 'vs-dark' | 'vs';
}

export const VS_THEMES: Record<VsThemeId, VsThemeTokens> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    monacoBase: 'vs-dark',
    cssVars: {
      '--vs-bg': '#1E1E1E',
      '--vs-bg-panel': '#252526',
      '--vs-bg-chrome': '#2D2D30',
      '--vs-bg-titlebar': '#2B2B2B',
      '--vs-bg-toolbar': '#2D2D30',
      '--vs-bg-input': '#333337',
      '--vs-bg-hover': '#3E3E42',
      '--vs-bg-selection': '#094771',
      '--vs-bg-selection-inactive': '#37373D',
      '--vs-bg-tab-active': '#1E1E1E',
      '--vs-bg-tab-inactive': '#2D2D30',
      '--vs-bg-header-active': '#007ACC',
      '--vs-bg-header-inactive': '#2D2D30',
      '--vs-fg': '#CCCCCC',
      '--vs-fg-bright': '#FFFFFF',
      '--vs-fg-muted': '#9D9D9D',
      '--vs-fg-header-active': '#FFFFFF',
      '--vs-border': '#3F3F46',
      '--vs-border-subtle': '#333337',
      '--vs-accent': '#007ACC',
      '--vs-accent-hover': '#1C97EA',
      '--vs-purple': '#8A3FFC',
      '--vs-purple-dark': '#68217A',
      '--vs-status-ready': '#007ACC',
      '--vs-status-debug': '#CA5100',
      '--vs-status-idle': '#68217A',
      '--vs-error': '#F48771',
      '--vs-warning': '#CCA700',
      '--vs-info': '#75BEFF',
      '--vs-success': '#89D185',
      '--vs-play-green': '#388A34',
      '--vs-stop-red': '#E51400',
    },
  },
  blue: {
    id: 'blue',
    label: 'Blue',
    monacoBase: 'vs',
    cssVars: {
      '--vs-bg': '#FFFFFF',
      '--vs-bg-panel': '#F5F5F5',
      '--vs-bg-chrome': '#D6DBE9',
      '--vs-bg-titlebar': '#D6DBE9',
      '--vs-bg-toolbar': '#CFD6E5',
      '--vs-bg-input': '#FFFFFF',
      '--vs-bg-hover': '#C9D3E6',
      '--vs-bg-selection': '#3399FF',
      '--vs-bg-selection-inactive': '#CCCEDB',
      '--vs-bg-tab-active': '#FFF29D',
      '--vs-bg-tab-inactive': '#4D6082',
      '--vs-bg-header-active': '#3B4F78',
      '--vs-bg-header-inactive': '#4D6082',
      '--vs-fg': '#1E1E1E',
      '--vs-fg-bright': '#000000',
      '--vs-fg-muted': '#555555',
      '--vs-fg-header-active': '#FFFFFF',
      '--vs-border': '#8E9BBC',
      '--vs-border-subtle': '#BDC6DB',
      '--vs-accent': '#007ACC',
      '--vs-accent-hover': '#005A9E',
      '--vs-purple': '#68217A',
      '--vs-purple-dark': '#521960',
      '--vs-status-ready': '#293955',
      '--vs-status-debug': '#CA5100',
      '--vs-status-idle': '#68217A',
      '--vs-error': '#E51400',
      '--vs-warning': '#B37A00',
      '--vs-info': '#0066CC',
      '--vs-success': '#107C10',
      '--vs-play-green': '#107C10',
      '--vs-stop-red': '#E51400',
    },
  },
  light: {
    id: 'light',
    label: 'Light',
    monacoBase: 'vs',
    cssVars: {
      '--vs-bg': '#FFFFFF',
      '--vs-bg-panel': '#F5F5F5',
      '--vs-bg-chrome': '#EEEEF2',
      '--vs-bg-titlebar': '#EEEEF2',
      '--vs-bg-toolbar': '#EEEEF2',
      '--vs-bg-input': '#FFFFFF',
      '--vs-bg-hover': '#E0E0E5',
      '--vs-bg-selection': '#007ACC',
      '--vs-bg-selection-inactive': '#CCCEDB',
      '--vs-bg-tab-active': '#FFFFFF',
      '--vs-bg-tab-inactive': '#E6E6EA',
      '--vs-bg-header-active': '#007ACC',
      '--vs-bg-header-inactive': '#EEEEF2',
      '--vs-fg': '#1E1E1E',
      '--vs-fg-bright': '#000000',
      '--vs-fg-muted': '#616161',
      '--vs-fg-header-active': '#FFFFFF',
      '--vs-border': '#CCCEDB',
      '--vs-border-subtle': '#DCDCE3',
      '--vs-accent': '#007ACC',
      '--vs-accent-hover': '#005A9E',
      '--vs-purple': '#68217A',
      '--vs-purple-dark': '#521960',
      '--vs-status-ready': '#007ACC',
      '--vs-status-debug': '#CA5100',
      '--vs-status-idle': '#68217A',
      '--vs-error': '#E51400',
      '--vs-warning': '#B37A00',
      '--vs-info': '#0066CC',
      '--vs-success': '#107C10',
      '--vs-play-green': '#107C10',
      '--vs-stop-red': '#E51400',
    },
  },
};

export function applyThemeToDom(themeId: VsThemeId): void {
  const theme = VS_THEMES[themeId];
  const root = document.documentElement;
  root.setAttribute('data-vs-theme', themeId);
  for (const [k, v] of Object.entries(theme.cssVars)) {
    root.style.setProperty(k, v);
  }
}

export function registerMonacoThemes(monacoInst: typeof monaco): void {
  monacoInst.editor.defineTheme('vs-community-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '569CD6' },
      { token: 'keyword.control', foreground: 'D8A0DF' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'string', foreground: 'D69D85' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'comment', foreground: '57A64A' },
    ],
    colors: {
      'editor.background': '#1E1E1E',
      'editor.lineHighlightBackground': '#2A2D2E',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#C6C6C6',
      'editorGutter.background': '#1E1E1E',
    },
  });

  monacoInst.editor.defineTheme('vs-community-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '0000FF' },
      { token: 'keyword.control', foreground: '8F08C4' },
      { token: 'type', foreground: '2B91AF' },
      { token: 'string', foreground: 'A31515' },
      { token: 'comment', foreground: '008000' },
    ],
    colors: {
      'editor.background': '#FFFFFF',
      'editor.lineHighlightBackground': '#F3F3F3',
    },
  });
}
