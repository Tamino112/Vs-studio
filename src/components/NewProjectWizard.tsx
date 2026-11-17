import React, { useEffect, useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { DotnetTemplate } from '../types/ide';
import { CSharpProjectIcon } from './VsIcons';

export const NewProjectWizard: React.FC<{ mode: 'newSolution' | 'addToSolution' }> = ({ mode }) => {
  const {
    templates,
    solution,
    newProjectOpen,
    addNewProjectOpen,
    setDialog,
    openSolution,
    refreshSolutionTrees,
    refreshRecent,
  } = useIdeStore();

  const isOpen = mode === 'newSolution' ? newProjectOpen : addNewProjectOpen;

  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [selectedTemplate, setSelectedTemplate] = useState<DotnetTemplate | null>(null);

  const [projectName, setProjectName] = useState('ConsoleApp1');
  const [solutionName, setSolutionName] = useState('ConsoleApp1');
  const [location, setLocation] = useState('');
  const [sameDirectory, setSameDirectory] = useState(false);
  const [framework, setFramework] = useState('net10.0');
  const [useProgramMain, setUseProgramMain] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setError(null);
    if (!selectedTemplate && templates.length > 0) {
      setSelectedTemplate(templates[0]);
    }
    if (mode === 'addToSolution' && solution) {
      const idx = solution.projects.length + 1;
      setProjectName(`Project${idx}`);
      setLocation(solution.dir);
    } else if (window.vsApi) {
      void window.vsApi.env.defaultProjectsDir().then((dir) => setLocation(dir));
    }
  }, [isOpen, templates, mode, solution, selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const base =
      selectedTemplate.shortName === 'console'
        ? 'ConsoleApp'
        : selectedTemplate.shortName === 'webapi'
        ? 'WebApi'
        : selectedTemplate.shortName === 'blazor'
        ? 'BlazorApp'
        : selectedTemplate.shortName === 'classlib'
        ? 'ClassLibrary'
        : selectedTemplate.category === 'Test'
        ? 'TestProject'
        : 'App';
    const nextNum = mode === 'addToSolution' && solution ? solution.projects.length + 1 : 1;
    const nextName = `${base}${nextNum}`;
    setProjectName(nextName);
    if (mode === 'newSolution') setSolutionName(nextName);
  }, [selectedTemplate, mode, solution]);

  if (!isOpen) return null;

  const close = () => {
    if (mode === 'newSolution') setDialog({ newProjectOpen: false });
    else setDialog({ addNewProjectOpen: false });
  };

  const filteredTemplates = templates.filter((t) => {
    const matchesCat = categoryFilter === 'All' || t.category === categoryFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  const handleBrowseLocation = async () => {
    const dir = await window.vsApi.dialog.openFolder();
    if (dir) setLocation(dir);
  };

  const handleCreate = async () => {
    if (!selectedTemplate || !projectName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      if (mode === 'newSolution') {
        const sln = await window.vsApi.solution.create({
          template: selectedTemplate.shortName,
          projectName: projectName.trim(),
          solutionName: (solutionName || projectName).trim(),
          location: location.trim(),
          sameDirectory,
          framework,
          useProgramMain,
        });
        close();
        await openSolution(sln.path);
        await refreshRecent();
      } else if (solution) {
        const updated = await window.vsApi.solution.addNewProject({
          slnPath: solution.path,
          template: selectedTemplate.shortName,
          projectName: projectName.trim(),
          framework,
          useProgramMain,
        });
        useIdeStore.setState({ solution: updated });
        await refreshSolutionTrees();
        close();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.56)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 820,
          height: 580,
          background: 'var(--vs-bg-panel)',
          border: '1px solid var(--vs-border)',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--vs-shadow, 0 12px 40px rgba(0,0,0,0.6))',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '13px 18px',
            borderBottom: '1px solid var(--vs-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--vs-bg-chrome)',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--vs-fg-bright)' }}>
            {mode === 'newSolution'
              ? step === 1
                ? 'Create a new project'
                : 'Configure your new project'
              : step === 1
              ? 'Add a new project'
              : `Configure new project in '${solution?.name}'`}
          </span>
          <button
            onClick={close}
            style={{ background: 'none', border: 'none', borderRadius: 5, padding: 4, cursor: 'pointer', color: 'var(--vs-fg)' }}
          >
            <span className="codicon codicon-close" />
          </button>
        </div>

        {/* Body */}
        {step === 1 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 18, minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <input
                className="vs-input"
                placeholder="Search for templates (e.g., Console, Web API, Blazor, xUnit)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, height: 32 }}
                autoFocus
              />
              <select
                className="vs-select"
                value="C#"
                disabled
                style={{ width: 120, height: 32 }}
              >
                <option value="C#">C#</option>
              </select>
              <select
                className="vs-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ width: 150, height: 32 }}
              >
                <option value="All">All project types</option>
                <option value="Console">Console</option>
                <option value="Web">Web</option>
                <option value="Library">Library</option>
                <option value="Test">Test</option>
                <option value="Worker">Worker</option>
              </select>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid var(--vs-border)',
                borderRadius: 7,
                padding: 4,
                background: 'var(--vs-bg)',
              }}
            >
              {filteredTemplates.map((tpl) => {
                const active = selectedTemplate?.shortName === tpl.shortName;
                return (
                  <div
                    key={tpl.shortName}
                    onClick={() => setSelectedTemplate(tpl)}
                    onDoubleClick={() => {
                      setSelectedTemplate(tpl);
                      setStep(2);
                    }}
                    style={{
                      display: 'flex',
                      gap: 14,
                      padding: '12px 14px',
                      marginBottom: 2,
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: active ? 'var(--vs-bg-selection)' : 'transparent',
                      color: active ? '#FFFFFF' : 'var(--vs-fg)',
                    }}
                  >
                    <CSharpProjectIcon
                      size={28}
                      kind={tpl.category === 'Web' ? 'web' : tpl.category === 'Test' ? 'test' : 'exe'}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#FFFFFF' : 'var(--vs-fg-bright)' }}>
                        {tpl.name}
                      </div>
                      <div style={{ fontSize: 12, color: active ? '#e4e4e7' : 'var(--vs-fg-muted)', margin: '2px 0 6px' }}>
                        {tpl.description}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {tpl.tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              fontSize: 10.5,
                              padding: '1px 8px',
                              borderRadius: 999,
                              background: active ? 'rgba(255,255,255,0.16)' : 'var(--vs-bg-chrome)',
                              border: `1px solid ${active ? 'rgba(255,255,255,0.28)' : 'var(--vs-border)'}`,
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--vs-fg-muted)', marginBottom: 4 }}>
              Template: <strong style={{ color: 'var(--vs-fg-bright)' }}>{selectedTemplate?.name}</strong> (C#)
            </div>

            <FieldRow label="Project name">
              <input
                className="vs-input"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (mode === 'newSolution') setSolutionName(e.target.value);
                }}
                style={{ width: '100%' }}
              />
            </FieldRow>

            {mode === 'newSolution' && (
              <>
                <FieldRow label="Location">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="vs-input"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button className="vs-btn" onClick={handleBrowseLocation}>
                      ...
                    </button>
                  </div>
                </FieldRow>

                <FieldRow label="Solution name">
                  <input
                    className="vs-input"
                    value={solutionName}
                    onChange={(e) => setSolutionName(e.target.value)}
                    disabled={sameDirectory}
                    style={{ width: '100%', opacity: sameDirectory ? 0.6 : 1 }}
                  />
                </FieldRow>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sameDirectory}
                    onChange={(e) => setSameDirectory(e.target.checked)}
                  />
                  <span>Place solution and project in the same directory</span>
                </label>
              </>
            )}

            <FieldRow label="Framework">
              <select
                className="vs-select"
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                style={{ width: '100%', height: 28 }}
              >
                <option value="net10.0">.NET 10.0 (Long Term Support)</option>
                <option value="net9.0">.NET 9.0 (Standard Term Support)</option>
                <option value="net8.0">.NET 8.0 (Long Term Support)</option>
              </select>
            </FieldRow>

            {selectedTemplate?.supportsTopLevelStatements && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useProgramMain}
                  onChange={(e) => setUseProgramMain(e.target.checked)}
                />
                <span>Do not use top-level statements (generate Program.Main)</span>
              </label>
            )}

            {error && (
              <div style={{ color: 'var(--vs-error)', fontSize: 12, padding: 8, border: '1px solid var(--vs-error)' }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--vs-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--vs-bg-chrome)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>
            Multi-project solutions supported: add more projects via Solution Explorer → Add → New Project
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 2 && (
              <button className="vs-btn" onClick={() => setStep(1)}>
                Back
              </button>
            )}
            <button className="vs-btn" onClick={close}>
              Cancel
            </button>
            {step === 1 ? (
              <button
                className="vs-btn vs-btn-primary"
                disabled={!selectedTemplate}
                onClick={() => setStep(2)}
              >
                Next
              </button>
            ) : (
              <button
                className="vs-btn vs-btn-primary"
                disabled={creating || !projectName.trim()}
                onClick={handleCreate}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const FieldRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 12 }}>
    <label style={{ color: 'var(--vs-fg)' }}>{label}</label>
    <div>{children}</div>
  </div>
);
