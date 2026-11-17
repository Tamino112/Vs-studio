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

  const ownerProj = solution?.projects.find((p) => addNewItemTargetDir.startsWith(p.dir));
  const ns = ownerProj?.name.replace(/[^a-zA-Z0-9_]/g, '_') || 'MyApp';

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
    { label: 'File: Add New Project to Solution...', action: () => store.setDialog({ addNewProjectOpen: true }) },
    { label: 'Build: Build Solution', action: () => void store.buildSolution('build') },
    { label: 'Build: Rebuild Solution', action: () => void store.buildSolution('rebuild') },
    { label: 'Build: Clean Solution', action: () => void store.buildSolution('clean') },
    { label: 'Debug: Start Debugging', action: () => void store.startDebugging(true) },
    { label: 'Debug: Start Without Debugging', action: () => void store.startDebugging(false) },
    { label: 'Test: Run All Tests', action: () => void store.runTests() },
    { label: 'Tools: Manage NuGet Packages...', action: () => store.openNugetTab() },
    { label: 'Tools: Options...', action: () => store.setDialog({ toolsOptionsOpen: true }) },
    { label: 'View: Solution Explorer', action: () => store.setDock({ leftOpen: true, leftPanel: 'solutionExplorer' }) },
    { label: 'View: Git Changes', action: () => store.setDock({ rightOpen: true, rightPanel: 'gitChanges' }) },
    { label: 'View: Error List', action: () => store.setDock({ bottomOpen: true, bottomPanel: 'errorList' }) },
    { label: 'View: Terminal', action: () => store.setDock({ bottomOpen: true, bottomPanel: 'terminal' }) },
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
        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--vs-border)' }}>
          {commands.map((cmd) => (
            <button
              key={cmd.label}
              onClick={() => {
                store.setDialog({ quickLaunchOpen: false });
                cmd.action();
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '7px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--vs-border-subtle)',
                cursor: 'pointer',
                color: 'var(--vs-fg)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vs-bg-selection)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
          <h4 style={{ marginBottom: 8, color: 'var(--vs-fg-bright)' }}>Environment &amp; Appearance</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center' }}>
            <span>Color theme:</span>
            <select
              className="vs-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'dark' | 'blue' | 'light')}
            >
              <option value="dark">Dark (Default)</option>
              <option value="blue">Blue (Classic Visual Studio)</option>
              <option value="light">Light</option>
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
      background: 'rgba(0,0,0,0.6)',
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
        boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--vs-bg-chrome)',
          borderBottom: '1px solid var(--vs-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ color: 'var(--vs-fg-bright)', fontSize: 13 }}>{title}</strong>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vs-fg)' }}
        >
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  </div>
);
