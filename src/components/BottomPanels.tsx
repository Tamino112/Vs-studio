import React, { useEffect, useRef, useState } from 'react';
import { selectAllEffectiveDiagnostics, useIdeStore } from '../store/useIdeStore';
import { OutputChannelName } from '../types/ide';

export const ErrorListPanel: React.FC = () => {
  const {
    buildDiagnostics,
    lspDiagnosticsByFile,
    liveDiagnosticsByFile,
    lspHasPublished,
    lspStaleByFile,
    openTabs,
    openFile,
  } = useIdeStore();
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [showMessages, setShowMessages] = useState(true);
  const [filter, setFilter] = useState('');
  const [selectedDiagId, setSelectedDiagId] = useState<string | null>(null);

  const all = selectAllEffectiveDiagnostics({
    buildDiagnostics,
    lspDiagnosticsByFile,
    liveDiagnosticsByFile,
    lspHasPublished,
    lspStaleByFile,
    openTabs,
  });
  const errCount = all.filter((d) => d.severity === 'error').length;
  const warnCount = all.filter((d) => d.severity === 'warning').length;
  const msgCount = all.filter((d) => d.severity === 'message').length;

  const visible = all.filter((d) => {
    if (d.severity === 'error' && !showErrors) return false;
    if (d.severity === 'warning' && !showWarnings) return false;
    if (d.severity === 'message' && !showMessages) return false;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      return (
        d.code.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.file.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          borderBottom: '1px solid var(--vs-border-subtle)',
          background: 'var(--vs-bg-panel)',
        }}
      >
        <FilterToggle
          active={showErrors}
          onClick={() => setShowErrors(!showErrors)}
          icon="codicon-error"
          color="var(--vs-error)"
          label={`${errCount} Error${errCount === 1 ? '' : 's'}`}
        />
        <FilterToggle
          active={showWarnings}
          onClick={() => setShowWarnings(!showWarnings)}
          icon="codicon-warning"
          color="var(--vs-warning)"
          label={`${warnCount} Warning${warnCount === 1 ? '' : 's'}`}
        />
        <FilterToggle
          active={showMessages}
          onClick={() => setShowMessages(!showMessages)}
          icon="codicon-info"
          color="var(--vs-info)"
          label={`${msgCount} Message${msgCount === 1 ? '' : 's'}`}
        />
        <div style={{ flex: 1 }} />
        <input
          className="vs-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search Error List"
          style={{ width: 220, height: 22, fontSize: 11.5 }}
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: 'var(--vs-bg-panel)', borderBottom: '1px solid var(--vs-border)', textAlign: 'left' }}>
              <th style={{ padding: '5px 8px', width: 28 }} />
              <th style={{ padding: '5px 8px', width: 74, fontWeight: 600 }}>Code</th>
              <th style={{ padding: '5px 8px', fontWeight: 600 }}>Description</th>
              <th style={{ padding: '5px 8px', width: 130, fontWeight: 600 }}>Project</th>
              <th style={{ padding: '5px 8px', width: 170, fontWeight: 600 }}>File</th>
              <th style={{ padding: '5px 8px', width: 55, fontWeight: 600 }}>Line</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 14, color: 'var(--vs-fg-muted)' }}>
                  No errors or warnings.
                </td>
              </tr>
            ) : (
              visible.map((d) => {
                const isSelected = selectedDiagId === d.id;
                return (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDiagId(d.id)}
                    onDoubleClick={() => void openFile(d.file, d.line, d.column)}
                    style={{
                      borderBottom: '1px solid var(--vs-border-subtle)',
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
                    <td style={{ padding: '4px 8px' }}>
                      <span
                        className={`codicon ${
                          d.severity === 'error'
                            ? 'codicon-error'
                            : d.severity === 'warning'
                            ? 'codicon-warning'
                            : 'codicon-info'
                        }`}
                        style={{
                          color: isSelected
                            ? '#FFFFFF'
                            : d.severity === 'error'
                            ? 'var(--vs-error)'
                            : d.severity === 'warning'
                            ? 'var(--vs-warning)'
                            : 'var(--vs-info)',
                        }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', fontWeight: 600 }}>{d.code}</td>
                    <td style={{ padding: '4px 8px' }}>{d.description}</td>
                    <td style={{ padding: '4px 8px', color: isSelected ? '#E4E4E7' : 'var(--vs-fg-muted)' }}>
                      {d.project}
                    </td>
                    <td style={{ padding: '4px 8px', color: isSelected ? '#E4E4E7' : 'var(--vs-fg-muted)' }}>
                      {d.file.split(/[/\\]/).pop()}
                    </td>
                    <td style={{ padding: '4px 8px' }}>{d.line}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const FilterToggle: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: string;
  color: string;
  label: string;
}> = ({ active, onClick, icon, color, label }) => (
  <button
    onClick={onClick}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 9px',
      borderRadius: 5,
      background: active ? 'var(--vs-bg-input)' : 'transparent',
      border: `1px solid ${active ? 'var(--vs-border)' : 'transparent'}`,
      cursor: 'pointer',
      fontSize: 11.5,
      opacity: active ? 1 : 0.6,
      transition: 'background 0.12s ease, opacity 0.12s ease',
    }}
  >
    <span className={`codicon ${icon}`} style={{ color, fontSize: 13 }} />
    <span>{label}</span>
  </button>
);

export const OutputPanel: React.FC = () => {
  const { outputChannels, activeOutputChannel, setActiveOutputChannel, clearOutput, debugState } = useIdeStore();
  const [stdinText, setStdinText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const lines = outputChannels[activeOutputChannel] || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [lines.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderBottom: '1px solid var(--vs-border-subtle)',
          background: 'var(--vs-bg-panel)',
        }}
      >
        <span style={{ fontSize: 11.5 }}>Show output from:</span>
        <select
          className="vs-select"
          value={activeOutputChannel}
          onChange={(e) => setActiveOutputChannel(e.target.value as OutputChannelName)}
          style={{ height: 22, fontSize: 11.5 }}
        >
          <option value="Build">Build</option>
          <option value="Debug">Debug</option>
          <option value="Package Manager">Package Manager</option>
          <option value="Language Server">Language Server</option>
          <option value="Tests">Tests</option>
        </select>
        <button
          className="vs-btn"
          style={{ padding: '2px 8px', fontSize: 11 }}
          onClick={() => clearOutput(activeOutputChannel)}
        >
          <span className="codicon codicon-clear-all" /> Clear All
        </button>
        {activeOutputChannel === 'Debug' && (
          <button
            className="vs-btn"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => void window.vsApi?.console.open()}
            title="Open Microsoft Visual Studio Debug Console Window"
          >
            <span className="codicon codicon-terminal" /> Open Debug Console
          </button>
        )}
      </div>

      <div
        className="mono"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 10px',
          fontSize: 12,
          lineHeight: 1.45,
          userSelect: 'text',
        }}
      >
        {lines.map((l, idx) => (
          <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {l}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {debugState === 'running' && activeOutputChannel === 'Debug' && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '4px 8px',
            borderTop: '1px solid var(--vs-border)',
            background: 'var(--vs-bg-panel)',
          }}
        >
          <input
            className="vs-input mono"
            value={stdinText}
            onChange={(e) => setStdinText(e.target.value)}
            placeholder="Send standard input (stdin) to running .NET process and press Enter..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void window.vsApi.debug.sendInput(stdinText + '\n');
                setStdinText('');
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            className="vs-btn"
            onClick={() => {
              void window.vsApi.debug.sendInput(stdinText + '\n');
              setStdinText('');
            }}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
};

export const TerminalPanel: React.FC = () => {
  const { solution, pendingTerminalCommand, consumePendingTerminalCommand } = useIdeStore();
  const [termOutput, setTermOutput] = useState<string>('Initializing macOS Developer Terminal...\n');
  const [cmdInput, setCmdInput] = useState('');
  const termId = 'main-terminal';
  const outRef = useRef<HTMLDivElement>(null);
  const terminalReadyRef = useRef(false);
  const lastCmdIdRef = useRef<number>(0);

  useEffect(() => {
    if (!window.vsApi) return;
    terminalReadyRef.current = false;
    const cwd = solution?.dir || '.';
    void window.vsApi.terminal.create(termId, cwd).then(() => {
      terminalReadyRef.current = true;
      const pending = useIdeStore.getState().pendingTerminalCommand;
      if (pending && pending.id !== lastCmdIdRef.current) {
        lastCmdIdRef.current = pending.id;
        setTermOutput((prev) => prev + `\n$ ${pending.command}\n`);
        void window.vsApi.terminal.write(termId, `cd "${pending.cwd.replace(/"/g, '\\"')}" && ${pending.command}\n`);
        useIdeStore.getState().consumePendingTerminalCommand();
      }
    });
    const unsubData = window.vsApi.on('terminal:data', (payload) => {
      const p = payload as { id: string; data: string };
      if (p.id === termId) {
        setTermOutput((prev) => (prev + p.data).slice(-25000));
      }
    });
    return () => {
      terminalReadyRef.current = false;
      unsubData();
      void window.vsApi.terminal.kill(termId);
    };
  }, [solution?.dir]);

  useEffect(() => {
    if (!pendingTerminalCommand || !terminalReadyRef.current) return;
    if (pendingTerminalCommand.id === lastCmdIdRef.current) return;
    lastCmdIdRef.current = pendingTerminalCommand.id;
    setTermOutput((prev) => prev + `\n$ ${pendingTerminalCommand.command}\n`);
    void window.vsApi.terminal.write(
      termId,
      `cd "${pendingTerminalCommand.cwd.replace(/"/g, '\\"')}" && ${pendingTerminalCommand.command}\n`,
    );
    consumePendingTerminalCommand();
  }, [pendingTerminalCommand, consumePendingTerminalCommand]);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [termOutput]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={outRef}
        className="mono"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          userSelect: 'text',
        }}
      >
        {termOutput}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderTop: '1px solid var(--vs-border)',
          background: 'var(--vs-bg-panel)',
        }}
      >
        <span className="mono" style={{ color: 'var(--vs-accent)' }}>$</span>
        <input
          className="vs-input mono"
          value={cmdInput}
          onChange={(e) => setCmdInput(e.target.value)}
          placeholder="Type command or program stdin (e.g. dotnet --info, dotnet build, git status)..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setTermOutput((prev) => prev + cmdInput + '\n');
              void window.vsApi.terminal.write(termId, cmdInput + '\n');
              setCmdInput('');
            } else if (e.key === 'c' && e.ctrlKey) {
              void window.vsApi.terminal.write(termId, '\x03');
            }
          }}
          style={{ flex: 1, border: 'none', background: 'transparent' }}
        />
      </div>
    </div>
  );
};

