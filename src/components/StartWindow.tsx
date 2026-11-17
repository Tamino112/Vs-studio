import React, { useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { SolutionIcon, VsLogoIcon } from './VsIcons';

export const StartWindow: React.FC = () => {
  const {
    recentSolutions,
    envStatus,
    openSolution,
    setScreen,
    setDialog,
    refreshRecent,
    theme,
    setTheme,
  } = useIdeStore();
  const [filter, setFilter] = useState('');

  const filtered = recentSolutions.filter(
    (r) =>
      r.name.toLowerCase().includes(filter.toLowerCase()) ||
      r.path.toLowerCase().includes(filter.toLowerCase()),
  );
  const pinned = filtered.filter((r) => r.pinned);
  const unpinned = filtered.filter((r) => !r.pinned);

  const handleOpenProjectDialog = async () => {
    const file = await window.vsApi.dialog.openSolution();
    if (file) await openSolution(file);
  };

  const handleOpenFolderDialog = async () => {
    const dir = await window.vsApi.dialog.openFolder();
    if (dir) await openSolution(dir);
  };

  const handleTogglePin = async (e: React.MouseEvent, targetPath: string) => {
    e.stopPropagation();
    await window.vsApi.recent.togglePin(targetPath);
    await refreshRecent();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--vs-bg)',
        color: 'var(--vs-fg)',
      }}
    >
      {/* Top macOS Drag / Branding Strip */}
      <div
        className="vs-drag-region"
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: window.vsApi?.platform === 'darwin' ? 84 : 16,
          paddingRight: 16,
          background: 'var(--vs-bg-titlebar)',
          borderBottom: '1px solid var(--vs-border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <VsLogoIcon size={16} />
          <span style={{ fontSize: 12, color: 'var(--vs-fg)' }}>
            Microsoft Visual Studio Community (macOS) — .NET 10
          </span>
        </div>
        <div className="vs-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              background: envStatus?.dotnetInstalled ? 'rgba(56,138,52,0.2)' : 'rgba(204,167,0,0.2)',
              color: envStatus?.dotnetInstalled ? 'var(--vs-success)' : 'var(--vs-warning)',
              border: '1px solid var(--vs-border)',
            }}
          >
            {envStatus?.dotnetInstalled
              ? `.NET SDK ${envStatus.dotnetVersion}`
              : '.NET SDK not detected'}
          </span>
          <select
            className="vs-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'dark' | 'blue' | 'light')}
            title="Switch Visual Studio Theme"
            style={{ fontSize: 11 }}
          >
            <option value="dark">Theme: Dark</option>
            <option value="blue">Theme: Blue</option>
            <option value="light">Theme: Light</option>
          </select>
          <button
            className="vs-btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => setDialog({ toolsOptionsOpen: true })}
          >
            <span className="codicon codicon-settings-gear" /> Options
          </button>
        </div>
      </div>

      {/* Main Content Centered like VS 2022 Start Window */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '24px 40px',
          overflow: 'auto',
        }}
      >
        <div style={{ width: '100%', maxWidth: 940 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <VsLogoIcon size={34} />
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 400, color: 'var(--vs-fg-bright)' }}>
                Visual Studio Community
              </h1>
              <div style={{ fontSize: 12, color: 'var(--vs-fg-muted)' }}>
                C# &amp; .NET 10 Development Environment for macOS • Private Edition
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 390px',
              gap: 36,
              alignItems: 'start',
            }}
          >
            {/* Left Column: Open recent */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 400, color: 'var(--vs-fg-bright)', marginBottom: 12 }}>
                Open recent
              </h2>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <span
                  className="codicon codicon-search"
                  style={{
                    position: 'absolute',
                    left: 9,
                    top: 7,
                    fontSize: 13,
                    color: 'var(--vs-fg-muted)',
                  }}
                />
                <input
                  className="vs-input"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search recent projects and solutions (Alt+S)"
                  style={{ width: '100%', paddingLeft: 28, height: 28 }}
                />
              </div>

              <div
                style={{
                  maxHeight: 370,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {filtered.length === 0 && (
                  <div
                    style={{
                      padding: 20,
                      border: '1px dashed var(--vs-border)',
                      color: 'var(--vs-fg-muted)',
                      borderRadius: 3,
                    }}
                  >
                    No recent solutions or projects yet. Click <strong>Create a new project</strong> on the right to start a .NET 10 Console App, Web API, or Multi-Project Solution.
                  </div>
                )}

                {pinned.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vs-fg-muted)', padding: '6px 4px' }}>
                      Pinned
                    </div>
                    {pinned.map((item) => (
                      <RecentRow
                        key={item.path}
                        item={item}
                        onOpen={() => openSolution(item.path)}
                        onTogglePin={(e) => handleTogglePin(e, item.path)}
                      />
                    ))}
                  </>
                )}

                {unpinned.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vs-fg-muted)', padding: '8px 4px 4px' }}>
                      Recent
                    </div>
                    {unpinned.map((item) => (
                      <RecentRow
                        key={item.path}
                        item={item}
                        onOpen={() => openSolution(item.path)}
                        onTogglePin={(e) => handleTogglePin(e, item.path)}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Right Column: Get started cards */}
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 400, color: 'var(--vs-fg-bright)', marginBottom: 12 }}>
                Get started
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <StartCard
                  icon="codicon-repo-clone"
                  title="Clone a repository"
                  subtitle="Get code from an online repository like GitHub or Azure DevOps"
                  onClick={() => setDialog({ cloneRepoOpen: true })}
                />
                <StartCard
                  icon="codicon-folder-opened"
                  title="Open a project or solution"
                  subtitle="Open a local Visual Studio .sln, .slnx, or .csproj file"
                  onClick={handleOpenProjectDialog}
                />
                <StartCard
                  icon="codicon-folder"
                  title="Open a local folder"
                  subtitle="Navigate and edit code within any folder"
                  onClick={handleOpenFolderDialog}
                />
                <StartCard
                  icon="codicon-new-file"
                  title="Create a new project"
                  subtitle="Choose a .NET 10 project template with code scaffolding to get started"
                  highlight
                  onClick={() => setDialog({ newProjectOpen: true })}
                />
              </div>

              <div style={{ marginTop: 18, textAlign: 'right' }}>
                <button
                  onClick={() => setScreen('ide')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--vs-accent-hover)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Continue without code →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const RecentRow: React.FC<{
  item: { path: string; name: string; lastOpened: string; pinned?: boolean };
  onOpen: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
}> = ({ item, onOpen, onTogglePin }) => {
  const dateLabel = new Date(item.lastOpened).toLocaleDateString();
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderRadius: 3,
        cursor: 'pointer',
        border: '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--vs-bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <SolutionIcon size={20} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--vs-fg-bright)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--vs-fg-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.path}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>{dateLabel}</span>
        <button
          onClick={onTogglePin}
          title={item.pinned ? 'Unpin' : 'Pin to top'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: item.pinned ? 'var(--vs-accent)' : 'var(--vs-fg-muted)',
          }}
        >
          <span className={`codicon ${item.pinned ? 'codicon-pinned' : 'codicon-pin'}`} />
        </button>
      </div>
    </div>
  );
};

const StartCard: React.FC<{
  icon: string;
  title: string;
  subtitle: string;
  highlight?: boolean;
  onClick: () => void;
}> = ({ icon, title, subtitle, highlight, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
      padding: '14px 16px',
      textAlign: 'left',
      background: 'var(--vs-bg-panel)',
      border: `1px solid ${highlight ? 'var(--vs-accent)' : 'var(--vs-border)'}`,
      borderRadius: 3,
      cursor: 'pointer',
      transition: 'background 0.12s, border-color 0.12s',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'var(--vs-bg-hover)';
      e.currentTarget.style.borderColor = 'var(--vs-accent)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'var(--vs-bg-panel)';
      e.currentTarget.style.borderColor = highlight ? 'var(--vs-accent)' : 'var(--vs-border)';
    }}
  >
    <span
      className={`codicon ${icon}`}
      style={{ fontSize: 22, color: 'var(--vs-purple)', marginTop: 2 }}
    />
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--vs-fg-bright)', marginBottom: 3 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--vs-fg-muted)', lineHeight: 1.35 }}>
        {subtitle}
      </div>
    </div>
  </button>
);
