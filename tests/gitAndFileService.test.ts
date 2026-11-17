import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readDirectoryTree, searchInDirectory } from '../electron/services/fileService';
import {
  checkoutGitBranch,
  commitGit,
  getGitFileDiff,
  getGitStatus,
  initGitRepo,
  stageGitFile,
} from '../electron/services/gitService';

describe('FileService & GitService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-studio-fs-git-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('hides bin/obj by default and shows them when showAllFiles=true', async () => {
    await fs.mkdir(path.join(tmpDir, 'bin', 'Debug'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'Models'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'Program.cs'), 'Console.WriteLine("Hi");');
    await fs.writeFile(path.join(tmpDir, 'Models', 'User.cs'), 'public record User(string Name);');

    const normal = await readDirectoryTree(tmpDir, false);
    expect(normal.map((n) => n.name)).toEqual(['Models', 'Program.cs']);

    const all = await readDirectoryTree(tmpDir, true);
    expect(all.map((n) => n.name)).toEqual(['bin', 'Models', 'Program.cs']);
  });

  it('searches across C# files with matchCase and wholeWord', async () => {
    await fs.writeFile(path.join(tmpDir, 'Program.cs'), 'var totalCount = 10;\nvar count = 5;\n');
    const matches = await searchInDirectory(tmpDir, 'count', { matchCase: true, wholeWord: true });
    expect(matches.length).toBe(1);
    expect(matches[0].line).toBe(2);
  });

  it('initializes git repo, stages, commits, diffs, and switches branches', async () => {
    await fs.writeFile(path.join(tmpDir, 'Program.cs'), 'Console.WriteLine(1);\n');
    await initGitRepo(tmpDir);
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'pipe' });

    const status1 = await getGitStatus(tmpDir);
    expect(status1.isRepo).toBe(true);
    expect(status1.changes.some((c) => c.relativePath === 'Program.cs')).toBe(true);

    await stageGitFile(tmpDir, 'Program.cs');
    await commitGit(tmpDir, 'Initial commit');

    await fs.writeFile(path.join(tmpDir, 'Program.cs'), 'Console.WriteLine(2);\n');
    const diff = await getGitFileDiff(tmpDir, 'Program.cs', false);
    expect(diff.original).toContain('Console.WriteLine(1);');
    expect(diff.modified).toContain('Console.WriteLine(2);');

    await checkoutGitBranch(tmpDir, 'feature/test', true);
    const status2 = await getGitStatus(tmpDir);
    expect(status2.branch).toBe('feature/test');
  });
});
