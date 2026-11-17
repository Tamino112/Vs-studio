import { create } from 'zustand';
import {
  BottomPanelId,
  Breakpoint,
  ConsoleLaunchMode,
  DebugStackFrame,
  DebugState,
  DebugVariable,
  DiagnosticItem,
  DocumentSplitMode,
  DotnetTemplate,
  EnvironmentStatus,
  FileNode,
  GitStatusInfo,
  KeymapMode,
  LeftPanelId,
  OpenTab,
  OutputChannelData,
  OutputChannelName,
  RecentSolution,
  RightPanelId,
  SearchMatch,
  SolutionInfo,
  TabLayoutPosition,
  TaskListItem,
  TestCaseResult,
  VsThemeId,
} from '../types/ide';
import { applyThemeToDom } from '../themes/vsThemes';
import { extractTodoTasks } from '../utils/csharpOutline';
import { analyzeCSharpCode } from '../utils/csharpDiagnostics';

export type EditorCommandType =
  | 'undo'
  | 'redo'
  | 'comment'
  | 'uncomment'
  | 'format'
  | 'find'
  | 'replace'
  | 'toggleBreakpoint';

const LIVE_COVERED_CODES = new Set([
  'CS0103',
  'CS0219',
  'CS1010',
  'CS1513',
  'CS1026',
  'CS0117',
  'CS0029',
  'CS1002',
]);

