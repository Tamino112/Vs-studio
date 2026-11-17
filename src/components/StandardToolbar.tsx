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
    setDialog,
    leftOpen,
    rightOpen,
    setDock,
  } = useIdeStore();

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const startupProject =
    solution?.projects.find((p) => p.id === solution.startupProjectId) || solution?.projects[0];
  const runnableProjects = solution?.projects || [];

  return (
    <div
      style={{
        height: 30,
        background: 'var(--vs-bg-toolbar)',
        borderBottom: '1px solid var(--vs-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        gap: 4,
        overflowX: 'auto',
      }}
    >
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
        disabled={!activeTab || activeTab.kind !== 'code'}
        onClick={() => activeTab && saveTab(activeTab.id)}
      />
      <ToolbarIconBtn icon="codicon-save-all" title="Save All" onClick={() => saveAllTabs()} />

      <ToolbarSep />

      {/* Build Config & Platform */}
      <select
        className="vs-select"
        value={activeConfiguration}
        onChange={(e) => setConfiguration(e.target.value as 'Debug' | 'Release')}
        title="Solution Configurations"
        style={{ height: 22, fontSize: 11 }}
      >
        <option value="Debug">Debug</option>
        <option value="Release">Release</option>
      </select>

      <select
        className="vs-select"
        value={activePlatform}
        onChange={(e) => setPlatform(e.target.value as 'Any CPU' | 'arm64' | 'x64')}
        title="Solution Platforms"
        style={{ height: 22, fontSize: 11 }}
      >
        <option value="Any CPU">Any CPU</option>
        <option value="arm64">arm64 (Apple Silicon)</option>
        <option value="x64">x64</option>
      </select>

      <ToolbarSep />

      {/* Iconic Visual Studio Green Play / Startup Project Control */}
      {debugState === 'stopped' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            disabled={!startupProject || isBuilding}
            onClick={() => startDebugging(true)}
            title="Start Debugging (F5)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 22,
              padding: '0 8px',
              background: 'var(--vs-bg-input)',
              border: '1px solid var(--vs-border)',
              borderRadius: 2,
              cursor: startupProject && !isBuilding ? 'pointer' : 'default',
              opacity: startupProject ? 1 : 0.45,
              fontSize: 12,
              color: 'var(--vs-fg-bright)',
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
              style={{ height: 22, fontSize: 11, maxWidth: 140 }}
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
            onClick={() => startDebugging(false)}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {debugState === 'paused' ? (
            <ToolbarIconBtn
              icon="codicon-debug-continue"
              iconColor="var(--vs-play-green)"
              title="Continue (F5)"
              onClick={() => continueDebugging()}
            />
          ) : (
            <ToolbarIconBtn
              icon="codicon-debug-pause"
              iconColor="var(--vs-info)"
              title="Break All"
              onClick={() => window.vsApi.debug.pause()}
            />
          )}
          <ToolbarIconBtn
            icon="codicon-debug-stop"
            iconColor="var(--vs-stop-red)"
            title="Stop Debugging (Shift+F5)"
            onClick={() => stopDebugging()}
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
            onClick={() => stepInto()}
          />
          <ToolbarIconBtn
            icon="codicon-debug-step-over"
            iconColor="var(--vs-info)"
            title="Step Over (F10)"
            disabled={debugState !== 'paused'}
            onClick={() => stepOver()}
          />
          <ToolbarIconBtn
            icon="codicon-debug-step-out"
            iconColor="var(--vs-info)"
            title="Step Out (Shift+F11)"
            disabled={debugState !== 'paused'}
            onClick={() => stepOut()}
          />
        </div>
      )}

      <ToolbarSep />

      <ToolbarIconBtn
        icon="codicon-tools"
        title="Build Solution"
        disabled={!solution || isBuilding}
        onClick={() => buildSolution('build')}
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
  <div style={{ width: 1, height: 18, background: 'var(--vs-border)', margin: '0 4px' }} />
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
      width: 24,
      height: 22,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? 'var(--vs-bg-selection)' : 'transparent',
      border: '1px solid transparent',
      borderRadius: 2,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      color: iconColor || 'var(--vs-fg)',
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
