import { spawn, execFileSync, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fsSync from 'node:fs';
import os from 'node:os';
import { getAugmentedEnv, getDotnetBin } from './dotnetService';
import { isPtyAvailable, spawnDetachedNewConsole, spawnWithPty } from './ptyHelper';

function killProcTree(p: ChildProcessWithoutNullStreams | null): void {
  if (!p) return;
  try {
    if (process.platform === 'win32' && p.pid && p.exitCode === null && p.signalCode === null) {
      try {
        execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 3000,
          windowsHide: true,
        });
        return;
      } catch {
        // process may have exited already; fall back to p.kill()
      }
    }
    p.kill();
  } catch {
    // ignore
  }
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  variablesReference?: number;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface BreakpointSpec {
  file: string;
  line: number;
  enabled: boolean;
  condition?: string;
}

export interface ConsoleSessionMeta {
  projectName: string;
  configuration: string;
  targetFramework: string;
  exePath: string;
  command: string;
  pid?: number;
  isPty?: boolean;
}

export interface ConsoleExitInfo {
  code: number;
  pid?: number;
  exePath: string;
}

export interface DebugCallbacks {
  onOutput: (line: string) => void;
  onStateChange: (state: 'stopped' | 'running' | 'paused') => void;
  onStopped: (data: { file?: string; line?: number; frames: DebugStackFrame[]; locals: DebugVariable[] }) => void;
  onExited: (exitCode: number) => void;
  onConsoleStart?: (meta: ConsoleSessionMeta) => void;
  onConsoleData?: (chunk: string) => void;
  onConsoleExit?: (info: ConsoleExitInfo) => void;
}

export class DotnetDebugManager {
  private runProc: ChildProcessWithoutNullStreams | null = null;
  private runIsPty = false;
  private dapProc: ChildProcessWithoutNullStreams | null = null;
  private externalWinPids = new Set<number>();
  private externalWinPollTimer: NodeJS.Timeout | null = null;
  private dapBuffer = Buffer.alloc(0);
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private currentThreadId = 1;
  private callbacks: DebugCallbacks | null = null;
  private currentExePath = '';
  private currentPid: number | undefined = undefined;
  private consoleExitedEmitted = false;
  private lineRemainder = '';
  /** Incremented for every start/stop so overlapping F5/Ctrl+F5 calls cannot orphan processes. */
  private sessionToken = 0;
  private exitedEmitted = false;
  private sentBpFiles = new Set<string>();

  setCallbacks(cb: DebugCallbacks): void {
    this.callbacks = cb;
  }

  private emitRawConsoleAndOutput(chunk: string): void {
    if (!chunk) return;
    this.callbacks?.onConsoleData?.(chunk);

    const plainChunk = chunk
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;:<=>?]*[!"#$%&'()*+,\-./ ]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[()][0-9A-Za-z]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[=>78cMDE]/g, '');

    const combined = this.lineRemainder + plainChunk;
    const parts = combined.split(/\r?\n/);
    this.lineRemainder = parts.pop() ?? '';
    for (const line of parts) {
      if (line.length > 0) this.callbacks?.onOutput(line);
    }
  }

  private flushLineRemainder(): void {
    if (this.lineRemainder.trim().length > 0) {
      this.callbacks?.onOutput(this.lineRemainder);
    }
    this.lineRemainder = '';
  }