export function selectEffectiveDiagnosticsForFile(state: Pick<IdeState, 'buildDiagnostics' | 'lspDiagnosticsByFile' | 'liveDiagnosticsByFile' | 'lspHasPublished' | 'lspStaleByFile'>, filePath: string): DiagnosticItem[] {
  const buildForFile = state.buildDiagnostics.filter((d) => d.file === filePath);
  const lspItems = state.lspDiagnosticsByFile[filePath] || [];
  const liveItems = state.liveDiagnosticsByFile[filePath] || [];
  const hasLsp = Boolean(state.lspHasPublished[filePath]);
  const isStale = Boolean(state.lspStaleByFile[filePath]);

  let intelItems: DiagnosticItem[];
  if (!hasLsp || isStale) {
    const deepLsp = isStale
      ? lspItems.filter((d) => !LIVE_COVERED_CODES.has(d.code) && !liveItems.some((l) => l.line === d.line))
      : [];
    intelItems = [...liveItems, ...deepLsp];
  } else {
    intelItems = lspItems;
  }

  const seen = new Set<string>();
  const combined: DiagnosticItem[] = [];
  for (const d of [...intelItems, ...buildForFile]) {
    const key = `${d.file}:${d.line}:${d.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(d);
  }
  return combined;
}

export function selectAllEffectiveDiagnostics(state: Pick<IdeState, 'buildDiagnostics' | 'lspDiagnosticsByFile' | 'liveDiagnosticsByFile' | 'lspHasPublished' | 'lspStaleByFile' | 'openTabs'>): DiagnosticItem[] {
  const fileSet = new Set<string>([
    ...state.buildDiagnostics.map((d) => d.file),
    ...Object.keys(state.lspDiagnosticsByFile),
    ...Object.keys(state.liveDiagnosticsByFile),
  ]);
  const result: DiagnosticItem[] = [];
  for (const file of fileSet) {
    result.push(...selectEffectiveDiagnosticsForFile(state, file));
  }
  return result;
}

const PROJECT_TAB_COLORS = [
  '#007ACC', // Visual Studio Blue
  '#68217A', // Visual Studio Purple
  '#388A34', // C# Green
  '#CA5100', // Amber / Orange
  '#008272', // Teal
  '#B4009E', // Magenta
  '#D13438', // Crimson
  '#038387', // Cyan
];

function getProjectColor(solution: SolutionInfo | null, filePath: string): { projectId?: string; projectName?: string; projectColor?: string } {
  if (!solution) return {};
  // Longest matching project dir wins ("/src/App" must not claim "/src/App.Tests/…")
  let idx = -1;
  solution.projects.forEach((p, i) => {
    if (filePath === p.dir || filePath.startsWith(p.dir.endsWith('/') ? p.dir : p.dir + '/')) {
      if (idx === -1 || p.dir.length > solution.projects[idx].dir.length) idx = i;
    }
  });
  if (idx === -1) return {};
  const p = solution.projects[idx];
  return {
    projectId: p.id,
    projectName: p.name,
    projectColor: PROJECT_TAB_COLORS[idx % PROJECT_TAB_COLORS.length],
  };
}

function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.csproj') || lower.endsWith('.slnx') || lower.endsWith('.xml') || lower.endsWith('.config') || lower.endsWith('.props'))
    return 'xml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.razor') || lower.endsWith('.cshtml') || lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  return 'plaintext';
}

export interface IdeState {
  screen: 'start' | 'ide';
  theme: VsThemeId;
  keymap: KeymapMode;
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  showAllFiles: boolean;
  tabLayout: TabLayoutPosition;
  colorizeTabsByProject: boolean;
  editorZoom: number;
  consoleLaunchMode: ConsoleLaunchMode;
  autoCloseConsole: boolean;
  pendingTerminalCommand: { id: number; command: string; cwd: string } | null;

  envStatus: EnvironmentStatus | null;
  templates: DotnetTemplate[];
  recentSolutions: RecentSolution[];

  solution: SolutionInfo | null;
  projectTrees: Record<string, FileNode[]>;
  activeConfiguration: 'Debug' | 'Release';
  activePlatform: 'Any CPU' | 'arm64' | 'x64';
  statusText: string;
  isBuilding: boolean;

  openTabs: OpenTab[];
  activeTabId: string | null;
  splitMode: DocumentSplitMode;
  activeGroupId: number;
  activeTabByGroup: Record<number, string | null>;
  pendingInsertSnippet: { id: number; text: string } | null;
  pendingReveal: { filePath: string; line: number; column: number; nonce: number } | null;
  editorCommand: { id: number; command: EditorCommandType } | null;
  navHistory: Array<{ filePath: string; line: number; column: number }>;
  navIndex: number;

  buildDiagnostics: DiagnosticItem[];
  lspDiagnosticsByFile: Record<string, DiagnosticItem[]>;
  liveDiagnosticsByFile: Record<string, DiagnosticItem[]>;
  lspHasPublished: Record<string, boolean>;
  lspStaleByFile: Record<string, boolean>;
  outputChannels: OutputChannelData;
  activeOutputChannel: OutputChannelName;

  breakpoints: Breakpoint[];
  debugState: DebugState;
  debugFrames: DebugStackFrame[];
  debugLocals: DebugVariable[];
  debugPausedLocation: { file?: string; line?: number } | null;
  watchExpressions: Array<{ id: string; expression: string; value: string }>;

  gitStatus: GitStatusInfo | null;
  tests: TestCaseResult[];
  searchResults: SearchMatch[];
  taskListItems: TaskListItem[];
  selectedPropertyTarget: {
    kind: 'solution' | 'project' | 'file';
    id: string;
    name: string;
    path: string;
  } | null;

  // Dock layout + Auto-Hide Pins
  leftOpen: boolean;
  leftPinned: boolean;
  leftPanel: LeftPanelId;
  leftWidth: number;
  rightOpen: boolean;
  rightPinned: boolean;
  rightPanel: RightPanelId;
  rightWidth: number;
  bottomOpen: boolean;
  bottomPinned: boolean;
  bottomPanel: BottomPanelId;
  bottomHeight: number;

  // Dialogs
  newProjectOpen: boolean;
  addNewProjectOpen: boolean;
  addProjectRefSourceId: string | null;
  addNewItemTargetDir: string | null;
  findInFilesOpen: boolean;
  quickLaunchOpen: boolean;
  toolsOptionsOpen: boolean;
  cloneRepoOpen: boolean;

  // Actions
  initApp: () => Promise<void>;
  setTheme: (theme: VsThemeId) => void;
  setKeymap: (mode: KeymapMode) => void;
  setFontSize: (size: number) => void;
  setWordWrap: (wrap: boolean) => void;
  setMinimap: (show: boolean) => void;
  setShowAllFiles: (show: boolean) => Promise<void>;
  setTabLayout: (layout: TabLayoutPosition) => void;
  setColorizeTabsByProject: (enabled: boolean) => void;
  setEditorZoom: (zoom: number) => void;
  setConsoleLaunchMode: (mode: ConsoleLaunchMode) => void;
  setAutoCloseConsole: (enabled: boolean) => void;
  consumePendingTerminalCommand: () => void;
  setScreen: (screen: 'start' | 'ide') => void;

  openSolution: (targetPath: string) => Promise<void>;
  closeSolution: () => void;
  refreshSolutionTrees: () => Promise<void>;
  refreshTaskList: () => Promise<void>;
  setStartupProject: (projectId: string) => void;
  setConfiguration: (cfg: 'Debug' | 'Release') => void;
  setPlatform: (plat: 'Any CPU' | 'arm64' | 'x64') => void;

  openFile: (
    filePath: string,
    line?: number,
    column?: number,
    options?: { preview?: boolean; groupId?: number; skipHistory?: boolean },
  ) => Promise<void>;
  openNugetTab: (projectId?: string) => void;
  openDiffTab: (title: string, path: string, original: string, modified: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  setTabCursor: (tabId: string, line: number, column: number) => void;
  consumePendingReveal: () => void;
  recordNavigation: (filePath: string, line: number, column: number) => void;
  navigateBack: () => Promise<void>;
  navigateForward: () => Promise<void>;
  dispatchEditorCommand: (command: EditorCommandType) => void;
  saveTab: (tabId: string) => Promise<void>;
  saveAllTabs: () => Promise<void>;
  closeTab: (tabId: string) => void;
  /** VS "Save changes to the following items?" – resolves false when the user pressed Cancel. */
  confirmCloseTabs: (tabIds: string[]) => Promise<boolean>;
  /** Keeps open tabs / breakpoints in sync after a rename or move in Solution Explorer. */
  renamePathInTabs: (oldPath: string, newPath: string) => void;
  /** Closes (without prompting) every tab of a deleted file or folder. */
  closeTabsUnderPath: (deletedPath: string) => void;
  closeAllTabs: (groupId?: number) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeTabsToLeft: (tabId: string) => void;
  togglePinTab: (tabId: string) => void;
  promotePreviewTab: (tabId: string) => void;
  reorderTab: (fromTabId: string, toTabId: string) => void;
  moveTabToGroup: (tabId: string, targetGroupId: number) => void;
  setSplitMode: (mode: DocumentSplitMode) => void;
  setActiveGroup: (groupId: number) => void;
  setActiveTab: (tabId: string, groupId?: number) => void;
  insertSnippetIntoEditor: (text: string) => void;

  appendOutput: (channel: OutputChannelName, line: string) => void;
  clearOutput: (channel: OutputChannelName) => void;
  setActiveOutputChannel: (channel: OutputChannelName) => void;
  setLspDiagnostics: (file: string, items: DiagnosticItem[]) => void;

  buildSolution: (mode: 'build' | 'rebuild' | 'clean', projectPath?: string) => Promise<boolean>;
  startDebugging: (withDebugger: boolean) => Promise<void>;
  stopDebugging: () => Promise<void>;
  continueDebugging: () => Promise<void>;
  stepOver: () => Promise<void>;
  stepInto: () => Promise<void>;
  stepOut: () => Promise<void>;
  toggleBreakpoint: (file: string, line: number) => void;
  toggleBreakpointEnabled: (id: string) => void;
  removeBreakpoint: (id: string) => void;
  addWatchExpression: (expr: string) => Promise<void>;
  removeWatchExpression: (id: string) => void;

  refreshGitStatus: () => Promise<void>;
  runTests: (targetPath?: string) => Promise<void>;
  runSearchInFiles: (query: string, opts?: { matchCase?: boolean; wholeWord?: boolean; fileMask?: string }) => Promise<void>;
  setSelectedPropertyTarget: (target: IdeState['selectedPropertyTarget']) => void;

  setDock: (
    partial: Partial<
      Pick<
        IdeState,
        | 'leftOpen'
        | 'leftPinned'
        | 'leftPanel'
        | 'leftWidth'
        | 'rightOpen'
        | 'rightPinned'
        | 'rightPanel'
        | 'rightWidth'
        | 'bottomOpen'
        | 'bottomPinned'
        | 'bottomPanel'
        | 'bottomHeight'
      >
    >,
  ) => void;
  setDialog: (partial: Partial<Pick<IdeState, 'newProjectOpen' | 'addNewProjectOpen' | 'addProjectRefSourceId' | 'addNewItemTargetDir' | 'findInFilesOpen' | 'quickLaunchOpen' | 'toolsOptionsOpen' | 'cloneRepoOpen'>>) => void;
  refreshEnvironment: () => Promise<void>;
  refreshRecent: () => Promise<void>;
}

const savedTheme = (localStorage.getItem('vs.theme') as VsThemeId) || 'dark';
const defaultKeymap: KeymapMode =
  typeof window !== 'undefined' && window.vsApi?.platform === 'win32' ? 'windows' : 'macos';
const savedKeymap = (localStorage.getItem('vs.keymap') as KeymapMode) || defaultKeymap;
const savedTabLayout = (localStorage.getItem('vs.tabLayout') as TabLayoutPosition) || 'top';
const savedColorize = localStorage.getItem('vs.colorizeTabs') !== 'false';
const savedConsoleMode = (localStorage.getItem('vs.consoleMode') as ConsoleLaunchMode) || 'externalWindow';
const savedAutoCloseConsole = localStorage.getItem('vs.autoCloseConsole') === 'true';
const savedFontSize = Number(localStorage.getItem('vs.fontSize')) || 13;
const savedWordWrap = localStorage.getItem('vs.wordWrap') === 'true';
const savedMinimap = localStorage.getItem('vs.minimap') !== 'false';
const savedEditorZoom = Number(localStorage.getItem('vs.editorZoom')) || 100;
applyThemeToDom(savedTheme);

// Guards against F5 key-repeat / menu + shortcut double launches
let debugLaunchInProgress = false;
// Set while re-running a close action after the user answered the save prompt with "No"
let closeGuardBypass = false;
function withCloseBypass(fn: () => void): void {
  closeGuardBypass = true;
  try {
    fn();
  } finally {
    closeGuardBypass = false;
  }
}

export const useIdeStore = create<IdeState>((set, get) => ({
  screen: 'start',
  theme: savedTheme,
  keymap: savedKeymap,
  fontSize: savedFontSize,
  wordWrap: savedWordWrap,
  minimap: savedMinimap,
  showAllFiles: false,
  tabLayout: savedTabLayout,
  colorizeTabsByProject: savedColorize,
  editorZoom: savedEditorZoom,
  consoleLaunchMode: savedConsoleMode,
  autoCloseConsole: savedAutoCloseConsole,
  pendingTerminalCommand: null,

  envStatus: null,
  templates: [],
  recentSolutions: [],

  solution: null,
  projectTrees: {},
  activeConfiguration: 'Debug',
  activePlatform: 'Any CPU',
  statusText: 'Ready',
  isBuilding: false,

  openTabs: [],
  activeTabId: null,
  splitMode: 'none',
  activeGroupId: 0,
  activeTabByGroup: { 0: null, 1: null },
  pendingInsertSnippet: null,
  pendingReveal: null,
  editorCommand: null,
  navHistory: [],
  navIndex: -1,

  buildDiagnostics: [],
  lspDiagnosticsByFile: {},
  liveDiagnosticsByFile: {},
  lspHasPublished: {},
  lspStaleByFile: {},
  outputChannels: {
    Build: [],
    Debug: [],
    'Package Manager': [],
    'Language Server': [],
    Tests: [],
  },
  activeOutputChannel: 'Build',

  breakpoints: [],
  debugState: 'stopped',
  debugFrames: [],
  debugLocals: [],
  debugPausedLocation: null,
  watchExpressions: [],

  gitStatus: null,
  tests: [],
  searchResults: [],
  taskListItems: [],
  selectedPropertyTarget: null,

  leftOpen: true,
  leftPinned: true,
  leftPanel: 'solutionExplorer',
  leftWidth: 280,
  rightOpen: false,
  rightPinned: true,
  rightPanel: 'properties',
  rightWidth: 300,
  bottomOpen: true,
  bottomPinned: true,
  bottomPanel: 'errorList',
  bottomHeight: 220,

  newProjectOpen: false,
  addNewProjectOpen: false,
  addProjectRefSourceId: null,
  addNewItemTargetDir: null,
  findInFilesOpen: false,
  quickLaunchOpen: false,
  toolsOptionsOpen: false,
  cloneRepoOpen: false,

  initApp: async () => {
    if (!window.vsApi) return;
    const [env, templates, recent] = await Promise.all([
      window.vsApi.env.detect(),
      window.vsApi.env.templates(),
      window.vsApi.recent.list(),
    ]);
    set({ envStatus: env, templates, recentSolutions: recent });
  },

  refreshEnvironment: async () => {
    if (!window.vsApi) return;
    const env = await window.vsApi.env.detect();
    set({ envStatus: env });
  },

  refreshRecent: async () => {
    if (!window.vsApi) return;
    const recent = await window.vsApi.recent.list();
    set({ recentSolutions: recent });
  },

  setTheme: (theme) => {
    localStorage.setItem('vs.theme', theme);
    applyThemeToDom(theme);
    set({ theme });
  },

  setKeymap: (keymap) => {
    localStorage.setItem('vs.keymap', keymap);
    set({ keymap });
  },

  setFontSize: (fontSize) => {
    localStorage.setItem('vs.fontSize', String(fontSize));
    set({ fontSize });
  },
  setWordWrap: (wordWrap) => {
    localStorage.setItem('vs.wordWrap', String(wordWrap));
    set({ wordWrap });
  },
  setMinimap: (minimap) => {
    localStorage.setItem('vs.minimap', String(minimap));
    set({ minimap });
  },
  setShowAllFiles: async (showAllFiles) => {
    set({ showAllFiles });
    await get().refreshSolutionTrees();
  },
  setTabLayout: (tabLayout) => {
    localStorage.setItem('vs.tabLayout', tabLayout);
    set({ tabLayout });
  },
  setColorizeTabsByProject: (colorizeTabsByProject) => {
    localStorage.setItem('vs.colorizeTabs', String(colorizeTabsByProject));
    set({ colorizeTabsByProject });
  },
  setEditorZoom: (editorZoom) => {
    const z = Math.max(50, Math.min(200, editorZoom));
    localStorage.setItem('vs.editorZoom', String(z));
    set({ editorZoom: z });
  },
  setConsoleLaunchMode: (consoleLaunchMode) => {
    localStorage.setItem('vs.consoleMode', consoleLaunchMode);
    set({ consoleLaunchMode });
  },
  setAutoCloseConsole: (autoCloseConsole) => {
    localStorage.setItem('vs.autoCloseConsole', String(autoCloseConsole));
    set({ autoCloseConsole });
  },
  consumePendingTerminalCommand: () => set({ pendingTerminalCommand: null }),
  setScreen: (screen) => set({ screen }),

  openSolution: async (targetPath) => {
    // Unsaved documents of the current solution: ask first (VS behaviour)
    if (!(await get().confirmCloseTabs(get().openTabs.map((t) => t.id)))) return;
    const sln = (await window.vsApi.solution.open(targetPath)) as SolutionInfo;
    if (get().solution && get().solution?.path !== sln.path) {
      void window.vsApi?.debug.stop();
    }
    set({
      solution: sln,
      screen: 'ide',
      openTabs: [],
      activeTabId: null,
      splitMode: 'none',
      activeGroupId: 0,
      activeTabByGroup: { 0: null, 1: null },
      pendingReveal: null,
      editorCommand: null,
      navHistory: [],
      navIndex: -1,
      buildDiagnostics: [],
      lspDiagnosticsByFile: {},
      liveDiagnosticsByFile: {},
      lspHasPublished: {},
      lspStaleByFile: {},
      taskListItems: [],
      ...(get().solution?.path !== sln.path
        ? {
            debugState: 'stopped' as const,
            debugFrames: [],
            debugLocals: [],
            debugPausedLocation: null,
            breakpoints: [],
            searchResults: [],
          }
        : {}),
      statusText: `Loaded solution '${sln.name}' (${sln.projects.length} project${sln.projects.length === 1 ? '' : 's'})`,
      selectedPropertyTarget: {
        kind: 'solution',
        id: sln.path,
        name: sln.name,
        path: sln.path,
      },
    });
    await get().refreshSolutionTrees();
    await get().refreshGitStatus();
    await get().refreshRecent();
    void get().refreshTaskList();

    // Start C# LSP if installed (await so initial didOpen is not dropped)
    const env = get().envStatus;
    if (env?.csharpLsInstalled && env.csharpLsPath) {
      const started = await window.vsApi.lsp.start(sln.dir, env.csharpLsPath);
      if (started) {
        for (const t of get().openTabs) {
          if (t.kind === 'code' && t.language === 'csharp') {
            void window.vsApi.lsp.didOpen(t.path, t.content);
          }
        }
      }
    }

    // Auto-open Program.cs of startup project if present
    const startup = sln.projects.find((p) => p.id === sln.startupProjectId) || sln.projects[0];
    if (startup) {
      const tree = get().projectTrees[startup.id] || [];
      const programNode = tree.find((n) => !n.isDirectory && n.name.toLowerCase() === 'program.cs')
        || tree.find((n) => !n.isDirectory && n.name.endsWith('.cs'));
      if (programNode) {
        await get().openFile(programNode.path);
      }
    }
  },

  closeSolution: () => {
    if (!closeGuardBypass) {
      const guardIds = get().openTabs.map((t) => t.id);
      if (get().openTabs.some((t) => guardIds.includes(t.id) && t.kind === 'code' && t.isDirty)) {
        void get().confirmCloseTabs(guardIds).then((ok) => {
          if (ok) withCloseBypass(() => get().closeSolution());
        });
        return;
      }
    }
    void window.vsApi?.lsp.stop();
    void window.vsApi?.debug.stop();
    set({
      solution: null,
      projectTrees: {},
      openTabs: [],
      activeTabId: null,
      splitMode: 'none',
      activeGroupId: 0,
      activeTabByGroup: { 0: null, 1: null },
      pendingReveal: null,
      editorCommand: null,
      navHistory: [],
      navIndex: -1,
      buildDiagnostics: [],
      lspDiagnosticsByFile: {},
      liveDiagnosticsByFile: {},
      lspHasPublished: {},
      lspStaleByFile: {},
      gitStatus: null,
      tests: [],
      taskListItems: [],
      debugState: 'stopped',
      debugFrames: [],
      debugLocals: [],
      debugPausedLocation: null,
      isBuilding: false,
      breakpoints: [],
      searchResults: [],
      screen: 'start',
      statusText: 'Ready',
    });
  },

  refreshSolutionTrees: async () => {
    const { solution, showAllFiles } = get();
    if (!solution) return;
    const trees: Record<string, FileNode[]> = {};
    for (const proj of solution.projects) {
      try {
        trees[proj.id] = (await window.vsApi.fs.tree(proj.dir, showAllFiles)) as FileNode[];
      } catch {
        trees[proj.id] = [];
      }
    }
    if (solution.projects.length === 0) {
      trees[solution.dir] = (await window.vsApi.fs.tree(solution.dir, showAllFiles)) as FileNode[];
    }
    set({ projectTrees: trees });
  },

  refreshTaskList: async () => {
    const sln = get().solution;
    if (!sln || !window.vsApi) return;
    const matches = (await window.vsApi.fs.search(sln.dir, '//', {})) as SearchMatch[];
    const seen = new Set<string>();
    const items: TaskListItem[] = [];
    for (const m of matches) {
      if (seen.has(`${m.file}:${m.line}`)) continue;
      seen.add(`${m.file}:${m.line}`);
      const parsed = extractTodoTasks(m.file, m.lineText);
      for (const p of parsed) {
        items.push({ ...p, id: `${m.file}:${m.line}`, line: m.line });
      }
    }
    set({ taskListItems: items });
  },

  setStartupProject: (projectId) => {
    const sln = get().solution;
    if (!sln) return;
    set({ solution: { ...sln, startupProjectId: projectId } });
  },

  setConfiguration: (activeConfiguration) => set({ activeConfiguration }),
  setPlatform: (activePlatform) => set({ activePlatform }),

  openFile: async (filePath, line, column, options) => {
    const targetGroup = options?.groupId ?? get().activeGroupId ?? 0;
    const isPreview = Boolean(options?.preview);
    const existing = get().openTabs.find((t) => t.kind === 'code' && t.path === filePath);

    if (!options?.skipHistory) {
      get().recordNavigation(filePath, line ?? existing?.cursorLine ?? 1, column ?? existing?.cursorColumn ?? 1);
    }

    if (existing) {
      const grp = existing.groupId ?? 0;
      set((s) => ({
        activeTabId: existing.id,
        activeGroupId: grp,
        activeTabByGroup: { ...s.activeTabByGroup, [grp]: existing.id },
        ...(line !== undefined
          ? {
              pendingReveal: {
                filePath,
                line,
                column: column ?? 1,
                nonce: Date.now() + Math.random(),
              },
            }
          : {}),
        openTabs: s.openTabs.map((t) => {
          if (t.id !== existing.id) return t;
          return {
            ...t,
            isPreview: isPreview ? t.isPreview : false,
            ...(line !== undefined ? { cursorLine: line, cursorColumn: column ?? 1 } : {}),
          };
        }),
      }));
      return;
    }

    const content = await window.vsApi.fs.readFile(filePath);
    const title = filePath.split(/[/\\]/).pop() || filePath;
    const language = detectLanguage(filePath);
    const id = `code:${filePath}`;
    const projMeta = getProjectColor(get().solution, filePath);
    const liveDiags =
      language === 'csharp'
        ? analyzeCSharpCode(filePath, projMeta.projectName || get().solution?.name || 'Project', content)
        : undefined;

    const newTab: OpenTab = {
      id,
      kind: 'code',
      title,
      path: filePath,
      content,
      savedContent: content,
      language,
      isDirty: false,
      cursorLine: line ?? 1,
      cursorColumn: column ?? 1,
      isPreview,
      isPinned: false,
      groupId: targetGroup,
      ...projMeta,
    };

    set((s) => {
      // Another openFile() for the same path finished first (click + double-click): just activate it
      const already = s.openTabs.find((t) => t.id === id);
      if (already) {
        const g = already.groupId ?? 0;
        return {
          activeTabId: id,
          activeGroupId: g,
          activeTabByGroup: { ...s.activeTabByGroup, [g]: id },
          openTabs: isPreview ? s.openTabs : s.openTabs.map((t) => (t.id === id ? { ...t, isPreview: false } : t)),
        };
      }
      // If opening as Preview Tab, replace any existing unmodified preview tab in the same group
      let nextTabs = isPreview
        ? s.openTabs.filter((t) => !(t.isPreview && !t.isDirty && (t.groupId ?? 0) === targetGroup))
        : [...s.openTabs];
      nextTabs = [...nextTabs, newTab];
      return {
        openTabs: nextTabs,
        activeTabId: id,
        activeGroupId: targetGroup,
        activeTabByGroup: { ...s.activeTabByGroup, [targetGroup]: id },
        ...(line !== undefined
          ? {
              pendingReveal: {
                filePath,
                line,
                column: column ?? 1,
                nonce: Date.now() + Math.random(),
              },
            }
          : {}),
        ...(liveDiags
          ? {
              liveDiagnosticsByFile: {
                ...s.liveDiagnosticsByFile,
                [filePath]: liveDiags,
              },
            }
          : {}),
      };
    });

    if (language === 'csharp') {
      void window.vsApi?.lsp.didOpen(filePath, content);
    }
  },

  openNugetTab: (projectId) => {
    const id = `nuget:${projectId || 'solution'}`;
    const existing = get().openTabs.find((t) => t.id === id);
    if (existing) {
      const grp = existing.groupId ?? 0;
      set((s) => ({
        activeTabId: id,
        activeGroupId: grp,
        activeTabByGroup: { ...s.activeTabByGroup, [grp]: id },
      }));
      return;
    }
    const projIdx = get().solution?.projects.findIndex((p) => p.id === projectId) ?? -1;
    const proj = projIdx >= 0 ? get().solution?.projects[projIdx] : undefined;
    const grp = get().activeGroupId ?? 0;
    const newTab: OpenTab = {
      id,
      kind: 'nuget',
      title: proj ? `NuGet: ${proj.name}` : 'NuGet: Solution',
      path: id,
      content: '',
      savedContent: '',
      language: 'plaintext',
      isDirty: false,
      projectId,
      projectName: proj?.name,
      projectColor: projIdx >= 0 ? PROJECT_TAB_COLORS[projIdx % PROJECT_TAB_COLORS.length] : '#004880',
      groupId: grp,
    };
    set((s) => ({
      openTabs: [...s.openTabs, newTab],
      activeTabId: id,
      activeTabByGroup: { ...s.activeTabByGroup, [grp]: id },
    }));
  },

  openDiffTab: (title, filePath, original, modified) => {
    const id = `diff:${filePath}`;
    const existing = get().openTabs.find((t) => t.id === id);
    if (existing) {
      const grp = existing.groupId ?? 0;
      set((s) => ({
        openTabs: s.openTabs.map((t) =>
          t.id === id ? { ...t, diffOriginal: original, diffModified: modified } : t,
        ),
        activeTabId: id,
        activeGroupId: grp,
        activeTabByGroup: { ...s.activeTabByGroup, [grp]: id },
      }));
      return;
    }
    const grp = get().activeGroupId ?? 0;
    const projMeta = getProjectColor(get().solution, filePath);
    const newTab: OpenTab = {
      id,
      kind: 'diff',
      title: `Diff: ${title}`,
      path: filePath,
      content: modified,
      savedContent: modified,
      language: detectLanguage(filePath),
      isDirty: false,
      diffOriginal: original,
      diffModified: modified,
      groupId: grp,
      ...projMeta,
    };
    set((s) => ({
      openTabs: [...s.openTabs, newTab],
      activeTabId: id,
      activeTabByGroup: { ...s.activeTabByGroup, [grp]: id },
    }));
  },

  updateTabContent: (tabId, content) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    const liveDiags =
      tab.kind === 'code' && tab.language === 'csharp'
        ? analyzeCSharpCode(tab.path, tab.projectName || get().solution?.name || 'Project', content)
        : undefined;

    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId
          ? { ...t, content, isDirty: content !== t.savedContent, isPreview: false }
          : t,
      ),
      ...(liveDiags
        ? {
            liveDiagnosticsByFile: {
              ...s.liveDiagnosticsByFile,
              [tab.path]: liveDiags,
            },
            lspStaleByFile: {
              ...s.lspStaleByFile,
              [tab.path]: true,
            },
          }
        : {}),
    }));
    if (tab.kind === 'code' && tab.language === 'csharp') {
      void window.vsApi?.lsp.didChange(tab.path, content);
    }
  },

  setTabCursor: (tabId, line, column) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, cursorLine: line, cursorColumn: column } : t,
      ),
    }));
  },

  consumePendingReveal: () => set({ pendingReveal: null }),

  recordNavigation: (filePath, line, column) => {
    set((s) => {
      const current = s.navHistory[s.navIndex];
      if (current && current.filePath === filePath && Math.abs(current.line - line) <= 3) {
        return {};
      }
      const sliced = s.navHistory.slice(0, s.navIndex + 1);
      const next = [...sliced, { filePath, line, column }].slice(-50);
      return { navHistory: next, navIndex: next.length - 1 };
    });
  },

  navigateBack: async () => {
    const { navIndex, navHistory } = get();
    if (navIndex <= 0) return;
    const prevIdx = navIndex - 1;
    const item = navHistory[prevIdx];
    if (!item) return;
    set({ navIndex: prevIdx });
    await get().openFile(item.filePath, item.line, item.column, { skipHistory: true });
  },

  navigateForward: async () => {
    const { navIndex, navHistory } = get();
    if (navIndex < 0 || navIndex >= navHistory.length - 1) return;
    const nextIdx = navIndex + 1;
    const item = navHistory[nextIdx];
    if (!item) return;
    set({ navIndex: nextIdx });
    await get().openFile(item.filePath, item.line, item.column, { skipHistory: true });
  },

  dispatchEditorCommand: (command) => {
    set({ editorCommand: { id: Date.now() + Math.random(), command } });
  },

  saveTab: async (tabId) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'code') return;
    try {
      await window.vsApi.fs.writeFile(tab.path, tab.content);
    } catch (err) {
      set({ statusText: `Save failed: ${tab.title} – ${(err as Error)?.message ?? String(err)}` });
      return;
    }
    // Only the written snapshot is "saved" – edits typed during the write stay dirty
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId
          ? { ...t, savedContent: tab.content, isDirty: t.content !== tab.content, isPreview: false }
          : t,
      ),
      statusText: `Item(s) Saved (${tab.title})`,
    }));
    if (tab.language === 'csharp') {
      void window.vsApi?.lsp.didSave(tab.path, tab.content);
    }
    if (tab.path.endsWith('.csproj') || tab.path.endsWith('.sln') || tab.path.endsWith('.slnx')) {
      const sln = get().solution;
      if (sln) {
        const updated = (await window.vsApi.solution.open(sln.path)) as SolutionInfo;
        set({ solution: updated });
        await get().refreshSolutionTrees();
      }
    }
    void get().refreshGitStatus();
    void get().refreshTaskList();
  },

  saveAllTabs: async () => {
    const dirty = get().openTabs.filter((t) => t.kind === 'code' && t.isDirty);
    for (const tab of dirty) {
      await get().saveTab(tab.id);
    }
  },

  confirmCloseTabs: async (tabIds) => {
    const dirty = get().openTabs.filter((t) => tabIds.includes(t.id) && t.kind === 'code' && t.isDirty);
    if (dirty.length === 0) return true;
    let choice: 'save' | 'discard' | 'cancel';
    if (window.vsApi?.dialog?.confirmSave) {
      choice = await window.vsApi.dialog.confirmSave(dirty.map((t) => t.path || t.title));
    } else {
      choice = window.confirm(`Save changes to the following items?\n\n${dirty.map((t) => t.title).join('\n')}`)
        ? 'save'
        : 'cancel';
    }
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      for (const t of dirty) {
        await get().saveTab(t.id);
      }
      // Saving failed (e.g. permission denied) -> keep the document open
      if (get().openTabs.some((t) => tabIds.includes(t.id) && t.kind === 'code' && t.isDirty)) return false;
    }
    return true;
  },

  renamePathInTabs: (oldPath, newPath) => {
    const remap = (p: string) =>
      p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : null;
    set((s) => {
      const idMap = new Map<string, string>();
      const openTabs = s.openTabs.map((t) => {
        if (t.kind !== 'code') return t;
        const np = remap(t.path);
        if (!np) return t;
        const id = `code:${np}`;
        idMap.set(t.id, id);
        return {
          ...t,
          id,
          path: np,
          title: np.split('/').pop() || np,
          language: detectLanguage(np),
          ...getProjectColor(s.solution, np),
        };
      });
      const mapId = (id: string | null) => (id && idMap.has(id) ? idMap.get(id)! : id);
      const breakpoints = s.breakpoints.map((b) => {
        const np = remap(b.file);
        return np ? { ...b, file: np, id: `${np}:${b.line}` } : b;
      });
      return {
        openTabs,
        breakpoints,
        activeTabId: mapId(s.activeTabId),
        activeTabByGroup: { 0: mapId(s.activeTabByGroup[0] ?? null), 1: mapId(s.activeTabByGroup[1] ?? null) },
      };
    });
    void window.vsApi?.debug.syncBreakpoints(get().breakpoints);
  },

  closeTabsUnderPath: (deletedPath) => {
    const ids = get()
      .openTabs.filter((t) => t.kind === 'code' && (t.path === deletedPath || t.path.startsWith(deletedPath + '/')))
      .map((t) => t.id);
    withCloseBypass(() => {
      for (const id of ids) get().closeTab(id);
    });
    const breakpoints = get().breakpoints.filter(
      (b) => !(b.file === deletedPath || b.file.startsWith(deletedPath + '/')),
    );
    if (breakpoints.length !== get().breakpoints.length) {
      set({ breakpoints });
      void window.vsApi?.debug.syncBreakpoints(breakpoints);
    }
  },

  closeTab: (tabId) => {
    if (!closeGuardBypass) {
      const guardIds = [tabId];
      if (get().openTabs.some((t) => guardIds.includes(t.id) && t.kind === 'code' && t.isDirty)) {
        void get().confirmCloseTabs(guardIds).then((ok) => {
          if (ok) withCloseBypass(() => get().closeTab(tabId));
        });
        return;
      }
    }
    set((s) => {
      const target = s.openTabs.find((t) => t.id === tabId);
      const grp = target?.groupId ?? 0;
      const groupTabs = s.openTabs.filter((t) => (t.groupId ?? 0) === grp);
      const idxInGroup = groupTabs.findIndex((t) => t.id === tabId);
      const next = s.openTabs.filter((t) => t.id !== tabId);
      const nextGroupTabs = next.filter((t) => (t.groupId ?? 0) === grp);

      let nextGroupActive = s.activeTabByGroup[grp];
      if (nextGroupActive === tabId) {
        nextGroupActive = nextGroupTabs[idxInGroup]?.id ?? nextGroupTabs[idxInGroup - 1]?.id ?? null;
      }

      const nextActiveByGroup = { ...s.activeTabByGroup, [grp]: nextGroupActive };
      let nextSplit = s.splitMode;
      let nextActiveGroup = s.activeGroupId;
      if (grp === 1 && nextGroupTabs.length === 0) {
        nextSplit = 'none';
        nextActiveGroup = 0;
      }

      const nextActiveGlobal =
        s.activeTabId === tabId
          ? nextActiveByGroup[nextActiveGroup] ?? next[0]?.id ?? null
          : s.activeTabId;

      return {
        openTabs: next,
        activeTabId: nextActiveGlobal,
        activeTabByGroup: nextActiveByGroup,
        splitMode: nextSplit,
        activeGroupId: nextActiveGroup,
      };
    });
  },

  closeAllTabs: (groupId) => {
    if (!closeGuardBypass) {
      const guardIds = get().openTabs.filter((t) => groupId === undefined || (t.groupId ?? 0) === groupId).map((t) => t.id);
      if (get().openTabs.some((t) => guardIds.includes(t.id) && t.kind === 'code' && t.isDirty)) {
        void get().confirmCloseTabs(guardIds).then((ok) => {
          if (ok) withCloseBypass(() => get().closeAllTabs(groupId));
        });
        return;
      }
    }
    set((s) => {
      const next =
        groupId === undefined
          ? []
          : s.openTabs.filter((t) => (t.groupId ?? 0) !== groupId);
      const g0 = next.find((t) => (t.groupId ?? 0) === 0)?.id ?? null;
      const g1 = next.find((t) => (t.groupId ?? 0) === 1)?.id ?? null;
      return {
        openTabs: next,
        activeTabByGroup: { 0: g0, 1: g1 },
        activeTabId: g0 ?? g1,
        splitMode: g1 ? s.splitMode : 'none',
        activeGroupId: g0 ? 0 : g1 ? 1 : 0,
      };
    });
  },

  closeOtherTabs: (tabId) => {
    if (!closeGuardBypass) {
      const guardIds = (() => {
        const keep = get().openTabs.find((t) => t.id === tabId);
        const grp = keep?.groupId ?? 0;
        return get()
          .openTabs.filter((t) => (t.groupId ?? 0) === grp && t.id !== tabId && !t.isPinned)
          .map((t) => t.id);
      })();
      if (get().openTabs.some((t) => guardIds.includes(t.id) && t.kind === 'code' && t.isDirty)) {
        void get().confirmCloseTabs(guardIds).then((ok) => {
          if (ok) withCloseBypass(() => get().closeOtherTabs(tabId));
        });
        return;
      }
    }
    set((s) => {
      const keep = s.openTabs.find((t) => t.id === tabId);
      if (!keep) return {};
      const grp = keep.groupId ?? 0;
      const next = s.openTabs.filter((t) => (t.groupId ?? 0) !== grp || t.id === tabId || t.isPinned);
      return {
        openTabs: next,
        activeTabId: tabId,
        activeTabByGroup: { ...s.activeTabByGroup, [grp]: tabId },
      };
    });
  },

  closeTabsToRight: (tabId) => {
    if (!closeGuardBypass) {
      const guardIds = (() => {
        const target = get().openTabs.find((t) => t.id === tabId);
        const grp = target?.groupId ?? 0;
        const groupTabs = get().openTabs.filter((t) => (t.groupId ?? 0) === grp);
        const idx = groupTabs.findIndex((t) => t.id === tabId);
        return idx === -1 ? [] : groupTabs.slice(idx + 1).filter((t) => !t.isPinned).map((t) => t.id);
      })();
      if (get().openTabs.some((t) => guardIds.includes(t.id) && t.kind === 'code' && t.isDirty)) {
        void get().confirmCloseTabs(guardIds).then((ok) => {
          if (ok) withCloseBypass(() => get().closeTabsToRight(tabId));
        });
        return;
      }
    }
    set((s) => {
      const target = s.openTabs.find((t) => t.id === tabId);
      if (!target) return {};
      const grp = target.groupId ?? 0;
      const groupTabs = s.openTabs.filter((t) => (t.groupId ?? 0) === grp);
      const idx = groupTabs.findIndex((t) => t.id === tabId);
      const toRemove = new Set(groupTabs.slice(idx + 1).filter((t) => !t.isPinned).map((t) => t.id));
      const next = s.openTabs.filter((t) => !toRemove.has(t.id));
      const nextGroupActive = toRemove.has(s.activeTabByGroup[grp] || '') ? tabId : s.activeTabByGroup[grp];
      return {
        openTabs: next,
        activeTabId: toRemove.has(s.activeTabId || '') ? tabId : s.activeTabId,
        activeTabByGroup: { ...s.activeTabByGroup, [grp]: nextGroupActive },
      };
    });
  },

  closeTabsToLeft: (tabId) => {
    if (!closeGuardBypass) {
      const guardIds = (() => {
        const target = get().openTabs.find((t) => t.id === tabId);
        const grp = target?.groupId ?? 0;
        const groupTabs = get().openTabs.filter((t) => (t.groupId ?? 0) === grp);
        const idx = groupTabs.findIndex((t) => t.id === tabId);
        return idx === -1 ? [] : groupTabs.slice(0, idx).filter((t) => !t.isPinned).map((t) => t.id);
      })();
      if (get().openTabs.some((t) => guardIds.includes(t.id) && t.kind === 'code' && t.isDirty)) {
        void get().confirmCloseTabs(guardIds).then((ok) => {
          if (ok) withCloseBypass(() => get().closeTabsToLeft(tabId));
        });
        return;
      }
    }
    set((s) => {
      const target = s.openTabs.find((t) => t.id === tabId);
      if (!target) return {};
      const grp = target.groupId ?? 0;
      const groupTabs = s.openTabs.filter((t) => (t.groupId ?? 0) === grp);
      const idx = groupTabs.findIndex((t) => t.id === tabId);
      const toRemove = new Set(groupTabs.slice(0, idx).filter((t) => !t.isPinned).map((t) => t.id));
      const next = s.openTabs.filter((t) => !toRemove.has(t.id));
      const nextGroupActive = toRemove.has(s.activeTabByGroup[grp] || '') ? tabId : s.activeTabByGroup[grp];
      return {
        openTabs: next,
        activeTabId: toRemove.has(s.activeTabId || '') ? tabId : s.activeTabId,
        activeTabByGroup: { ...s.activeTabByGroup, [grp]: nextGroupActive },
      };
    });
  },

  togglePinTab: (tabId) => {
    set((s) => {
      const updated = s.openTabs.map((t) =>
        t.id === tabId ? { ...t, isPinned: !t.isPinned, isPreview: false } : t,
      );
      // Keep pinned tabs grouped before unpinned tabs within each document group
      updated.sort((a, b) => {
        if ((a.groupId ?? 0) !== (b.groupId ?? 0)) return (a.groupId ?? 0) - (b.groupId ?? 0);
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) return a.isPinned ? -1 : 1;
        return 0;
      });
      return { openTabs: updated };
    });
  },

  promotePreviewTab: (tabId) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.id === tabId ? { ...t, isPreview: false } : t)),
    }));
  },

  reorderTab: (fromTabId, toTabId) => {
    if (fromTabId === toTabId) return;
    set((s) => {
      const list = [...s.openTabs];
      const fromIdx = list.findIndex((t) => t.id === fromTabId);
      const toIdx = list.findIndex((t) => t.id === toTabId);
      if (fromIdx === -1 || toIdx === -1) return {};
      const targetGroup = list[toIdx].groupId ?? 0;
      const [moved] = list.splice(fromIdx, 1);
      moved.groupId = targetGroup;
      list.splice(toIdx, 0, moved);
      return { openTabs: list };
    });
  },

  moveTabToGroup: (tabId, targetGroupId) => {
    set((s) => {
      const target = s.openTabs.find((t) => t.id === tabId);
      if (!target) return {};
      const prevGroup = target.groupId ?? 0;
      const nextTabs = s.openTabs.map((t) =>
        t.id === tabId ? { ...t, groupId: targetGroupId, isPreview: false } : t,
      );
      const prevGroupRemaining = nextTabs.filter((t) => (t.groupId ?? 0) === prevGroup);
      const nextSplit: DocumentSplitMode =
        targetGroupId === 1
          ? s.splitMode === 'none'
            ? 'vertical'
            : s.splitMode
          : nextTabs.some((t) => (t.groupId ?? 0) === 1)
          ? s.splitMode
          : 'none';
      return {
        openTabs: nextTabs,
        splitMode: nextSplit,
        activeGroupId: targetGroupId,
        activeTabId: tabId,
        activeTabByGroup: {
          ...s.activeTabByGroup,
          [prevGroup]: prevGroupRemaining[0]?.id ?? null,
          [targetGroupId]: tabId,
        },
      };
    });
  },

  setSplitMode: (mode) => {
    set((s) => {
      if (mode === 'none') {
        // Merge group 1 tabs back into group 0
        const nextTabs = s.openTabs.map((t) => ({ ...t, groupId: 0 }));
        return {
          splitMode: 'none',
          activeGroupId: 0,
          openTabs: nextTabs,
          activeTabByGroup: { 0: s.activeTabId ?? nextTabs[0]?.id ?? null, 1: null },
        };
      }
      // If group 1 has no tabs yet and there are >=2 tabs in group 0, move active or last tab to group 1
      const hasGroup1 = s.openTabs.some((t) => (t.groupId ?? 0) === 1);
      if (!hasGroup1 && s.openTabs.length >= 2) {
        const toMove =
          s.openTabs.find((t) => t.id !== s.activeTabId) || s.openTabs[s.openTabs.length - 1];
        const nextTabs = s.openTabs.map((t) => (t.id === toMove.id ? { ...t, groupId: 1 } : t));
        return {
          splitMode: mode,
          openTabs: nextTabs,
          activeTabByGroup: {
            0: s.activeTabId ?? nextTabs.find((t) => (t.groupId ?? 0) === 0)?.id ?? null,
            1: toMove.id,
          },
        };
      }
      return { splitMode: mode };
    });
  },

  setActiveGroup: (groupId) => {
    const activeInGrp = get().activeTabByGroup[groupId] ?? get().openTabs.find((t) => (t.groupId ?? 0) === groupId)?.id ?? null;
    set({ activeGroupId: groupId, activeTabId: activeInGrp ?? get().activeTabId });
  },

  setActiveTab: (tabId, groupId) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    const grp = groupId ?? tab?.groupId ?? 0;
    set((s) => ({
      activeTabId: tabId,
      activeGroupId: grp,
      activeTabByGroup: { ...s.activeTabByGroup, [grp]: tabId },
    }));
  },

  insertSnippetIntoEditor: (text) => {
    set({ pendingInsertSnippet: { id: Date.now(), text } });
  },

  appendOutput: (channel, line) => {
    set((s) => {
      const existing = s.outputChannels[channel] || [];
      const next = existing.length > 2000 ? existing.slice(-1500) : existing;
      return {
        outputChannels: {
          ...s.outputChannels,
          [channel]: [...next, line],
        },
      };
    });
  },

  clearOutput: (channel) => {
    set((s) => ({
      outputChannels: {
        ...s.outputChannels,
        [channel]: [],
      },
    }));
  },

  setActiveOutputChannel: (activeOutputChannel) => set({ activeOutputChannel }),

  setLspDiagnostics: (file, items) => {
    set((s) => ({
      lspDiagnosticsByFile: {
        ...s.lspDiagnosticsByFile,
        [file]: items,
      },
      lspHasPublished: {
        ...s.lspHasPublished,
        [file]: true,
      },
      lspStaleByFile: {
        ...s.lspStaleByFile,
        [file]: false,
      },
    }));
  },

  buildSolution: async (mode, projectPath) => {
    const sln = get().solution;
    if (!sln) return false;
    // Like VS: a second build request while one is running is ignored
    if (get().isBuilding) return false;
    set({ isBuilding: true });
    try {
      await get().saveAllTabs();

    const target = projectPath || (sln.format === 'sln' || sln.format === 'slnx' ? sln.path : sln.projects[0]?.path || sln.dir);
    set({
      isBuilding: true,
      statusText: mode === 'clean' ? 'Clean started...' : 'Build started...',
      bottomOpen: true,
      bottomPanel: 'output',
      activeOutputChannel: 'Build',
    });

    if (mode === 'clean') {
      const res = (await window.vsApi.dotnet.clean({
        targetPath: target,
        configuration: get().activeConfiguration,
      })) as { success: boolean };
      set({
        isBuilding: false,
        buildDiagnostics: [],
        statusText: res.success ? 'Clean succeeded' : 'Clean failed',
      });
      return res.success;
    }

    const res = (await window.vsApi.dotnet.build({
      targetPath: target,
      configuration: get().activeConfiguration,
      noIncremental: mode === 'rebuild',
    })) as { success: boolean; diagnostics: DiagnosticItem[] };

    set({
      isBuilding: false,
      buildDiagnostics: res.diagnostics || [],
      statusText: res.success ? 'Build succeeded' : 'Build failed',
      bottomPanel: res.diagnostics?.length ? 'errorList' : 'output',
    });
    return res.success;
    } catch (err) {
      get().appendOutput('Build', `Build failed: ${(err as Error)?.message ?? String(err)}`);
      set({ statusText: 'Build failed' });
      return false;
    } finally {
      // Never leave the toolbar disabled when dotnet is missing or the IPC call throws
      if (get().isBuilding) set({ isBuilding: false });
    }
  },

  startDebugging: async (withDebugger) => {
    const sln = get().solution;
    if (!sln) return;
    const startup = sln.projects.find((p) => p.id === sln.startupProjectId) || sln.projects[0];
    if (!startup) return;
    // Ignore F5 key repeat / double clicks while a launch or build is in progress
    if (debugLaunchInProgress || get().isBuilding) return;
    // VS: F5 while paused = Continue, F5 while already debugging does nothing
    if (withDebugger && get().debugState === 'paused') {
      await get().continueDebugging();
      return;
    }
    if (withDebugger && get().debugState === 'running') return;
    debugLaunchInProgress = true;
    try {
    const ok = await get().buildSolution('build', startup.path);
    if (!ok) return;

    const cfg = get().activeConfiguration;
    const consoleMode = get().consoleLaunchMode;
    const isExeProject = startup.outputType.toLowerCase() === 'exe' || startup.outputType.toLowerCase() === 'winexe';
    const hasNetcoredbg = Boolean(get().envStatus?.netcoredbgPath);
    const useIntegratedTerminal =
      isExeProject &&
      consoleMode === 'integratedTerminal' &&
      (!withDebugger || !hasNetcoredbg);

    if (useIntegratedTerminal) {
      const cmd = `dotnet run --project "${startup.path}" -c ${cfg} --no-build`;
      set({
        bottomOpen: true,
        bottomPanel: 'terminal',
        debugState: 'stopped',
        statusText: `Running ${startup.name} in Terminal...`,
        pendingTerminalCommand: {
          id: Date.now() + Math.random(),
          command: cmd,
          cwd: startup.dir,
        },
      });
      return;
    }

    set({
      bottomOpen: true,
      bottomPanel: 'output',
      activeOutputChannel: 'Debug',
      debugState: 'running',
      statusText: withDebugger ? `Debugging ${startup.name}...` : `Running ${startup.name}...`,
    });

    // Like Visual Studio on Windows, automatically open the Debug Console Terminal window for Console / Exe projects
    if (isExeProject && consoleMode === 'externalWindow') {
      await window.vsApi.console.open();
    }

    if (withDebugger) {
      await window.vsApi.debug.start({
        csprojPath: startup.path,
        projectName: startup.name,
        targetFramework: startup.targetFramework,
        configuration: cfg,
        netcoredbgPath: get().envStatus?.netcoredbgPath || null,
        breakpoints: get().breakpoints,
        consoleMode,
      });
    } else {
      await window.vsApi.debug.startWithoutDebugging(startup.path, cfg, {
        projectName: startup.name,
        targetFramework: startup.targetFramework,
        consoleMode,
      });
    }
    } catch (err) {
      get().appendOutput('Debug', `Unable to start program: ${(err as Error)?.message ?? String(err)}`);
      set({ debugState: 'stopped', statusText: 'Ready' });
    } finally {
      debugLaunchInProgress = false;
    }
  },

  stopDebugging: async () => {
    await window.vsApi.debug.stop();
    set({
      debugState: 'stopped',
      debugFrames: [],
      debugLocals: [],
      debugPausedLocation: null,
      statusText: 'Ready',
    });
  },

  continueDebugging: async () => {
    set({ debugPausedLocation: null, debugState: 'running' });
    await window.vsApi.debug.continue();
  },
  stepOver: async () => {
    if (get().debugState !== 'paused') return;
    set({ debugPausedLocation: null, debugState: 'running' });
    await window.vsApi.debug.stepOver();
  },
  stepInto: async () => {
    if (get().debugState !== 'paused') return;
    set({ debugPausedLocation: null, debugState: 'running' });
    await window.vsApi.debug.stepInto();
  },
  stepOut: async () => {
    if (get().debugState !== 'paused') return;
    set({ debugPausedLocation: null, debugState: 'running' });
    await window.vsApi.debug.stepOut();
  },

  toggleBreakpoint: (file, line) => {
    const existing = get().breakpoints.find((b) => b.file === file && b.line === line);
    const next = existing
      ? get().breakpoints.filter((b) => b.id !== existing.id)
      : [...get().breakpoints, { id: `${file}:${line}`, file, line, enabled: true }];
    set({ breakpoints: next });
    void window.vsApi?.debug.syncBreakpoints(next);
  },

  toggleBreakpointEnabled: (id) => {
    const next = get().breakpoints.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b));
    set({ breakpoints: next });
    void window.vsApi?.debug.syncBreakpoints(next);
  },

  removeBreakpoint: (id) => {
    const next = get().breakpoints.filter((b) => b.id !== id);
    set({ breakpoints: next });
    void window.vsApi?.debug.syncBreakpoints(next);
  },

  addWatchExpression: async (expression) => {
    const id = `${Date.now()}-${Math.random()}`;
    let value = '<not debugging>';
    if (get().debugState === 'paused') {
      const topFrameId = get().debugFrames[0]?.id;
      value = await window.vsApi.debug.evaluate(expression, topFrameId);
    }
    set((s) => ({ watchExpressions: [...s.watchExpressions, { id, expression, value }] }));
  },

  removeWatchExpression: (id) => {
    set((s) => ({ watchExpressions: s.watchExpressions.filter((w) => w.id !== id) }));
  },

  refreshGitStatus: async () => {
    const sln = get().solution;
    if (!sln) return;
    const status = (await window.vsApi.git.status(sln.dir)) as GitStatusInfo;
    set({ gitStatus: status });
  },

  runTests: async (targetPath) => {
    const sln = get().solution;
    if (!sln) return;
    await get().saveAllTabs();
    const target = targetPath || (sln.format === 'sln' || sln.format === 'slnx' ? sln.path : sln.projects[0]?.path || sln.dir);
    set({
      bottomOpen: true,
      bottomPanel: 'testExplorer',
      statusText: 'Running tests...',
    });
    const res = (await window.vsApi.dotnet.test({
      targetPath: target,
      configuration: get().activeConfiguration,
    })) as { success: boolean; tests: TestCaseResult[] };
    set({
      tests: res.tests || [],
      statusText: res.success ? 'Test run finished' : 'Test run completed with failures',
    });
  },

  runSearchInFiles: async (query, opts) => {
    const sln = get().solution;
    if (!sln) return;
    const results = (await window.vsApi.fs.search(sln.dir, query, opts)) as SearchMatch[];
    set({
      searchResults: results,
      bottomOpen: true,
      bottomPanel: 'findResults',
    });
  },

  setSelectedPropertyTarget: (selectedPropertyTarget) => set({ selectedPropertyTarget }),
  setDock: (partial) => set(partial),
  setDialog: (partial) => set(partial),
}));
