import { create } from 'zustand';
import {
  BottomPanelId,
  Breakpoint,
  DebugStackFrame,
  DebugState,
  DebugVariable,
  DiagnosticItem,
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
  TestCaseResult,
  VsThemeId,
} from '../types/ide';
import { applyThemeToDom } from '../themes/vsThemes';

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

  buildDiagnostics: DiagnosticItem[];
  lspDiagnosticsByFile: Record<string, DiagnosticItem[]>;
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
  selectedPropertyTarget: {
    kind: 'solution' | 'project' | 'file';
    id: string;
    name: string;
    path: string;
  } | null;

  // Dock layout
  leftOpen: boolean;
  leftPanel: LeftPanelId;
  leftWidth: number;
  rightOpen: boolean;
  rightPanel: RightPanelId;
  rightWidth: number;
  bottomOpen: boolean;
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
  setScreen: (screen: 'start' | 'ide') => void;

  openSolution: (targetPath: string) => Promise<void>;
  closeSolution: () => void;
  refreshSolutionTrees: () => Promise<void>;
  setStartupProject: (projectId: string) => void;
  setConfiguration: (cfg: 'Debug' | 'Release') => void;
  setPlatform: (plat: 'Any CPU' | 'arm64' | 'x64') => void;

  openFile: (filePath: string, line?: number, column?: number) => Promise<void>;
  openNugetTab: (projectId?: string) => void;
  openDiffTab: (title: string, path: string, original: string, modified: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  setTabCursor: (tabId: string, line: number, column: number) => void;
  saveTab: (tabId: string) => Promise<void>;
  saveAllTabs: () => Promise<void>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

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

  setDock: (partial: Partial<Pick<IdeState, 'leftOpen' | 'leftPanel' | 'leftWidth' | 'rightOpen' | 'rightPanel' | 'rightWidth' | 'bottomOpen' | 'bottomPanel' | 'bottomHeight'>>) => void;
  setDialog: (partial: Partial<Pick<IdeState, 'newProjectOpen' | 'addNewProjectOpen' | 'addProjectRefSourceId' | 'addNewItemTargetDir' | 'findInFilesOpen' | 'quickLaunchOpen' | 'toolsOptionsOpen' | 'cloneRepoOpen'>>) => void;
  refreshEnvironment: () => Promise<void>;
  refreshRecent: () => Promise<void>;
}

const savedTheme = (localStorage.getItem('vs.theme') as VsThemeId) || 'dark';
const savedKeymap = (localStorage.getItem('vs.keymap') as KeymapMode) || 'macos';
applyThemeToDom(savedTheme);

