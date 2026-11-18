import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ConsoleSessionInfo } from '../types/ide';
import {
  applyTerminalChunk,
  containsCursorQuery,
  formatExitCode,
  terminalCursorPosition,
  terminalSegments,
} from '../utils/terminalRender';

interface ConsoleSnapshotPayload {
  session: ConsoleSessionInfo | null;
  output: string;
}

export const DebugConsoleWindow: React.FC = () => {
  const [session, setSession] = useState<ConsoleSessionInfo | null>(null);
  const [output, setOutput] = useState<string>('');
  const [inputBuffer, setInputBuffer] = useState<string>('');
  const [autoClose, setAutoClose] = useState<boolean>(
    () => localStorage.getItem('vs.autoCloseConsole') === 'true',
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ConsoleSessionInfo | null>(null);
  sessionRef.current = session;
  const inputBufferRef = useRef<string>('');
  inputBufferRef.current = inputBuffer;
  const autoCloseRef = useRef<boolean>(autoClose);
  autoCloseRef.current = autoClose;
  const outputRef = useRef<string>('');
  const segments = useMemo(() => terminalSegments(output), [output]);

  useEffect(() => {
    document.title = 'Microsoft Visual Studio Debug Console';
    bodyRef.current?.focus();
    if (!window.vsApi) return;

    let cancelled = false;
    void (window.vsApi.console.getSnapshot() as Promise<ConsoleSnapshotPayload>).then((snap) => {
      if (cancelled) return;
      if (snap?.session) setSession(snap.session);
      if (snap?.output) {
        const restored = applyTerminalChunk('', snap.output);
        outputRef.current = restored;
        setOutput(restored);
        const tailQueries = containsCursorQuery(snap.output.slice(-64));
        if (tailQueries > 0 && snap.session?.running && snap.session?.isPty) {
          const { row, col } = terminalCursorPosition(restored);
          for (let q = 0; q < tailQueries; q++) {
            void window.vsApi?.debug.sendInput(`\x1b[${row};${col}R`);
          }
        }
      }
    });

    const unsubSession = window.vsApi.on('console:session', (payload) => {
      const s = payload as ConsoleSessionInfo;
      setSession(s);
      outputRef.current = '';
      setOutput('');
      setInputBuffer('');
      bodyRef.current?.focus();
    });

    const unsubData = window.vsApi.on('console:data', (chunk) => {
      const raw = String(chunk || '');
      if (raw) {
        const next = applyTerminalChunk(outputRef.current, raw);
        outputRef.current = next;
        setOutput(next);
        // Answer cursor position queries (ESC[6n), e.g. Console.CursorLeft / CursorTop
        const queries = containsCursorQuery(raw);
        if (queries > 0 && sessionRef.current?.isPty) {
          const { row, col } = terminalCursorPosition(next);
          for (let q = 0; q < queries; q++) {
            void window.vsApi?.debug.sendInput(`\x1b[${row};${col}R`);
          }
        }
      }
    });

    const unsubExit = window.vsApi.on('console:exit', (payload) => {
      const info = payload as { code: number; pid?: number; exePath: string };
      setSession((cur) =>
        cur
          ? {
              ...cur,
              running: false,
              exitCode: info.code,
              pid: info.pid ?? cur.pid,
              exePath: info.exePath || cur.exePath,
            }
          : {
              sessionId: 1,
              projectName: 'ConsoleApp',
              configuration: 'Debug',
              targetFramework: 'net10.0',
              exePath: info.exePath,
              command: info.exePath,
              pid: info.pid,
              running: false,
              exitCode: info.code,
            },
      );
      if (autoCloseRef.current) {
        setTimeout(() => {
          void window.vsApi?.console.close();
        }, 450);
      }
    });

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'vs.autoCloseConsole') {
        setAutoClose(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      unsubSession();
      unsubData();
      unsubExit();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Auto-scroll to bottom when output or inputBuffer updates
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [output, inputBuffer, session?.running]);

  // Direct terminal keyboard capture:
  // - In PTY mode: forwards every keypress immediately (so Console.ReadKey / ReadKey(true) / Read / ReadLine all work natively)
  // - After exit: press any non-modifier key to close window (Visual Studio behavior)
  useEffect(() => {
    const mapSpecialKey = (key: string): string | null => {
      switch (key) {
        case 'Enter': return '\r';
        case 'Backspace': return '\x7f';
        case 'Tab': return '\t';
        case 'Escape': return '\x1b';
        case 'ArrowUp': return '\x1b[A';
        case 'ArrowDown': return '\x1b[B';
        case 'ArrowRight': return '\x1b[C';
        case 'ArrowLeft': return '\x1b[D';
        case 'Home': return '\x1b[H';
        case 'End': return '\x1b[F';
        case 'Delete': return '\x1b[3~';
        default: return null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const activeTag = (e.target as HTMLElement | null)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'BUTTON') return;

      const cur = sessionRef.current;

      // After process exit: press any non-modifier key to close window (Visual Studio behavior)
      if (cur && !cur.running) {
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') return; // allow copy
        e.preventDefault();
        void window.vsApi?.console.close();
        return;
      }

      if (!cur?.running) return;

      if (e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        if (cur.isPty) {
          void window.vsApi?.debug.sendInput('\x03');
        } else {
          void window.vsApi?.debug.stop();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void navigator.clipboard?.readText().then((clip) => {
          if (!clip) return;
          if (cur.isPty) {
            void window.vsApi?.debug.sendInput(clip.replace(/\r?\n/g, '\r'));
            return;
          }
          const lines = clip.replace(/\r\n/g, '\n').split('\n');
          if (lines.length > 1) {
            const first = lines.shift() || '';
            const toSend = inputBufferRef.current + first + '\n' + lines.join('\n');
            outputRef.current = applyTerminalChunk(outputRef.current, toSend);
            setOutput(outputRef.current);
            setInputBuffer('');
            void window.vsApi?.debug.sendInput(toSend);
          } else {
            setInputBuffer((b) => b + clip);
          }
        });
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (cur.isPty) {
        const mapped = mapSpecialKey(e.key);
        if (mapped !== null) {
          e.preventDefault();
          void window.vsApi?.debug.sendInput(mapped);
          return;
        }
        if (e.key.length === 1) {
          e.preventDefault();
          void window.vsApi?.debug.sendInput(e.key);
        }
        return;
      }

      // Fallback when running over pipe without PTY
      if (e.key === 'Enter') {
        e.preventDefault();
        const line = inputBufferRef.current + '\n';
        outputRef.current = applyTerminalChunk(outputRef.current, line);
        setOutput(outputRef.current);
        setInputBuffer('');
        void window.vsApi?.debug.sendInput(line);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setInputBuffer((b) => b.slice(0, -1));
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setInputBuffer((b) => b + '    ');
      } else if (e.key.length === 1) {
        e.preventDefault();
        setInputBuffer((b) => b + e.key);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleAutoClose = (val: boolean) => {
    setAutoClose(val);
    localStorage.setItem('vs.autoCloseConsole', String(val));
  };

  const isMac = window.vsApi?.platform === 'darwin';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: '#0C0C0C',
        color: '#CCCCCC',
        fontFamily: "'Consolas', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, monospace",
      }}
    >
      {/* Visual Studio Debug Console Window Header */}
      <div
        className="vs-drag-region"
        style={{
          height: 36,
          background: '#1B1B1E',
          borderBottom: '1px solid #2D2D32',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isMac ? 76 : 12,
          paddingRight: window.vsApi?.platform === 'win32' ? 148 : 10,
          flexShrink: 0,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="codicon codicon-terminal" style={{ color: '#4CC2FF', fontSize: 14 }} />
          <span style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
            Microsoft Visual Studio Debug Console
          </span>
          {session && (
            <span
              style={{
                fontSize: 11,
                padding: '1px 8px',
                borderRadius: 10,
                background: session.running ? 'rgba(56, 138, 52, 0.22)' : 'rgba(130, 130, 145, 0.2)',
                color: session.running ? '#89D185' : '#A1A1AA',
                border: `1px solid ${session.running ? 'rgba(137, 209, 133, 0.35)' : 'rgba(161, 161, 170, 0.25)'}`,
                whiteSpace: 'nowrap',
              }}
            >
              {session.running
                ? `Running • ${session.projectName}${session.pid ? ` (PID ${session.pid})` : ''}`
                : `Exited (${session.exitCode ?? 0})`}
            </span>
          )}
        </div>

        <div className="vs-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: '#A1A1AA',
              cursor: 'pointer',
            }}
            title="Tools -> Options -> Debugging -> Automatically close the console when debugging stops"
          >
            <input
              type="checkbox"
              checked={autoClose}
              onChange={(e) => {
                toggleAutoClose(e.target.checked);
                e.currentTarget.blur();
              }}
            />
            Auto-close
          </label>

          {session?.running && (
            <button
              className="vs-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                void window.vsApi?.debug.stop();
              }}
              title="Stop process (Ctrl+C)"
              style={{ padding: '2px 8px', fontSize: 11, background: '#2A1D1D', borderColor: '#5C2B2B', color: '#F48771' }}
            >
              <span className="codicon codicon-debug-stop" style={{ fontSize: 12 }} /> Stop
            </button>
          )}

          <button
            className="vs-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              outputRef.current = '';
              setOutput('');
            }}
            title="Clear Console"
            style={{ padding: '2px 8px', fontSize: 11 }}
          >
            <span className="codicon codicon-clear-all" style={{ fontSize: 12 }} /> Clear
          </button>

          {!isMac && window.vsApi?.platform !== 'win32' && (
            <button
              onClick={() => void window.vsApi?.console.close()}
              style={{
                background: 'none',
                border: 'none',
                color: '#CCCCCC',
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <span className="codicon codicon-close" />
            </button>
          )}
        </div>
      </div>

      {/* Interactive Terminal Surface */}
      <div
        ref={bodyRef}
        tabIndex={0}
        onClick={(e) => e.currentTarget.focus()}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px',
          fontSize: 13.5,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          userSelect: 'text',
          outline: 'none',
          cursor: 'text',
        }}
      >
        {!session && !output ? (
          <div style={{ color: '#8A8A94' }}>
            Waiting for Console Application output...
          </div>
        ) : (
          <>
            {segments.map((seg, idx) =>
              seg.color || seg.background ? (
                <span key={idx} style={{ color: seg.color, background: seg.background }}>
                  {seg.text}
                </span>
              ) : (
                <span key={idx}>{seg.text}</span>
              ),
            )}
            {session?.running && (
              <>
                <span style={{ color: '#FFFFFF' }}>{inputBuffer}</span>
                <span className="vs-console-cursor" />
              </>
            )}
            {session && !session.running && (
              <div style={{ marginTop: 14, color: '#9D9DA8' }}>
                <div>
                  {session.exePath}
                  {session.pid ? ` (process ${session.pid})` : ''} exited with code {formatExitCode(session.exitCode ?? 0)}.
                </div>
                <div>
                  To automatically close the console when debugging stops, enable Tools -&gt; Options -&gt; Debugging -&gt; Automatically close the console when debugging stops.
                </div>
                <div style={{ marginTop: 8, color: '#FFFFFF' }}>
                  Press any key to close this window . . .
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
