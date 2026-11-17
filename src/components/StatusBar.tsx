import React from 'react';
import { selectAllEffectiveDiagnostics, useIdeStore } from '../store/useIdeStore';

export const StatusBar: React.FC = () => {
  const {
    solution,
    statusText,
    isBuilding,
    debugState,
    openTabs,
    activeTabId,
    gitStatus,
    buildDiagnostics,
    lspDiagnosticsByFile,
    liveDiagnosticsByFile,
    lspHasPublished,
    lspStaleByFile,
    keymap,
    editorZoom,
    setDock,
  } = useIdeStore();

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const allDiags = selectAllEffectiveDiagnostics({
    buildDiagnostics,
    lspDiagnosticsByFile,
    liveDiagnosticsByFile,
    lspHasPublished,
    lspStaleByFile,
    openTabs,
  });
  const errorCount = allDiags.filter((d) => d.severity === 'error').length;
  const warnCount = allDiags.filter((d) => d.severity === 'warning').length;

  const bg =
    debugState !== 'stopped' || isBuilding
      ? 'var(--vs-status-debug)'
      : solution
      ? 'var(--vs-status-ready)'
      : 'var(--vs-status-idle)';

  return (
    <div
      style={{
        height: 24,
        background: bg,
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        fontSize: 11.5,
        transition: 'background 0.2s ease',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {(isBuilding || debugState === 'running') && (
            <span className="codicon codicon-sync codicon-modifier-spin" style={{ fontSize: 12 }} />
          )}
          <span>{statusText}</span>
        </div>

        <button
          onClick={() => setDock({ bottomOpen: true, bottomPanel: 'errorList' })}
          title="Open Error List"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            borderRadius: 4,
            padding: '1px 6px',
            color: '#FFFFFF',
            cursor: 'pointer',
            fontSize: 11.5,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="codicon codicon-error" style={{ fontSize: 12 }} /> {errorCount}
          <span className="codicon codicon-warning" style={{ fontSize: 12, marginLeft: 4 }} /> {warnCount}
        </button>

        {gitStatus?.isRepo && (
          <button
            onClick={() => setDock({ rightOpen: true, rightPanel: 'gitChanges' })}
            title="Open Git Changes"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              borderRadius: 4,
              padding: '1px 6px',
              color: '#FFFFFF',
              cursor: 'pointer',
              fontSize: 11.5,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="codicon codicon-source-control" style={{ fontSize: 12 }} />
            <span>{gitStatus.branch}</span>
            {gitStatus.changes.length > 0 && <span>({gitStatus.changes.length})</span>}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {activeTab?.kind === 'code' && (
          <>
            <span>
              Ln {activeTab.cursorLine ?? 1} &nbsp; Ch {activeTab.cursorColumn ?? 1}
            </span>
            <span>{editorZoom}%</span>
            <span>Spaces: 4</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span>{activeTab.language === 'csharp' ? 'C#' : activeTab.language.toUpperCase()}</span>
          </>
        )}
        <span>{keymap === 'macos' ? 'Keymap: macOS' : 'Keymap: Windows'}</span>
      </div>
    </div>
  );
};