  async launchInMacTerminal(params: {
    csprojPath: string;
    projectName?: string;
    targetFramework?: string;
    configuration: string;
  }): Promise<void> {
    const dotnetBin = await getDotnetBin();
    const cwd = path.dirname(params.csprojPath);
    const projName = params.projectName || path.basename(params.csprojPath, '.csproj');
    const tfm = params.targetFramework || 'net10.0';
    const dllPath = path.join(cwd, 'bin', params.configuration, tfm, `${projName}.dll`);
    const scriptPath = path.join(os.tmpdir(), `vs-console-${Date.now()}.command`);

    const env = getAugmentedEnv();
    // POSIX single-quote escaping: safe for paths containing $, `, \\, " or spaces
    const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
    const dotnetRootExport = env.DOTNET_ROOT ? `export DOTNET_ROOT=${q(env.DOTNET_ROOT)}\n` : '';
    const cmdLine = fsSync.existsSync(dllPath)
      ? `${q(dotnetBin)} ${q(dllPath)}`
      : `${q(dotnetBin)} run --project ${q(params.csprojPath)} -c ${q(params.configuration)} --no-build`;

    const scriptContent = [
      '#!/bin/zsh',
      `cd ${q(cwd)}`,
      `export PATH=${q(env.PATH || '')}`,
      dotnetRootExport + 'export DOTNET_CLI_TELEMETRY_OPTOUT=1',
      'export DOTNET_NOLOGO=1',
      `printf '\\033]0;%s\\007' ${q(`Microsoft Visual Studio Debug Console — ${projName}`)}`,
      cmdLine,
      'EXIT_CODE=$?',
      `printf '\\n%s (process %s) exited with code %s.\\n' ${q(dllPath)} "$$" "$EXIT_CODE"`,
      'echo "Press any key to close this window . . ."',
      'read -k 1 -s',
      `rm -f ${q(scriptPath)}`,
      'exit $EXIT_CODE',
      '',
    ].join('\n');

    fsSync.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
    this.callbacks?.onOutput(`[Run] Launching macOS Terminal.app for ${projName}...`);
    const opener = spawn('open', ['-a', 'Terminal', scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    opener.unref();
  }

  async launchInWindowsTerminal(params: {
    csprojPath: string;
    projectName?: string;
    targetFramework?: string;
    configuration: string;
  }): Promise<boolean> {
    const dotnetBin = await getDotnetBin();
    const cwd = path.dirname(params.csprojPath);
    const projName = params.projectName || path.basename(params.csprojPath, '.csproj');
    const safeProjTitle = projName.replace(/[&|<>^%"\r\n]/g, ' ').trim() || 'App';
    const tfm = params.targetFramework || 'net10.0';
    const dllPath = path.join(cwd, 'bin', params.configuration, tfm, `${projName}.dll`);
    const batPath = path.join(os.tmpdir(), `vs-console-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.cmd`);
    const qBat = (v: string) => v.replace(/"/g, '').replace(/%/g, '%%');

    const runCmd = fsSync.existsSync(dllPath)
      ? `"${qBat(dotnetBin)}" "${qBat(dllPath)}"`
      : `"${qBat(dotnetBin)}" run --project "${qBat(params.csprojPath)}" -c "${qBat(params.configuration)}" --no-build`;

    const batContent = [
      '@echo off',
      'setlocal DisableDelayedExpansion',
      'chcp 65001 >nul',
      `title Microsoft Visual Studio Debug Console - ${safeProjTitle}`,
      `cd /d "${qBat(cwd)}"`,
      'set DOTNET_CLI_TELEMETRY_OPTOUT=1',
      'set DOTNET_NOLOGO=1',
      'set DOTNET_CLI_FORCE_UTF8_ENCODING=1',
      runCmd,
      'set EXIT_CODE=%ERRORLEVEL%',
      'echo.',
      `set "DLL_PATH=${qBat(dllPath)}"`,
      'echo %DLL_PATH% (process exited with code %EXIT_CODE%).',
      'echo Press any key to close this window . . .',
      'pause >nul',
      'del "%~f0" >nul 2>&1',
      'exit /b %EXIT_CODE%',
      '',
    ].join('\r\n');

    fsSync.writeFileSync(batPath, batContent, 'utf-8');
    this.callbacks?.onOutput(`[Run] Launching Windows Console for ${projName}...`);
    const env = getAugmentedEnv();
    const winProc = spawnDetachedNewConsole(batPath, [], { cwd, env });
    if (winProc) {
      this.externalWinPids.add(winProc.pid);
      this.currentPid = winProc.pid;
      this.startExternalWinPoll();
      return true;
    }

    const opener = spawn(
      'cmd.exe',
      ['/c', 'start', `"Microsoft Visual Studio Debug Console - ${safeProjTitle}"`, 'cmd.exe', '/c', `"${batPath}"`],
      {
        cwd,
        env,
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      },
    );
    opener.unref();
    return false;
  }

  async startWithoutDebugging(
    csprojPath: string,
    configuration: string,
    options?: {
      projectName?: string;
      targetFramework?: string;
      consoleMode?: 'externalWindow' | 'integratedTerminal' | 'macTerminal';
    },
  ): Promise<void> {
    await this.stop();
    const token = ++this.sessionToken;
    const projName = options?.projectName || path.basename(csprojPath, '.csproj');
    const tfm = options?.targetFramework || 'net10.0';
    const cwd = path.dirname(csprojPath);
    const dllPath = path.join(cwd, 'bin', configuration, tfm, `${projName}.dll`);

    if (options?.consoleMode === 'macTerminal') {
      if (process.platform === 'darwin') {
        await this.launchInMacTerminal({
          csprojPath,
          projectName: projName,
          targetFramework: tfm,
          configuration,
        });
        this.callbacks?.onStateChange('stopped');
        return;
      }
      if (process.platform === 'win32') {
        this.currentExePath = dllPath;
        this.consoleExitedEmitted = false;
        this.exitedEmitted = false;
        this.lineRemainder = '';
        this.callbacks?.onStateChange('running');
        const tracked = await this.launchInWindowsTerminal({
          csprojPath,
          projectName: projName,
          targetFramework: tfm,
          configuration,
        });
        if (!tracked) {
          this.callbacks?.onStateChange('stopped');
        }
        return;
      }
    }

    const env = getAugmentedEnv();
    const dotnetBin = await getDotnetBin();
    // Another start/stop happened while we were awaiting – that one wins.
    if (token !== this.sessionToken) return;
    this.killProcessesNow();
    const useCompiledDll = fsSync.existsSync(dllPath);
    const cmdArgs = useCompiledDll
      ? [dllPath]
      : ['run', '--project', csprojPath, '-c', configuration, '--no-build'];
    const displayCmd = `${dotnetBin} ${cmdArgs.join(' ')}`;

    this.currentExePath = dllPath;
    this.consoleExitedEmitted = false;
    this.exitedEmitted = false;
    this.lineRemainder = '';
    this.callbacks?.onStateChange('running');
    this.callbacks?.onOutput(`[Run] ${displayCmd}`);

    const spawned = spawnWithPty(dotnetBin, cmdArgs, { cwd, env });
    const proc = spawned.proc;
    this.runIsPty = spawned.isPty;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    this.runProc = proc;
    this.currentPid = proc.pid;

    this.callbacks?.onConsoleStart?.({
      projectName: projName,
      configuration,
      targetFramework: tfm,
      exePath: dllPath,
      command: displayCmd,
      pid: proc.pid,
      isPty: spawned.isPty,
    });

    const handle = (text: string) => {
      // Ignore late output of a process that was already replaced by a restart.
      if (this.runProc !== proc) return;
      this.emitRawConsoleAndOutput(text);
    };
    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);
    proc.on('close', (code) => {
      // A stale process (stopped/restarted) must never touch the new session.
      if (this.runProc !== proc) return;
      const exitCode = code ?? 0;
      const pid = proc.pid;
      this.runProc = null;
      this.runIsPty = false;
      this.flushLineRemainder();
      this.callbacks?.onStateChange('stopped');
      this.callbacks?.onOutput(`[Process exited with code ${exitCode}]`);
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: exitCode, pid, exePath: this.currentExePath });
      }
      this.emitExited(exitCode);
    });
    proc.on('error', (err) => {
      if (this.runProc !== proc) return;
      const pid = proc.pid;
      const errMsg = `[Run error: ${err.message}]\n`;
      this.callbacks?.onConsoleData?.(errMsg);
      this.callbacks?.onOutput(`[Run error: ${err.message}]`);
      this.runProc = null;
      this.runIsPty = false;
      this.callbacks?.onStateChange('stopped');
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: 1, pid, exePath: this.currentExePath });
      }
      this.emitExited(1);
    });
  }

  async startDebugging(params: {
    csprojPath: string;
    projectName: string;
    targetFramework: string;
    configuration: string;
    netcoredbgPath: string | null;
    breakpoints: BreakpointSpec[];
    consoleMode?: 'externalWindow' | 'integratedTerminal' | 'macTerminal';
  }): Promise<{ mode: 'dap' | 'run' }> {
    if (!params.netcoredbgPath) {
      const hint =
        process.platform === 'win32'
          ? 'configure netcoredbg.exe on PATH or under %USERPROFILE%\\.dotnet\\tools'
          : process.platform === 'darwin'
            ? 'install via `brew install netcoredbg`'
            : 'install netcoredbg on PATH';
      this.callbacks?.onOutput(
        `[Debugger] netcoredbg not found on ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'system'} PATH. Running without debugger (${hint} for breakpoints & stepping).`,
      );
      await this.startWithoutDebugging(params.csprojPath, params.configuration, {
        projectName: params.projectName,
        targetFramework: params.targetFramework,
        consoleMode: params.consoleMode,
      });
      return { mode: 'run' };
    }

    await this.stop();
    const token = ++this.sessionToken;
    const projDir = path.dirname(params.csprojPath);
    const dllPath = path.join(
      projDir,
      'bin',
      params.configuration,
      params.targetFramework,
      `${params.projectName}.dll`,
    );

    if (!fsSync.existsSync(dllPath)) {
      this.callbacks?.onOutput(`[Debugger] Assembly not found at ${dllPath}; falling back to dotnet run.`);
      await this.startWithoutDebugging(params.csprojPath, params.configuration, {
        projectName: params.projectName,
        targetFramework: params.targetFramework,
        consoleMode: params.consoleMode,
      });
      return { mode: 'run' };
    }

    if (token !== this.sessionToken) return { mode: 'dap' };
    this.killProcessesNow();
    this.currentExePath = dllPath;
    this.consoleExitedEmitted = false;
    this.exitedEmitted = false;
    this.sentBpFiles.clear();
    this.lineRemainder = '';
    this.callbacks?.onStateChange('running');
    this.callbacks?.onOutput(`[Debugger] Launching netcoredbg for ${dllPath}`);

    const dap = spawn(params.netcoredbgPath, ['--interpreter=vscode'], {
      cwd: projDir,
      env: getAugmentedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(params.netcoredbgPath),
      windowsHide: true,
    });
    dap.stdin.on('error', () => {
      // ignore EPIPE if netcoredbg died
    });
    this.dapProc = dap;
    this.currentPid = dap.pid;

    this.callbacks?.onConsoleStart?.({
      projectName: params.projectName,
      configuration: params.configuration,
      targetFramework: params.targetFramework,
      exePath: dllPath,
      command: dllPath,
      pid: dap.pid,
      isPty: isPtyAvailable(),
    });

    dap.stdout.on('data', (chunk: Buffer) => {
      if (this.dapProc === dap) this.handleDapData(chunk);
    });
    dap.stderr.on('data', (chunk: Buffer) => {
      const t = chunk.toString('utf-8').trim();
      if (t && this.dapProc === dap) this.callbacks?.onOutput(`[netcoredbg] ${t}`);
    });
    dap.on('error', (err) => {
      if (this.dapProc !== dap) return;
      const pid = this.currentPid;
      this.dapProc = null;
      this.callbacks?.onOutput(`[Debugger] Failed to start netcoredbg: ${err.message}`);
      this.callbacks?.onStateChange('stopped');
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: 1, pid, exePath: this.currentExePath });
      }
      this.emitExited(1);
    });
    dap.on('close', (code) => {
      if (this.dapProc !== dap) return;
      const exitCode = code ?? 0;
      const pid = this.currentPid;
      this.dapProc = null;
      if (this.runProc) {
        killProcTree(this.runProc);
        this.runProc = null;
        this.runIsPty = false;
      }
      for (const p of this.pending.values()) {
        p.reject(new Error('Debug adapter exited'));
      }
      this.pending.clear();
      this.flushLineRemainder();
      this.callbacks?.onStateChange('stopped');
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: exitCode, pid, exePath: this.currentExePath });
      }
      this.emitExited(exitCode);
    });

    await this.sendDapRequest('initialize', {
      clientID: 'vs-studio-desktop',
      adapterID: 'coreclr',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsRunInTerminalRequest: true,
    });

    try {
      await this.sendDapRequest('launch', {
        name: params.projectName,
        type: 'coreclr',
        request: 'launch',
        program: dllPath,
        cwd: projDir,
        stopAtEntry: false,
        console: 'integratedTerminal',
      });
    } catch {
      // Fallback if this netcoredbg build prefers internalConsole
      await this.sendDapRequest('launch', {
        name: params.projectName,
        type: 'coreclr',
        request: 'launch',
        program: dllPath,
        cwd: projDir,
        stopAtEntry: false,
      });
    }

    await this.syncBreakpoints(params.breakpoints);
    await this.sendDapRequest('configurationDone', {});
    return { mode: 'dap' };
  }

  async syncBreakpoints(breakpoints: BreakpointSpec[]): Promise<void> {
    if (!this.dapProc) return;
    const byFile = new Map<string, BreakpointSpec[]>();
    for (const bp of breakpoints) {
      if (!bp.enabled) continue;
      const arr = byFile.get(bp.file) || [];
      arr.push(bp);
      byFile.set(bp.file, arr);
    }
    for (const [file, list] of byFile.entries()) {
      await this.sendDapRequest('setBreakpoints', {
        source: { path: file },
        breakpoints: list.map((b) => ({ line: b.line, condition: b.condition })),
      });
    }
    // Files whose last breakpoint was removed/disabled must be cleared explicitly in the adapter
    for (const file of this.sentBpFiles) {
      if (!byFile.has(file)) {
        await this.sendDapRequest('setBreakpoints', { source: { path: file }, breakpoints: [] });
      }
    }
    this.sentBpFiles = new Set(byFile.keys());
  }

  async continue(): Promise<void> {
    if (!this.dapProc) return;
    this.callbacks?.onStateChange('running');
    await this.sendDapRequest('continue', { threadId: this.currentThreadId });
  }

  async stepOver(): Promise<void> {
    if (!this.dapProc) return;
    this.callbacks?.onStateChange('running');
    await this.sendDapRequest('next', { threadId: this.currentThreadId });
  }

  async stepInto(): Promise<void> {
    if (!this.dapProc) return;
    this.callbacks?.onStateChange('running');
    await this.sendDapRequest('stepIn', { threadId: this.currentThreadId });
  }

  async stepOut(): Promise<void> {
    if (!this.dapProc) return;
    this.callbacks?.onStateChange('running');
    await this.sendDapRequest('stepOut', { threadId: this.currentThreadId });
  }

  async pause(): Promise<void> {
    if (!this.dapProc) return;
    await this.sendDapRequest('pause', { threadId: this.currentThreadId });
  }

  async evaluate(expression: string, frameId?: number): Promise<string> {
    if (!this.dapProc) return '<not debugging>';
    const res = (await this.sendDapRequest('evaluate', {
      expression,
      frameId,
      context: 'watch',
    })) as { result?: string };
    return res?.result ?? '';
  }

  sendInput(text: string): void {
    if (this.runProc && !this.runProc.killed) {
      const payload =
        this.runIsPty && process.platform === 'win32' ? text.replace(/\r?\n/g, '\r') : text;
      this.runProc.stdin.write(payload);
    }
  }

  private emitExited(code: number): void {
    if (this.exitedEmitted) return;
    this.exitedEmitted = true;
    this.callbacks?.onExited(code);
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }

  private clearExternalWinPoll(): void {
    if (this.externalWinPollTimer) {
      clearInterval(this.externalWinPollTimer);
      this.externalWinPollTimer = null;
    }
  }

  private startExternalWinPoll(): void {
    this.clearExternalWinPoll();
    this.externalWinPollTimer = setInterval(() => {
      if (this.externalWinPids.size === 0) {
        this.clearExternalWinPoll();
        return;
      }
      for (const pid of [...this.externalWinPids]) {
        if (!this.isPidAlive(pid)) {
          this.externalWinPids.delete(pid);
        }
      }
      if (this.externalWinPids.size === 0) {
        this.clearExternalWinPoll();
        if (!this.runProc && !this.dapProc) {
          this.callbacks?.onStateChange('stopped');
          this.callbacks?.onOutput('[Windows Console closed]');
          this.emitExited(0);
        }
      }
    }, 350);
    this.externalWinPollTimer.unref?.();
  }

  private killExternalWinPids(): void {
    this.clearExternalWinPoll();
    if (process.platform !== 'win32' || this.externalWinPids.size === 0) {
      this.externalWinPids.clear();
      return;
    }
    for (const pid of this.externalWinPids) {
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 3000,
          windowsHide: true,
        });
      } catch {
        // console window already closed
      }
    }
    this.externalWinPids.clear();
  }

  /** Synchronously kills every child process (used on app quit and before a new launch). */
  private killProcessesNow(): void {
    killProcTree(this.runProc);
    killProcTree(this.dapProc);
    this.runProc = null;
    this.runIsPty = false;
    this.dapProc = null;
    this.killExternalWinPids();
  }

  /** Called from app 'before-quit': no awaiting, just make sure nothing keeps running. */
  disposeSync(): void {
    this.sessionToken++;
    killProcTree(this.runProc);
    killProcTree(this.dapProc);
    this.runProc = null;
    this.runIsPty = false;
    this.dapProc = null;
    this.killExternalWinPids();
    for (const p of this.pending.values()) {
      p.reject(new Error('Debug session disposed'));
    }
    this.pending.clear();
  }

  async stop(): Promise<void> {
    this.sessionToken++;
    const hadSession = Boolean(this.runProc || this.dapProc || this.externalWinPids.size > 0);
    if (this.runProc) {
      killProcTree(this.runProc);
      this.runProc = null;
    }
    this.runIsPty = false;
    if (this.dapProc) {
      const dap = this.dapProc;
      try {
        // Never hang Shift+F5 on an unresponsive adapter
        await Promise.race([
          this.sendDapRequest('disconnect', { terminateDebuggee: true }),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        // ignore
      }
      killProcTree(dap);
      if (this.dapProc === dap) this.dapProc = null;
    }
    this.killExternalWinPids();
    for (const p of this.pending.values()) {
      p.reject(new Error('Debug session stopped'));
    }
    this.pending.clear();
    this.dapBuffer = Buffer.alloc(0);
    this.callbacks?.onStateChange('stopped');
    // The killed process' own 'close' handler is ignored (identity check), so
    // report the end of the session here exactly once – like VS: "exited with code -1".
    if (hadSession && !this.consoleExitedEmitted) {
      this.consoleExitedEmitted = true;
      this.flushLineRemainder();
      this.callbacks?.onOutput('[Process exited with code -1]');
      this.callbacks?.onConsoleExit?.({ code: -1, pid: this.currentPid, exePath: this.currentExePath });
      this.emitExited(-1);
    }
  }

  private sendDapResponse(requestSeq: number, command: string, success: boolean, body: unknown, message?: string): void {
    if (!this.dapProc) return;
    const seq = this.seq++;
    const payload = JSON.stringify({
      seq,
      type: 'response',
      request_seq: requestSeq,
      success,
      command,
      body,
      ...(message ? { message } : {}),
    });
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
    this.dapProc.stdin.write(header + payload, 'utf-8');
  }

  private sendDapRequest(command: string, args: unknown): Promise<unknown> {
    if (!this.dapProc) return Promise.reject(new Error('No DAP process'));
    const seq = this.seq++;
    const payload = JSON.stringify({ seq, type: 'request', command, arguments: args });
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
    this.dapProc.stdin.write(header + payload, 'utf-8');
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(seq)) {
          this.pending.delete(seq);
          reject(new Error(`DAP request timeout: ${command}`));
        }
      }, 30000);
    });
  }

  private handleDapReverseRequest(seq: number, command: string, args: Record<string, unknown>): void {
    if (command === 'runInTerminal') {
      const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      if (cmdArgs.length === 0) {
        this.sendDapResponse(seq, command, false, {}, 'Missing command args');
        return;
      }
      const cwd = typeof args.cwd === 'string' && args.cwd ? args.cwd : path.dirname(this.currentExePath || process.cwd());
      const customEnv = (typeof args.env === 'object' && args.env ? args.env : {}) as Record<string, string | null>;
      const mergedEnv: NodeJS.ProcessEnv = { ...getAugmentedEnv() };
      for (const [k, v] of Object.entries(customEnv)) {
        if (v === null) delete mergedEnv[k];
        else mergedEnv[k] = String(v);
      }
      const spawned = spawnWithPty(cmdArgs[0], cmdArgs.slice(1), {
        cwd,
        env: mergedEnv,
      });
      const proc = spawned.proc;
      this.runIsPty = spawned.isPty;
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      this.runProc = proc;
      this.currentPid = proc.pid;
      const onChunk = (chunk: string) => {
        if (this.runProc === proc) this.emitRawConsoleAndOutput(chunk);
      };
      proc.stdout.on('data', onChunk);
      proc.stderr.on('data', onChunk);
      proc.on('close', () => {
        if (this.runProc === proc) {
          this.runProc = null;
          this.runIsPty = false;
        }
      });
      this.sendDapResponse(seq, command, true, { processId: proc.pid });
      return;
    }
    this.sendDapResponse(seq, command, false, {}, `Unsupported reverse request: ${command}`);
  }

  private handleDapData(chunk: Buffer): void {
    this.dapBuffer = Buffer.concat([this.dapBuffer, chunk]);
    while (true) {
      const headerEnd = this.dapBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerStr = this.dapBuffer.subarray(0, headerEnd).toString('ascii');
      const lenMatch = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!lenMatch) {
        this.dapBuffer = this.dapBuffer.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(lenMatch[1]);
      const total = headerEnd + 4 + len;
      if (this.dapBuffer.length < total) break;
      const bodyStr = this.dapBuffer.subarray(headerEnd + 4, total).toString('utf-8');
      this.dapBuffer = this.dapBuffer.subarray(total);

      try {
        const msg = JSON.parse(bodyStr) as {
          type: 'response' | 'event' | 'request';
          seq?: number;
          command?: string;
          arguments?: Record<string, unknown>;
          request_seq?: number;
          success?: boolean;
          message?: string;
          body?: Record<string, unknown>;
          event?: string;
        };

        if (msg.type === 'request' && msg.seq !== undefined && msg.command) {
          this.handleDapReverseRequest(msg.seq, msg.command, msg.arguments || {});
        } else if (msg.type === 'response' && msg.request_seq !== undefined) {
          const p = this.pending.get(msg.request_seq);
          if (p) {
            this.pending.delete(msg.request_seq);
            if (msg.success) p.resolve(msg.body);
            else p.reject(new Error(msg.message || 'DAP request failed'));
          }
        } else if (msg.type === 'event') {
          void this.handleDapEvent(msg.event || '', msg.body || {});
        }
      } catch {
        // ignore
      }
    }
  }

  private async handleDapEvent(event: string, body: Record<string, unknown>): Promise<void> {
    if (event === 'output') {
      const rawOut = String(body.output || '');
      const category = String(body.category || 'console');
      if (rawOut) {
        if (category === 'stdout' || category === 'stderr' || category === 'console') {
          this.callbacks?.onConsoleData?.(rawOut);
        }
        const trimmed = rawOut.replace(/\r?\n$/, '');
        if (trimmed) this.callbacks?.onOutput(trimmed);
      }
    } else if (event === 'stopped') {
      this.currentThreadId = Number(body.threadId || 1);
      this.callbacks?.onStateChange('paused');
      try {
        const st = (await this.sendDapRequest('stackTrace', {
          threadId: this.currentThreadId,
          startFrame: 0,
          levels: 20,
        })) as {
          stackFrames?: Array<{
            id: number;
            name: string;
            source?: { path?: string };
            line?: number;
            column?: number;
          }>;
        };
        const frames: DebugStackFrame[] = (st.stackFrames || []).map((f) => ({
          id: f.id,
          name: f.name,
          file: f.source?.path,
          line: f.line,
          column: f.column,
        }));
        const top = frames[0];
        let locals: DebugVariable[] = [];
        if (top) {
          const scopesRes = (await this.sendDapRequest('scopes', { frameId: top.id })) as {
            scopes?: Array<{ name: string; variablesReference: number }>;
          };
          const localScope = scopesRes.scopes?.[0];
          if (localScope && localScope.variablesReference > 0) {
            const varsRes = (await this.sendDapRequest('variables', {
              variablesReference: localScope.variablesReference,
            })) as { variables?: DebugVariable[] };
            locals = varsRes.variables || [];
          }
        }
        this.callbacks?.onStopped({
          file: top?.file,
          line: top?.line,
          frames,
          locals,
        });
      } catch {
        this.callbacks?.onStopped({ frames: [], locals: [] });
      }
    } else if (event === 'terminated' || event === 'exited') {
      const exitCode = Number(body.exitCode ?? 0);
      this.callbacks?.onStateChange('stopped');
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({
          code: exitCode,
          pid: this.currentPid,
          exePath: this.currentExePath,
        });
      }
      this.emitExited(exitCode);
      // netcoredbg stays alive after the debuggee ends – shut it down like VS does
      if (event === 'terminated') {
        const dap = this.dapProc;
        setTimeout(() => {
          if (dap && this.dapProc === dap) void this.stop();
        }, 0);
      }
    }
  }
}
