import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fsSync from 'node:fs';
import { getAugmentedEnv } from './dotnetService';

const execFileAsync = promisify(execFile);

export interface GitFileChange {
  path: string;
  relativePath: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  staged: boolean;
}

export interface GitStatusInfo {
  isRepo: boolean;
  branch: string;
  branches: string[];
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  recentCommits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
}

async function runGit(cwd: string, args: string[], timeoutMs = 120000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    // Never wait for an interactive credential prompt (would hang pull/push forever)
    env: { ...getAugmentedEnv(), GIT_TERMINAL_PROMPT: '0' },
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Porcelain paths are relative to the repository root – which may be above the solution folder. */
async function repoRoot(dir: string): Promise<string> {
  try {
    const root = (await runGit(dir, ['rev-parse', '--show-toplevel'])).trim();
    if (!root) return dir;
    // git returns the realpath (/private/var/… on macOS); express it relative to the
    // path the IDE uses so file paths match open tabs exactly.
    try {
      const realDir = fsSync.realpathSync.native(dir);
      const rel = path.relative(realDir, root);
      return path.resolve(dir, rel);
    } catch {
      return root;
    }
  } catch {
    return dir;
  }
}

export async function getGitStatus(repoDir: string): Promise<GitStatusInfo> {
  if (!repoDir || !fsSync.existsSync(repoDir)) {
    return { isRepo: false, branch: '', branches: [], ahead: 0, behind: 0, changes: [], recentCommits: [] };
  }
  try {
    await runGit(repoDir, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { isRepo: false, branch: '', branches: [], ahead: 0, behind: 0, changes: [], recentCommits: [] };
  }

  let branch = 'main';
  try {
    branch = (await runGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'HEAD';
  } catch {
    branch = 'main';
  }

  let branches: string[] = [];
  try {
    const bOut = await runGit(repoDir, ['branch', '--format=%(refname:short)']);
    branches = bOut.split(/\r?\n/).map((b) => b.trim()).filter(Boolean);
  } catch {
    branches = [branch];
  }

  let ahead = 0;
  let behind = 0;
  try {
    const ab = (await runGit(repoDir, ['rev-list', '--left-right', '--count', `HEAD...@{upstream}`])).trim();
    const [a, b] = ab.split(/\s+/).map(Number);
    ahead = a || 0;
    behind = b || 0;
  } catch {
    // no upstream configured
  }

  const changes: GitFileChange[] = [];
  try {
    const root = await repoRoot(repoDir);
    // -z: NUL separated, unquoted paths; renames/copies are followed by the original path
    const statusOut = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const tokens = statusOut.split('\0');
    for (let i = 0; i < tokens.length; i++) {
      const line = tokens[i];
      if (!line || line.length < 4) continue;
      const x = line[0];
      const y = line[1];
      const rel = line.slice(3);
      if (x === 'R' || x === 'C') i++; // skip original path token
      const abs = path.resolve(root, rel);

      if (x !== ' ' && x !== '?') {
        changes.push({
          path: abs,
          relativePath: rel,
          status: (x as GitFileChange['status']) || 'M',
          staged: true,
        });
      }
      if (y !== ' ' || x === '?') {
        changes.push({
          path: abs,
          relativePath: rel,
          status: x === '?' ? '?' : ((y as GitFileChange['status']) || 'M'),
          staged: false,
        });
      }
    }
  } catch {
    // empty repo
  }

  const recentCommits: GitStatusInfo['recentCommits'] = [];
  try {
    const logOut = await runGit(repoDir, ['log', '-n', '15', '--pretty=format:%h%x1f%s%x1f%an%x1f%ar']);
    for (const line of logOut.split(/\r?\n/)) {
      if (!line) continue;
      const [hash, message, author, date] = line.split('\x1f');
      recentCommits.push({ hash, message, author, date });
    }
  } catch {
    // no commits yet
  }

  return { isRepo: true, branch, branches, ahead, behind, changes, recentCommits };
}

export async function initGitRepo(repoDir: string): Promise<void> {
  await runGit(repoDir, ['init']);
}

export async function stageGitFile(repoDir: string, relativePath: string): Promise<void> {
  await runGit(await repoRoot(repoDir), ['add', '--', relativePath]);
}

export async function unstageGitFile(repoDir: string, relativePath: string): Promise<void> {
  const root = await repoRoot(repoDir);
  try {
    await runGit(root, ['restore', '--staged', '--', relativePath]);
  } catch {
    await runGit(root, ['reset', 'HEAD', '--', relativePath]);
  }
}

export async function stageAllGitFiles(repoDir: string): Promise<void> {
  await runGit(repoDir, ['add', '-A']);
}

export async function commitGit(repoDir: string, message: string): Promise<string> {
  return runGit(repoDir, ['commit', '-m', message]);
}

export async function getGitFileDiff(repoDir: string, relativePath: string, staged: boolean): Promise<{ original: string; modified: string }> {
  const root = await repoRoot(repoDir);
  const relPosix = relativePath.replace(/\\/g, '/');
  let original = '';
  try {
    original = await runGit(root, ['show', `HEAD:${relPosix}`]);
  } catch {
    original = '';
  }
  let modified = '';
  if (staged) {
    try {
      modified = await runGit(root, ['show', `:${relPosix}`]);
    } catch {
      modified = '';
    }
  } else {
    const fs = await import('node:fs/promises');
    try {
      modified = await fs.readFile(path.resolve(root, relativePath), 'utf-8');
    } catch {
      modified = '';
    }
  }
  return { original, modified };
}

export async function checkoutGitBranch(repoDir: string, branch: string, create = false): Promise<void> {
  // Reject names git would interpret as options or that are not valid branch names
  await runGit(repoDir, ['check-ref-format', '--branch', branch]);
  if (branch.startsWith('-')) throw new Error(`Invalid branch name: ${branch}`);
  if (create) {
    await runGit(repoDir, ['checkout', '-b', branch]);
  } else {
    await runGit(repoDir, ['checkout', branch, '--']);
  }
}

export async function cloneGitRepo(url: string, targetDir: string): Promise<void> {
  await execFileAsync('git', ['clone', '--', url, targetDir], {
    env: { ...getAugmentedEnv(), GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

export async function pullGit(repoDir: string): Promise<string> {
  return runGit(repoDir, ['pull']);
}

export async function pushGit(repoDir: string): Promise<string> {
  return runGit(repoDir, ['push']);
}
