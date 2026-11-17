import React, { useEffect, useRef, useState } from 'react';
import { ConsoleSessionInfo } from '../types/ide';

interface ConsoleSnapshotPayload {
  session: ConsoleSessionInfo | null;
  output: string;
}

function stripAnsiControl(text: string): string {
  // Strip ANSI escape codes & BEL/OSC sequences while preserving newlines and tabs
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
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

  useEffect(() => {
    document.title = 'Microsoft Visual Studio Debug Console';
    if (!window.vsApi) return;

    void (window.vsApi.console.getSnapshot() as Promise<ConsoleSnapshotPayload>).then((snap) => {
      if (snap?.session) setSession(snap.session);
      if (snap?.output) setOutput(stripAnsiControl(snap.output));
    });

    const unsubSession = window.vsApi.on('console:session', (payload) => {
      const s = payload as ConsoleSessionInfo;
      setSession(s);
      setOutput('');
      setInputBuffer('');
    });

    const unsubData = window.vsApi.on('console:data', (chunk) => {
      const str = stripAnsiControl(String(chunk || ''));
      if (str) {
        setOutput((prev) => (prev + str).slice(-120000));
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

  // Direct terminal keyboard capture (live stdin typing while running, press-any-key-to-close after exit)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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

      if ((e.ctrlKey && e.key.toLowerCase() === 'c') && !window.getSelection()?.toString()) {
        e.preventDefault();
        void window.vsApi?.debug.stop();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void navigator.clipboard?.readText().then((clip) => {
          if (clip) {
            const lines = clip.replace(/\r\n/g, '\n').split('\n');
            if (lines.length > 1) {
              const first = lines.shift() || '';
              const toSend = inputBufferRef.current + first + '\n' + lines.join('\n');
              setOutput((prev) => prev + toSend);
              setInputBuffer('');
              void window.vsApi?.debug.sendInput(toSend);
            } else {
              setInputBuffer((b) => b + clip);
            }
          }
        });
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        const line = inputBufferRef.current + '\n';
        setOutput((prev) => prev + line);
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
          paddingRight: 10,
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
              setOutput('');
            }}
            title="Clear Console"
            style={{ padding: '2px 8px', fontSize: 11 }}
          >
            <span className="codicon codicon-clear-all" style={{ fontSize: 12 }} /> Clear
          </button>

          {!isMac && (
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
            <span>{output}</span>
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
                  {session.pid ? ` (process ${session.pid})` : ''} exited with code {session.exitCode ?? 0}.
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
