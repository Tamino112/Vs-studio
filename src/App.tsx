import React, { useEffect } from 'react';
import { selectAllEffectiveDiagnostics, useIdeStore } from './store/useIdeStore';
import { StartWindow } from './components/StartWindow';
import { NewProjectWizard } from './components/NewProjectWizard';
import { TitleBarAndMenu } from './components/TitleBarAndMenu';
import { StandardToolbar } from './components/StandardToolbar';
import { SolutionExplorer } from './components/SolutionExplorer';
import { ClassViewPanel, ToolboxPanel } from './components/LeftExtraPanels';
import { CodeEditorPane } from './components/CodeEditorPane';
import { StatusBar } from './components/StatusBar';
import {
  DebugBottomPanel,
  ErrorListPanel,
  FindResultsPanel,
  ImmediateWindowPanel,
  OutputPanel,
  TaskListPanel,
  TerminalPanel,
  TestExplorerPanel,
} from './components/BottomPanels';
import { GitChangesPanel, PropertiesPanel } from './components/RightPanels';
import {
  AddNewItemDialog,
  CloneRepoDialog,
  FindInFilesDialog,
  ProjectReferenceDialog,
  QuickLaunchDialog,
  ToolsOptionsDialog,
} from './components/IdeDialogs';
import { DebugConsoleWindow } from './components/DebugConsoleWindow';
import { BottomPanelId, DiagnosticItem, LeftPanelId, OutputChannelName, RightPanelId } from './types/ide';

const isDebugConsoleView =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('view') === 'debug-console';

export const App: React.FC = () => {
  if (isDebugConsoleView) {
    return <DebugConsoleWindow />;
  }

  return <MainIdeApp />;
};

