import React, { useEffect, useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';

export const AddNewItemDialog: React.FC = () => {
  const { addNewItemTargetDir, setDialog, solution, refreshSolutionTrees, openFile } = useIdeStore();
  const [kind, setKind] = useState<'class' | 'interface' | 'record' | 'struct' | 'enum' | 'json' | 'folder'>('class');
  const [name, setName] = useState('Class1.cs');

  useEffect(() => {
    if (!addNewItemTargetDir) return;
    if (kind === 'class') setName('Class1.cs');
    else if (kind === 'interface') setName('IInterface1.cs');
    else if (kind === 'record') setName('Record1.cs');
    else if (kind === 'struct') setName('Struct1.cs');
    else if (kind === 'enum') setName('Enum1.cs');
    else if (kind === 'json') setName('appsettings.json');
    else setName('NewFolder');
  }, [kind, addNewItemTargetDir]);

  if (!addNewItemTargetDir) return null;

  // Longest matching project dir ("/src/App" must not own "/src/App.Tests")
  const ownerProj = solution?.projects
    .filter((p) => addNewItemTargetDir === p.dir || addNewItemTargetDir.startsWith(p.dir + '/'))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
  // Like VS: RootNamespace + sub folders (Project/Models/Dto -> Project.Models.Dto)
  const nsPart = (v: string) => v.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  const subFolders = ownerProj
    ? addNewItemTargetDir.slice(ownerProj.dir.length).split('/').filter(Boolean).map(nsPart)
    : [];
  const ns = ownerProj ? [nsPart(ownerProj.name), ...subFolders].join('.') : 'MyApp';

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const fullPath = `${addNewItemTargetDir}/${trimmed}`;

    if (kind === 'folder') {
      await window.vsApi.fs.createDir(fullPath);
      await refreshSolutionTrees();
      setDialog({ addNewItemTargetDir: null });
      return;
    }

    const typeName = trimmed.replace(/\.cs$/i, '').replace(/[^a-zA-Z0-9_]/g, '_');
    let content = '';
    if (kind === 'class') {
      content = `namespace ${ns};\n\npublic class ${typeName}\n{\n}\n`;
    } else if (kind === 'interface') {
      content = `namespace ${ns};\n\npublic interface ${typeName}\n{\n}\n`;
    } else if (kind === 'record') {
      content = `namespace ${ns};\n\npublic record ${typeName}();\n`;
    } else if (kind === 'struct') {
      content = `namespace ${ns};\n\npublic struct ${typeName}\n{\n}\n`;
    } else if (kind === 'enum') {
      content = `namespace ${ns};\n\npublic enum ${typeName}\n{\n    None = 0\n}\n`;
    } else if (kind === 'json') {
      content = `{\n  "Logging": {\n    "LogLevel": {\n      "Default": "Information"\n    }\n  }\n}\n`;
    }

    await window.vsApi.fs.writeFile(fullPath, content);
    await refreshSolutionTrees();
    setDialog({ addNewItemTargetDir: null });
    await openFile(fullPath);
  };

  return (
    <ModalShell title="Add New Item" width={540} onClose={() => setDialog({ addNewItemTargetDir: null })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {(
            [
              ['class', 'Class (.cs)'],
              ['interface', 'Interface (.cs)'],
              ['record', 'Record (.cs)'],
              ['struct', 'Struct (.cs)'],
              ['enum', 'Enum (.cs)'],
              ['json', 'App Settings (.json)'],
              ['folder', 'New Folder'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setKind(id)}
              className={`vs-btn ${kind === id ? 'vs-btn-primary' : ''}`}
              style={{ justifyContent: 'flex-start' }}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Name:</label>
          <input
            className="vs-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            style={{ width: '100%' }}
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="vs-btn" onClick={() => setDialog({ addNewItemTargetDir: null })}>
            Cancel
          </button>
          <button className="vs-btn vs-btn-primary" onClick={handleCreate}>
            Add
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export const ProjectReferenceDialog: React.FC = () => {
  const { addProjectRefSourceId, setDialog, solution } = useIdeStore();
  if (!addProjectRefSourceId || !solution) return null;

  const srcProj = solution.projects.find((p) => p.id === addProjectRefSourceId);
  if (!srcProj) return null;

  const otherProjects = solution.projects.filter((p) => p.id !== srcProj.id);

  const toggleRef = async (targetPath: string, checked: boolean) => {
    const updated = checked
      ? await window.vsApi.solution.addReference(solution.path, srcProj.path, targetPath)
      : await window.vsApi.solution.removeReference(solution.path, srcProj.path, targetPath);
    useIdeStore.setState({ solution: updated });
  };

  return (
    <ModalShell
      title={`Reference Manager — ${srcProj.name}`}
      width={500}
      onClose={() => setDialog({ addProjectRefSourceId: null })}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: 'var(--vs-fg-muted)' }}>
          Select projects in solution <strong>{solution.name}</strong> to reference from <strong>{srcProj.name}</strong>:
        </div>
        <div style={{ border: '1px solid var(--vs-border)', maxHeight: 240, overflowY: 'auto' }}>
          {otherProjects.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--vs-fg-muted)' }}>
              No other projects in this solution. Add another project via Solution Explorer → Add → New Project.
            </div>
          ) : (
            otherProjects.map((p) => {
              const hasRef = srcProj.projectReferences.some((r) => r.path === p.path);
              return (
                <label
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--vs-border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={hasRef}
                    onChange={(e) => void toggleRef(p.path, e.target.checked)}
                  />
                  <span>{p.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--vs-fg-muted)' }}>
                    {p.targetFramework}
                  </span>
                </label>
              );
            })
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="vs-btn vs-btn-primary"
            onClick={() => setDialog({ addProjectRefSourceId: null })}
          >
            OK
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export const FindInFilesDialog: React.FC = () => {
  const { findInFilesOpen, setDialog, runSearchInFiles } = useIdeStore();
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  if (!findInFilesOpen) return null;

  const handleSearch = async () => {
    if (!query.trim()) return;
    await runSearchInFiles(query, { matchCase, wholeWord });
    setDialog({ findInFilesOpen: false });
  };

  return (
    <ModalShell title="Find and Replace — Find in Files" width={460} onClose={() => setDialog({ findInFilesOpen: false })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="vs-input"
          placeholder="Find what..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch();
          }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
            Match case
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
            Match whole word
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="vs-btn" onClick={() => setDialog({ findInFilesOpen: false })}>
            Cancel
          </button>
          <button className="vs-btn vs-btn-primary" onClick={handleSearch}>
            Find All
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export const QuickLaunchDialog: React.FC = () => {
  const store = useIdeStore();
  const [query, setQuery] = useState('');
  if (!store.quickLaunchOpen) return null;

  const commands = [
    { label: 'File: New Project...', action: () => store.setDialog({ newProjectOpen: true }) },
    {
      label: 'File: Open Project/Solution...',
      action: () =>
        void window.vsApi?.dialog.openSolution().then((p) => {
          if (p) void store.openSolution(p);
        }),
    },
    { label: 'File: Add New Project to Solution...', action: () => store.setDialog({ addNewProjectOpen: true }) },
    { label: 'Edit: Undo', action: () => store.dispatchEditorCommand('undo') },
    { label: 'Edit: Redo', action: () => store.dispatchEditorCommand('redo') },
    { label: 'Edit: Find in Active Document', action: () => store.dispatchEditorCommand('find') },
    { label: 'Edit: Replace in Active Document', action: () => store.dispatchEditorCommand('replace') },
    { label: 'Edit: Find in Files', action: () => store.setDialog({ findInFilesOpen: true }) },
    { label: 'Edit: Comment Selection', action: () => store.dispatchEditorCommand('comment') },
    { label: 'Edit: Uncomment Selection', action: () => store.dispatchEditorCommand('uncomment') },
    { label: 'Edit: Format Document', action: () => store.dispatchEditorCommand('format') },
    { label: 'Navigate: Backward', action: () => void store.navigateBack() },
    { label: 'Navigate: Forward', action: () => void store.navigateForward() },
    { label: 'Build: Build Solution', action: () => void store.buildSolution('build') },
    { label: 'Build: Rebuild Solution', action: () => void store.buildSolution('rebuild') },
    { label: 'Build: Clean Solution', action: () => void store.buildSolution('clean') },
    { label: 'Debug: Start Debugging', action: () => void store.startDebugging(true) },
    { label: 'Debug: Start Without Debugging', action: () => void store.startDebugging(false) },
    { label: 'Debug: Open Debug Console Window', action: () => void window.vsApi?.console.open() },
    { label: 'Debug: Toggle Breakpoint (F9)', action: () => store.dispatchEditorCommand('toggleBreakpoint') },
    { label: 'Test: Run All Tests', action: () => void store.runTests() },
    { label: 'Tools: Manage NuGet Packages...', action: () => store.openNugetTab() },
    { label: 'Tools: Options...', action: () => store.setDialog({ toolsOptionsOpen: true }) },
    { label: 'View: Solution Explorer', action: () => store.setDock({ leftOpen: true, leftPanel: 'solutionExplorer' }) },
    { label: 'View: Class View', action: () => store.setDock({ leftOpen: true, leftPanel: 'classView' }) },
    { label: 'View: Toolbox', action: () => store.setDock({ leftOpen: true, leftPanel: 'toolbox' }) },
    { label: 'View: Properties Window', action: () => store.setDock({ rightOpen: true, rightPanel: 'properties' }) },
    { label: 'View: Git Changes', action: () => store.setDock({ rightOpen: true, rightPanel: 'gitChanges' }) },
    { label: 'View: Error List', action: () => store.setDock({ bottomOpen: true, bottomPanel: 'errorList' }) },
    { label: 'View: Task List', action: () => store.setDock({ bottomOpen: true, bottomPanel: 'taskList' }) },
    { label: 'View: Immediate Window', action: () => store.setDock({ bottomOpen: true, bottomPanel: 'immediate' }) },
    { label: 'View: Terminal', action: () => store.setDock({ bottomOpen: true, bottomPanel: 'terminal' }) },
    { label: 'Window: New Vertical Tab Group', action: () => store.setSplitMode('vertical') },
    { label: 'Window: New Horizontal Tab Group', action: () => store.setSplitMode('horizontal') },
    { label: 'Window: Merge All Tab Groups', action: () => store.setSplitMode('none') },
    { label: 'Window: Place Tabs on Top', action: () => store.setTabLayout('top') },
    { label: 'Window: Place Tabs on Left (Vertical)', action: () => store.setTabLayout('left') },
    { label: 'Window: Place Tabs on Right (Vertical)', action: () => store.setTabLayout('right') },
    { label: 'Window: Close All Documents', action: () => store.closeAllTabs() },
  ].filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <ModalShell title="Visual Studio Search (Quick Launch)" width={520} onClose={() => store.setDialog({ quickLaunchOpen: false })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="vs-input"
          placeholder="Search commands, panels, or actions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div style={{ maxHeight: 290, overflowY: 'auto', border: '1px solid var(--vs-border)', borderRadius: 6, padding: 4 }}>
          {commands.map((cmd) => (
            <button
              key={cmd.label}
              className="vs-menu-item-btn"
              onClick={() => {
                store.setDialog({ quickLaunchOpen: false });
                cmd.action();
              }}
              style={{ justifyContent: 'flex-start', padding: '6px 10px' }}
            >
              {cmd.label}
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
};

export const ToolsOptionsDialog: React.FC = () => {
  const {
    toolsOptionsOpen,
    setDialog,
    theme,
    setTheme,
    keymap,
    setKeymap,
    fontSize,
    setFontSize,
    wordWrap,
    setWordWrap,
    minimap,
    setMinimap,
    tabLayout,
    setTabLayout,
    colorizeTabsByProject,
    setColorizeTabsByProject,
    editorZoom,
    setEditorZoom,
    consoleLaunchMode,
    setConsoleLaunchMode,
    autoCloseConsole,
    setAutoCloseConsole,
    envStatus,
    refreshEnvironment,
  } = useIdeStore();
  const [installingLsp, setInstallingLsp] = useState(false);

  if (!toolsOptionsOpen) return null;

  return (
    <ModalShell title="Options" width={640} onClose={() => setDialog({ toolsOptionsOpen: false })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Environment */}
        <section>
          <h4 style={{ marginBottom: 8, color: 'var(--vs-fg-bright)' }}>Environment, Tabs &amp; Appearance</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 10, alignItems: 'center' }}>
            <span>Color theme:</span>
            <select
              className="vs-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'blue' | 'light')}
            >
              <option value="dark">Dark (Fluent)</option>
              <option value="blue">Blue (Classic Visual Studio)</option>
              <option value="light">Light (Fluent)</option>
            </select>

            <span>Keyboard mapping scheme:</span>
            <select
              className="vs-select"
              value={keymap}
              onChange={(e) => setKeymap(e.target.value as 'macos' | 'windows')}
            >
              <option value="macos">macOS Visual Studio (Cmd+S, Cmd+B, F5 / Cmd+R)</option>
              <option value="windows">Windows Visual Studio (Ctrl+S, Ctrl+Shift+B, F5)</option>
            </select>

            <span>Document tab layout:</span>
            <select
              className="vs-select"
              value={tabLayout}
              onChange={(e) => setTabLayout(e.target.value as 'top' | 'left' | 'right')}
            >
              <option value="top">Top (Horizontal Tabs)</option>
              <option value="left">Left (Vertical Tabs)</option>
              <option value="right">Right (Vertical Tabs)</option>
            </select>

            <span>Colorize tabs by project:</span>
            <input
              type="checkbox"
              checked={colorizeTabsByProject}
              onChange={(e) => setColorizeTabsByProject(e.target.checked)}
            />

            <span>Console App Terminal:</span>
            <select
              className="vs-select"
              value={consoleLaunchMode}
              onChange={(e) => setConsoleLaunchMode(e.target.value as 'externalWindow' | 'integratedTerminal' | 'macTerminal')}
            >
              <option value="macTerminal">
                {window.vsApi?.platform === 'win32'
                  ? 'Windows Console (Native Terminal - Recommended)'
                  : 'macOS Terminal.app'}
              </option>
              <option value="externalWindow">
                {window.vsApi?.platform === 'win32'
                  ? 'VS Debug Console Window (Piped)'
                  : 'VS Debug Console Window (Visual Studio Default)'}
              </option>
              <option value="integratedTerminal">Integrated Terminal (Bottom Dock)</option>
            </select>

            <span>Auto-close console on exit:</span>
            <input
              type="checkbox"
              checked={autoCloseConsole}
              onChange={(e) => setAutoCloseConsole(e.target.checked)}
            />

            <span>Editor Font Size:</span>
            <input
              type="number"
              className="vs-input"
              min={10}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value) || 13)}
              style={{ width: 90 }}
            />

            <span>Editor Zoom (%):</span>
            <select
              className="vs-select"
              value={editorZoom}
              onChange={(e) => setEditorZoom(Number(e.target.value))}
              style={{ width: 110 }}
            >
              {[50, 70, 85, 100, 115, 125, 150, 175, 200].map((z) => (
                <option key={z} value={z}>
                  {z} %
                </option>
              ))}
            </select>

            <span>Word Wrap:</span>
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />

            <span>Show Minimap:</span>
            <input type="checkbox" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} />
          </div>
        </section>

        {/* .NET 10 SDK & C# Tooling Status */}
        <section style={{ borderTop: '1px solid var(--vs-border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ color: 'var(--vs-fg-bright)' }}>.NET 10 SDK, Roslyn LSP &amp; Debugger Status</h4>
            <button className="vs-btn" onClick={() => void refreshEnvironment()}>
              Refresh
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <div>
              <strong>.NET SDK:</strong>{' '}
              {envStatus?.dotnetInstalled ? (
                <span style={{ color: 'var(--vs-success)' }}>
                  Detected {envStatus.dotnetVersion} ({envStatus.hasNet10 ? '.NET 10 Ready' : 'Install .NET 10 SDK recommended'})
                </span>
              ) : (
                <span style={{ color: 'var(--vs-warning)' }}>Not found (install .NET 10 SDK for macOS)</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <strong>C# Language Server (csharp-ls):</strong>{' '}
                {envStatus?.csharpLsInstalled ? (
                  <span style={{ color: 'var(--vs-success)' }}>Installed ({envStatus.csharpLsPath})</span>
                ) : (
                  <span style={{ color: 'var(--vs-warning)' }}>Not installed (needed for full Roslyn IntelliSense)</span>
                )}
              </div>
              {!envStatus?.csharpLsInstalled && envStatus?.dotnetInstalled && (
                <button
                  className="vs-btn vs-btn-primary"
                  disabled={installingLsp}
                  onClick={async () => {
                    setInstallingLsp(true);
                    await window.vsApi.env.installCsharpLs();
                    await refreshEnvironment();
                    const { envStatus: updatedEnv, solution, openTabs } = useIdeStore.getState();
                    if (solution && updatedEnv?.csharpLsInstalled && updatedEnv.csharpLsPath) {
                      const ok = await window.vsApi.lsp.start(solution.dir, updatedEnv.csharpLsPath);
                      if (ok) {
                        for (const t of openTabs) {
                          if (t.kind === 'code' && t.language === 'csharp') {
                            void window.vsApi.lsp.didOpen(t.path, t.content);
                          }
                        }
                      }
                    }
                    setInstallingLsp(false);
                  }}
                >
                  {installingLsp ? 'Installing...' : 'Install csharp-ls'}
                </button>
              )}
            </div>
            <div>
              <strong>Debugger (netcoredbg):</strong>{' '}
              {envStatus?.netcoredbgInstalled ? (
                <span style={{ color: 'var(--vs-success)' }}>Installed ({envStatus.netcoredbgPath})</span>
              ) : (
                <span style={{ color: 'var(--vs-fg-muted)' }}>
                  Optional: install via <code>brew install netcoredbg</code> for step-by-step breakpoints
                </span>
              )}
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="vs-btn vs-btn-primary" onClick={() => setDialog({ toolsOptionsOpen: false })}>
            OK
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export const CloneRepoDialog: React.FC = () => {
  const { cloneRepoOpen, setDialog, openSolution } = useIdeStore();
  const [url, setUrl] = useState('');
  const [location, setLocation] = useState('');
  const [cloning, setCloning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (cloneRepoOpen && window.vsApi) {
      void window.vsApi.env.defaultProjectsDir().then((d) => setLocation(d));
    }
  }, [cloneRepoOpen]);

  if (!cloneRepoOpen) return null;

  const handleClone = async () => {
    if (!url.trim() || !location.trim()) return;
    setCloning(true);
    setErr(null);
    try {
      const repoName = url.trim().split('/').pop()?.replace(/\.git$/, '') || 'repo';
      const target = `${location.trim()}/${repoName}`;
      await window.vsApi.git.clone(url.trim(), target);
      setDialog({ cloneRepoOpen: false });
      await openSolution(target);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCloning(false);
    }
  };

  return (
    <ModalShell title="Clone a repository" width={520} onClose={() => setDialog({ cloneRepoOpen: false })}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Repository location (URL):</label>
          <input
            className="vs-input"
            placeholder="https://github.com/user/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: '100%' }}
            autoFocus
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4 }}>Path:</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="vs-input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="vs-btn"
              onClick={async () => {
                const d = await window.vsApi.dialog.openFolder();
                if (d) setLocation(d);
              }}
            >
              ...
            </button>
          </div>
        </div>
        {err && <div style={{ color: 'var(--vs-error)' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="vs-btn" onClick={() => setDialog({ cloneRepoOpen: false })}>
            Cancel
          </button>
          <button className="vs-btn vs-btn-primary" disabled={cloning} onClick={handleClone}>
            {cloning ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

const ModalShell: React.FC<{
  title: string;
  width: number;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, width, onClose, children }) => (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.56)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
    }}
  >
    <div
      style={{
        width,
        maxWidth: '92vw',
        background: 'var(--vs-bg-panel)',
        border: '1px solid var(--vs-border)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: 'var(--vs-shadow, 0 12px 36px rgba(0,0,0,0.6))',
      }}
    >
      <div
        style={{
          padding: '11px 16px',
          background: 'var(--vs-bg-chrome)',
          borderBottom: '1px solid var(--vs-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ color: 'var(--vs-fg-bright)', fontSize: 13.5, fontWeight: 600 }}>{title}</strong>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', borderRadius: 5, padding: 4, cursor: 'pointer', color: 'var(--vs-fg)' }}
        >
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  </div>
);
