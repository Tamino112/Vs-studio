import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { getAugmentedEnv } from './dotnetService';
import { DiagnosticItem } from './solutionService';

interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

export class CSharpLspClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private initialized = false;
  private openVersions = new Map<string, number>();
  private onDiagnosticsCb?: (file: string, diagnostics: DiagnosticItem[]) => void;
  private onLogCb?: (line: string) => void;

  setCallbacks(
    onDiagnostics: (file: string, diagnostics: DiagnosticItem[]) => void,
    onLog: (line: string) => void,
  ): void {
    this.onDiagnosticsCb = onDiagnostics;
    this.onLogCb = onLog;
  }

  async start(rootDir: string, csharpLsPath: string): Promise<boolean> {
    this.stop();
    try {
      const proc = spawn(csharpLsPath, [], {
        cwd: rootDir,
        env: getAugmentedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;

      proc.stdin.on('error', () => {
        // ignore EPIPE if csharp-ls crashed
      });
      proc.stdout.on('data', (chunk: Buffer) => {
        if (this.proc === proc) this.handleData(chunk);
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        if (text && this.proc === proc) this.onLogCb?.(`[csharp-ls] ${text}`);
      });
      proc.on('close', (code) => {
        // Ignore the exit of a previous (restarted) server instance
        if (this.proc !== proc) return;
        this.onLogCb?.(`[csharp-ls] exited with code ${code ?? 0}`);
        this.initialized = false;
        this.proc = null;
        this.rejectAll('csharp-ls exited');
      });
      proc.on('error', (err) => {
        if (this.proc !== proc) return;
        this.onLogCb?.(`[csharp-ls] error: ${err.message}`);
        this.initialized = false;
        this.proc = null;
        this.rejectAll(`csharp-ls error: ${err.message}`);
      });

      const rootUri = pathToFileURL(rootDir).toString();
      await this.sendRequest('initialize', {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(rootDir) }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            completion: {
              completionItem: {
                snippetSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
              },
            },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: {
              signatureInformation: {
                documentationFormat: ['markdown', 'plaintext'],
                parameterInformation: { labelOffsetSupport: true },
              },
            },
            definition: { linkSupport: true },
            references: { dynamicRegistration: false },
            codeAction: {
              codeActionLiteralSupport: {
                codeActionKind: { valueSet: ['quickfix', 'refactor'] },
              },
            },
            formatting: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: true },
            rename: { prepareSupport: false },
          },
        },
      });

      this.sendNotification('initialized', {});
      this.initialized = true;
      this.onLogCb?.(`[csharp-ls] Initialized for workspace ${rootDir}`);
      return true;
    } catch (err) {
      this.onLogCb?.(`[csharp-ls] Failed to start: ${(err as Error).message}`);
      this.stop();
      return false;
    }
  }

  isRunning(): boolean {
    return Boolean(this.proc && this.initialized);
  }

  stop(): void {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        // ignore
      }
      this.proc = null;
    }
    this.initialized = false;
    this.openVersions.clear();
    this.rejectAll('LSP client stopped');
    this.buffer = Buffer.alloc(0);
  }

  private rejectAll(reason: string): void {
    for (const p of this.pending.values()) {
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private respond(id: number | string, result: unknown): void {
    if (!this.proc) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
    this.proc.stdin.write(header + payload, 'utf-8');
  }

  didOpen(filePath: string, text: string): void {
    if (!this.isRunning()) return;
    const uri = pathToFileURL(filePath).toString();
    const version = 1;
    this.openVersions.set(uri, version);
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'csharp',
        version,
        text,
      },
    });
  }

  didChange(filePath: string, text: string): void {
    if (!this.isRunning()) return;
    const uri = pathToFileURL(filePath).toString();
    if (!this.openVersions.has(uri)) {
      this.didOpen(filePath, text);
      return;
    }
    const version = (this.openVersions.get(uri) ?? 1) + 1;
    this.openVersions.set(uri, version);
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  didSave(filePath: string, text: string): void {
    if (!this.isRunning()) return;
    const uri = pathToFileURL(filePath).toString();
    if (!this.openVersions.has(uri)) {
      this.didOpen(filePath, text);
    }
    this.sendNotification('textDocument/didSave', {
      textDocument: { uri },
      text,
    });
  }

  async completion(filePath: string, line: number, character: number): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/completion', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      position: { line, character },
    });
  }

  async hover(filePath: string, line: number, character: number): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      position: { line, character },
    });
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      position: { line, character },
    });
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/rename', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      position: { line, character },
      newName,
    });
  }

  async signatureHelp(filePath: string, line: number, character: number): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      position: { line, character },
    });
  }

  async codeAction(
    filePath: string,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    diagnostics: unknown[] = [],
  ): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/codeAction', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      context: { diagnostics },
    });
  }

  async references(filePath: string, line: number, character: number): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/references', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async formatDocument(filePath: string): Promise<unknown> {
    if (!this.isRunning()) return null;
    return this.sendRequest('textDocument/formatting', {
      textDocument: { uri: pathToFileURL(filePath).toString() },
      options: { tabSize: 4, insertSpaces: true },
    });
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error('LSP not running'));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
    this.proc.stdin.write(header + payload, 'utf-8');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 15000);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.proc) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
    this.proc.stdin.write(header + payload, 'utf-8');
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerStr = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lenMatch = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!lenMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(lenMatch[1]);
      const total = headerEnd + 4 + length;
      if (this.buffer.length < total) break;

      const bodyStr = this.buffer.subarray(headerEnd + 4, total).toString('utf-8');
      this.buffer = this.buffer.subarray(total);

      try {
        const msg = JSON.parse(bodyStr) as {
          id?: number;
          method?: string;
          result?: unknown;
          error?: { message?: string };
          params?: unknown;
        };

        if (msg.method && msg.id !== undefined) {
          // Server -> client request (client/registerCapability, workspace/configuration, …).
          // Must be answered and must never be mistaken for a response to our own request ids.
          const items = (msg.params as { items?: unknown[] } | undefined)?.items;
          this.respond(
            msg.id,
            msg.method === 'workspace/configuration' ? (Array.isArray(items) ? items.map(() => null) : []) : null,
          );
        } else if (msg.id !== undefined && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) pending.reject(new Error(msg.error.message || 'LSP error'));
          else pending.resolve(msg.result);
        } else if (msg.method === 'textDocument/publishDiagnostics') {
          const p = msg.params as {
            uri: string;
            diagnostics: Array<{
              range: {
                start: { line: number; character: number };
                end?: { line: number; character: number };
              };
              severity?: number;
              code?: string | number | { value?: string | number };
              message: string;
            }>;
          };
          const filePath = p.uri.startsWith('file://') ? fileURLToPath(p.uri) : p.uri;
          const mapped: DiagnosticItem[] = (p.diagnostics || []).map((d, idx) => {
            const rawCode =
              typeof d.code === 'object' && d.code !== null ? d.code.value : d.code;
            const startLine = d.range.start.line + 1;
            const startCol = d.range.start.character + 1;
            const endLine = d.range.end ? d.range.end.line + 1 : startLine;
            const endCol = d.range.end ? d.range.end.character + 1 : startCol + 1;
            return {
              id: `lsp:${filePath}:${idx}:${startLine}:${startCol}:${d.message}`,
              severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'message',
              code: rawCode ? String(rawCode) : 'CS',
              description: d.message,
              project: path.basename(path.dirname(filePath)),
              file: filePath,
              line: startLine,
              column: startCol,
              endLine,
              endColumn: Math.max(startCol + 1, endCol),
              source: 'IntelliSense',
            };
          });
          this.onDiagnosticsCb?.(filePath, mapped);
        }
      } catch {
        // ignore malformed frame
      }
    }
  }
}
