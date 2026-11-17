import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  extension?: string;
}

export interface RecentSolution {
  path: string;
  name: string;
  lastOpened: string;
  pinned?: boolean;
  kind: 'sln' | 'csproj' | 'folder';
}

export interface SearchMatch {
  file: string;
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

const IGNORED_DIRS = new Set(['bin', 'obj', '.git', '.vs', 'node_modules', '.DS_Store']);

export async function readDirectoryTree(dirPath: string, showAllFiles = false): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (!showAllFiles && IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name === '.DS_Store') continue;

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const children = await readDirectoryTree(fullPath, showAllFiles);
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDirectory: true,
        children,
      });
    } else {
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDirectory: false,
        extension: path.extname(entry.name).toLowerCase(),
      });
    }
  }

  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return nodes;
}

export async function readFileText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function writeFileText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function createDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await fs.rename(oldPath, newPath);
}

export async function deletePath(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function searchInDirectory(
  rootDir: string,
  query: string,
  options: { matchCase?: boolean; wholeWord?: boolean; fileMask?: string } = {},
): Promise<SearchMatch[]> {
  if (!query) return [];
  const matches: SearchMatch[] = [];
  const maxMatches = 500;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped;
  const regex = new RegExp(pattern, options.matchCase ? 'g' : 'gi');

  const allowedExtensions = new Set([
    '.cs', '.csproj', '.sln', '.slnx', '.json', '.xml', '.razor', '.cshtml',
    '.css', '.html', '.js', '.ts', '.md', '.txt', '.config', '.props', '.targets',
  ]);

  async function walk(currentDir: string) {
    if (matches.length >= maxMatches) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxMatches) break;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(ext)) continue;
        if (options.fileMask && !entry.name.toLowerCase().includes(options.fileMask.replace(/\*/g, '').toLowerCase())) {
          continue;
        }
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            const m = regex.exec(lines[i]);
            if (m) {
              matches.push({
                file: fullPath,
                relativePath: path.relative(rootDir, fullPath),
                line: i + 1,
                column: m.index + 1,
                lineText: lines[i].trim(),
              });
              if (matches.length >= maxMatches) break;
            }
          }
        } catch {
          // ignore unreadable binary files
        }
      }
    }
  }

  await walk(rootDir);
  return matches;
}

const RECENT_STORE_PATH = path.join(os.homedir(), '.vs-studio-community', 'recent.json');

export async function getRecentSolutions(): Promise<RecentSolution[]> {
  try {
    const raw = await fs.readFile(RECENT_STORE_PATH, 'utf-8');
    const items = JSON.parse(raw) as RecentSolution[];
    return items.filter((item) => fsSync.existsSync(item.path));
  } catch {
    return [];
  }
}

export async function addRecentSolution(item: RecentSolution): Promise<RecentSolution[]> {
  const existing = await getRecentSolutions();
  const prev = existing.find((x) => x.path === item.path);
  const merged: RecentSolution = {
    ...item,
    pinned: prev?.pinned ?? item.pinned ?? false,
    lastOpened: new Date().toISOString(),
  };
  const filtered = existing.filter((x) => x.path !== item.path);
  const next = [merged, ...filtered].slice(0, 20);
  await fs.mkdir(path.dirname(RECENT_STORE_PATH), { recursive: true });
  await fs.writeFile(RECENT_STORE_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export async function togglePinRecentSolution(targetPath: string): Promise<RecentSolution[]> {
  const existing = await getRecentSolutions();
  const next = existing.map((x) =>
    x.path === targetPath ? { ...x, pinned: !x.pinned } : x,
  );
  await fs.mkdir(path.dirname(RECENT_STORE_PATH), { recursive: true });
  await fs.writeFile(RECENT_STORE_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function getDefaultProjectsDir(): string {
  return path.join(os.homedir(), 'source', 'repos');
}
