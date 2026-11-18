import { describe, expect, it } from 'vitest';
import {
  isPathUnderDir,
  isWindowsPath,
  joinPath,
  normalizePathKey,
  pathBaseName,
  pathDirName,
  pathsEqual,
  remapPathPrefix,
} from '../src/utils/pathUtils';

describe('Cross-platform pathUtils', () => {
  it('recognizes Windows drive, backslash, and UNC paths', () => {
    expect(isWindowsPath('C:\\Users\\Tamino\\Program.cs')).toBe(true);
    expect(isWindowsPath('d:/Projects/App/App.csproj')).toBe(true);
    expect(isWindowsPath('\\\\server\\share\\file.cs')).toBe(true);
    expect(isWindowsPath('/Users/tamino/Projects/Program.cs')).toBe(false);
  });

  it('normalizes slashes and casing on Windows paths while preserving POSIX case sensitivity', () => {
    expect(normalizePathKey('C:\\Users\\Tamino\\App\\Program.cs')).toBe('c:/users/tamino/app/program.cs');
    expect(normalizePathKey('c:/Users/Tamino/App/Program.cs/')).toBe('c:/users/tamino/app/program.cs');
    expect(normalizePathKey('C:\\')).toBe('c:/');
    expect(normalizePathKey('/Users/Tamino/App/Program.cs')).toBe('/Users/Tamino/App/Program.cs');
  });

  it('matches equal Windows paths regardless of slash style or drive/folder casing', () => {
    expect(pathsEqual('C:\\App\\Program.cs', 'c:/app/program.cs')).toBe(true);
    expect(pathsEqual('D:\\Work\\', 'd:/work')).toBe(true);
    expect(pathsEqual('/home/App/Program.cs', '/home/app/program.cs')).toBe(false);
    expect(pathsEqual(null, null)).toBe(true);
    expect(pathsEqual('C:\\a.cs', undefined)).toBe(false);
  });

  it('checks directory containment safely without partial-folder prefix bugs', () => {
    expect(isPathUnderDir('C:\\Repo\\App\\Program.cs', 'c:/repo/app')).toBe(true);
    expect(isPathUnderDir('C:\\Repo\\App2\\Program.cs', 'C:\\Repo\\App')).toBe(false);
    expect(isPathUnderDir('C:\\Repo\\App', 'c:/repo/app/')).toBe(true);
    expect(isPathUnderDir('/repo/App/Program.cs', '/repo/app')).toBe(false);
  });

  it('remaps moved/renamed prefixes while preserving target separator conventions', () => {
    expect(remapPathPrefix('C:\\Repo\\Old\\Sub\\File.cs', 'c:/repo/old', 'C:\\Repo\\New')).toBe(
      'C:\\Repo\\New\\Sub\\File.cs',
    );
    expect(remapPathPrefix('C:\\Repo\\Old', 'C:\\Repo\\Old', 'C:\\Repo\\New')).toBe('C:\\Repo\\New');
    expect(remapPathPrefix('C:\\Repo\\Other\\File.cs', 'C:\\Repo\\Old', 'C:\\Repo\\New')).toBeNull();
  });

  it('computes basename, dirname, and joins cleanly for Windows and POSIX', () => {
    expect(pathBaseName('C:\\Repo\\App\\Program.cs')).toBe('Program.cs');
    expect(pathBaseName('C:\\Repo\\App\\')).toBe('App');
    expect(pathDirName('C:\\Repo\\App\\Program.cs')).toBe('C:\\Repo\\App');
    expect(pathDirName('C:\\Program.cs')).toBe('C:\\');
    expect(pathDirName('/Users/tamino/Program.cs')).toBe('/Users/tamino');

    expect(joinPath('C:\\Repo\\App', 'Models', 'User.cs')).toBe('C:\\Repo\\App\\Models\\User.cs');
    expect(joinPath('C:\\', 'Repo', 'Program.cs')).toBe('C:\\Repo\\Program.cs');
    expect(joinPath('/Users/tamino/App', 'Models/User.cs')).toBe('/Users/tamino/App/Models/User.cs');
  });
});
