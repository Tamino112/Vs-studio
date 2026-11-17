import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fsSync from 'node:fs';
import os from 'node:os';
import { getAugmentedEnv, getDotnetBin } from './dotnetService';

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
  private dapProc: ChildProcessWithoutNullStreams | null = null;
  private dapBuffer = Buffer.alloc(0);
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private currentThreadId = 1;
  private callbacks: DebugCallbacks | null = null;
  private currentExePath = '';
  private currentPid: number | undefined = undefined;
  private consoleExitedEmitted = false;
  private lineRemainder = '';

  setCallbacks(cb: DebugCallbacks): void {
    this.callbacks = cb;
  }

  private emitRawConsoleAndOutput(chunk: string): void {
    if (!chunk) return;
    this.callbacks?.onConsoleData?.(chunk);

    const combined = this.lineRemainder + chunk;
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
    const dotnetRootExport = env.DOTNET_ROOT ? `export DOTNET_ROOT="${env.DOTNET_ROOT}"\n` : '';
    const cmdLine = fsSync.existsSync(dllPath)
      ? `"${dotnetBin}" "${dllPath}"`
      : `"${dotnetBin}" run --project "${params.csprojPath}" -c "${params.configuration}" --no-build`;

    const scriptContent = [
      '#!/bin/zsh',
      `cd "${cwd.replace(/"/g, '\\"')}"`,
      `export PATH="${(env.PATH || '').replace(/"/g, '\\"')}"`,
      dotnetRootExport + 'export DOTNET_CLI_TELEMETRY_OPTOUT=1',
      'export DOTNET_NOLOGO=1',
      `printf "\\033]0;Microsoft Visual Studio Debug Console — ${projName}\\007"`,
      cmdLine,
      'EXIT_CODE=$?',
      'echo ""',
      `echo "${dllPath.replace(/"/g, '\\"')} (process $$) exited with code $EXIT_CODE."`,
      'echo "Press any key to close this window . . ."',
      'read -k 1 -s',
      `rm -f "${scriptPath}"`,
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
    const projName = options?.projectName || path.basename(csprojPath, '.csproj');
    const tfm = options?.targetFramework || 'net10.0';
    const cwd = path.dirname(csprojPath);
    const dllPath = path.join(cwd, 'bin', configuration, tfm, `${projName}.dll`);

    if (options?.consoleMode === 'macTerminal' && process.platform === 'darwin') {
      await this.launchInMacTerminal({
        csprojPath,
        projectName: projName,
        targetFramework: tfm,
        configuration,
      });
      this.callbacks?.onStateChange('stopped');
      return;
    }

    const env = getAugmentedEnv();
    const dotnetBin = await getDotnetBin();
    const useCompiledDll = fsSync.existsSync(dllPath);
    const cmdArgs = useCompiledDll
      ? [dllPath]
      : ['run', '--project', csprojPath, '-c', configuration, '--no-build'];
    const displayCmd = `${dotnetBin} ${cmdArgs.join(' ')}`;

    this.currentExePath = dllPath;
    this.consoleExitedEmitted = false;
    this.lineRemainder = '';
    this.callbacks?.onStateChange('running');
    this.callbacks?.onOutput(`[Run] ${displayCmd}`);

    this.runProc = spawn(dotnetBin, cmdArgs, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.currentPid = this.runProc.pid;

    this.callbacks?.onConsoleStart?.({
      projectName: projName,
      configuration,
      targetFramework: tfm,
      exePath: dllPath,
      command: displayCmd,
      pid: this.runProc.pid,
    });

    const handle = (buf: Buffer) => {
      this.emitRawConsoleAndOutput(buf.toString('utf-8'));
    };
    this.runProc.stdout.on('data', handle);
    this.runProc.stderr.on('data', handle);
    this.runProc.on('close', (code) => {
      const exitCode = code ?? 0;
      const pid = this.currentPid;
      this.runProc = null;
      this.flushLineRemainder();
      this.callbacks?.onStateChange('stopped');
      this.callbacks?.onOutput(`[Process exited with code ${exitCode}]`);
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: exitCode, pid, exePath: this.currentExePath });
      }
      this.callbacks?.onExited(exitCode);
    });
    this.runProc.on('error', (err) => {
      const pid = this.currentPid;
      const errMsg = `[Run error: ${err.message}]\n`;
      this.callbacks?.onConsoleData?.(errMsg);
      this.callbacks?.onOutput(`[Run error: ${err.message}]`);
      this.runProc = null;
      this.callbacks?.onStateChange('stopped');
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: 1, pid, exePath: this.currentExePath });
      }
      this.callbacks?.onExited(1);
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
      this.callbacks?.onOutput(
        '[Debugger] netcoredbg not found on macOS PATH. Running without debugger (install via `brew install netcoredbg` for breakpoints & stepping).',
      );
      await this.startWithoutDebugging(params.csprojPath, params.configuration, {
        projectName: params.projectName,
        targetFramework: params.targetFramework,
        consoleMode: params.consoleMode,
      });
      return { mode: 'run' };
    }

    await this.stop();
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

    this.currentExePath = dllPath;
    this.consoleExitedEmitted = false;
    this.lineRemainder = '';
    this.callbacks?.onStateChange('running');
    this.callbacks?.onOutput(`[Debugger] Launching netcoredbg for ${dllPath}`);

    this.dapProc = spawn(params.netcoredbgPath, ['--interpreter=vscode'], {
      cwd: projDir,
      env: getAugmentedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.currentPid = this.dapProc.pid;

    this.callbacks?.onConsoleStart?.({
      projectName: params.projectName,
      configuration: params.configuration,
      targetFramework: params.targetFramework,
      exePath: dllPath,
      command: dllPath,
      pid: this.dapProc.pid,
    });

    this.dapProc.stdout.on('data', (chunk: Buffer) => this.handleDapData(chunk));
    this.dapProc.stderr.on('data', (chunk: Buffer) => {
      const t = chunk.toString('utf-8').trim();
      if (t) this.callbacks?.onOutput(`[netcoredbg] ${t}`);
    });
    this.dapProc.on('close', (code) => {
      const exitCode = code ?? 0;
      const pid = this.currentPid;
      this.dapProc = null;
      this.flushLineRemainder();
      this.callbacks?.onStateChange('stopped');
      if (!this.consoleExitedEmitted) {
        this.consoleExitedEmitted = true;
        this.callbacks?.onConsoleExit?.({ code: exitCode, pid, exePath: this.currentExePath });
      }
      this.callbacks?.onExited(exitCode);
    });

    await this.sendDapRequest('initialize', {
      clientID: 'vs-studio-macos',
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
  }

  async continue(): Promise<void> {
    if (!this.dapProc) return;
    this.callbacks?.onStateChange('running');
    await this.sendDapRequest('continue', { threadId: this.currentThreadId });
  }

  async stepOver(): Promise<void> {
    if (!this.dapProc) return;
    await this.sendDapRequest('next', { threadId: this.currentThreadId });
  }

  async stepInto(): Promise<void> {
    if (!this.dapProc) return;
    await this.sendDapRequest('stepIn', { threadId: this.currentThreadId });
  }

  async stepOut(): Promise<void> {
    if (!this.dapProc) return;
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
      this.runProc.stdin.write(text);
    }
  }

  async stop(): Promise<void> {
    if (this.runProc) {
      try {
        this.runProc.kill();
      } catch {
        // ignore
      }
      this.runProc = null;
    }
    if (this.dapProc) {
      try {
        await this.sendDapRequest('disconnect', { terminateDebuggee: true });
      } catch {
        // ignore
      }
      try {
        this.dapProc?.kill();
      } catch {
        // ignore
      }
      this.dapProc = null;
    }
    for (const p of this.pending.values()) {
      p.reject(new Error('Debug session stopped'));
    }
    this.pending.clear();
    this.dapBuffer = Buffer.alloc(0);
    this.callbacks?.onStateChange('stopped');
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
      const proc = spawn(cmdArgs[0], cmdArgs.slice(1), {
        cwd,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.runProc = proc;
      this.currentPid = proc.pid;
      proc.stdout.on('data', (chunk: Buffer) => this.emitRawConsoleAndOutput(chunk.toString('utf-8')));
      proc.stderr.on('data', (chunk: Buffer) => this.emitRawConsoleAndOutput(chunk.toString('utf-8')));
      proc.on('close', () => {
        if (this.runProc === proc) this.runProc = null;
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
      this.callbacks?.onExited(exitCode);
    }
  }
}
