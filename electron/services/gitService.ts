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

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env: getAugmentedEnv() });
  return stdout;
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
    const statusOut = await runGit(repoDir, ['status', '--porcelain=v1']);
    for (const line of statusOut.split(/\r?\n/)) {
      if (!line) continue;
      const x = line[0];
      const y = line[1];
      const rel = line.slice(3).trim();
      const abs = path.resolve(repoDir, rel);

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
    const logOut = await runGit(repoDir, ['log', '-n', '15', '--pretty=format:%h|%s|%an|%ar']);
    for (const line of logOut.split(/\r?\n/)) {
      if (!line) continue;
      const [hash, message, author, date] = line.split('|');
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
  await runGit(repoDir, ['add', '--', relativePath]);
}

export async function unstageGitFile(repoDir: string, relativePath: string): Promise<void> {
  try {
    await runGit(repoDir, ['restore', '--staged', '--', relativePath]);
  } catch {
    await runGit(repoDir, ['reset', 'HEAD', '--', relativePath]);
  }
}

export async function stageAllGitFiles(repoDir: string): Promise<void> {
  await runGit(repoDir, ['add', '-A']);
}

export async function commitGit(repoDir: string, message: string): Promise<string> {
  return runGit(repoDir, ['commit', '-m', message]);
}

export async function getGitFileDiff(repoDir: string, relativePath: string, staged: boolean): Promise<{ original: string; modified: string }> {
  let original = '';
  try {
    original = await runGit(repoDir, ['show', `HEAD:${relativePath}`]);
  } catch {
    original = '';
  }
  let modified = '';
  if (staged) {
    try {
      modified = await runGit(repoDir, ['show', `:${relativePath}`]);
    } catch {
      modified = '';
    }
  } else {
    const fs = await import('node:fs/promises');
    try {
      modified = await fs.readFile(path.resolve(repoDir, relativePath), 'utf-8');
    } catch {
      modified = '';
    }
  }
  return { original, modified };
}

export async function checkoutGitBranch(repoDir: string, branch: string, create = false): Promise<void> {
  if (create) {
    await runGit(repoDir, ['checkout', '-b', branch]);
  } else {
    await runGit(repoDir, ['checkout', branch]);
  }
}

export async function cloneGitRepo(url: string, targetDir: string): Promise<void> {
  await execFileAsync('git', ['clone', url, targetDir], { env: getAugmentedEnv() });
}

export async function pullGit(repoDir: string): Promise<string> {
  return runGit(repoDir, ['pull']);
}

export async function pushGit(repoDir: string): Promise<string> {
  return runGit(repoDir, ['push']);
}
