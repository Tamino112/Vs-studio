import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMsbuildDiagnostics } from '../electron/services/solutionService';
import { parseTestConsoleOutput, parseTrx } from '../electron/services/dotnetService';
import { getGitStatus, stageGitFile } from '../electron/services/gitService';

describe('Audit regressions (backend parsing)', () => {
  it('reports MSBuild errors without a file location (NU1101, CS5001) and strips ::TargetFramework', () => {
    const out = [
      '/Users/dev/App/App.csproj : error NU1101: Unable to find package Foo. [/Users/dev/App/App.csproj::TargetFramework=net10.0]',
      'CSC : error CS5001: Program does not contain a static \'Main\' method suitable for an entry point [/Users/dev/App/App.csproj]',
      '/Users/dev/App/Program.cs(3,5,3,9): warning CS0168: The variable \'x\' is declared but never used [/Users/dev/App/App.csproj]',
    ].join('\n');
    const diags = parseMsbuildDiagnostics(out, '/Users/dev/App');
    expect(diags).toHaveLength(3);
    expect(diags[0]).toMatchObject({ code: 'NU1101', severity: 'error', project: 'App', file: '/Users/dev/App/App.csproj' });
    expect(diags[1]).toMatchObject({ code: 'CS5001', severity: 'error', project: 'App' });
    expect(diags[2]).toMatchObject({ code: 'CS0168', severity: 'warning', line: 3, column: 5, file: '/Users/dev/App/Program.cs' });
  });

  it('parses TRX results like VS Test Explorer (names, durations, error messages, project)', () => {
    const trx = `<?xml version="1.0" encoding="utf-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="a" testName="Calc.Tests.MathTests.Add(x: 1, y: 2.5)" outcome="Passed" duration="00:00:00.0123000" />
    <UnitTestResult testId="b" testName="Calc.Tests.MathTests.Divide" outcome="Failed" duration="00:00:01.5000000">
      <Output><ErrorInfo><Message>Assert.Equal() Failure</Message><StackTrace>at MathTests.Divide()</StackTrace></ErrorInfo></Output>
    </UnitTestResult>
    <UnitTestResult testId="c" testName="Calc.Tests.MathTests.Skip" outcome="NotExecuted" />
  </Results>
  <TestDefinitions>
    <UnitTest id="a" name="Add" storage="/x/bin/Debug/net10.0/Calc.Tests.dll"><TestMethod className="Calc.Tests.MathTests" name="Add" /></UnitTest>
    <UnitTest id="b" name="Divide" storage="/x/bin/Debug/net10.0/Calc.Tests.dll"><TestMethod className="Calc.Tests.MathTests" name="Divide" /></UnitTest>
    <UnitTest id="c" name="Skip" storage="/x/bin/Debug/net10.0/Calc.Tests.dll"><TestMethod className="Calc.Tests.MathTests" name="Skip" /></UnitTest>
  </TestDefinitions>
</TestRun>`;
    const tests = parseTrx(trx);
    expect(tests).toHaveLength(3);
    expect(tests[0]).toMatchObject({ name: 'Add(x: 1, y: 2.5)', suite: 'Calc.Tests.MathTests', project: 'Calc.Tests', status: 'passed', durationMs: 12 });
    expect(tests[1]).toMatchObject({ status: 'failed', durationMs: 1500, errorMessage: 'Assert.Equal() Failure' });
    expect(tests[2].status).toBe('skipped');
  });

  it('console fallback keeps Theory names intact and ignores "Failed to restore" lines', () => {
    const out = [
      '  Passed Calc.Tests.MathTests.Add(x: 1.5, y: "a b") [3 ms]',
      '  Failed Calc.Tests.MathTests.Divide [1 s]',
      'Failed to restore /x/y.csproj',
    ].join('\n');
    const tests = parseTestConsoleOutput(out, 'Calc.Tests');
    expect(tests).toHaveLength(2);
    expect(tests[0]).toMatchObject({ name: 'Add(x: 1.5, y: "a b")', suite: 'Calc.Tests.MathTests', durationMs: 3 });
    expect(tests[1]).toMatchObject({ name: 'Divide', status: 'failed', durationMs: 1000 });
  });

  it('git status/stage work when the solution folder is a sub folder of the repository', async () => {
    const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vs-git-sub-')));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
      git('init', '-q');
      fs.mkdirSync(path.join(repo, 'src', 'App'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'src', 'App', 'My File.cs'), 'class A {}');
      const slnDir = path.join(repo, 'src');
      const status = await getGitStatus(slnDir);
      const change = status.changes.find((c) => c.relativePath.endsWith('My File.cs'));
      expect(change).toBeDefined();
      expect(change!.path).toBe(path.join(repo, 'src', 'App', 'My File.cs'));
      await stageGitFile(slnDir, change!.relativePath);
      const after = await getGitStatus(slnDir);
      expect(after.changes.some((c) => c.staged && c.relativePath === change!.relativePath)).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
