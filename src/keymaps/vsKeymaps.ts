import { KeymapMode } from '../types/ide';

export interface ShortcutLabels {
  save: string;
  saveAll: string;
  newProject: string;
  openSolution: string;
  buildSolution: string;
  rebuildSolution: string;
  startDebug: string;
  startWithoutDebug: string;
  stopDebug: string;
  stepOver: string;
  stepInto: string;
  stepOut: string;
  toggleBreakpoint: string;
  find: string;
  findInFiles: string;
  quickLaunch: string;
  formatDoc: string;
  terminal: string;
  options: string;
}

export function getShortcutLabels(mode: KeymapMode): ShortcutLabels {
  if (mode === 'macos') {
    return {
      save: '⌘S',
      saveAll: '⇧⌘S',
      newProject: '⇧⌘N',
      openSolution: '⇧⌘O',
      buildSolution: '⌘B',
      rebuildSolution: '⌥⌘B',
      startDebug: 'F5 / ⌘R',
      startWithoutDebug: '⌥⌘R',
      stopDebug: '⇧F5',
      stepOver: 'F10',
      stepInto: 'F11',
      stepOut: '⇧F11',
      toggleBreakpoint: 'F9',
      find: '⌘F',
      findInFiles: '⇧⌘F',
      quickLaunch: '⌃Q', // ⌘Q stays macOS Quit
      formatDoc: '⇧⌥F',
      terminal: '⌃`',
      options: '⌘,',
    };
  }
  return {
    save: 'Ctrl+S',
    saveAll: 'Ctrl+Shift+S',
    newProject: 'Ctrl+Shift+N',
    openSolution: 'Ctrl+Shift+O',
    buildSolution: 'Ctrl+Shift+B',
    rebuildSolution: 'Ctrl+Alt+B',
    startDebug: 'F5',
    startWithoutDebug: 'Ctrl+F5',
    stopDebug: 'Shift+F5',
    stepOver: 'F10',
    stepInto: 'F11',
    stepOut: 'Shift+F11',
    toggleBreakpoint: 'F9',
    find: 'Ctrl+F',
    findInFiles: 'Ctrl+Shift+F',
    quickLaunch: 'Ctrl+Q',
    formatDoc: 'Ctrl+K, Ctrl+D',
    terminal: 'Ctrl+`',
    options: 'Alt+T, O',
  };
}
