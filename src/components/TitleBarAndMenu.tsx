import React, { useEffect, useRef, useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { getShortcutLabels } from '../keymaps/vsKeymaps';
import { VsLogoIcon } from './VsIcons';

interface MenuEntry {
  label?: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  action?: () => void;
}

export const TitleBarAndMenu: React.FC = () => {
  const store = useIdeStore();
  const shortcuts = getShortcutLabels(store.keymap);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, []);

  const hasSolution = Boolean(store.solution);
  const activeTab = store.openTabs.find((t) => t.id === store.activeTabId);

  const handleOpenSolutionDialog = async () => {
    const p = await window.vsApi.dialog.openSolution();
    if (p) await store.openSolution(p);
  };

  const handleOpenFolderDialog = async () => {
    const p = await window.vsApi.dialog.openFolder();
    if (p) await store.openSolution(p);
  };

  const handleAddExistingProject = async () => {
    if (!store.solution) return;
    const proj = await window.vsApi.dialog.openProjectFile();
    if (proj) {
      const updated = await window.vsApi.solution.addExistingProject(store.solution.path, proj);
      useIdeStore.setState({ solution: updated });
      await store.refreshSolutionTrees();
    }
  };

  const menus: Record<string, MenuEntry[]> = {
    File: [
      { label: 'New Project...', shortcut: shortcuts.newProject, action: () => store.setDialog({ newProjectOpen: true }) },
      { label: 'Open Project / Solution...', shortcut: shortcuts.openSolution, action: handleOpenSolutionDialog },
      { label: 'Open Folder...', action: handleOpenFolderDialog },
      { label: 'Clone Repository...', action: () => store.setDialog({ cloneRepoOpen: true }) },
      { separator: true },
      {
        label: 'Add New Project to Solution...',
        disabled: !hasSolution,
        action: () => store.setDialog({ addNewProjectOpen: true }),
      },
      {
        label: 'Add Existing Project...',
        disabled: !hasSolution,
        action: handleAddExistingProject,
      },
      { separator: true },
      {
        label: `Save ${activeTab?.title ?? 'File'}`,
        shortcut: shortcuts.save,
        disabled: !activeTab || activeTab.kind !== 'code',
        action: () => activeTab && store.saveTab(activeTab.id),
      },
      { label: 'Save All', shortcut: shortcuts.saveAll, action: () => store.saveAllTabs() },
      { separator: true },
      { label: 'Close Solution', disabled: !hasSolution, action: () => store.closeSolution() },
      { label: 'Start Window', action: () => store.setScreen('start') },
    ],
    Edit: [
      { label: 'Find in Files', shortcut: shortcuts.findInFiles, action: () => store.setDialog({ findInFilesOpen: true }) },
      {
        label: 'Format Document (LSP)',
        shortcut: shortcuts.formatDoc,
        disabled: !activeTab || activeTab.language !== 'csharp',
        action: async () => {
          if (!activeTab) return;
          const edits = (await window.vsApi.lsp.format(activeTab.path)) as Array<{ newText: string }> | null;
          if (edits?.length && edits[0].newText) {
            store.updateTabContent(activeTab.id, edits[0].newText);
          }
        },
      },
      { separator: true },
      {
        label: 'Toggle Word Wrap',
        action: () => store.setWordWrap(!store.wordWrap),
      },
      {
        label: 'Toggle Minimap',
        action: () => store.setMinimap(!store.minimap),
      },
    ],
    View: [
      {
        label: 'Solution Explorer',
        action: () => store.setDock({ leftOpen: true, leftPanel: 'solutionExplorer' }),
      },
      {
        label: 'Class View',
        action: () => store.setDock({ leftOpen: true, leftPanel: 'classView' }),
      },
      {
        label: 'Toolbox',
        action: () => store.setDock({ leftOpen: true, leftPanel: 'toolbox' }),
      },
      {
        label: 'Git Changes',
        action: () => store.setDock({ rightOpen: true, rightPanel: 'gitChanges' }),
      },
      {
        label: 'Properties Window',
        action: () => store.setDock({ rightOpen: true, rightPanel: 'properties' }),
      },
      { separator: true },
      {
        label: 'Error List',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'errorList' }),
      },
      {
        label: 'Output',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'output' }),
      },
      {
        label: 'Terminal',
        shortcut: shortcuts.terminal,
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'terminal' }),
      },
      {
        label: 'Test Explorer',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'testExplorer' }),
      },
      {
        label: 'Task List',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'taskList' }),
      },
      {
        label: 'Immediate Window',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'immediate' }),
      },
    ],
    Git: [
      {
        label: 'Open Git Changes',
        action: () => {
          store.setDock({ rightOpen: true, rightPanel: 'gitChanges' });
          void store.refreshGitStatus();
        },
      },
      { label: 'Clone Repository...', action: () => store.setDialog({ cloneRepoOpen: true }) },
      {
        label: 'Pull',
        disabled: !hasSolution,
        action: async () => {
          if (store.solution) {
            await window.vsApi.git.pull(store.solution.dir);
            await store.refreshGitStatus();
          }
        },
      },
      {
        label: 'Push',
        disabled: !hasSolution,
        action: async () => {
          if (store.solution) {
            await window.vsApi.git.push(store.solution.dir);
            await store.refreshGitStatus();
          }
        },
      },
    ],
    Project: [
      {
        label: 'Add Class / New Item...',
        disabled: !hasSolution,
        action: () => {
          const startup = store.solution?.projects.find((p) => p.id === store.solution?.startupProjectId) || store.solution?.projects[0];
          if (startup) store.setDialog({ addNewItemTargetDir: startup.dir });
        },
      },
      {
        label: 'Add Project Reference...',
        disabled: !store.solution || store.solution.projects.length < 2,
        action: () => {
          const startup = store.solution?.projects.find((p) => p.id === store.solution?.startupProjectId) || store.solution?.projects[0];
          if (startup) store.setDialog({ addProjectRefSourceId: startup.id });
        },
      },
      {
        label: 'Manage NuGet Packages...',
        disabled: !hasSolution,
        action: () => {
          const startup = store.solution?.projects.find((p) => p.id === store.solution?.startupProjectId) || store.solution?.projects[0];
          store.openNugetTab(startup?.id);
        },
      },
    ],
    Build: [
      {
        label: 'Build Solution',
        shortcut: shortcuts.buildSolution,
        disabled: !hasSolution,
        action: () => store.buildSolution('build'),
      },
      {
        label: 'Rebuild Solution',
        shortcut: shortcuts.rebuildSolution,
        disabled: !hasSolution,
        action: () => store.buildSolution('rebuild'),
      },
      {
        label: 'Clean Solution',
        disabled: !hasSolution,
        action: () => store.buildSolution('clean'),
      },
    ],
    Debug: [
      {
        label: 'Start Debugging',
        shortcut: shortcuts.startDebug,
        disabled: !hasSolution,
        action: () => store.startDebugging(true),
      },
      {
        label: 'Start Without Debugging',
        shortcut: shortcuts.startWithoutDebug,
        disabled: !hasSolution,
        action: () => store.startDebugging(false),
      },
      {
        label: 'Stop Debugging',
        shortcut: shortcuts.stopDebug,
        disabled: store.debugState === 'stopped',
        action: () => store.stopDebugging(),
      },
      { separator: true },
      { label: 'Step Over', shortcut: shortcuts.stepOver, disabled: store.debugState !== 'paused', action: () => store.stepOver() },
      { label: 'Step Into', shortcut: shortcuts.stepInto, disabled: store.debugState !== 'paused', action: () => store.stepInto() },
      { label: 'Step Out', shortcut: shortcuts.stepOut, disabled: store.debugState !== 'paused', action: () => store.stepOut() },
      { separator: true },
      {
        label: 'Windows -> Locals',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'locals' }),
      },
      {
        label: 'Windows -> Watch',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'watch' }),
      },
      {
        label: 'Windows -> Call Stack',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'callStack' }),
      },
      {
        label: 'Windows -> Breakpoints',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'breakpoints' }),
      },
    ],
    Test: [
      {
        label: 'Run All Tests',
        disabled: !hasSolution,
        action: () => store.runTests(),
      },
      {
        label: 'Test Explorer',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'testExplorer' }),
      },
    ],
    Tools: [
      {
        label: 'NuGet Package Manager -> Manage NuGet Packages for Solution...',
        disabled: !hasSolution,
        action: () => store.openNugetTab(),
      },
      {
        label: 'Command Line -> Developer Terminal',
        action: () => store.setDock({ bottomOpen: true, bottomPanel: 'terminal' }),
      },
      { separator: true },
      {
        label: 'Options...',
        shortcut: shortcuts.options,
        action: () => store.setDialog({ toolsOptionsOpen: true }),
      },
    ],
    Window: [
      {
        label: 'New Vertical Tab Group',
        disabled: store.openTabs.length === 0,
        action: () => store.setSplitMode('vertical'),
      },
      {
        label: 'New Horizontal Tab Group',
        disabled: store.openTabs.length === 0,
        action: () => store.setSplitMode('horizontal'),
      },
      {
        label: 'Merge All Tab Groups',
        disabled: store.splitMode === 'none',
        action: () => store.setSplitMode('none'),
      },
      { separator: true },
      {
        label: `${store.tabLayout === 'top' ? '✓ ' : ''}Tab Layout -> Top`,
        action: () => store.setTabLayout('top'),
      },
      {
        label: `${store.tabLayout === 'left' ? '✓ ' : ''}Tab Layout -> Left (Vertical Tabs)`,
        action: () => store.setTabLayout('left'),
      },
      {
        label: `${store.tabLayout === 'right' ? '✓ ' : ''}Tab Layout -> Right (Vertical Tabs)`,
        action: () => store.setTabLayout('right'),
      },
      {
        label: `${store.colorizeTabsByProject ? '✓ ' : ''}Colorize Document Tabs by Project`,
        action: () => store.setColorizeTabsByProject(!store.colorizeTabsByProject),
      },
      { separator: true },
      {
        label: activeTab?.isPinned ? 'Unpin Active Tab' : 'Pin Active Tab',
        disabled: !activeTab,
        action: () => activeTab && store.togglePinTab(activeTab.id),
      },
      {
        label: 'Close All Documents',
        disabled: store.openTabs.length === 0,
        action: () => store.closeAllTabs(),
      },
      {
        label: 'Reset Window Layout',
        action: () => {
          store.setSplitMode('none');
          store.setTabLayout('top');
          store.setDock({
            leftOpen: true,
            leftPinned: true,
            leftPanel: 'solutionExplorer',
            bottomOpen: true,
            bottomPinned: true,
            bottomPanel: 'errorList',
            rightOpen: false,
            rightPinned: true,
          });
        },
      },
    ],
    Help: [
      {
        label: 'Environment & .NET 10 SDK Status',
        action: () => store.setDialog({ toolsOptionsOpen: true }),
      },
    ],
  };

  return (
    <div
      ref={menuRef}
      className="vs-drag-region"
      style={{
        height: 32,
        background: 'var(--vs-bg-titlebar)',
        borderBottom: '1px solid var(--vs-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: window.vsApi?.platform === 'darwin' ? 78 : 10,
        paddingRight: 10,
        position: 'relative',
        zIndex: 200,
      }}
    >
      {/* Left: VS Logo + Menu Bar */}
      <div className="vs-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <div
          onClick={() => store.setScreen('start')}
          title="Visual Studio Community (Click for Start Window)"
          style={{ display: 'flex', alignItems: 'center', padding: '0 6px', cursor: 'pointer' }}
        >
          <VsLogoIcon size={16} />
        </div>

        {Object.keys(menus).map((menuName) => {
          const isOpen = openMenu === menuName;
          return (
            <div key={menuName} style={{ position: 'relative' }}>
              <button
                onClick={() => setOpenMenu(isOpen ? null : menuName)}
                onMouseEnter={() => {
                  if (openMenu) setOpenMenu(menuName);
                }}
                style={{
                  background: isOpen ? 'var(--vs-bg-hover)' : 'transparent',
                  border: 'none',
                  padding: '3px 8px',
                  fontSize: 12,
                  color: 'var(--vs-fg)',
                  cursor: 'pointer',
                  borderRadius: 2,
                }}
              >
                {menuName}
              </button>

              {isOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    minWidth: 250,
                    background: 'var(--vs-bg-panel)',
                    border: '1px solid var(--vs-border)',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
                    padding: '4px 0',
                    zIndex: 500,
                  }}
                >
                  {menus[menuName].map((item, idx) =>
                    item.separator ? (
                      <div
                        key={idx}
                        style={{ height: 1, background: 'var(--vs-border)', margin: '4px 0' }}
                      />
                    ) : (
                      <button
                        key={idx}
                        disabled={item.disabled}
                        onClick={() => {
                          setOpenMenu(null);
                          item.action?.();
                        }}
                        style={{
                          width: '100%',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '5px 14px',
                          background: 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          cursor: item.disabled ? 'default' : 'pointer',
                          color: item.disabled ? 'var(--vs-fg-muted)' : 'var(--vs-fg)',
                          opacity: item.disabled ? 0.5 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!item.disabled) e.currentTarget.style.background = 'var(--vs-bg-selection)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && (
                          <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)', marginLeft: 18 }}>
                            {item.shortcut}
                          </span>
                        )}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Center: Quick Launch Search Bar (like Visual Studio Search Ctrl+Q / Cmd+Q) */}
      <div className="vs-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => store.setDialog({ quickLaunchOpen: true })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: 280,
            height: 22,
            padding: '0 8px',
            background: 'var(--vs-bg-input)',
            border: '1px solid var(--vs-border)',
            borderRadius: 2,
            color: 'var(--vs-fg-muted)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          <span className="codicon codicon-search" style={{ fontSize: 12 }} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search ({shortcuts.quickLaunch})</span>
        </button>

        {store.solution && (
          <div
            style={{
              padding: '2px 10px',
              background: 'var(--vs-purple-dark)',
              color: '#FFFFFF',
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 600,
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {store.solution.name}
          </div>
        )}
      </div>

      {/* Right: Private Edition Indicator (No Copilot!) */}
      <div className="vs-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>
          Community • .NET 10
        </span>
      </div>
    </div>
  );
};