export const TestExplorerPanel: React.FC = () => {
  const { tests, runTests, solution } = useIdeStore();
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const skipped = tests.filter((t) => t.status === 'skipped').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 8px',
          borderBottom: '1px solid var(--vs-border-subtle)',
          background: 'var(--vs-bg-panel)',
        }}
      >
        <button
          className="vs-btn vs-btn-primary"
          disabled={!solution}
          onClick={() => void runTests()}
          style={{ padding: '2px 10px', fontSize: 11.5 }}
        >
          <span className="codicon codicon-run-all" /> Run All Tests
        </button>
        <span style={{ color: 'var(--vs-success)' }}>✓ {passed} Passed</span>
        <span style={{ color: 'var(--vs-error)' }}>✕ {failed} Failed</span>
        <span style={{ color: 'var(--vs-warning)' }}>⚠ {skipped} Skipped</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {tests.length === 0 ? (
          <div style={{ padding: 10, color: 'var(--vs-fg-muted)' }}>
            Click <strong>Run All Tests</strong> to execute <code>dotnet test</code> across your solution.
          </div>
        ) : (
          tests.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                borderBottom: '1px solid var(--vs-border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className={`codicon ${
                    t.status === 'passed'
                      ? 'codicon-pass'
                      : t.status === 'failed'
                      ? 'codicon-error'
                      : 'codicon-circle-slash'
                  }`}
                  style={{
                    color:
                      t.status === 'passed'
                        ? 'var(--vs-success)'
                        : t.status === 'failed'
                        ? 'var(--vs-error)'
                        : 'var(--vs-warning)',
                  }}
                />
                <strong>{t.name}</strong>
                <span style={{ color: 'var(--vs-fg-muted)', fontSize: 11 }}>{t.suite}</span>
              </div>
              {t.durationMs !== undefined && (
                <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>{t.durationMs} ms</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const FindResultsPanel: React.FC = () => {
  const { searchResults, openFile } = useIdeStore();
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 6 }}>
      {searchResults.length === 0 ? (
        <div style={{ padding: 10, color: 'var(--vs-fg-muted)' }}>
          No search results. Press Cmd+Shift+F / Ctrl+Shift+F to search across all solution files.
        </div>
      ) : (
        searchResults.map((m, idx) => (
          <div
            key={`${m.file}:${m.line}:${idx}`}
            onClick={() => void openFile(m.file, m.line, m.column)}
            style={{
              padding: '3px 8px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--vs-border-subtle)',
              display: 'flex',
              gap: 10,
            }}
          >
            <span style={{ color: 'var(--vs-accent)', minWidth: 210 }}>
              {m.relativePath}({m.line},{m.column}):
            </span>
            <span className="mono" style={{ color: 'var(--vs-fg)' }}>
              {m.lineText}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

export const DebugBottomPanel: React.FC<{
  tab: 'locals' | 'watch' | 'callStack' | 'breakpoints';
}> = ({ tab }) => {
  const {
    debugLocals,
    debugFrames,
    breakpoints,
    watchExpressions,
    toggleBreakpointEnabled,
    removeBreakpoint,
    addWatchExpression,
    removeWatchExpression,
    openFile,
  } = useIdeStore();
  const [watchInput, setWatchInput] = useState('');

  if (tab === 'locals') {
    return (
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: 'var(--vs-bg-panel)', borderBottom: '1px solid var(--vs-border)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px', width: '30%' }}>Name</th>
              <th style={{ padding: '4px 8px', width: '45%' }}>Value</th>
              <th style={{ padding: '4px 8px', width: '25%' }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {debugLocals.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 10, color: 'var(--vs-fg-muted)' }}>
                  Locals appear when paused at a breakpoint.
                </td>
              </tr>
            ) : (
              debugLocals.map((v, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--vs-border-subtle)' }}>
                  <td style={{ padding: '3px 8px', fontWeight: 600 }}>{v.name}</td>
                  <td className="mono" style={{ padding: '3px 8px' }}>{v.value}</td>
                  <td style={{ padding: '3px 8px', color: 'var(--vs-fg-muted)' }}>{v.type}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === 'watch') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid var(--vs-border-subtle)' }}>
          <input
            className="vs-input"
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value)}
            placeholder="Add expression to watch..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && watchInput.trim()) {
                void addWatchExpression(watchInput.trim());
                setWatchInput('');
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            className="vs-btn"
            onClick={() => {
              if (watchInput.trim()) {
                void addWatchExpression(watchInput.trim());
                setWatchInput('');
              }
            }}
          >
            Add Watch
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {watchExpressions.map((w) => (
            <div
              key={w.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 10px',
                borderBottom: '1px solid var(--vs-border-subtle)',
              }}
            >
              <span className="mono">{w.expression} = {w.value}</span>
              <button
                onClick={() => removeWatchExpression(w.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vs-fg-muted)' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'callStack') {
    return (
      <div style={{ height: '100%', overflowY: 'auto' }}>
        {debugFrames.length === 0 ? (
          <div style={{ padding: 10, color: 'var(--vs-fg-muted)' }}>
            Call Stack is empty when not paused in debugger.
          </div>
        ) : (
          debugFrames.map((f) => (
            <div
              key={f.id}
              onClick={() => f.file && void openFile(f.file, f.line, f.column)}
              style={{
                padding: '4px 10px',
                cursor: f.file ? 'pointer' : 'default',
                borderBottom: '1px solid var(--vs-border-subtle)',
              }}
            >
              <strong>{f.name}</strong>
              {f.file && (
                <span style={{ marginLeft: 8, color: 'var(--vs-fg-muted)' }}>
                  {f.file.split(/[/\\]/).pop()} : Line {f.line}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {breakpoints.length === 0 ? (
        <div style={{ padding: 10, color: 'var(--vs-fg-muted)' }}>
          No breakpoints set. Click the left margin of any code editor to set a breakpoint.
        </div>
      ) : (
        breakpoints.map((bp) => (
          <div
            key={bp.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 10px',
              borderBottom: '1px solid var(--vs-border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={bp.enabled}
                onChange={() => toggleBreakpointEnabled(bp.id)}
              />
              <span
                style={{ cursor: 'pointer' }}
                onClick={() => void openFile(bp.file, bp.line)}
              >
                {bp.file.split(/[/\\]/).pop()}, line {bp.line}
              </span>
            </div>
              <button
                className="vs-btn"
                style={{ padding: '1px 6px', fontSize: 11 }}
                onClick={() => removeBreakpoint(bp.id)}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    );
  };

export const TaskListPanel: React.FC = () => {
  const { taskListItems, refreshTaskList, openFile, solution } = useIdeStore();
  const [filter, setFilter] = useState('');

  const visible = taskListItems.filter((item) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      item.tag.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.file.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderBottom: '1px solid var(--vs-border-subtle)',
          background: 'var(--vs-bg-panel)',
        }}
      >
        <button
          className="vs-btn"
          disabled={!solution}
          onClick={() => void refreshTaskList()}
          style={{ padding: '2px 8px', fontSize: 11 }}
        >
          <span className="codicon codicon-refresh" /> Refresh
        </button>
        <span style={{ fontSize: 11, color: 'var(--vs-fg-muted)' }}>
          Comments matching TODO, HACK, FIXME, UNDONE ({visible.length})
        </span>
        <div style={{ flex: 1 }} />
        <input
          className="vs-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search Task List"
          style={{ width: 200, height: 20, fontSize: 11 }}
        />
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: 'var(--vs-bg-panel)', borderBottom: '1px solid var(--vs-border)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px', width: 70 }}>Priority</th>
              <th style={{ padding: '4px 8px', width: 75 }}>Tag</th>
              <th style={{ padding: '4px 8px' }}>Description</th>
              <th style={{ padding: '4px 8px', width: 190 }}>File</th>
              <th style={{ padding: '4px 8px', width: 55 }}>Line</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 14, color: 'var(--vs-fg-muted)' }}>
                  No TODO / HACK / FIXME / UNDONE comments found in solution.
                </td>
              </tr>
            ) : (
              visible.map((t) => (
                <tr
                  key={t.id}
                  onDoubleClick={() => void openFile(t.file, t.line, 1)}
                  onClick={() => void openFile(t.file, t.line, 1, { preview: true })}
                  style={{ borderBottom: '1px solid var(--vs-border-subtle)', cursor: 'pointer' }}
                >
                  <td
                    style={{
                      padding: '3px 8px',
                      color: t.priority === 'High' ? 'var(--vs-warning)' : 'var(--vs-fg-muted)',
                      fontWeight: t.priority === 'High' ? 600 : 400,
                    }}
                  >
                    {t.priority}
                  </td>
                  <td style={{ padding: '3px 8px', fontWeight: 600 }}>{t.tag}</td>
                  <td style={{ padding: '3px 8px' }}>{t.description}</td>
                  <td style={{ padding: '3px 8px', color: 'var(--vs-fg-muted)' }}>
                    {t.file.split(/[/\\]/).pop()}
                  </td>
                  <td style={{ padding: '3px 8px' }}>{t.line}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const ImmediateWindowPanel: React.FC = () => {
  const { debugState, debugFrames } = useIdeStore();
  const [history, setHistory] = useState<string[]>([
    'Immediate Window — Enter C# expressions while paused at a breakpoint, or type "clear".',
  ]);
  const [expr, setExpr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [history.length]);

  const handleEval = async () => {
    const trimmed = expr.trim();
    if (!trimmed) return;
    setExpr('');
    if (trimmed === 'clear' || trimmed === 'cls') {
      setHistory([]);
      return;
    }

    if (debugState !== 'paused') {
      setHistory((h) => [
        ...h,
        `> ${trimmed}`,
        'The expression cannot be evaluated while not paused in the debugger. Hit a breakpoint (F9 + F5) first.',
      ]);
      return;
    }

    try {
      const topFrameId = debugFrames[0]?.id;
      const result = await window.vsApi.debug.evaluate(trimmed, topFrameId);
      setHistory((h) => [...h, `> ${trimmed}`, result]);
    } catch (e) {
      setHistory((h) => [...h, `> ${trimmed}`, `Error: ${(e as Error).message}`]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        className="mono"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 10px',
          fontSize: 12,
          lineHeight: 1.45,
          userSelect: 'text',
        }}
      >
        {history.map((line, idx) => (
          <div
            key={idx}
            style={{
              whiteSpace: 'pre-wrap',
              color: line.startsWith('>') ? 'var(--vs-accent)' : 'var(--vs-fg)',
            }}
          >
            {line}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderTop: '1px solid var(--vs-border)',
          background: 'var(--vs-bg-panel)',
        }}
      >
        <span className="mono" style={{ color: 'var(--vs-accent)', fontWeight: 700 }}>
          &gt;
        </span>
        <input
          className="vs-input mono"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="Evaluate C# expression (e.g. myVar, items.Count)..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleEval();
          }}
          style={{ flex: 1, border: 'none', background: 'transparent' }}
        />
      </div>
    </div>
  );
};

