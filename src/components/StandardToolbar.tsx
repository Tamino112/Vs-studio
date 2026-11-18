import React from 'react';
import { useIdeStore } from '../store/useIdeStore';

export const StandardToolbar: React.FC = () => {
  const {
    solution,
    activeConfiguration,
    activePlatform,
    setConfiguration,
    setPlatform,
    setStartupProject,
    openTabs,
    activeTabId,
    saveTab,
    saveAllTabs,
    buildSolution,
    startDebugging,
    stopDebugging,
    continueDebugging,
    stepOver,
    stepInto,
    stepOut,
    debugState,
    isBuilding,
    consoleWindowOpen,
    terminalSessionOpen,
    bottomOpen,
    bottomPanel,
    closeActiveTerminalOrConsole,
    setDialog,
    leftOpen,
    rightOpen,
    setDock,
    navHistory,
    navIndex,
    navigateBack,
    navigateForward,
    dispatchEditorCommand,
  } = useIdeStore();

  const hasOpenTerminalOrConsole =
    consoleWindowOpen || terminalSessionOpen || (bottomOpen && bottomPanel === 'terminal');
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const isCodeTab = Boolean(activeTab && activeTab.kind === 'code');
  const canGoBack = navIndex > 0;
  const canGoForward = navIndex >= 0 && navIndex < navHistory.length - 1;
  const startupProject =
    solution?.projects.find((p) => p.id === solution.startupProjectId) || solution?.projects[0];
  const runnableProjects = solution?.projects || [];

  return (
    <div
      style={{
        height: 34,
        background: 'var(--vs-bg-toolbar)',
        borderBottom: '1px solid var(--vs-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 3,
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Navigation History */}
      <ToolbarIconBtn
        icon="codicon-arrow-left"
        title="Navigate Backward"
        disabled={!canGoBack}
        onClick={() => void navigateBack()}
      />
      <ToolbarIconBtn
        icon="codicon-arrow-right"
        title="Navigate Forward"
        disabled={!canGoForward}
        onClick={() => void navigateForward()}
      />

      <ToolbarSep />

      {/* File actions */}
      <ToolbarIconBtn
        icon="codicon-new-file"
        title="New Project..."
        onClick={() => setDialog({ newProjectOpen: true })}
      />
      <ToolbarIconBtn
        icon="codicon-folder-opened"
        title="Open Project/Solution..."
        onClick={async () => {
          const p = await window.vsApi.dialog.openSolution();
          if (p) await useIdeStore.getState().openSolution(p);
        }}
      />
      <ToolbarIconBtn
        icon="codicon-save"
        title="Save"
        disabled={!isCodeTab}
        onClick={() => activeTab && void saveTab(activeTab.id)}
      />
      <ToolbarIconBtn icon="codicon-save-all" title="Save All" onClick={() => void saveAllTabs()} />

      <ToolbarSep />

      {/* Undo / Redo & Code Editing Actions */}
      <ToolbarIconBtn
        icon="codicon-discard"
        title="Undo"
        disabled={!isCodeTab}
        onClick={() => dispatchEditorCommand('undo')}
      />
      <ToolbarIconBtn
        icon="codicon-redo"
        title="Redo"
        disabled={!isCodeTab}
        onClick={() => dispatchEditorCommand('redo')}
      />

      <ToolbarSep />

      <ToolbarIconBtn
        icon="codicon-comment"
        title="Comment out the selected lines"
        disabled={!isCodeTab}
        onClick={() => dispatchEditorCommand('comment')}
      />
      <ToolbarIconBtn
        icon="codicon-clear-all"
        title="Uncomment the selected lines"
        disabled={!isCodeTab}
        onClick={() => dispatchEditorCommand('uncomment')}
      />
      <ToolbarIconBtn
        icon="codicon-wand"
        title="Format Document (Shift+Alt+F)"
        disabled={!isCodeTab}
        onClick={() => dispatchEditorCommand('format')}
      />

      <ToolbarSep />

      {/* Build Config & Platform */}
      <select
        className="vs-select"
        value={activeConfiguration}
        onChange={(e) => setConfiguration(e.target.value as 'Debug' | 'Release')}
        title="Solution Configurations"
        style={{ height: 24, fontSize: 11.5 }}
      >
        <option value="Debug">Debug</option>
        <option value="Release">Release</option>
      </select>

      <select
        className="vs-select"
        value={activePlatform}
        onChange={(e) => setPlatform(e.target.value as 'Any CPU' | 'arm64' | 'x64')}
        title="Solution Platforms"
        style={{ height: 24, fontSize: 11.5 }}
      >
        <option value="Any CPU">Any CPU</option>
        <option value="arm64">{window.vsApi?.platform === 'darwin' ? 'arm64 (Apple Silicon)' : 'arm64'}</option>
        <option value="x64">x64</option>
      </select>

      <ToolbarSep />

      {/* Iconic Visual Studio Green Play / Startup Project Control */}
      {debugState === 'stopped' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button
            disabled={!startupProject || isBuilding}
            onClick={() => void startDebugging(true)}
            title="Start Debugging (F5)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 24,
              padding: '0 10px',
              background: 'var(--vs-bg-input)',
              border: '1px solid var(--vs-border)',
              borderRadius: 6,
              cursor: startupProject && !isBuilding ? 'pointer' : 'default',
              opacity: startupProject ? 1 : 0.45,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--vs-fg-bright)',
              transition: 'border-color 0.12s ease, background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              if (startupProject && !isBuilding) {
                e.currentTarget.style.background = 'var(--vs-bg-hover)';
                e.currentTarget.style.borderColor = 'var(--vs-accent)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--vs-bg-input)';
              e.currentTarget.style.borderColor = 'var(--vs-border)';
            }}
          >
            <span
              className="codicon codicon-play"
              style={{ color: 'var(--vs-play-green)', fontSize: 14 }}
            />
            <span>{startupProject ? startupProject.name : 'Start'}</span>
          </button>

          {runnableProjects.length > 1 && (
            <select
              className="vs-select"
              value={startupProject?.id || ''}
              onChange={(e) => setStartupProject(e.target.value)}
              title="Select Startup Project"
              style={{ height: 24, fontSize: 11.5, maxWidth: 145 }}
            >
              {runnableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  Startup: {p.name}
                </option>
              ))}
            </select>
          )}

          <ToolbarIconBtn
            icon="codicon-run"
            iconColor="var(--vs-play-green)"
            title="Start Without Debugging"
            disabled={!startupProject || isBuilding}
            onClick={() => void startDebugging(false)}
          />

          {hasOpenTerminalOrConsole && (
            <ToolbarIconBtn
              icon="codicon-close"
              iconColor="var(--vs-stop-red)"
              title="Close Open Terminal / Console"
              onClick={() => void closeActiveTerminalOrConsole()}
            />
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {debugState === 'paused' ? (
            <ToolbarIconBtn
              icon="codicon-debug-continue"
              iconColor="var(--vs-play-green)"
              title="Continue (F5)"
              onClick={() => void continueDebugging()}
            />
          ) : (
            <ToolbarIconBtn
              icon="codicon-debug-pause"
              iconColor="var(--vs-info)"
              title="Break All"
              onClick={() => void window.vsApi.debug.pause()}
            />
          )}
          <ToolbarIconBtn
            icon="codicon-debug-stop"
            iconColor="var(--vs-stop-red)"
            title="Stop Debugging (Shift+F5)"
            onClick={() => void stopDebugging()}
          />
          <ToolbarIconBtn
            icon="codicon-close"
            iconColor="var(--vs-stop-red)"
            title="Close Open Terminal / Console"
            onClick={() => void closeActiveTerminalOrConsole()}
          />
          <ToolbarIconBtn
            icon="codicon-debug-restart"
            iconColor="var(--vs-play-green)"
            title="Restart"
            onClick={async () => {
              await stopDebugging();
              await startDebugging(true);
            }}
          />
          <ToolbarSep />
          <ToolbarIconBtn
            icon="codicon-debug-step-into"
            iconColor="var(--vs-info)"
            title="Step Into (F11)"
            disabled={debugState !== 'paused'}
            onClick={() => void stepInto()}
          />
          <ToolbarIconBtn
            icon="codicon-debug-step-over"
            iconColor="var(--vs-info)"
            title="Step Over (F10)"
            disabled={debugState !== 'paused'}
            onClick={() => void stepOver()}
          />
          <ToolbarIconBtn
            icon="codicon-debug-step-out"
            iconColor="var(--vs-info)"
            title="Step Out (Shift+F11)"
            disabled={debugState !== 'paused'}
            onClick={() => void stepOut()}
          />
        </div>
      )}

      <ToolbarSep />

      <ToolbarIconBtn
        icon="codicon-tools"
        title="Build Solution"
        disabled={!solution || isBuilding}
        onClick={() => void buildSolution('build')}
      />
      <ToolbarIconBtn
        icon="codicon-search"
        title="Find in Files"
        disabled={!solution}
        onClick={() => setDialog({ findInFilesOpen: true })}
      />

      <div style={{ flex: 1 }} />

      <ToolbarIconBtn
        icon="codicon-files"
        title="Toggle Solution Explorer"
        active={leftOpen}
        onClick={() => setDock({ leftOpen: !leftOpen, leftPanel: 'solutionExplorer' })}
      />
      <ToolbarIconBtn
        icon="codicon-source-control"
        title="Git Changes"
        onClick={() => setDock({ rightOpen: true, rightPanel: 'gitChanges' })}
      />
      <ToolbarIconBtn
        icon="codicon-list-flat"
        title="Properties Window"
        active={rightOpen}
        onClick={() => setDock({ rightOpen: !rightOpen, rightPanel: 'properties' })}
      />
    </div>
  );
};

const ToolbarSep: React.FC = () => (
  <div style={{ width: 1, height: 18, background: 'var(--vs-border)', margin: '0 4px', flexShrink: 0 }} />
);

const ToolbarIconBtn: React.FC<{
  icon: string;
  title: string;
  disabled?: boolean;
  active?: boolean;
  iconColor?: string;
  onClick: () => void;
}> = ({ icon, title, disabled, active, iconColor, onClick }) => (
  <button
    disabled={disabled}
    title={title}
    onClick={onClick}
    style={{
      width: 26,
      height: 24,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? 'var(--vs-bg-selection)' : 'transparent',
      border: '1px solid transparent',
      borderRadius: 5,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.38 : 1,
      color: active ? '#FFFFFF' : iconColor || 'var(--vs-fg)',
      transition: 'background 0.12s ease',
      flexShrink: 0,
    }}
    onMouseEnter={(e) => {
      if (!disabled && !active) e.currentTarget.style.background = 'var(--vs-bg-hover)';
    }}
    onMouseLeave={(e) => {
      if (!active) e.currentTarget.style.background = 'transparent';
    }}
  >
    <span className={`codicon ${icon}`} style={{ fontSize: 14 }} />
  </button>
);
