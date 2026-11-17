import React, { useEffect } from 'react';
import { useIdeStore } from './store/useIdeStore';
import { StartWindow } from './components/StartWindow';
import { NewProjectWizard } from './components/NewProjectWizard';
import { TitleBarAndMenu } from './components/TitleBarAndMenu';
import { StandardToolbar } from './components/StandardToolbar';
import { SolutionExplorer } from './components/SolutionExplorer';
import { CodeEditorPane } from './components/CodeEditorPane';
import { StatusBar } from './components/StatusBar';
import {
  DebugBottomPanel,
  ErrorListPanel,
  FindResultsPanel,
  OutputPanel,
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
import { BottomPanelId, DiagnosticItem, OutputChannelName } from './types/ide';

export const App: React.FC = () => {
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
        else if (cmd === 'file.save' && s.activeTabId) void s.saveTab(s.activeTabId);
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
      const s = useIdeStore.getState();
      const mod = s.keymap === 'macos' ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        s.setDialog({ quickLaunchOpen: !s.quickLaunchOpen });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        s.setDialog({ findInFilesOpen: true });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        s.setDialog({ newProjectOpen: true });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.saveAllTabs();
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        void s.buildSolution(e.altKey ? 'rebuild' : 'build');
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

  const bottomTabs: Array<{ id: BottomPanelId; label: string; icon: string }> = [
    { id: 'errorList', label: 'Error List', icon: 'codicon-error' },
    { id: 'output', label: 'Output', icon: 'codicon-output' },
    { id: 'terminal', label: 'Terminal', icon: 'codicon-terminal' },
    { id: 'testExplorer', label: 'Test Explorer', icon: 'codicon-beaker' },
    { id: 'findResults', label: 'Find Results', icon: 'codicon-search' },
    { id: 'locals', label: 'Locals', icon: 'codicon-symbol-variable' },
    { id: 'watch', label: 'Watch 1', icon: 'codicon-eye' },
    { id: 'callStack', label: 'Call Stack', icon: 'codicon-layers' },
    { id: 'breakpoints', label: 'Breakpoints', icon: 'codicon-debug-breakpoint' },
  ];

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
            {/* Left Dock (Solution Explorer) */}
            {store.leftOpen && (
              <div
                style={{
                  width: store.leftWidth,
                  minWidth: 200,
                  maxWidth: 480,
                  borderRight: '1px solid var(--vs-border)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <ToolWindowHeader
                  title="Solution Explorer"
                  active
                  onClose={() => store.setDock({ leftOpen: false })}
                />
                <div style={{ flex: 1, minHeight: 0 }}>
                  <SolutionExplorer />
                </div>
              </div>
            )}

            {/* Center Workspace + Bottom Dock */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <CodeEditorPane />
              </div>

              {store.bottomOpen && (
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
                    onClose={() => store.setDock({ bottomOpen: false })}
                  />
                  <div style={{ flex: 1, minHeight: 0 }}>
                    {store.bottomPanel === 'errorList' && <ErrorListPanel />}
                    {store.bottomPanel === 'output' && <OutputPanel />}
                    {store.bottomPanel === 'terminal' && <TerminalPanel />}
                    {store.bottomPanel === 'testExplorer' && <TestExplorerPanel />}
                    {store.bottomPanel === 'findResults' && <FindResultsPanel />}
                    {(store.bottomPanel === 'locals' ||
                      store.bottomPanel === 'watch' ||
                      store.bottomPanel === 'callStack' ||
                      store.bottomPanel === 'breakpoints') && (
                      <DebugBottomPanel tab={store.bottomPanel} />
                    )}
                  </div>
                  {/* Bottom Tool Window Tabs Strip (Visual Studio style at bottom!) */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--vs-bg-panel)',
                      borderTop: '1px solid var(--vs-border)',
                      height: 24,
                      overflowX: 'auto',
                    }}
                  >
                    {bottomTabs.map((t) => {
                      const active = store.bottomPanel === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => store.setDock({ bottomPanel: t.id })}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '0 10px',
                            height: '100%',
                            background: active ? 'var(--vs-bg)' : 'transparent',
                            border: 'none',
                            borderRight: '1px solid var(--vs-border-subtle)',
                            borderBottom: active ? '2px solid var(--vs-accent)' : '2px solid transparent',
                            color: active ? 'var(--vs-fg-bright)' : 'var(--vs-fg)',
                            cursor: 'pointer',
                            fontSize: 11.5,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span className={`codicon ${t.icon}`} style={{ fontSize: 12 }} />
                          <span>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
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
                  onClose={() => store.setDock({ rightOpen: false })}
                />
                <div style={{ flex: 1, minHeight: 0 }}>
                  {store.rightPanel === 'gitChanges' ? <GitChangesPanel /> : <PropertiesPanel />}
                </div>
                <div
                  style={{
                    display: 'flex',
                    borderTop: '1px solid var(--vs-border)',
                    height: 24,
                    background: 'var(--vs-bg-panel)',
                  }}
                >
                  <button
                    onClick={() => store.setDock({ rightPanel: 'properties' })}
                    style={{
                      flex: 1,
                      border: 'none',
                      cursor: 'pointer',
                      background: store.rightPanel === 'properties' ? 'var(--vs-bg)' : 'transparent',
                      color: 'var(--vs-fg)',
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
                      cursor: 'pointer',
                      background: store.rightPanel === 'gitChanges' ? 'var(--vs-bg)' : 'transparent',
                      color: 'var(--vs-fg)',
                      fontSize: 11.5,
                    }}
                  >
                    Git Changes
                  </button>
                </div>
              </div>
            )}
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
  onClose: () => void;
}> = ({ title, active, onClose }) => (
  <div
    style={{
      height: 22,
      background: active ? 'var(--vs-bg-header-active)' : 'var(--vs-bg-header-inactive)',
      color: active ? 'var(--vs-fg-header-active)' : 'var(--vs-fg)',
      borderBottom: '1px solid var(--vs-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 8px',
      fontSize: 11.5,
      fontWeight: 500,
    }}
  >
    <span>{title}</span>
    <button
      onClick={onClose}
      title="Hide"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        display: 'inline-flex',
      }}
    >
      <span className="codicon codicon-close" style={{ fontSize: 12 }} />
    </button>
  </div>
);

export default App;
