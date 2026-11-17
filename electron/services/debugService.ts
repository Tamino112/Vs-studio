import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fsSync from 'node:fs';
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

export interface DebugCallbacks {
  onOutput: (line: string) => void;
  onStateChange: (state: 'stopped' | 'running' | 'paused') => void;
  onStopped: (data: { file?: string; line?: number; frames: DebugStackFrame[]; locals: DebugVariable[] }) => void;
  onExited: (exitCode: number) => void;
}

export class DotnetDebugManager {
  private runProc: ChildProcessWithoutNullStreams | null = null;
  private dapProc: ChildProcessWithoutNullStreams | null = null;
  private dapBuffer = Buffer.alloc(0);
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private currentThreadId = 1;
  private callbacks: DebugCallbacks | null = null;

  setCallbacks(cb: DebugCallbacks): void {
    this.callbacks = cb;
  }

  async startWithoutDebugging(csprojPath: string, configuration: string): Promise<void> {
    await this.stop();
    const env = getAugmentedEnv();
    const dotnetBin = await getDotnetBin();
    const cwd = path.dirname(csprojPath);

    this.callbacks?.onStateChange('running');
    this.callbacks?.onOutput(`[Run] dotnet run --project "${csprojPath}" -c ${configuration}`);

    this.runProc = spawn(dotnetBin, ['run', '--project', csprojPath, '-c', configuration, '--no-build'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const handle = (buf: Buffer) => {
      for (const line of buf.toString('utf-8').split(/\r?\n/)) {
        if (line.length > 0) this.callbacks?.onOutput(line);
      }
    };
    this.runProc.stdout.on('data', handle);
    this.runProc.stderr.on('data', handle);
    this.runProc.on('close', (code) => {
      this.runProc = null;
      this.callbacks?.onStateChange('stopped');
      this.callbacks?.onOutput(`[Process exited with code ${code ?? 0}]`);
      this.callbacks?.onExited(code ?? 0);
    });
    this.runProc.on('error', (err) => {
      this.callbacks?.onOutput(`[Run error: ${err.message}]`);
      this.runProc = null;
      this.callbacks?.onStateChange('stopped');
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
  }): Promise<{ mode: 'dap' | 'run' }> {
    if (!params.netcoredbgPath) {
      this.callbacks?.onOutput(
        '[Debugger] netcoredbg not found on macOS PATH. Running without debugger (install via `brew install netcoredbg` for breakpoints & stepping).',
      );
      await this.startWithoutDebugging(params.csprojPath, params.configuration);
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
      await this.startWithoutDebugging(params.csprojPath, params.configuration);
      return { mode: 'run' };
    }

    this.callbacks?.onStateChange('running');
    this.callbacks?.onOutput(`[Debugger] Launching netcoredbg for ${dllPath}`);

    this.dapProc = spawn(params.netcoredbgPath, ['--interpreter=vscode'], {
      cwd: projDir,
      env: getAugmentedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.dapProc.stdout.on('data', (chunk: Buffer) => this.handleDapData(chunk));
    this.dapProc.stderr.on('data', (chunk: Buffer) => {
      const t = chunk.toString('utf-8').trim();
      if (t) this.callbacks?.onOutput(`[netcoredbg] ${t}`);
    });
    this.dapProc.on('close', (code) => {
      this.dapProc = null;
      this.callbacks?.onStateChange('stopped');
      this.callbacks?.onExited(code ?? 0);
    });

    await this.sendDapRequest('initialize', {
      clientID: 'vs-studio-macos',
      adapterID: 'coreclr',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
    });

    await this.sendDapRequest('launch', {
      name: params.projectName,
      type: 'coreclr',
      request: 'launch',
      program: dllPath,
      cwd: projDir,
      stopAtEntry: false,
    });

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
          type: 'response' | 'event';
          request_seq?: number;
          success?: boolean;
          message?: string;
          body?: Record<string, unknown>;
          event?: string;
        };

        if (msg.type === 'response' && msg.request_seq !== undefined) {
          const p = this.pending.get(msg.request_seq);
          if (p) {
            this.pending.delete(msg.request_seq);
            if (msg.success) p.resolve(msg.body);
            else p.reject(new Error(msg.message || 'DAP request failed'));
          }
        } else if (msg.type === 'event') {
          this.handleDapEvent(msg.event || '', msg.body || {});
        }
      } catch {
        // ignore
      }
    }
  }

  private async handleDapEvent(event: string, body: Record<string, unknown>): Promise<void> {
    if (event === 'output') {
      const out = String(body.output || '').replace(/\r?\n$/, '');
      if (out) this.callbacks?.onOutput(out);
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
      this.callbacks?.onStateChange('stopped');
      this.callbacks?.onExited(Number(body.exitCode ?? 0));
    }
  }
}