const MainIdeApp: React.FC = () => {
  const store = useIdeStore();

  useEffect(() => {
    void store.initApp();
    if (!window.vsApi) return;

    const unsubs = [
      window.vsApi.on('output:line', (payload) => {
        const p = payload as { channel: OutputChannelName; line: string };
        useIdeStore.getState().appendOutput(p.channel, p.line);
      }),
      window.vsApi.on('lsp:diagnostics', (payload) => {
        const p = payload as { file: string; diagnostics: DiagnosticItem[] };
        useIdeStore.getState().setLspDiagnostics(p.file, p.diagnostics);
      }),
      window.vsApi.on('debug:state', (state) => {
        useIdeStore.setState({ debugState: state as 'stopped' | 'running' | 'paused' });
      }),
      window.vsApi.on('debug:stopped', (data) => {
        const d = data as {
          file?: string;
          line?: number;
          frames: Array<{ id: number; name: string; file?: string; line?: number; column?: number }>;
          locals: Array<{ name: string; value: string; type: string }>;
        };
        useIdeStore.setState({
          debugState: 'paused',
          debugFrames: d.frames,
          debugLocals: d.locals,
          debugPausedLocation: { file: d.file, line: d.line },
          bottomOpen: true,
          bottomPanel: 'locals',
          statusText: 'Paused at breakpoint',
        });
        if (d.file) void useIdeStore.getState().openFile(d.file, d.line);
      }),
      window.vsApi.on('debug:exited', () => {
        useIdeStore.setState({
          debugState: 'stopped',
          debugFrames: [],
          debugLocals: [],
          debugPausedLocation: null,
          statusText: 'Ready',
        });
      }),
      window.vsApi.on('menu:command', (cmd) => {
        const s = useIdeStore.getState();
        if (cmd === 'file.newProject') s.setDialog({ newProjectOpen: true });
        else if (cmd === 'file.openSolution') {
          void window.vsApi.dialog.openSolution().then((p) => {
            if (p) void s.openSolution(p);
          });
        } else if (cmd === 'file.save' && s.activeTabId) void s.saveTab(s.activeTabId);
        else if (cmd === 'file.saveAll') void s.saveAllTabs();
        else if (cmd === 'file.closeSolution') s.closeSolution();
        else if (cmd === 'build.buildSolution') void s.buildSolution('build');
        else if (cmd === 'build.rebuildSolution') void s.buildSolution('rebuild');
        else if (cmd === 'build.cleanSolution') void s.buildSolution('clean');
        else if (cmd === 'debug.start') void s.startDebugging(true);
        else if (cmd === 'debug.startWithoutDebugging') void s.startDebugging(false);
        else if (cmd === 'debug.stop') void s.stopDebugging();
        else if (cmd === 'tools.options') s.setDialog({ toolsOptionsOpen: true });
      }),
    ];

    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global IDE Keyboard Shortcuts (macOS + Windows modes)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = useIdeStore.getState();
      const mod = s.keymap === 'macos' ? e.metaKey : e.ctrlKey;
      const targetEl = e.target as HTMLElement | null;
      const inEditor = Boolean(targetEl?.closest('.monaco-editor'));
      const inRegularInput =
        (targetEl?.tagName === 'INPUT' || targetEl?.tagName === 'TEXTAREA') &&
        !inEditor;

      if (mod && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        s.setDialog({ quickLaunchOpen: !s.quickLaunchOpen });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void window.vsApi.dialog.openSolution().then((p) => {
          if (p) void s.openSolution(p);
        });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        s.setDialog({ findInFilesOpen: true });
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'f' && !inRegularInput && !inEditor) {
        e.preventDefault();
        s.dispatchEditorCommand('find');
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        s.setDialog({ newProjectOpen: true });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.saveAllTabs();
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 's' && !inEditor) {
        if (s.activeTabId) {
          e.preventDefault();
          void s.saveTab(s.activeTabId);
        }
      } else if (mod && e.key.toLowerCase() === 'w') {
        if (s.activeTabId) {
          e.preventDefault();
          s.closeTab(s.activeTabId);
        }
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        void s.buildSolution(e.altKey ? 'rebuild' : 'build');
      } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f' && !inEditor) {
        e.preventDefault();
        s.dispatchEditorCommand('format');
      } else if (mod && e.key === '/' && !inEditor) {
        e.preventDefault();
        s.dispatchEditorCommand('comment');
      } else if ((e.ctrlKey || (s.keymap === 'macos' && e.metaKey)) && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        const isTerminalShowing = s.bottomOpen && s.bottomPanel === 'terminal';
        s.setDock({ bottomOpen: !isTerminalShowing, bottomPanel: 'terminal' });
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        s.setEditorZoom(s.editorZoom + 15);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        s.setEditorZoom(s.editorZoom - 15);
      } else if (e.key === 'F9' && !inEditor) {
        e.preventDefault();
        s.dispatchEditorCommand('toggleBreakpoint');
      } else if ((e.key === 'F5' && !e.shiftKey) || (s.keymap === 'macos' && e.metaKey && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        if (s.debugState === 'paused') void s.continueDebugging();
        else if (s.debugState === 'stopped') void s.startDebugging(!(e.ctrlKey || e.altKey));
      } else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault();
        void s.stopDebugging();
      } else if (e.key === 'F10') {
        e.preventDefault();
        if (s.debugState === 'paused') void s.stepOver();
      } else if (e.key === 'F11') {
        e.preventDefault();
        if (s.debugState === 'paused') {
          if (e.shiftKey) void s.stepOut();
          else void s.stepInto();
        }
      } else if (mod && e.key === ',') {
        e.preventDefault();
        s.setDialog({ toolsOptionsOpen: true });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const totalDiagCount = selectAllEffectiveDiagnostics(store).length;

  const leftTabs: Array<{ id: LeftPanelId; label: string; icon: string }> = [
    { id: 'solutionExplorer', label: 'Solution Explorer', icon: 'codicon-root-folder' },
    { id: 'classView', label: 'Class View', icon: 'codicon-symbol-class' },
    { id: 'toolbox', label: 'Toolbox', icon: 'codicon-tools' },
  ];

  const rightTabs: Array<{ id: RightPanelId; label: string; icon: string }> = [
    { id: 'properties', label: 'Properties', icon: 'codicon-wrench' },
    { id: 'gitChanges', label: 'Git Changes', icon: 'codicon-source-control' },
  ];

  const bottomTabs: Array<{ id: BottomPanelId; label: string; icon: string }> = [
    { id: 'errorList', label: 'Error List', icon: 'codicon-error' },
    { id: 'output', label: 'Output', icon: 'codicon-output' },
    { id: 'terminal', label: 'Terminal', icon: 'codicon-terminal' },
    { id: 'testExplorer', label: 'Test Explorer', icon: 'codicon-beaker' },
    { id: 'findResults', label: 'Find Results', icon: 'codicon-search' },
    { id: 'taskList', label: 'Task List', icon: 'codicon-checklist' },
    { id: 'locals', label: 'Locals', icon: 'codicon-symbol-variable' },
    { id: 'watch', label: 'Watch 1', icon: 'codicon-eye' },
    { id: 'callStack', label: 'Call Stack', icon: 'codicon-layers' },
    { id: 'breakpoints', label: 'Breakpoints', icon: 'codicon-debug-breakpoint' },
    { id: 'immediate', label: 'Immediate', icon: 'codicon-terminal-cmd' },
  ];

  const toggleLeftRailTab = (id: LeftPanelId) => {
    if (store.leftOpen && store.leftPanel === id) {
      store.setDock({ leftOpen: false });
    } else {
      store.setDock({ leftOpen: true, leftPanel: id });
    }
  };

  const toggleRightRailTab = (id: RightPanelId) => {
    if (store.rightOpen && store.rightPanel === id) {
      store.setDock({ rightOpen: false });
    } else {
      store.setDock({ rightOpen: true, rightPanel: id });
      if (id === 'gitChanges') void store.refreshGitStatus();
    }
  };

  return (
    <>
      {store.screen === 'start' ? (
        <StartWindow />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
          <TitleBarAndMenu />
          <StandardToolbar />

          {/* Main Visual Studio Dock Area */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            {/* Visual Studio Left Auto-Hide Edge Rail */}
            <div
              style={{
                width: 26,
                background: 'var(--vs-bg-chrome)',
                borderRight: '1px solid var(--vs-border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 6,
                gap: 4,
                flexShrink: 0,
              }}
            >
              {leftTabs.map((t) => {
                const active = store.leftOpen && store.leftPanel === t.id;
                return (
                  <button
                    key={t.id}
                    title={t.label}
                    onClick={() => toggleLeftRailTab(t.id)}
                    style={{
                      width: 22,
                      padding: '8px 0',
                      background: active ? 'var(--vs-bg-panel)' : 'transparent',
                      border: 'none',
                      borderRadius: 5,
                      borderLeft: active ? '2px solid var(--vs-accent)' : '2px solid transparent',
                      color: active ? 'var(--vs-fg-bright)' : 'var(--vs-fg-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span className={`codicon ${t.icon}`} style={{ fontSize: 13 }} />
                    <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10.5 }}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Left Dock (Solution Explorer / Class View / Toolbox) */}
            {store.leftOpen && (
              <div
                style={{
                  width: store.leftWidth,
                  minWidth: 210,
                  maxWidth: 480,
                  borderRight: '1px solid var(--vs-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--vs-bg-panel)',
                }}
              >
                <ToolWindowHeader
                  title={leftTabs.find((t) => t.id === store.leftPanel)?.label || 'Solution Explorer'}
                  active
                  pinned={store.leftPinned}
                  onTogglePin={() =>
                    store.setDock({
                      leftPinned: !store.leftPinned,
                      leftOpen: store.leftPinned ? false : true,
                    })
                  }
                  onClose={() => store.setDock({ leftOpen: false })}
                />
                <div style={{ flex: 1, minHeight: 0 }}>
                  {store.leftPanel === 'solutionExplorer' && <SolutionExplorer />}
                  {store.leftPanel === 'classView' && <ClassViewPanel />}
                  {store.leftPanel === 'toolbox' && <ToolboxPanel />}
                </div>
                <div
                  style={{
                    display: 'flex',
                    borderTop: '1px solid var(--vs-border)',
                    height: 26,
                    padding: '2px 4px 0',
                    gap: 2,
                    background: 'var(--vs-bg-chrome)',
                  }}
                >
                  {leftTabs.map((t) => {
                    const active = store.leftPanel === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => store.setDock({ leftPanel: t.id })}
                        style={{
                          flex: 1,
                          border: 'none',
                          borderRadius: '4px 4px 0 0',
                          borderBottom: active ? '2px solid var(--vs-accent)' : '2px solid transparent',
                          cursor: 'pointer',
                          background: active ? 'var(--vs-bg-panel)' : 'transparent',
                          color: active ? 'var(--vs-fg-bright)' : 'var(--vs-fg-muted)',
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          padding: '0 4px',
                        }}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Center Workspace + Bottom Dock */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <CodeEditorPane />
              </div>

              {store.bottomOpen ? (
                <div
                  style={{
                    height: store.bottomHeight,
                    minHeight: 120,
                    borderTop: '1px solid var(--vs-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--vs-bg)',
                  }}
                >
                  <ToolWindowHeader
                    title={bottomTabs.find((t) => t.id === store.bottomPanel)?.label || 'Output'}
                    active={false}
                    pinned={store.bottomPinned}
                    onTogglePin={() =>
                      store.setDock({
                        bottomPinned: !store.bottomPinned,
                        bottomOpen: store.bottomPinned ? false : true,
                      })
                    }
                    onClose={() => store.setDock({ bottomOpen: false })}
                  />
                  <div style={{ flex: 1, minHeight: 0 }}>
                    {store.bottomPanel === 'errorList' && <ErrorListPanel />}
                    {store.bottomPanel === 'output' && <OutputPanel />}
                    {store.bottomPanel === 'terminal' && <TerminalPanel />}
                    {store.bottomPanel === 'testExplorer' && <TestExplorerPanel />}
                    {store.bottomPanel === 'findResults' && <FindResultsPanel />}
                    {store.bottomPanel === 'taskList' && <TaskListPanel />}
                    {store.bottomPanel === 'immediate' && <ImmediateWindowPanel />}
                    {(store.bottomPanel === 'locals' ||
                      store.bottomPanel === 'watch' ||
                      store.bottomPanel === 'callStack' ||
                      store.bottomPanel === 'breakpoints') && (
                      <DebugBottomPanel tab={store.bottomPanel} />
                    )}
                  </div>
                  {/* Bottom Tool Window Tabs Strip */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--vs-bg-chrome)',
                      borderTop: '1px solid var(--vs-border)',
                      height: 26,
                      padding: '0 4px',
                      gap: 2,
                      overflowX: 'auto',
                    }}
                  >
                    {bottomTabs.map((t) => {
                      const active = store.bottomPanel === t.id;
                      const showCount = t.id === 'errorList' && totalDiagCount > 0;
                      return (
                        <button
                          key={t.id}
                          onClick={() => store.setDock({ bottomPanel: t.id })}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '0 10px',
                            height: 22,
                            background: active ? 'var(--vs-bg)' : 'transparent',
                            border: 'none',
                            borderRadius: 4,
                            borderBottom: active ? '2px solid var(--vs-accent)' : '2px solid transparent',
                            color: active ? 'var(--vs-fg-bright)' : 'var(--vs-fg-muted)',
                            cursor: 'pointer',
                            fontSize: 11.5,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span className={`codicon ${t.icon}`} style={{ fontSize: 12 }} />
                          <span>
                            {t.label}
                            {showCount ? ` (${totalDiagCount})` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Bottom Auto-Hide Restore Bar */
                <div
                  style={{
                    height: 24,
                    background: 'var(--vs-bg-chrome)',
                    borderTop: '1px solid var(--vs-border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '0 6px',
                    overflowX: 'auto',
                  }}
                >
                  {bottomTabs.slice(0, 6).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => store.setDock({ bottomOpen: true, bottomPanel: t.id })}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '1px 8px',
                        height: 20,
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        color: 'var(--vs-fg-muted)',
                        cursor: 'pointer',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span className={`codicon ${t.icon}`} style={{ fontSize: 11 }} />
                      <span>
                        {t.label}
                        {t.id === 'errorList' && totalDiagCount > 0 ? ` (${totalDiagCount})` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right Dock (Git Changes & Properties) */}
            {store.rightOpen && (
              <div
                style={{
                  width: store.rightWidth,
                  minWidth: 220,
                  maxWidth: 480,
                  borderLeft: '1px solid var(--vs-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--vs-bg-panel)',
                }}
              >
                <ToolWindowHeader
                  title={store.rightPanel === 'gitChanges' ? 'Git Changes' : 'Properties'}
                  active={false}
                  pinned={store.rightPinned}
                  onTogglePin={() =>
                    store.setDock({
                      rightPinned: !store.rightPinned,
                      rightOpen: store.rightPinned ? false : true,
                    })
                  }
                  onClose={() => store.setDock({ rightOpen: false })}
                />
                <div style={{ flex: 1, minHeight: 0 }}>
                  {store.rightPanel === 'gitChanges' ? <GitChangesPanel /> : <PropertiesPanel />}
                </div>
                <div
                  style={{
                    display: 'flex',
                    borderTop: '1px solid var(--vs-border)',
                    height: 26,
                    padding: '2px 4px 0',
                    gap: 2,
                    background: 'var(--vs-bg-chrome)',
                  }}
                >
                  <button
                    onClick={() => store.setDock({ rightPanel: 'properties' })}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: '4px 4px 0 0',
                      borderBottom: store.rightPanel === 'properties' ? '2px solid var(--vs-accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      background: store.rightPanel === 'properties' ? 'var(--vs-bg-panel)' : 'transparent',
                      color: store.rightPanel === 'properties' ? 'var(--vs-fg-bright)' : 'var(--vs-fg-muted)',
                      fontSize: 11.5,
                    }}
                  >
                    Properties
                  </button>
                  <button
                    onClick={() => {
                      store.setDock({ rightPanel: 'gitChanges' });
                      void store.refreshGitStatus();
                    }}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: '4px 4px 0 0',
                      borderBottom: store.rightPanel === 'gitChanges' ? '2px solid var(--vs-accent)' : '2px solid transparent',
                      cursor: 'pointer',
                      background: store.rightPanel === 'gitChanges' ? 'var(--vs-bg-panel)' : 'transparent',
                      color: store.rightPanel === 'gitChanges' ? 'var(--vs-fg-bright)' : 'var(--vs-fg-muted)',
                      fontSize: 11.5,
                    }}
                  >
                    Git Changes
                  </button>
                </div>
              </div>
            )}

            {/* Visual Studio Right Auto-Hide Edge Rail */}
            <div
              style={{
                width: 26,
                background: 'var(--vs-bg-chrome)',
                borderLeft: '1px solid var(--vs-border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 6,
                gap: 4,
                flexShrink: 0,
              }}
            >
              {rightTabs.map((t) => {
                const active = store.rightOpen && store.rightPanel === t.id;
                return (
                  <button
                    key={t.id}
                    title={t.label}
                    onClick={() => toggleRightRailTab(t.id)}
                    style={{
                      width: 22,
                      padding: '8px 0',
                      background: active ? 'var(--vs-bg-panel)' : 'transparent',
                      border: 'none',
                      borderRadius: 5,
                      borderRight: active ? '2px solid var(--vs-accent)' : '2px solid transparent',
                      color: active ? 'var(--vs-fg-bright)' : 'var(--vs-fg-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <span className={`codicon ${t.icon}`} style={{ fontSize: 13 }} />
                    <span style={{ writingMode: 'vertical-rl', fontSize: 10.5 }}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <StatusBar />
        </div>
      )}

      {/* Modals shared across Start Window & IDE */}
      <NewProjectWizard mode="newSolution" />
      <NewProjectWizard mode="addToSolution" />
      <AddNewItemDialog />
      <ProjectReferenceDialog />
      <FindInFilesDialog />
      <QuickLaunchDialog />
      <ToolsOptionsDialog />
      <CloneRepoDialog />
    </>
  );
};

const ToolWindowHeader: React.FC<{
  title: string;
  active: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
}> = ({ title, active, pinned, onTogglePin, onClose }) => (
  <div
    style={{
      height: 28,
      background: active ? 'var(--vs-bg-header-active)' : 'var(--vs-bg-header-inactive)',
      color: active ? 'var(--vs-fg-header-active)' : 'var(--vs-fg)',
      borderBottom: '1px solid var(--vs-border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 8px 0 10px',
      fontSize: 11.5,
      fontWeight: 600,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {active && (
        <span
          style={{
            width: 3,
            height: 13,
            borderRadius: 2,
            background: 'var(--vs-accent)',
          }}
        />
      )}
      <span>{title}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <button
        onClick={onTogglePin}
        title={pinned ? 'Auto Hide' : 'Dock / Pin'}
        style={{
          background: 'none',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
        }}
      >
        <span className={`codicon ${pinned ? 'codicon-pinned' : 'codicon-pin'}`} style={{ fontSize: 12 }} />
      </button>
      <button
        onClick={onClose}
        title="Hide"
        style={{
          background: 'none',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
        }}
      >
        <span className="codicon codicon-close" style={{ fontSize: 12 }} />
      </button>
    </div>
  </div>
);

export default App;
