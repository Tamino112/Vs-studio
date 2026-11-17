import { ChildProcessWithoutNullStreams } from 'node:child_process';
import fsSync from 'node:fs';
import os from 'node:os';
import { getAugmentedEnv } from './dotnetService';
import { spawnWithPty } from './ptyHelper';

interface TerminalSession {
  id: string;
  proc: ChildProcessWithoutNullStreams;
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();

  create(
    id: string,
    cwd: string,
    onData: (data: string) => void,
    onExit: (code: number) => void,
  ): void {
    this.kill(id);
    const defaultShell =
      process.platform === 'darwin'
        ? fsSync.existsSync('/bin/zsh')
          ? '/bin/zsh'
          : '/bin/bash'
        : fsSync.existsSync('/bin/bash')
          ? '/bin/bash'
          : '/bin/sh';

    const args = ['-i'];
    const { proc } = spawnWithPty(defaultShell, args, {
      cwd: fsSync.existsSync(cwd) ? cwd : os.homedir(),
      env: {
        ...getAugmentedEnv(),
        TERM: 'xterm-256color',
        PS1: process.platform === 'darwin' ? '%n@%m %1~ %# ' : '\\u@\\h:\\w\\$ ',
      },
    });

    proc.stdout.on('data', (chunk: Buffer) => onData(chunk.toString('utf-8')));
    proc.stderr.on('data', (chunk: Buffer) => onData(chunk.toString('utf-8')));
    proc.on('close', (code) => {
      this.sessions.delete(id);
      onExit(code ?? 0);
    });
    proc.on('error', (err) => {
      onData(`\r\n[Terminal error: ${err.message}]\r\n`);
    });

    this.sessions.set(id, { id, proc });
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s && !s.proc.killed) {
      s.proc.stdin.write(data);
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      try {
        s.proc.kill();
      } catch {
        // ignore
      }
      this.sessions.delete(id);
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }
}