export const useIdeStore = create<IdeState>((set, get) => ({
  screen: 'start',
  theme: savedTheme,
  keymap: savedKeymap,
  fontSize: 13,
  wordWrap: false,
  minimap: true,
  showAllFiles: false,

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

  buildDiagnostics: [],
  lspDiagnosticsByFile: {},
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
  selectedPropertyTarget: null,

  leftOpen: true,
  leftPanel: 'solutionExplorer',
  leftWidth: 280,
  rightOpen: false,
  rightPanel: 'properties',
  rightWidth: 300,
  bottomOpen: true,
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

  setFontSize: (fontSize) => set({ fontSize }),
  setWordWrap: (wordWrap) => set({ wordWrap }),
  setMinimap: (minimap) => set({ minimap }),
  setShowAllFiles: async (showAllFiles) => {
    set({ showAllFiles });
    await get().refreshSolutionTrees();
  },
  setScreen: (screen) => set({ screen }),

  openSolution: async (targetPath) => {
    const sln = (await window.vsApi.solution.open(targetPath)) as SolutionInfo;
    set({
      solution: sln,
      screen: 'ide',
      openTabs: [],
      activeTabId: null,
      buildDiagnostics: [],
      lspDiagnosticsByFile: {},
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
    void window.vsApi?.lsp.stop();
    void window.vsApi?.debug.stop();
    set({
      solution: null,
      projectTrees: {},
      openTabs: [],
      activeTabId: null,
      buildDiagnostics: [],
      lspDiagnosticsByFile: {},
      gitStatus: null,
      tests: [],
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

  setStartupProject: (projectId) => {
    const sln = get().solution;
    if (!sln) return;
    set({ solution: { ...sln, startupProjectId: projectId } });
  },

  setConfiguration: (activeConfiguration) => set({ activeConfiguration }),
  setPlatform: (activePlatform) => set({ activePlatform }),

  openFile: async (filePath, line, column) => {
    const existing = get().openTabs.find((t) => t.kind === 'code' && t.path === filePath);
    if (existing) {
      set({
        activeTabId: existing.id,
        openTabs: get().openTabs.map((t) =>
          t.id === existing.id && line !== undefined
            ? { ...t, cursorLine: line, cursorColumn: column ?? 1 }
            : t,
        ),
      });
      return;
    }

    const content = await window.vsApi.fs.readFile(filePath);
    const title = filePath.split(/[/\\]/).pop() || filePath;
    const language = detectLanguage(filePath);
    const id = `code:${filePath}`;
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
    };
    set((s) => ({
      openTabs: [...s.openTabs, newTab],
      activeTabId: id,
    }));

    if (language === 'csharp') {
      void window.vsApi.lsp.didOpen(filePath, content);
    }
  },

  openNugetTab: (projectId) => {
    const id = `nuget:${projectId || 'solution'}`;
    const existing = get().openTabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: id });
      return;
    }
    const proj = get().solution?.projects.find((p) => p.id === projectId);
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
    };
    set((s) => ({ openTabs: [...s.openTabs, newTab], activeTabId: id }));
  },

  openDiffTab: (title, filePath, original, modified) => {
    const id = `diff:${filePath}`;
    const existing = get().openTabs.find((t) => t.id === id);
    if (existing) {
      set({
        openTabs: get().openTabs.map((t) =>
          t.id === id ? { ...t, diffOriginal: original, diffModified: modified } : t,
        ),
        activeTabId: id,
      });
      return;
    }
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
    };
    set((s) => ({ openTabs: [...s.openTabs, newTab], activeTabId: id }));
  },

  updateTabContent: (tabId, content) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    if (!tab) return;
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: content !== t.savedContent } : t,
      ),
    }));
    if (tab.kind === 'code' && tab.language === 'csharp') {
      void window.vsApi.lsp.didChange(tab.path, content);
    }
  },

  setTabCursor: (tabId, line, column) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, cursorLine: line, cursorColumn: column } : t,
      ),
    }));
  },

  saveTab: async (tabId) => {
    const tab = get().openTabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== 'code') return;
    await window.vsApi.fs.writeFile(tab.path, tab.content);
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, savedContent: t.content, isDirty: false } : t,
      ),
      statusText: `Item(s) Saved (${tab.title})`,
    }));
    if (tab.language === 'csharp') {
      void window.vsApi.lsp.didSave(tab.path, tab.content);
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
  },

  saveAllTabs: async () => {
    const dirty = get().openTabs.filter((t) => t.kind === 'code' && t.isDirty);
    for (const tab of dirty) {
      await get().saveTab(tab.id);
    }
  },

  closeTab: (tabId) => {
    set((s) => {
      const idx = s.openTabs.findIndex((t) => t.id === tabId);
      const next = s.openTabs.filter((t) => t.id !== tabId);
      let nextActive = s.activeTabId;
      if (s.activeTabId === tabId) {
        nextActive = next[idx]?.id ?? next[idx - 1]?.id ?? null;
      }
      return { openTabs: next, activeTabId: nextActive };
    });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

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
    }));
  },

  buildSolution: async (mode, projectPath) => {
    const sln = get().solution;
    if (!sln) return false;
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
  },

  startDebugging: async (withDebugger) => {
    const sln = get().solution;
    if (!sln) return;
    const startup = sln.projects.find((p) => p.id === sln.startupProjectId) || sln.projects[0];
    if (!startup) return;

    const ok = await get().buildSolution('build', startup.path);
    if (!ok) return;

    set({
      bottomOpen: true,
      bottomPanel: 'output',
      activeOutputChannel: 'Debug',
      debugState: 'running',
      statusText: withDebugger ? `Debugging ${startup.name}...` : `Running ${startup.name}...`,
    });

    if (withDebugger) {
      await window.vsApi.debug.start({
        csprojPath: startup.path,
        projectName: startup.name,
        targetFramework: startup.targetFramework,
        configuration: get().activeConfiguration,
        netcoredbgPath: get().envStatus?.netcoredbgPath || null,
        breakpoints: get().breakpoints,
      });
    } else {
      await window.vsApi.debug.startWithoutDebugging(startup.path, get().activeConfiguration);
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
    await window.vsApi.debug.stepOver();
  },
  stepInto: async () => {
    await window.vsApi.debug.stepInto();
  },
  stepOut: async () => {
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
