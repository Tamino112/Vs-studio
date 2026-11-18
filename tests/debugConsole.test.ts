import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

vi.mock('../electron/services/dotnetService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/services/dotnetService')>();
  return {
    ...actual,
    getDotnetBin: vi.fn(async () => process.execPath),
  };
});

import { DotnetDebugManager, ConsoleExitInfo, ConsoleSessionMeta } from '../electron/services/debugService';

describe('Debug Console & Terminal Launch', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-console-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams raw prompts without trailing newline and supports interactive stdin via DotnetDebugManager', async () => {
    const projDir = path.join(tmpDir, 'MyConsoleApp');
    const outDir = path.join(projDir, 'bin', 'Debug', 'net10.0');
    await fs.mkdir(outDir, { recursive: true });
    const csprojPath = path.join(projDir, 'MyConsoleApp.csproj');
    const dllPath = path.join(outDir, 'MyConsoleApp.dll');

    await fs.writeFile(csprojPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>', 'utf-8');
    // Mock compiled assembly executable under Node to verify partial stdout + stdin roundtrip + exit info
    await fs.writeFile(
      dllPath,
      `
      process.stdout.write('Enter name: ');
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', (chunk) => {
        const name = String(chunk).trim();
        console.log('Hello ' + name);
        process.exit(0);
      });
      `,
      'utf-8',
    );

    const mgr = new DotnetDebugManager();
    const rawChunks: string[] = [];
    const outputLines: string[] = [];
    let startMeta: ConsoleSessionMeta | null = null;
    let exitInfo: ConsoleExitInfo | null = null;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for console process')), 5000);
      mgr.setCallbacks({
        onOutput: (line) => outputLines.push(line),
        onStateChange: () => {},
        onStopped: () => {},
        onConsoleStart: (meta) => {
          startMeta = meta;
        },
        onConsoleData: (chunk) => {
          rawChunks.push(chunk);
          if (rawChunks.join('').includes('Enter name: ')) {
            mgr.sendInput('Tamino\n');
          }
        },
        onConsoleExit: (info) => {
          exitInfo = info;
        },
        onExited: () => {
          clearTimeout(timer);
          resolve();
        },
      });

      void mgr.startWithoutDebugging(csprojPath, 'Debug', {
        projectName: 'MyConsoleApp',
        targetFramework: 'net10.0',
        consoleMode: 'externalWindow',
      });
    });

    expect(startMeta).not.toBeNull();
    expect(startMeta!.projectName).toBe('MyConsoleApp');
    expect(startMeta!.exePath).toBe(dllPath);
    expect(rawChunks.join('')).toContain('Enter name: ');
    expect(rawChunks.join('')).toContain('Hello Tamino');
    expect(outputLines.some((l) => l.includes('Hello Tamino'))).toBe(true);
    expect(exitInfo).toEqual({
      code: 0,
      pid: startMeta!.pid,
      exePath: dllPath,
    });
  });

  it(
    'provides a real PTY and delivers a single keypress without Enter (Console.ReadKey semantics) with exact exit code',
    async () => {
    const projDir = path.join(tmpDir, 'ReadKeyApp');
    const outDir = path.join(projDir, 'bin', 'Debug', 'net10.0');
    await fs.mkdir(outDir, { recursive: true });
    const csprojPath = path.join(projDir, 'ReadKeyApp.csproj');
    const dllPath = path.join(outDir, 'ReadKeyApp.dll');

    await fs.writeFile(csprojPath, '<Project />', 'utf-8');
    await fs.writeFile(
      dllPath,
      `
      process.stdout.write('Hallo');
      if (!process.stdin.isTTY) {
        console.error('NOT_TTY');
        process.exit(99);
      }
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', (chunk) => {
        process.stdin.setRawMode(false);
        process.stdout.write('|KEY=' + chunk.toString('utf8'), () => {
          setTimeout(() => process.exit(7), 30);
        });
      });
      `,
      'utf-8',
    );

    const mgr = new DotnetDebugManager();
    const rawChunks: string[] = [];
    let startMeta: ConsoleSessionMeta | null = null;
    let exitInfo: ConsoleExitInfo | null = null;
    let sentKey = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for ReadKey PTY test')), 15000);
      mgr.setCallbacks({
        onOutput: () => {},
        onStateChange: () => {},
        onStopped: () => {},
        onConsoleStart: (meta) => {
          startMeta = meta;
        },
        onConsoleData: (chunk) => {
          rawChunks.push(chunk);
          if (!sentKey && rawChunks.join('').includes('Hallo')) {
            sentKey = true;
            // Send single character 'K' with NO newline, just like Console.ReadKey()
            mgr.sendInput('K');
          }
        },
        onConsoleExit: (info) => {
          exitInfo = info;
        },
        onExited: () => {
          clearTimeout(timer);
          resolve();
        },
      });

      void mgr.startWithoutDebugging(csprojPath, 'Debug', {
        projectName: 'ReadKeyApp',
        targetFramework: 'net10.0',
        consoleMode: 'externalWindow',
      });
    });

    expect(startMeta?.isPty).toBe(true);
    expect(rawChunks.join('')).toContain('Hallo');
    expect(rawChunks.join('')).toContain('|KEY=K');
    expect(exitInfo?.code).toBe(7);
  },
    25000,
  );

  it('restart (F5 while running) does not let the old process exit end the new session', async () => {
    const projDir = path.join(tmpDir, 'RestartApp');
    const outDir = path.join(projDir, 'bin', 'Debug', 'net10.0');
    await fs.mkdir(outDir, { recursive: true });
    const csprojPath = path.join(projDir, 'RestartApp.csproj');
    const dllPath = path.join(outDir, 'RestartApp.dll');
    await fs.writeFile(csprojPath, '<Project />', 'utf-8');
    await fs.writeFile(
      dllPath,
      `process.stdout.write('RUN ');\nsetTimeout(() => process.exit(5), 600);\n`,
      'utf-8',
    );

    const mgr = new DotnetDebugManager();
    const starts: ConsoleSessionMeta[] = [];
    const exits: ConsoleExitInfo[] = [];
    let secondStarted = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for restart test')), 8000);
      mgr.setCallbacks({
        onOutput: () => {},
        onStateChange: () => {},
        onStopped: () => {},
        onConsoleStart: (meta) => {
          starts.push(meta);
        },
        onConsoleData: () => {
          if (!secondStarted) {
            secondStarted = true;
            void mgr.startWithoutDebugging(csprojPath, 'Debug', {
              projectName: 'RestartApp',
              targetFramework: 'net10.0',
            });
          }
        },
        onConsoleExit: (info) => {
          exits.push(info);
        },
        onExited: (code) => {
          if (code === 5) {
            clearTimeout(timer);
            resolve();
          }
        },
      });
      void mgr.startWithoutDebugging(csprojPath, 'Debug', {
        projectName: 'RestartApp',
        targetFramework: 'net10.0',
      });
    });

    expect(starts).toHaveLength(2);
    // First session is reported as stopped (-1, like VS), second exits normally with its own pid
    expect(exits).toHaveLength(2);
    expect(exits[0]).toMatchObject({ code: -1, pid: starts[0].pid });
    expect(exits[1]).toMatchObject({ code: 5, pid: starts[1].pid });
  });

  it('handles DAP reverse runInTerminal request when debugging a console app', async () => {
    const projDir = path.join(tmpDir, 'DebugApp');
    const outDir = path.join(projDir, 'bin', 'Debug', 'net10.0');
    await fs.mkdir(outDir, { recursive: true });
    const csprojPath = path.join(projDir, 'DebugApp.csproj');
    const dllPath = path.join(outDir, 'DebugApp.dll');
    const fakeDapScript = path.join(tmpDir, 'fake-dap.cjs');

    await fs.writeFile(csprojPath, '<Project />', 'utf-8');
    await fs.writeFile(dllPath, 'console.log("compiled");', 'utf-8');
    await fs.writeFile(
      fakeDapScript,
      `#!${process.execPath}
      let buf = Buffer.alloc(0);
      function send(obj) {
        const s = JSON.stringify(obj);
        process.stdout.write('Content-Length: ' + Buffer.byteLength(s, 'utf8') + '\\r\\n\\r\\n' + s);
      }
      process.stdin.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (true) {
          const idx = buf.indexOf('\\r\\n\\r\\n');
          if (idx === -1) break;
          const hdr = buf.subarray(0, idx).toString('ascii');
          const m = /Content-Length:\\s*(\\d+)/i.exec(hdr);
          if (!m) { buf = buf.subarray(idx + 4); continue; }
          const len = Number(m[1]);
          if (buf.length < idx + 4 + len) break;
          const msg = JSON.parse(buf.subarray(idx + 4, idx + 4 + len).toString('utf8'));
          buf = buf.subarray(idx + 4 + len);
          if (msg.type === 'request' && msg.command === 'initialize') {
            send({ seq: 1, type: 'response', request_seq: msg.seq, success: true, command: 'initialize', body: {} });
          } else if (msg.type === 'request' && msg.command === 'launch') {
            send({ seq: 2, type: 'request', command: 'runInTerminal', arguments: {
              kind: 'integrated',
              cwd: ${JSON.stringify(projDir)},
              args: [${JSON.stringify(process.execPath)}, '-e', 'console.log("DAP_TERMINAL_OK")'],
            }});
            send({ seq: 3, type: 'response', request_seq: msg.seq, success: true, command: 'launch', body: {} });
          } else if (msg.type === 'request' && msg.command === 'configurationDone') {
            send({ seq: 4, type: 'response', request_seq: msg.seq, success: true, command: 'configurationDone', body: {} });
            setTimeout(() => {
              send({ seq: 5, type: 'event', event: 'exited', body: { exitCode: 0 } });
              process.exit(0);
            }, 150);
          }
        }
      });
      `,
      { encoding: 'utf-8', mode: 0o755 },
    );

    const dapExe =
      process.platform === 'win32' ? path.join(tmpDir, 'fake-dap.cmd') : fakeDapScript;
    if (process.platform === 'win32') {
      await fs.writeFile(dapExe, `@echo off\r\n"${process.execPath}" "${fakeDapScript}" %*\r\n`, 'utf-8');
    }

    const mgr = new DotnetDebugManager();
    const rawChunks: string[] = [];
    let exited = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for fake DAP')), 8000);
      mgr.setCallbacks({
        onOutput: () => {},
        onStateChange: () => {},
        onStopped: () => {},
        onConsoleData: (chunk) => rawChunks.push(chunk),
        onConsoleExit: () => {
          exited = true;
        },
        onExited: () => {
          clearTimeout(timer);
          resolve();
        },
      });

      void mgr.startDebugging({
        csprojPath,
        projectName: 'DebugApp',
        targetFramework: 'net10.0',
        configuration: 'Debug',
        netcoredbgPath: dapExe,
        breakpoints: [],
        consoleMode: 'externalWindow',
      });
    });

    expect(rawChunks.join('')).toContain('DAP_TERMINAL_OK');
    expect(exited).toBe(true);
  });

  it('useIdeStore opens Debug Console automatically for Exe projects, queues integrated terminal when configured, and skips console for Library projects', async () => {
    const storeMap = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storeMap.get(k) ?? null,
      setItem: (k: string, v: string) => storeMap.set(k, v),
      removeItem: (k: string) => storeMap.delete(k),
    });
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
        setAttribute: () => {},
        style: { setProperty: () => {} },
      },
    });

    const consoleOpen = vi.fn(async () => true);
    const debugStartWithoutDebugging = vi.fn(async () => {});
    const debugStart = vi.fn(async () => ({ mode: 'dap' }));
    const dotnetBuild = vi.fn(async () => ({ success: true, diagnostics: [] }));

    vi.stubGlobal('window', {
      vsApi: {
        console: { open: consoleOpen, close: vi.fn(async () => true), getSnapshot: vi.fn(async () => ({ session: null, output: '' })) },
        debug: {
          start: debugStart,
          startWithoutDebugging: debugStartWithoutDebugging,
          stop: vi.fn(async () => {}),
          syncBreakpoints: vi.fn(async () => {}),
        },
        dotnet: { build: dotnetBuild },
        fs: { readFile: vi.fn(async () => 'Console.WriteLine("Hi");') },
        lsp: { didOpen: vi.fn(async () => {}) },
      },
    });

    vi.resetModules();
    const { useIdeStore, selectEffectiveDiagnosticsForFile } = await import('../src/store/useIdeStore');

    useIdeStore.setState({
      solution: {
        name: 'TestSln',
        path: '/tmp/TestSln.sln',
        dir: '/tmp',
        format: 'sln',
        startupProjectId: 'exe-1',
        projects: [
          {
            id: 'exe-1',
            name: 'MyConsole',
            path: '/tmp/MyConsole/MyConsole.csproj',
            dir: '/tmp/MyConsole',
            targetFramework: 'net10.0',
            outputType: 'Exe',
            nullable: 'enable',
            implicitUsings: 'enable',
            sdk: 'Microsoft.NET.Sdk',
            packageReferences: [],
            projectReferences: [],
            files: [],
          },
          {
            id: 'lib-1',
            name: 'MyLib',
            path: '/tmp/MyLib/MyLib.csproj',
            dir: '/tmp/MyLib',
            targetFramework: 'net10.0',
            outputType: 'Library',
            nullable: 'enable',
            implicitUsings: 'enable',
            sdk: 'Microsoft.NET.Sdk',
            packageReferences: [],
            projectReferences: [],
            files: [],
          },
        ],
      },
      consoleLaunchMode: 'externalWindow',
      envStatus: null,
    });

    // 1. Exe + externalWindow => calls console.open() then startWithoutDebugging
    await useIdeStore.getState().startDebugging(false);
    expect(consoleOpen).toHaveBeenCalledTimes(1);
    expect(debugStartWithoutDebugging).toHaveBeenCalledWith('/tmp/MyConsole/MyConsole.csproj', 'Debug', {
      projectName: 'MyConsole',
      targetFramework: 'net10.0',
      consoleMode: 'externalWindow',
    });

    // 2. Exe + integratedTerminal => switches bottom dock to terminal and queues dotnet run
    consoleOpen.mockClear();
    useIdeStore.setState({ consoleLaunchMode: 'integratedTerminal', pendingTerminalCommand: null });
    await useIdeStore.getState().startDebugging(false);
    expect(consoleOpen).not.toHaveBeenCalled();
    expect(useIdeStore.getState().bottomOpen).toBe(true);
    expect(useIdeStore.getState().bottomPanel).toBe('terminal');
    expect(useIdeStore.getState().pendingTerminalCommand?.command).toContain('dotnet run --project "/tmp/MyConsole/MyConsole.csproj"');

    // 3. Exe + withDebugger + netcoredbg + macTerminal mode => still opens Debug Console for DAP integratedTerminal
    consoleOpen.mockClear();
    debugStart.mockClear();
    useIdeStore.setState({
      consoleLaunchMode: 'macTerminal',
      debugState: 'stopped',
      envStatus: {
        dotnetInstalled: true,
        dotnetVersion: '10.0.100',
        dotnetSdks: ['10.0.100'],
        hasNet10: true,
        csharpLsInstalled: false,
        csharpLsPath: null,
        netcoredbgInstalled: true,
        netcoredbgPath: '/usr/local/bin/netcoredbg',
        gitInstalled: true,
        platform: 'win32',
      },
    });
    await useIdeStore.getState().startDebugging(true);
    expect(consoleOpen).toHaveBeenCalledTimes(1);
    expect(debugStart).toHaveBeenCalledTimes(1);

    // 4. Library + externalWindow => does NOT open debug console window
    consoleOpen.mockClear();
    debugStartWithoutDebugging.mockClear();
    useIdeStore.setState((s) => ({
      consoleLaunchMode: 'externalWindow',
      debugState: 'stopped',
      solution: s.solution ? { ...s.solution, startupProjectId: 'lib-1' } : null,
    }));
    await useIdeStore.getState().startDebugging(false);
    expect(consoleOpen).not.toHaveBeenCalled();
    expect(debugStartWithoutDebugging).toHaveBeenCalledTimes(1);

    // 5. Windows backslash & drive-letter casing parity across tabs, breakpoints, diagnostics, rename, and close
    await useIdeStore.getState().openFile('C:\\Repo\\App\\Program.cs');
    expect(useIdeStore.getState().openTabs.some((t) => t.path === 'C:\\Repo\\App\\Program.cs')).toBe(true);

    useIdeStore.getState().toggleBreakpoint('c:/repo/app/program.cs', 10);
    expect(useIdeStore.getState().breakpoints).toHaveLength(1);
    // Toggling the same line with uppercase backslash removes it rather than duplicating
    useIdeStore.getState().toggleBreakpoint('C:\\Repo\\App\\Program.cs', 10);
    expect(useIdeStore.getState().breakpoints).toHaveLength(0);
    useIdeStore.getState().toggleBreakpoint('C:\\Repo\\App\\Program.cs', 10);

    useIdeStore.getState().setLspDiagnostics('c:/REPO/app/program.cs', [
      {
        code: 'CS1002',
        description: '; expected',
        project: 'App',
        file: 'c:/REPO/app/program.cs',
        line: 1,
        column: 25,
        severity: 'error',
        source: 'Roslyn',
      },
    ]);
    const stBeforeRename = useIdeStore.getState();
    const diags = selectEffectiveDiagnosticsForFile(stBeforeRename, 'C:\\Repo\\App\\Program.cs');
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('CS1002');

    useIdeStore.getState().renamePathInTabs('c:/repo/app', 'C:\\Repo\\AppRenamed');
    expect(useIdeStore.getState().openTabs.some((t) => t.path === 'C:\\Repo\\AppRenamed\\Program.cs')).toBe(true);
    expect(useIdeStore.getState().breakpoints[0].file).toBe('C:\\Repo\\AppRenamed\\Program.cs');
    expect(
      selectEffectiveDiagnosticsForFile(useIdeStore.getState(), 'c:/repo/apprenamed/program.cs'),
    ).toHaveLength(1);

    useIdeStore.getState().closeTabsUnderPath('c:/repo/apprenamed');
    expect(useIdeStore.getState().openTabs.some((t) => t.path.includes('AppRenamed'))).toBe(false);
    expect(useIdeStore.getState().breakpoints).toHaveLength(0);
  });
});
