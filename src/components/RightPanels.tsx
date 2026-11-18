import React, { useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';

export const GitChangesPanel: React.FC = () => {
  const { solution, gitStatus, refreshGitStatus, openDiffTab } = useIdeStore();
  const [commitMsg, setCommitMsg] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy] = useState(false);

  if (!solution) {
    return <div style={{ padding: 12, color: 'var(--vs-fg-muted)' }}>Open a solution to use Git Changes.</div>;
  }

  if (!gitStatus?.isRepo) {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: 'var(--vs-fg-muted)' }}>
          This solution is not currently under Git source control.
        </div>
        <button
          className="vs-btn vs-btn-primary"
          onClick={async () => {
            await window.vsApi.git.init(solution.dir);
            await refreshGitStatus();
          }}
        >
          Create Git Repository
        </button>
      </div>
    );
  }

  const staged = gitStatus.changes.filter((c) => c.staged);
  const unstaged = gitStatus.changes.filter((c) => !c.staged);

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setBusy(true);
    try {
      if (staged.length === 0) {
        await window.vsApi.git.stageAll(solution.dir);
      }
      await window.vsApi.git.commit(solution.dir, commitMsg.trim());
      setCommitMsg('');
      await refreshGitStatus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8, gap: 8, overflowY: 'auto' }}>
      {/* Branch + Sync Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <select
          className="vs-select"
          value={gitStatus.branch}
          onChange={async (e) => {
            await window.vsApi.git.checkout(solution.dir, e.target.value, false);
            await refreshGitStatus();
          }}
          style={{ flex: 1 }}
        >
          {gitStatus.branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button className="vs-btn" title="Pull" onClick={async () => { await window.vsApi.git.pull(solution.dir); await refreshGitStatus(); }}>
          <span className="codicon codicon-arrow-down" />
        </button>
        <button className="vs-btn" title="Push" onClick={async () => { await window.vsApi.git.push(solution.dir); await refreshGitStatus(); }}>
          <span className="codicon codicon-arrow-up" />
        </button>
        <button className="vs-btn" title="Refresh" onClick={() => void refreshGitStatus()}>
          <span className="codicon codicon-refresh" />
        </button>
      </div>

      {/* Commit Box */}
      <textarea
        className="vs-input"
        rows={3}
        placeholder="Enter a commit message"
        value={commitMsg}
        onChange={(e) => setCommitMsg(e.target.value)}
        style={{ width: '100%', resize: 'vertical' }}
      />
      <button
        className="vs-btn vs-btn-primary"
        disabled={busy || !commitMsg.trim() || gitStatus.changes.length === 0}
        onClick={handleCommit}
        style={{ justifyContent: 'center' }}
      >
        {staged.length > 0 ? 'Commit Staged' : 'Commit All'}
      </button>

      {/* Staged */}
      {staged.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vs-fg-muted)', marginBottom: 4 }}>
            Staged Changes ({staged.length})
          </div>
          {staged.map((c) => (
            <div
              key={`s:${c.relativePath}`}
              onClick={async () => {
                const diff = await window.vsApi.git.diff(solution.dir, c.relativePath, true);
                openDiffTab(c.relativePath, c.path, diff.original, diff.modified);
              }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vs-bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                [{c.status}] {c.relativePath}
              </span>
              <button
                className="vs-btn"
                style={{ padding: '0 6px' }}
                onClick={async (e) => {
                  e.stopPropagation();
                  await window.vsApi.git.unstage(solution.dir, c.relativePath);
                  await refreshGitStatus();
                }}
              >
                -
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Unstaged */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vs-fg-muted)', marginBottom: 4 }}>
          Changes ({unstaged.length})
        </div>
        {unstaged.length === 0 ? (
          <div style={{ color: 'var(--vs-fg-muted)', fontSize: 11 }}>Working tree clean.</div>
        ) : (
          unstaged.map((c) => (
            <div
              key={`u:${c.relativePath}`}
              onClick={async () => {
                const diff = await window.vsApi.git.diff(solution.dir, c.relativePath, false);
                openDiffTab(c.relativePath, c.path, diff.original, diff.modified);
              }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vs-bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                [{c.status}] {c.relativePath}
              </span>
              <button
                className="vs-btn"
                style={{ padding: '0 6px' }}
                onClick={async (e) => {
                  e.stopPropagation();
                  await window.vsApi.git.stage(solution.dir, c.relativePath);
                  await refreshGitStatus();
                }}
              >
                +
              </button>
            </div>
          ))
        )}
      </div>

      {/* Create New Branch */}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          className="vs-input"
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="New branch name..."
          style={{ flex: 1 }}
        />
        <button
          className="vs-btn"
          disabled={!newBranch.trim()}
          onClick={async () => {
            await window.vsApi.git.checkout(solution.dir, newBranch.trim(), true);
            setNewBranch('');
            await refreshGitStatus();
          }}
        >
          Branch
        </button>
      </div>
    </div>
  );
};

export const PropertiesPanel: React.FC = () => {
  const { solution, selectedPropertyTarget } = useIdeStore();
  const [filePropOverrides, setFilePropOverrides] = useState<
    Record<string, { buildAction?: string; copyToOutput?: string }>
  >({});

  if (!selectedPropertyTarget) {
    return (
      <div style={{ padding: 12, color: 'var(--vs-fg-muted)' }}>
        Select a solution, project, or file in Solution Explorer to inspect its properties.
      </div>
    );
  }

  const project =
    selectedPropertyTarget.kind === 'project'
      ? solution?.projects.find((p) => p.id === selectedPropertyTarget.id)
      : undefined;

  const updateProp = async (prop: 'TargetFramework' | 'OutputType' | 'Nullable' | 'ImplicitUsings', val: string) => {
    if (!solution || !project) return;
    const updated = await window.vsApi.solution.updateProperty(solution.path, project.path, prop, val);
    useIdeStore.setState({ solution: updated });
  };

  const lowerPropName = selectedPropertyTarget.name.toLowerCase();
  const defaultBuildAction = lowerPropName.endsWith('.cs')
    ? 'C# compiler'
    : lowerPropName.endsWith('.json') || lowerPropName.endsWith('.config')
    ? 'Content'
    : 'None';
  const curFileProps = filePropOverrides[selectedPropertyTarget.path] || {};
  const buildAction = curFileProps.buildAction ?? defaultBuildAction;
  const copyToOutput = curFileProps.copyToOutput ?? 'Do not copy';

  return (
    <div style={{ padding: 10, fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: 'var(--vs-fg-bright)', marginBottom: 8 }}>
        {selectedPropertyTarget.name} ({selectedPropertyTarget.kind})
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--vs-border)', borderRadius: 5, overflow: 'hidden' }}>
        <tbody>
          <PropRow label="Name" value={selectedPropertyTarget.name} />
          <PropRow label="Full Path" value={selectedPropertyTarget.path} />

          {selectedPropertyTarget.kind === 'file' && (
            <>
              <tr style={{ borderBottom: '1px solid var(--vs-border-subtle)' }}>
                <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)', width: '42%' }}>Build Action</td>
                <td style={{ padding: '4px 6px' }}>
                  <select
                    className="vs-select"
                    value={buildAction}
                    onChange={(e) =>
                      setFilePropOverrides((prev) => ({
                        ...prev,
                        [selectedPropertyTarget.path]: { ...prev[selectedPropertyTarget.path], buildAction: e.target.value },
                      }))
                    }
                    style={{ width: '100%' }}
                  >
                    <option value="C# compiler">C# compiler</option>
                    <option value="Content">Content</option>
                    <option value="Embedded resource">Embedded resource</option>
                    <option value="None">None</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)' }}>Copy to Output Directory</td>
                <td style={{ padding: '4px 6px' }}>
                  <select
                    className="vs-select"
                    value={copyToOutput}
                    onChange={(e) =>
                      setFilePropOverrides((prev) => ({
                        ...prev,
                        [selectedPropertyTarget.path]: { ...prev[selectedPropertyTarget.path], copyToOutput: e.target.value },
                      }))
                    }
                    style={{ width: '100%' }}
                  >
                    <option value="Do not copy">Do not copy</option>
                    <option value="Copy always">Copy always</option>
                    <option value="Copy if newer">Copy if newer</option>
                  </select>
                </td>
              </tr>
            </>
          )}

          {project && (
            <>
              <PropRow label="Assembly Name" value={project.name} />
              <tr style={{ borderBottom: '1px solid var(--vs-border-subtle)' }}>
                <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)', width: '42%' }}>Target Framework</td>
                <td style={{ padding: '4px 6px' }}>
                  <select
                    className="vs-select"
                    value={project.targetFramework}
                    onChange={(e) => void updateProp('TargetFramework', e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="net10.0">.NET 10.0</option>
                    <option value="net9.0">.NET 9.0</option>
                    <option value="net8.0">.NET 8.0</option>
                  </select>
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--vs-border-subtle)' }}>
                <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)' }}>Output Type</td>
                <td style={{ padding: '4px 6px' }}>
                  <select
                    className="vs-select"
                    value={project.outputType}
                    onChange={(e) => void updateProp('OutputType', e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="Exe">Console Application (Exe)</option>
                    <option value="Library">Class Library (Library)</option>
                  </select>
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--vs-border-subtle)' }}>
                <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)' }}>Nullable</td>
                <td style={{ padding: '4px 6px' }}>
                  <select
                    className="vs-select"
                    value={project.nullable}
                    onChange={(e) => void updateProp('Nullable', e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="enable">enable</option>
                    <option value="disable">disable</option>
                  </select>
                </td>
              </tr>
              <tr>
                <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)' }}>Implicit Usings</td>
                <td style={{ padding: '4px 6px' }}>
                  <select
                    className="vs-select"
                    value={project.implicitUsings}
                    onChange={(e) => void updateProp('ImplicitUsings', e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="enable">enable</option>
                    <option value="disable">disable</option>
                  </select>
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};

const PropRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <tr style={{ borderBottom: '1px solid var(--vs-border-subtle)' }}>
    <td style={{ padding: '5px 8px', color: 'var(--vs-fg-muted)', width: '42%' }}>{label}</td>
    <td style={{ padding: '5px 8px', wordBreak: 'break-all' }}>{value}</td>
  </tr>
);
