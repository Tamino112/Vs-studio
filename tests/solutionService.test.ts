import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  addProjectToSlnFile,
  createSlnContent,
  generateGuid,
  parseCsproj,
  parseMsbuildDiagnostics,
  parseSolution,
  updateCsprojProperty,
} from '../electron/services/solutionService';
import {
  addNewProjectToSolution,
  addProjectReference,
  createSolutionWithProject,
  removeProjectReference,
} from '../electron/services/dotnetService';

describe('Solution & Multi-Project Service', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-studio-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a multi-project .NET 10 solution with ConsoleApp + ClassLibrary + ProjectReference', async () => {
    const created = await createSolutionWithProject({
      template: 'console',
      projectName: 'MyConsoleApp',
      solutionName: 'MultiAppSolution',
      location: tmpDir,
      sameDirectory: false,
      framework: 'net10.0',
      useProgramMain: false,
    });

    const libCsproj = await addNewProjectToSolution({
      slnPath: created.slnPath,
      template: 'classlib',
      projectName: 'MySharedLib',
      framework: 'net10.0',
    });

    await addProjectReference(created.csprojPath, libCsproj);

    const sln = await parseSolution(created.slnPath);
    expect(sln.name).toBe('MultiAppSolution');
    expect(sln.format).toBe('sln');
    expect(sln.projects.length).toBe(2);

    const consoleProj = sln.projects.find((p) => p.name === 'MyConsoleApp');
    const libProj = sln.projects.find((p) => p.name === 'MySharedLib');

    expect(consoleProj).toBeDefined();
    expect(libProj).toBeDefined();
    expect(consoleProj?.targetFramework).toBe('net10.0');
    expect(consoleProj?.outputType).toBe('Exe');
    expect(libProj?.outputType).toBe('Library');
    expect(consoleProj?.projectReferences.some((r) => r.name === 'MySharedLib')).toBe(true);
    expect(sln.startupProjectId).toBe(consoleProj?.id);

    // Test removing project reference
    await removeProjectReference(created.csprojPath, libCsproj);
    const updated = await parseCsproj(created.csprojPath);
    expect(updated.projectReferences.length).toBe(0);
  });

  it('updates .csproj properties cleanly', async () => {
    const csproj = path.join(tmpDir, 'App.csproj');
    await fs.writeFile(
      csproj,
      `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net10.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>`,
      'utf-8',
    );
    await updateCsprojProperty(csproj, 'Nullable', 'disable');
    await updateCsprojProperty(csproj, 'ImplicitUsings', 'enable');
    const parsed = await parseCsproj(csproj);
    expect(parsed.nullable).toBe('disable');
    expect(parsed.implicitUsings).toBe('enable');
  });

  it('parses .slnx format solutions', async () => {
    const projDir = path.join(tmpDir, 'Api');
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(
      path.join(projDir, 'Api.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n</Project>`,
      'utf-8',
    );
    const slnxPath = path.join(tmpDir, 'Modern.slnx');
    await fs.writeFile(slnxPath, `<Solution>\n  <Project Path="Api/Api.csproj" />\n</Solution>`, 'utf-8');

    const sln = await parseSolution(slnxPath);
    expect(sln.format).toBe('slnx');
    expect(sln.projects.length).toBe(1);
    expect(sln.projects[0].sdk).toBe('Microsoft.NET.Sdk.Web');
  });

  it('appends projects cleanly to existing .sln file', async () => {
    const slnPath = path.join(tmpDir, 'Demo.sln');
    const projA = path.join(tmpDir, 'A', 'A.csproj');
    const projB = path.join(tmpDir, 'B', 'B.csproj');
    await fs.mkdir(path.dirname(projA), { recursive: true });
    await fs.mkdir(path.dirname(projB), { recursive: true });
    await fs.writeFile(projA, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    await fs.writeFile(projB, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');

    await fs.writeFile(
      slnPath,
      createSlnContent([{ name: 'A', relPath: 'A/A.csproj', guid: generateGuid() }]),
      'utf-8',
    );
    await addProjectToSlnFile(slnPath, projB);
    const sln = await parseSolution(slnPath);
    expect(sln.projects.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('parses MSBuild error and warning diagnostics accurately', () => {
    const sample = [
      `  /Users/dev/App/Program.cs(12,9): error CS0103: The name 'x' does not exist in the current context [/Users/dev/App/App.csproj]`,
      `  /Users/dev/App/Helper.cs(4,1): warning CS0168: The variable 'y' is declared but never used [/Users/dev/App/App.csproj]`,
    ].join('\n');
    const diags = parseMsbuildDiagnostics(sample, '/Users/dev/App');
    expect(diags.length).toBe(2);
    expect(diags[0]).toMatchObject({
      severity: 'error',
      code: 'CS0103',
      project: 'App',
      line: 12,
      column: 9,
    });
    expect(diags[1]).toMatchObject({
      severity: 'warning',
      code: 'CS0168',
      line: 4,
      column: 1,
    });
  });
});
