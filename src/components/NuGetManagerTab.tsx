import React, { useEffect, useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { NuGetPackageSummary } from '../types/ide';
import { NuGetIcon } from './VsIcons';

export const NuGetManagerTab: React.FC<{ initialProjectId?: string }> = ({ initialProjectId }) => {
  const { solution, appendOutput } = useIdeStore();
  const [subTab, setSubTab] = useState<'browse' | 'installed'>('browse');
  const [query, setQuery] = useState('Newtonsoft.Json');
  const [results, setResults] = useState<NuGetPackageSummary[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<NuGetPackageSummary | null>(null);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [targetProjectId, setTargetProjectId] = useState<string>(
    initialProjectId || solution?.projects[0]?.id || '',
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const targetProject = solution?.projects.find((p) => p.id === targetProjectId) || solution?.projects[0];

  const handleSearch = async (q = query) => {
    setLoading(true);
    setMsg(null);
    try {
      const list = (await window.vsApi.nuget.search(q)) as NuGetPackageSummary[];
      setResults(list);
      if (list[0]) {
        setSelectedPkg(list[0]);
        setSelectedVersion(list[0].version);
      }
    } catch (err) {
      setMsg(`NuGet search failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void handleSearch('Newtonsoft.Json');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstall = async () => {
    if (!targetProject || !selectedPkg) return;
    setBusy(true);
    setMsg(null);
    const res = await window.vsApi.nuget.install(
      targetProject.path,
      selectedPkg.id,
      selectedVersion || selectedPkg.version,
    );
    if (res.success && solution) {
      const updated = await window.vsApi.solution.open(solution.path);
      useIdeStore.setState({ solution: updated });
      setMsg(`Installed ${selectedPkg.id} (${selectedVersion || selectedPkg.version}) into ${targetProject.name}.`);
      appendOutput('Package Manager', `Successfully installed '${selectedPkg.id}' to ${targetProject.name}`);
    } else {
      setMsg(res.output || 'Failed to install package');
    }
    setBusy(false);
  };

  const handleUninstall = async (pkgId: string) => {
    if (!targetProject) return;
    setBusy(true);
    setMsg(null);
    const res = await window.vsApi.nuget.remove(targetProject.path, pkgId);
    if (res.success && solution) {
      const updated = await window.vsApi.solution.open(solution.path);
      useIdeStore.setState({ solution: updated });
      setMsg(`Removed ${pkgId} from ${targetProject.name}.`);
    } else {
      setMsg(res.output || 'Failed to remove package');
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--vs-bg)' }}>
      {/* NuGet Header Bar */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--vs-border)',
          background: 'var(--vs-bg-panel)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NuGetIcon size={20} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--vs-fg-bright)' }}>
              NuGet Package Manager
            </span>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`vs-btn ${subTab === 'browse' ? 'vs-btn-primary' : ''}`}
              onClick={() => setSubTab('browse')}
            >
              Browse
            </button>
            <button
              className={`vs-btn ${subTab === 'installed' ? 'vs-btn-primary' : ''}`}
              onClick={() => setSubTab('installed')}
            >
              Installed ({targetProject?.packages.length ?? 0})
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--vs-fg-muted)' }}>Project:</span>
          <select
            className="vs-select"
            value={targetProject?.id || ''}
            onChange={(e) => setTargetProjectId(e.target.value)}
          >
            {solution?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {subTab === 'browse' ? (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 1fr', minHeight: 0 }}>
          {/* Search + List */}
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--vs-border)', minHeight: 0 }}>
            <div style={{ padding: 10, display: 'flex', gap: 6, borderBottom: '1px solid var(--vs-border-subtle)' }}>
              <input
                className="vs-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSearch();
                }}
                placeholder="Search NuGet.org packages..."
                style={{ flex: 1 }}
              />
              <button className="vs-btn vs-btn-primary" onClick={() => void handleSearch()}>
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {results.map((pkg) => {
                const active = selectedPkg?.id === pkg.id;
                return (
                  <div
                    key={pkg.id}
                    onClick={() => {
                      setSelectedPkg(pkg);
                      setSelectedVersion(pkg.version);
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--vs-border-subtle)',
                      background: active ? 'var(--vs-bg-selection)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 13, color: 'var(--vs-fg-bright)' }}>{pkg.id}</strong>
                      <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>v{pkg.version}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--vs-fg-muted)', marginTop: 2 }}>
                      by {pkg.authors} • {pkg.totalDownloads.toLocaleString()} downloads
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        marginTop: 4,
                        color: active ? '#eee' : 'var(--vs-fg)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {pkg.description}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Package Details */}
          <div style={{ padding: 18, overflowY: 'auto' }}>
            {selectedPkg ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <NuGetIcon size={28} />
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--vs-fg-bright)' }}>
                      {selectedPkg.id}
                    </h2>
                    <div style={{ fontSize: 12, color: 'var(--vs-fg-muted)' }}>
                      Authors: {selectedPkg.authors}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: 12,
                    background: 'var(--vs-bg-panel)',
                    border: '1px solid var(--vs-border)',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span>Version:</span>
                  <select
                    className="vs-select"
                    value={selectedVersion}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    {(selectedPkg.versions.length ? selectedPkg.versions : [selectedPkg.version]).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    className="vs-btn vs-btn-primary"
                    disabled={busy || !targetProject}
                    onClick={handleInstall}
                  >
                    {busy ? 'Installing...' : 'Install'}
                  </button>
                </div>

                {msg && (
                  <div
                    style={{
                      padding: 8,
                      border: '1px solid var(--vs-accent)',
                      borderRadius: 6,
                      background: 'var(--vs-bg-panel)',
                      fontSize: 12,
                    }}
                  >
                    {msg}
                  </div>
                )}

                <div>
                  <h4 style={{ fontSize: 12, color: 'var(--vs-fg-muted)', marginBottom: 4 }}>Description</h4>
                  <p style={{ lineHeight: 1.5 }}>{selectedPkg.description}</p>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--vs-fg-muted)' }}>Select a package to view details.</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
          {!targetProject?.packages.length ? (
            <div style={{ color: 'var(--vs-fg-muted)' }}>
              No NuGet packages installed in {targetProject?.name}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
              {targetProject.packages.map((pkg) => (
                <div
                  key={pkg.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--vs-bg-panel)',
                    border: '1px solid var(--vs-border)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <NuGetIcon size={20} />
                    <div>
                      <strong style={{ color: 'var(--vs-fg-bright)' }}>{pkg.id}</strong>
                      <div style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>Version {pkg.version}</div>
                    </div>
                  </div>
                  <button
                    className="vs-btn"
                    disabled={busy}
                    onClick={() => handleUninstall(pkg.id)}
                  >
                    Uninstall
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
