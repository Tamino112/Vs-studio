import React, { useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { CsProjectInfo, FileNode } from '../types/ide';
import { CSharpFileIcon, CSharpProjectIcon, NuGetIcon, SolutionIcon } from './VsIcons';

interface ContextMenuState {
  x: number;
  y: number;
  kind: 'solution' | 'project' | 'file' | 'folder';
  project?: CsProjectInfo;
  node?: FileNode;
}

export const SolutionExplorer: React.FC = () => {
  const {
    solution,
    projectTrees,
    showAllFiles,
    setShowAllFiles,
    refreshSolutionTrees,
    openTabs,
    activeTabId,
    openFile,
    setStartupProject,
    buildSolution,
    openNugetTab,
    setDialog,
    setSelectedPropertyTarget,
    setDock,
  } = useIdeStore();

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ __solution__: true });
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const isExpanded = (key: string, defaultOpen = false) =>
    expanded[key] !== undefined ? expanded[key] : defaultOpen;

  const toggleExpand = (key: string, defaultOpen = false) => {
    setExpanded((s) => ({ ...s, [key]: !isExpanded(key, defaultOpen) }));
  };

  const collapseAll = () => {
    setExpanded({ __solution__: true });
  };

  const syncWithActiveDocument = () => {
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.kind !== 'code' || !solution) return;

    const nextExpanded: Record<string, boolean> = { ...expanded, __solution__: true };
    const findAndExpand = (nodes: FileNode[], targetPath: string): FileNode | null => {
      for (const n of nodes) {
        if (n.path === targetPath) return n;
        if (n.isDirectory && targetPath.startsWith(n.path) && n.children) {
          nextExpanded[`file:${n.path}`] = true;
          const found = findAndExpand(n.children, targetPath);
          if (found) return found;
        }
      }
      return null;
    };

    for (const proj of solution.projects) {
      if (activeTab.path.startsWith(proj.dir)) {
        nextExpanded[`proj:${proj.id}`] = true;
        const found = findAndExpand(projectTrees[proj.id] || [], activeTab.path);
        if (found) setSelectedNode(found);
      }
    }
    if (solution.projects.length === 0) {
      const found = findAndExpand(projectTrees[solution.dir] || [], activeTab.path);
      if (found) setSelectedNode(found);
    }

    setExpanded(nextExpanded);
    const key = `file:${activeTab.path}`;
    setSelectedKey(key);
    setSelectedPropertyTarget({
      kind: 'file',
      id: key,
      name: activeTab.title,
      path: activeTab.path,
    });
  };

  const handleCommitRename = async (node: FileNode) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === node.name) return;
    const parentDir = node.path.slice(0, node.path.lastIndexOf('/'));
    const newPath = `${parentDir}/${trimmed}`;
    await window.vsApi.fs.rename(node.path, newPath);
    useIdeStore.getState().renamePathInTabs(node.path, newPath);
    await refreshSolutionTrees();
  };

  const filterMatches = (node: FileNode): boolean => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    if (node.name.toLowerCase().includes(q)) return true;
    if (node.children) return node.children.some(filterMatches);
    return false;
  };

  const renderFileNode = (node: FileNode, depth: number, project?: CsProjectInfo) => {
    if (!filterMatches(node)) return null;
    const key = `file:${node.path}`;
    const open = isExpanded(key, false) || Boolean(search.trim());
    const isSelected = selectedKey === key;

    if (node.isDirectory) {
      return (
        <div key={key}>
          <div
            onClick={() => {
              setSelectedKey(key);
              setSelectedNode(node);
              toggleExpand(key, false);
              setSelectedPropertyTarget({ kind: 'file', id: key, name: node.name, path: node.path });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelectedKey(key);
              setSelectedNode(node);
              setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'folder', node, project });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: `3px 8px 3px ${depth * 14 + 6}px`,
              margin: '0 4px',
              borderRadius: 4,
              cursor: 'pointer',
              background: isSelected ? 'var(--vs-bg-selection)' : 'transparent',
              color: isSelected ? '#FFFFFF' : 'var(--vs-fg)',
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'var(--vs-bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'transparent';
            }}
          >
            <span
              className={`codicon ${open ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
              style={{ fontSize: 12, color: isSelected ? '#FFFFFF' : 'var(--vs-fg-muted)' }}
            />
            <span
              className={`codicon ${open ? 'codicon-folder-opened' : 'codicon-folder'}`}
              style={{ fontSize: 14, color: '#DCAD5A' }}
            />
            {renamingPath === node.path ? (
              <input
                className="vs-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void handleCommitRename(node)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCommitRename(node);
                  if (e.key === 'Escape') setRenamingPath(null);
                }}
                autoFocus
                style={{ padding: '0 4px', height: 18, flex: 1 }}
              />
            ) : (
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.name}
              </span>
            )}
          </div>
          {open && node.children?.map((child) => renderFileNode(child, depth + 1, project))}
        </div>
      );
    }

    const isCs = node.name.endsWith('.cs');
    const isCsproj = node.name.endsWith('.csproj');
    return (
      <div
        key={key}
        onClick={() => {
          setSelectedKey(key);
          setSelectedNode(node);
          setSelectedPropertyTarget({ kind: 'file', id: key, name: node.name, path: node.path });
          void openFile(node.path, undefined, undefined, { preview: true });
        }}
        onDoubleClick={() => void openFile(node.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSelectedKey(key);
          setSelectedNode(node);
          setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'file', node, project });
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `3px 8px 3px ${depth * 14 + 22}px`,
          margin: '0 4px',
          borderRadius: 4,
          cursor: 'pointer',
          background: isSelected ? 'var(--vs-bg-selection)' : 'transparent',
          color: isSelected ? '#FFFFFF' : 'var(--vs-fg)',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'var(--vs-bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
      >
        {isCs ? (
          <CSharpFileIcon size={14} />
        ) : isCsproj ? (
          <CSharpProjectIcon size={14} />
        ) : (
          <span className="codicon codicon-file" style={{ fontSize: 14, color: isSelected ? '#FFFFFF' : 'var(--vs-fg-muted)' }} />
        )}
        {renamingPath === node.path ? (
          <input
            className="vs-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void handleCommitRename(node)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCommitRename(node);
              if (e.key === 'Escape') setRenamingPath(null);
            }}
            autoFocus
            style={{ padding: '0 4px', height: 18, flex: 1 }}
          />
        ) : (
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.name}
          </span>
        )}
      </div>
    );
  };

  const renderProjectNode = (proj: CsProjectInfo) => {
    const key = `proj:${proj.id}`;
    const open = isExpanded(key, true);
    const depsOpen = isExpanded(`deps:${proj.id}`, false);
    const isStartup = solution?.startupProjectId === proj.id;
    const isSelected = selectedKey === key;
    const files = (projectTrees[proj.id] || []).filter((f) => !f.name.endsWith('.csproj'));
    const kind = proj.sdk.includes('.Web') ? 'web' : proj.packages.some((p) => p.id.toLowerCase().includes('xunit') || p.id.toLowerCase().includes('nunit') || p.id.toLowerCase().includes('mstest')) ? 'test' : 'exe';

    return (
      <div key={proj.id}>
        <div
          onClick={() => {
            setSelectedKey(key);
            setSelectedNode(null);
            setSelectedPropertyTarget({ kind: 'project', id: proj.id, name: proj.name, path: proj.path });
          }}
          onDoubleClick={() => toggleExpand(key, true)}
          onContextMenu={(e) => {
            e.preventDefault();
            setSelectedKey(key);
            setSelectedNode(null);
            setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'project', project: proj });
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px 3px 16px',
            margin: '0 4px',
            borderRadius: 4,
            cursor: 'pointer',
            background: isSelected ? 'var(--vs-bg-selection)' : 'transparent',
            fontWeight: isStartup ? 700 : 400,
            color: isSelected ? '#FFFFFF' : isStartup ? 'var(--vs-fg-bright)' : 'var(--vs-fg)',
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.background = 'var(--vs-bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.background = 'transparent';
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(key, true);
            }}
            className={`codicon ${open ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
            style={{ fontSize: 12, color: isSelected ? '#FFFFFF' : 'var(--vs-fg-muted)' }}
          />
          <CSharpProjectIcon size={15} kind={kind} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {proj.name}
          </span>
        </div>

        {open && (
          <div>
            {/* Dependencies node just like Visual Studio */}
            <div
              onClick={() => toggleExpand(`deps:${proj.id}`, false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px 3px 30px',
                margin: '0 4px',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--vs-fg)',
              }}
            >
              <span
                className={`codicon ${depsOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
                style={{ fontSize: 12, color: 'var(--vs-fg-muted)' }}
              />
              <span className="codicon codicon-references" style={{ fontSize: 14, color: '#75BEFF' }} />
              <span>Dependencies</span>
            </div>

            {depsOpen && (
              <div style={{ paddingLeft: 52, fontSize: 11.5, color: 'var(--vs-fg-muted)' }}>
                <div style={{ padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="codicon codicon-symbol-namespace" style={{ color: '#4EC9B0' }} />
                  <span>Frameworks ({proj.targetFramework})</span>
                </div>
                {proj.packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    onClick={() => openNugetTab(proj.id)}
                    style={{
                      padding: '2px 0 2px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <NuGetIcon size={12} />
                    <span>
                      {pkg.id} ({pkg.version})
                    </span>
                  </div>
                ))}
                {proj.projectReferences.map((pr) => (
                  <div
                    key={pr.path}
                    style={{ padding: '2px 0 2px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <CSharpProjectIcon size={12} />
                    <span>Project: {pr.name}</span>
                  </div>
                ))}
              </div>
            )}

            {files.map((node) => renderFileNode(node, 2.5, proj))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={async (e) => {
        if (renamingPath || (e.target as HTMLElement)?.tagName === 'INPUT') return;
        if (e.key === 'F2' && selectedNode) {
          e.preventDefault();
          setRenameValue(selectedNode.name);
          setRenamingPath(selectedNode.path);
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
          e.preventDefault();
          if (window.confirm(`'${selectedNode.name}' will be deleted permanently.`)) {
            await window.vsApi.fs.delete(selectedNode.path);
            useIdeStore.getState().closeTabsUnderPath(selectedNode.path);
            setSelectedNode(null);
            await refreshSolutionTrees();
          }
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--vs-bg-panel)', outline: 'none' }}
      onClick={() => setCtxMenu(null)}
    >
      {/* Explorer Mini Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '4px 6px',
          borderBottom: '1px solid var(--vs-border-subtle)',
        }}
      >
        <MiniBtn
          icon="codicon-home"
          title="Solution View"
          onClick={() => void refreshSolutionTrees()}
        />
        <MiniBtn
          icon="codicon-sync"
          title="Sync with Active Document"
          onClick={syncWithActiveDocument}
        />
        <MiniBtn
          icon="codicon-refresh"
          title="Refresh"
          onClick={() => void refreshSolutionTrees()}
        />
        <MiniBtn
          icon="codicon-collapse-all"
          title="Collapse All"
          onClick={collapseAll}
        />
        <MiniBtn
          icon="codicon-eye"
          title="Show All Files (bin/obj)"
          active={showAllFiles}
          onClick={() => void setShowAllFiles(!showAllFiles)}
        />
        <MiniBtn
          icon="codicon-wrench"
          title="Properties"
          onClick={() => setDock({ rightOpen: true, rightPanel: 'properties' })}
        />
      </div>

      {/* Search Box */}
      <div style={{ padding: '5px 6px', borderBottom: '1px solid var(--vs-border-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <span
            className="codicon codicon-search"
            style={{ position: 'absolute', left: 8, top: 6, fontSize: 12, color: 'var(--vs-fg-muted)' }}
          />
          <input
            className="vs-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Solution Explorer"
            style={{ width: '100%', paddingLeft: 26, height: 24, fontSize: 11.5 }}
          />
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', fontSize: 12 }}>
        {!solution ? (
          <div style={{ padding: 14, color: 'var(--vs-fg-muted)' }}>
            No solution loaded.
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="vs-btn vs-btn-primary" onClick={() => setDialog({ newProjectOpen: true })}>
                Create a new project...
              </button>
              <button
                className="vs-btn"
                onClick={async () => {
                  const p = await window.vsApi.dialog.openSolution();
                  if (p) await useIdeStore.getState().openSolution(p);
                }}
              >
                Open Project / Solution...
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Solution Root Node */}
            <div
              onClick={() => {
                setSelectedKey('__solution__');
                setSelectedNode(null);
                setSelectedPropertyTarget({
                  kind: 'solution',
                  id: solution.path,
                  name: solution.name,
                  path: solution.path,
                });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelectedKey('__solution__');
                setSelectedNode(null);
                setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'solution' });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                margin: '0 4px',
                borderRadius: 4,
                cursor: 'pointer',
                background: selectedKey === '__solution__' ? 'var(--vs-bg-selection)' : 'transparent',
                fontWeight: 600,
                color: selectedKey === '__solution__' ? '#FFFFFF' : 'var(--vs-fg-bright)',
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand('__solution__', true);
                }}
                className={`codicon ${isExpanded('__solution__', true) ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
                style={{ fontSize: 12, color: selectedKey === '__solution__' ? '#FFFFFF' : 'var(--vs-fg-muted)' }}
              />
              <SolutionIcon size={15} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Solution '{solution.name}' ({solution.projects.length} of {solution.projects.length} projects)
              </span>
            </div>

            {isExpanded('__solution__', true) && (
              <div>
                {solution.projects.map(renderProjectNode)}
                {solution.projects.length === 0 &&
                  (projectTrees[solution.dir] || []).map((n) => renderFileNode(n, 1))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Authentic Visual Studio Context Menu */}
      {ctxMenu && (
        <div
          className="vs-menu-popup"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 300),
            left: Math.min(ctxMenu.x, window.innerWidth - 230),
            width: 230,
            zIndex: 900,
          }}
        >
          {ctxMenu.kind === 'solution' && solution && (
            <>
              <CtxItem label="Build Solution" onClick={() => { setCtxMenu(null); void buildSolution('build'); }} />
              <CtxItem label="Rebuild Solution" onClick={() => { setCtxMenu(null); void buildSolution('rebuild'); }} />
              <CtxItem label="Clean Solution" onClick={() => { setCtxMenu(null); void buildSolution('clean'); }} />
              <CtxSep />
              <CtxItem label="Add -> New Project..." onClick={() => { setCtxMenu(null); setDialog({ addNewProjectOpen: true }); }} />
              <CtxItem
                label="Add -> Existing Project..."
                onClick={async () => {
                  setCtxMenu(null);
                  const proj = await window.vsApi.dialog.openProjectFile();
                  if (proj) {
                    const updated = await window.vsApi.solution.addExistingProject(solution.path, proj);
                    useIdeStore.setState({ solution: updated });
                    await refreshSolutionTrees();
                  }
                }}
              />
              <CtxSep />
              <CtxItem label="Manage NuGet Packages for Solution..." onClick={() => { setCtxMenu(null); openNugetTab(); }} />
              <CtxItem label={window.vsApi?.platform === 'win32' ? 'Open Folder in File Explorer' : 'Open Folder in Finder'} onClick={() => { setCtxMenu(null); void window.vsApi.fs.revealInFinder(solution.dir); }} />
            </>
          )}

          {ctxMenu.kind === 'project' && ctxMenu.project && (
            <>
              <CtxItem label="Build" onClick={() => { setCtxMenu(null); void buildSolution('build', ctxMenu.project!.path); }} />
              <CtxItem label="Rebuild" onClick={() => { setCtxMenu(null); void buildSolution('rebuild', ctxMenu.project!.path); }} />
              <CtxItem label="Clean" onClick={() => { setCtxMenu(null); void buildSolution('clean', ctxMenu.project!.path); }} />
              <CtxSep />
              <CtxItem
                label="Set as Startup Project"
                onClick={() => {
                  setStartupProject(ctxMenu.project!.id);
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                label="Add -> New Item (Class / Interface)..."
                onClick={() => {
                  setDialog({ addNewItemTargetDir: ctxMenu.project!.dir });
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                label="Add -> Project Reference..."
                onClick={() => {
                  setDialog({ addProjectRefSourceId: ctxMenu.project!.id });
                  setCtxMenu(null);
                }}
              />
              <CtxSep />
              <CtxItem label="Manage NuGet Packages..." onClick={() => { setCtxMenu(null); openNugetTab(ctxMenu.project!.id); }} />
              <CtxItem label="Edit Project File (.csproj)" onClick={() => { setCtxMenu(null); void openFile(ctxMenu.project!.path); }} />
              <CtxItem label="Properties" onClick={() => { setCtxMenu(null); setDock({ rightOpen: true, rightPanel: 'properties' }); }} />
              <CtxItem label={window.vsApi?.platform === 'win32' ? 'Open Folder in File Explorer' : 'Open Folder in Finder'} onClick={() => { setCtxMenu(null); void window.vsApi.fs.revealInFinder(ctxMenu.project!.dir); }} />
            </>
          )}

          {(ctxMenu.kind === 'file' || ctxMenu.kind === 'folder') && ctxMenu.node && (
            <>
              {ctxMenu.kind === 'file' ? (
                <CtxItem label="Open" onClick={() => { setCtxMenu(null); void openFile(ctxMenu.node!.path); }} />
              ) : (
                <CtxItem
                  label="Add -> New Item..."
                  onClick={() => {
                    setDialog({ addNewItemTargetDir: ctxMenu.node!.path });
                    setCtxMenu(null);
                  }}
                />
              )}
              <CtxItem
                label="Rename (F2)"
                onClick={() => {
                  setRenameValue(ctxMenu.node!.name);
                  setRenamingPath(ctxMenu.node!.path);
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                label="Delete"
                onClick={async () => {
                  const target = ctxMenu.node!.path;
                  const targetName = ctxMenu.node!.name;
                  setCtxMenu(null);
                  if (!window.confirm(`'${targetName}' will be deleted permanently.`)) return;
                  await window.vsApi.fs.delete(target);
                  useIdeStore.getState().closeTabsUnderPath(target);
                  await refreshSolutionTrees();
                }}
              />
              <CtxSep />
              <CtxItem
                label={window.vsApi?.platform === 'win32' ? 'Reveal in File Explorer' : 'Reveal in Finder'}
                onClick={() => {
                  setCtxMenu(null);
                  void window.vsApi.fs.revealInFinder(ctxMenu.node!.path);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const MiniBtn: React.FC<{ icon: string; title: string; active?: boolean; onClick: () => void }> = ({
  icon,
  title,
  active,
  onClick,
}) => (
  <button
    title={title}
    onClick={onClick}
    style={{
      width: 24,
      height: 22,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? 'var(--vs-bg-selection)' : 'transparent',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      color: active ? '#FFFFFF' : 'var(--vs-fg)',
    }}
  >
    <span className={`codicon ${icon}`} style={{ fontSize: 13 }} />
  </button>
);

const CtxItem: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    className="vs-menu-item-btn"
    onClick={onClick}
    style={{ justifyContent: 'flex-start', padding: '5px 10px' }}
  >
    {label}
  </button>
);

const CtxSep: React.FC = () => (
  <div style={{ height: 1, background: 'var(--vs-border-subtle)', margin: '3px 4px' }} />
);
