/**
 * Cross-platform path helpers so Windows paths (`C:\...`, UNC, mixed drive-letter case)
 * and POSIX paths (`/Users/...`) behave identically across tabs, diagnostics, debugger, and trees.
 */

export function isWindowsPath(p: string): boolean {
  return (
    /^[a-zA-Z]:[/\\]/.test(p) ||
    p.startsWith('\\\\') ||
    p.startsWith('//') ||
    p.includes('\\') ||
    (typeof window !== 'undefined' && window.vsApi?.platform === 'win32')
  );
}

/** Normalizes slashes to `/` and lowercases Windows paths for reliable Map/Record keys. */
export function normalizePathKey(p: string): string {
  if (!p) return '';
  let s = p.replace(/\\/g, '/');
  if (s.length > 1 && !/^[a-zA-Z]:\/$/.test(s)) {
    s = s.replace(/\/+$/, '');
  }
  if (isWindowsPath(p)) {
    s = s.toLowerCase();
  }
  return s;
}

export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  return normalizePathKey(a) === normalizePathKey(b);
}

export function isPathUnderDir(target: string | null | undefined, dir: string | null | undefined): boolean {
  if (!target || !dir) return false;
  const nt = normalizePathKey(target);
  const nd = normalizePathKey(dir);
  if (!nt || !nd) return false;
  if (nt === nd) return true;
  const prefix = nd.endsWith('/') ? nd : `${nd}/`;
  return nt.startsWith(prefix);
}

export function remapPathPrefix(target: string, oldPrefix: string, newPrefix: string): string | null {
  if (pathsEqual(target, oldPrefix)) return newPrefix;
  if (!isPathUnderDir(target, oldPrefix)) return null;
  const normOld = oldPrefix.replace(/[/\\]+$/, '');
  const targetSep = isWindowsPath(newPrefix) ? '\\' : '/';
  const remainder = target.slice(normOld.length).replace(/[/\\]+/g, targetSep);
  const cleanNew = newPrefix.replace(/[/\\]+$/, '');
  return `${cleanNew}${remainder}`;
}

export function pathBaseName(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, '');
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function pathDirName(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return cleaned[0];
  if (idx === 2 && /^[a-zA-Z]:/.test(cleaned)) return cleaned.slice(0, 3);
  return cleaned.slice(0, idx);
}

export function joinPath(dir: string, ...segments: string[]): string {
  const sep = isWindowsPath(dir) ? '\\' : '/';
  let out = dir === '/' ? '/' : dir.replace(/[/\\]+$/, '');
  if (/^[a-zA-Z]:$/.test(out)) out += sep;
  for (const seg of segments) {
    const clean = seg.replace(/^[/\\]+|[/\\]+$/g, '').replace(/[/\\]+/g, sep);
    if (!clean) continue;
    if (!out) out = clean;
    else out = out.endsWith(sep) ? `${out}${clean}` : `${out}${sep}${clean}`;
  }
  return out;
}
