import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  addProjectToSlnFile,
  createSlnContent,
  generateGuid,
  parseMsbuildDiagnostics,
  DiagnosticItem,
} from './solutionService';

const execFileAsync = promisify(execFile);

export interface EnvironmentStatus {
  dotnetInstalled: boolean;
  dotnetVersion: string | null;
  dotnetSdks: string[];
  hasNet10: boolean;
  csharpLsInstalled: boolean;
  csharpLsPath: string | null;
  netcoredbgInstalled: boolean;
  netcoredbgPath: string | null;
  gitInstalled: boolean;
  platform: string;
}

export interface DotnetTemplate {
  shortName: string;
  name: string;
  description: string;
  language: string;
  tags: string[];
  category: 'Console' | 'Web' | 'Library' | 'Test' | 'Desktop' | 'Worker';
  supportsTopLevelStatements?: boolean;
}

export interface TestCaseResult {
  id: string;
  name: string;
  suite: string;
  project: string;
  status: 'passed' | 'failed' | 'skipped' | 'notrun' | 'running';
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
}

export function getAugmentedEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extraPaths = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/share/dotnet',
    path.join(home, '.dotnet'),
    path.join(home, '.dotnet', 'tools'),
  ];
  const currentPath = process.env.PATH || '';
  const merged = [...extraPaths, ...currentPath.split(path.delimiter)]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(path.delimiter);
  return {
    ...process.env,
    PATH: merged,
    DOTNET_ROOT: process.env.DOTNET_ROOT || (fsSync.existsSync('/usr/local/share/dotnet') ? '/usr/local/share/dotnet' : path.join(home, '.dotnet')),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
  };
}

async function resolveExecutable(name: string, candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  try {
    const { stdout } = await execFileAsync('which', [name], { env: getAugmentedEnv() });
    const p = stdout.trim().split('\n')[0];
    return p || null;
  } catch {
    return null;
  }
}

export async function getDotnetBin(): Promise<string> {
  const home = os.homedir();
  const found = await resolveExecutable('dotnet', [
    '/usr/local/share/dotnet/dotnet',
    '/opt/homebrew/bin/dotnet',
    path.join(home, '.dotnet', 'dotnet'),
    '/usr/bin/dotnet',
  ]);
  return found || 'dotnet';
}

export async function detectEnvironment(): Promise<EnvironmentStatus> {
  const home = os.homedir();
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();

  let dotnetInstalled = false;
  let dotnetVersion: string | null = null;
  let dotnetSdks: string[] = [];

  try {
    const { stdout } = await execFileAsync(dotnetBin, ['--version'], { env });
    dotnetVersion = stdout.trim();
    dotnetInstalled = Boolean(dotnetVersion);
    const sdksRes = await execFileAsync(dotnetBin, ['--list-sdks'], { env });
    dotnetSdks = sdksRes.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    dotnetInstalled = false;
  }

  const hasNet10 =
    (dotnetVersion?.startsWith('10.') ?? false) ||
    dotnetSdks.some((s) => s.startsWith('10.'));

  const csharpLsPath = await resolveExecutable('csharp-ls', [
    path.join(home, '.dotnet', 'tools', 'csharp-ls'),
    '/opt/homebrew/bin/csharp-ls',
    '/usr/local/bin/csharp-ls',
  ]);

  const netcoredbgPath = await resolveExecutable('netcoredbg', [
    '/opt/homebrew/bin/netcoredbg',
    '/usr/local/bin/netcoredbg',
    path.join(home, '.dotnet', 'tools', 'netcoredbg'),
  ]);

  const gitPath = await resolveExecutable('git', ['/opt/homebrew/bin/git', '/usr/bin/git']);

  return {
    dotnetInstalled,
    dotnetVersion,
    dotnetSdks,
    hasNet10,
    csharpLsInstalled: Boolean(csharpLsPath),
    csharpLsPath,
    netcoredbgInstalled: Boolean(netcoredbgPath),
    netcoredbgPath,
    gitInstalled: Boolean(gitPath),
    platform: process.platform,
  };
}

export const DOTNET_TEMPLATES: DotnetTemplate[] = [
  {
    shortName: 'console',
    name: 'Console App',
    description: 'A project for creating a command-line application that can run on .NET 10 on macOS, Linux, and Windows.',
    language: 'C#',
    tags: ['C#', 'macOS', 'Linux', 'Windows', 'Console'],
    category: 'Console',
    supportsTopLevelStatements: true,
  },
  {
    shortName: 'classlib',
    name: 'Class Library',
    description: 'A project for creating a class library that targets .NET 10 or .NET Standard.',
    language: 'C#',
    tags: ['C#', 'Library', 'Cross-platform'],
    category: 'Library',
  },
  {
    shortName: 'webapi',
    name: 'ASP.NET Core Web API',
    description: 'A project template for creating a RESTful HTTP service using ASP.NET Core Controllers or Minimal APIs on .NET 10.',
    language: 'C#',
    tags: ['C#', 'Web', 'API', 'Cloud'],
    category: 'Web',
  },
  {
    shortName: 'blazor',
    name: 'Blazor Web App',
    description: 'A project template for creating a Blazor web app that supports both server-side rendering and client interactivity.',
    language: 'C#',
    tags: ['C#', 'Web', 'Blazor', 'Razor'],
    category: 'Web',
  },
  {
    shortName: 'webapp',
    name: 'ASP.NET Core Web App (Razor Pages)',
    description: 'A project template for creating an ASP.NET Core application with example ASP.NET Razor Pages content.',
    language: 'C#',
    tags: ['C#', 'Web', 'Razor'],
    category: 'Web',
  },
  {
    shortName: 'mvc',
    name: 'ASP.NET Core Web App (Model-View-Controller)',
    description: 'A project template for creating an ASP.NET Core application with example MVC Views and Controllers.',
    language: 'C#',
    tags: ['C#', 'Web', 'MVC'],
    category: 'Web',
  },
  {
    shortName: 'xunit',
    name: 'xUnit Test Project',
    description: 'A project that contains xUnit.net tests that can run on .NET 10.',
    language: 'C#',
    tags: ['C#', 'Test', 'xUnit'],
    category: 'Test',
  },
  {
    shortName: 'nunit',
    name: 'NUnit Test Project',
    description: 'A project that contains NUnit tests that can run on .NET 10.',
    language: 'C#',
    tags: ['C#', 'Test', 'NUnit'],
    category: 'Test',
  },
  {
    shortName: 'mstest',
    name: 'MSTest Test Project',
    description: 'A project that contains MSTest unit tests that can run on .NET 10.',
    language: 'C#',
    tags: ['C#', 'Test', 'MSTest'],
    category: 'Test',
  },
  {
    shortName: 'worker',
    name: 'Worker Service',
    description: 'An empty project template for creating a long-running background worker service.',
    language: 'C#',
    tags: ['C#', 'Service', 'Worker'],
    category: 'Worker',
  },
  {
    shortName: 'grpc',
    name: 'ASP.NET Core gRPC Service',
    description: 'A project template for creating a gRPC service using ASP.NET Core on .NET 10.',
    language: 'C#',
    tags: ['C#', 'Web', 'gRPC'],
    category: 'Web',
  },
];

async function scaffoldFallbackProject(params: {
  template: string;
  projectName: string;
  projectDir: string;
  framework: string;
  useProgramMain?: boolean;
}): Promise<string> {
  const { template, projectName, projectDir, framework, useProgramMain } = params;
  await fs.mkdir(projectDir, { recursive: true });
  const csprojPath = path.join(projectDir, `${projectName}.csproj`);

  const isWeb = ['webapi', 'blazor', 'webapp', 'mvc', 'grpc'].includes(template);
  const isLib = template === 'classlib';
  const isTest = ['xunit', 'nunit', 'mstest'].includes(template);

  const sdk = isWeb ? 'Microsoft.NET.Sdk.Web' : 'Microsoft.NET.Sdk';
  const outputTypeLine = !isWeb && !isLib && !isTest ? '    <OutputType>Exe</OutputType>\n' : '';
  const rootNamespace = projectName.replace(/[^a-zA-Z0-9_]/g, '_');

  let extraItems = '';
  if (template === 'xunit') {
    extraItems = `
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.13.0" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.0.2" />
  </ItemGroup>`;
  } else if (template === 'nunit') {
    extraItems = `
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.13.0" />
    <PackageReference Include="NUnit" Version="4.3.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="5.0.0" />
  </ItemGroup>`;
  } else if (template === 'mstest') {
    extraItems = `
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.13.0" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.8.0" />
    <PackageReference Include="MSTest.TestFramework" Version="3.8.0" />
  </ItemGroup>`;
  }

  const csprojXml = `<Project Sdk="${sdk}">

  <PropertyGroup>
${outputTypeLine}    <TargetFramework>${framework}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>${extraItems}

</Project>
`;
  await fs.writeFile(csprojPath, csprojXml, 'utf-8');

  if (isLib) {
    await fs.writeFile(
      path.join(projectDir, 'Class1.cs'),
      `namespace ${rootNamespace};\n\npublic class Class1\n{\n    public string GetGreeting(string name) => $"Hello, {name} from ${rootNamespace}!";\n}\n`,
      'utf-8',
    );
  } else if (isTest) {
    await fs.writeFile(
      path.join(projectDir, 'UnitTest1.cs'),
      template === 'xunit'
        ? `namespace ${rootNamespace};\n\npublic class UnitTest1\n{\n    [Fact]\n    public void Test1()\n    {\n        Assert.True(true);\n    }\n}\n`
        : `namespace ${rootNamespace};\n\npublic class Tests\n{\n    [Test]\n    public void Test1()\n    {\n        Assert.Pass();\n    }\n}\n`,
      'utf-8',
    );
  } else if (isWeb) {
    await fs.writeFile(
      path.join(projectDir, 'Program.cs'),
      `var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\n\napp.MapGet("/", () => "Hello from ${projectName} (.NET 10)!");\n\napp.Run();\n`,
      'utf-8',
    );
  } else if (useProgramMain) {
    await fs.writeFile(
      path.join(projectDir, 'Program.cs'),
      `namespace ${rootNamespace}\n{\n    internal class Program\n    {\n        static void Main(string[] args)\n        {\n            Console.WriteLine("Hello, World!");\n        }\n    }\n}\n`,
      'utf-8',
    );
  } else {
    await fs.writeFile(
      path.join(projectDir, 'Program.cs'),
      `// See https://aka.ms/new-console-template for more information\nConsole.WriteLine("Hello, World!");\n`,
      'utf-8',
    );
  }

  return csprojPath;
}

export async function createSolutionWithProject(params: {
  template: string;
  projectName: string;
  solutionName: string;
  location: string;
  sameDirectory: boolean;
  framework: string;
  useProgramMain?: boolean;
}): Promise<{ slnPath: string; csprojPath: string }> {
  const { template, projectName, solutionName, location, sameDirectory, framework, useProgramMain } = params;
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();

  const solutionDir = sameDirectory
    ? path.join(location, projectName)
    : path.join(location, solutionName);
  const projectDir = sameDirectory
    ? solutionDir
    : path.join(solutionDir, projectName);

  await fs.mkdir(solutionDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });

  const slnPath = path.join(solutionDir, `${solutionName}.sln`);
  const csprojPath = path.join(projectDir, `${projectName}.csproj`);

  let createdViaCli = false;
  try {
    const args = ['new', template, '-n', projectName, '-o', projectDir, '--framework', framework];
    if (useProgramMain && template === 'console') {
      args.push('--use-program-main');
    }
    await execFileAsync(dotnetBin, args, { env });
    if (!fsSync.existsSync(slnPath)) {
      await execFileAsync(dotnetBin, ['new', 'sln', '-n', solutionName, '-o', solutionDir, '--format', 'sln'], { env });
    }
    await execFileAsync(dotnetBin, ['sln', slnPath, 'add', csprojPath], { env });
    createdViaCli = fsSync.existsSync(csprojPath) && fsSync.existsSync(slnPath);
  } catch {
    createdViaCli = false;
  }

  if (!createdViaCli) {
    await scaffoldFallbackProject({ template, projectName, projectDir, framework, useProgramMain });
    const rel = path.relative(solutionDir, csprojPath);
    const slnContent = createSlnContent([{ name: projectName, relPath: rel, guid: generateGuid() }]);
    await fs.writeFile(slnPath, slnContent, 'utf-8');
  }

  return { slnPath, csprojPath };
}

export async function addNewProjectToSolution(params: {
  slnPath: string;
  template: string;
  projectName: string;
  framework: string;
  useProgramMain?: boolean;
}): Promise<string> {
  const { slnPath, template, projectName, framework, useProgramMain } = params;
  const slnDir = path.dirname(slnPath);
  const projectDir = path.join(slnDir, projectName);
  const csprojPath = path.join(projectDir, `${projectName}.csproj`);

  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  let createdViaCli = false;

  try {
    const args = ['new', template, '-n', projectName, '-o', projectDir, '--framework', framework];
    if (useProgramMain && template === 'console') args.push('--use-program-main');
    await execFileAsync(dotnetBin, args, { env });
    if (slnPath.endsWith('.sln') || slnPath.endsWith('.slnx')) {
      await execFileAsync(dotnetBin, ['sln', slnPath, 'add', csprojPath], { env });
    }
    createdViaCli = fsSync.existsSync(csprojPath);
  } catch {
    createdViaCli = false;
  }

  if (!createdViaCli) {
    await scaffoldFallbackProject({ template, projectName, projectDir, framework, useProgramMain });
    if (slnPath.endsWith('.sln') || slnPath.endsWith('.slnx')) {
      await addProjectToSlnFile(slnPath, csprojPath);
    }
  }

  return csprojPath;
}

export async function addExistingProjectToSolution(slnPath: string, csprojPath: string): Promise<void> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  try {
    await execFileAsync(dotnetBin, ['sln', slnPath, 'add', csprojPath], { env });
  } catch {
    await addProjectToSlnFile(slnPath, csprojPath);
  }
}

export async function addProjectReference(sourceCsproj: string, targetCsproj: string): Promise<void> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  try {
    await execFileAsync(dotnetBin, ['add', sourceCsproj, 'reference', targetCsproj], { env });
  } catch {
    const rel = path.relative(path.dirname(sourceCsproj), targetCsproj).replace(/\\/g, '\\');
    let xml = await fs.readFile(sourceCsproj, 'utf-8');
    if (xml.includes(rel)) return;
    const refTag = `  <ItemGroup>\n    <ProjectReference Include="${rel}" />\n  </ItemGroup>\n`;
    xml = xml.replace('</Project>', `${refTag}</Project>`);
    await fs.writeFile(sourceCsproj, xml, 'utf-8');
  }
}

export async function removeProjectReference(sourceCsproj: string, targetCsproj: string): Promise<void> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  try {
    await execFileAsync(dotnetBin, ['remove', sourceCsproj, 'reference', targetCsproj], { env });
  } catch {
    const relWin = path.relative(path.dirname(sourceCsproj), targetCsproj).replace(/\\/g, '\\');
    const relUnix = path.relative(path.dirname(sourceCsproj), targetCsproj).replace(/\\/g, '/');
    let xml = await fs.readFile(sourceCsproj, 'utf-8');
    xml = xml.replace(new RegExp(`\\s*<ProjectReference\\s+Include="(?:${escapeRegex(relWin)}|${escapeRegex(relUnix)})"\\s*/>`, 'g'), '');
    await fs.writeFile(sourceCsproj, xml, 'utf-8');
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function runDotnetBuild(params: {
  targetPath: string;
  configuration: string;
  cleanFirst?: boolean;
  noIncremental?: boolean;
  onOutput: (line: string) => void;
}): Promise<{ success: boolean; exitCode: number; diagnostics: DiagnosticItem[]; rawOutput: string }> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  const targetDir = fsSync.statSync(params.targetPath).isDirectory()
    ? params.targetPath
    : path.dirname(params.targetPath);

  const runCmd = (args: string[]) =>
    new Promise<{ code: number; output: string }>((resolve) => {
      const proc = spawn(dotnetBin, args, { cwd: targetDir, env });
      let combined = '';
      const handleChunk = (buf: Buffer) => {
        const text = buf.toString('utf-8');
        combined += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) params.onOutput(line);
        }
      };
      proc.stdout.on('data', handleChunk);
      proc.stderr.on('data', handleChunk);
      proc.on('error', (err) => {
        const msg = `Failed to execute dotnet: ${err.message}`;
        params.onOutput(msg);
        resolve({ code: 1, output: msg });
      });
      proc.on('close', (code) => {
        resolve({ code: code ?? 1, output: combined });
      });
    });

  let fullOutput = '';
  if (params.cleanFirst) {
    params.onOutput(`------ Clean started: ${path.basename(params.targetPath)}, Configuration: ${params.configuration} ------`);
    const cleanRes = await runCmd(['clean', params.targetPath, '-c', params.configuration]);
    fullOutput += cleanRes.output + '\n';
  }

  params.onOutput(
    `------ ${params.noIncremental ? 'Rebuild All' : 'Build'} started: ${path.basename(params.targetPath)}, Configuration: ${params.configuration} ------`,
  );
  const args = ['build', params.targetPath, '-c', params.configuration];
  if (params.noIncremental) args.push('--no-incremental');

  const res = await runCmd(args);
  fullOutput += res.output;
  const diagnostics = parseMsbuildDiagnostics(fullOutput, targetDir);

  return {
    success: res.code === 0,
    exitCode: res.code,
    diagnostics,
    rawOutput: fullOutput,
  };
}

export async function runDotnetClean(params: {
  targetPath: string;
  configuration: string;
  onOutput: (line: string) => void;
}): Promise<{ success: boolean }> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  const targetDir = path.dirname(params.targetPath);
  return new Promise((resolve) => {
    params.onOutput(`------ Clean started: ${path.basename(params.targetPath)}, Configuration: ${params.configuration} ------`);
    const proc = spawn(dotnetBin, ['clean', params.targetPath, '-c', params.configuration], {
      cwd: targetDir,
      env,
    });
    const handle = (buf: Buffer) => {
      for (const line of buf.toString('utf-8').split(/\r?\n/)) {
        if (line) params.onOutput(line);
      }
    };
    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);
    proc.on('close', (code) => resolve({ success: code === 0 }));
    proc.on('error', () => resolve({ success: false }));
  });
}

export async function runDotnetTest(params: {
  targetPath: string;
  configuration: string;
  onOutput: (line: string) => void;
}): Promise<{ success: boolean; tests: TestCaseResult[] }> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  const targetDir = fsSync.statSync(params.targetPath).isDirectory()
    ? params.targetPath
    : path.dirname(params.targetPath);

  return new Promise((resolve) => {
    params.onOutput(`========== Starting test run: ${path.basename(params.targetPath)} ==========`);
    const proc = spawn(
      dotnetBin,
      ['test', params.targetPath, '-c', params.configuration, '--verbosity', 'normal'],
      { cwd: targetDir, env },
    );
    let output = '';
    const handle = (buf: Buffer) => {
      const txt = buf.toString('utf-8');
      output += txt;
      for (const line of txt.split(/\r?\n/)) {
        if (line) params.onOutput(line);
      }
    };
    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);
    proc.on('close', (code) => {
      const tests: TestCaseResult[] = [];
      const lineRegex = /^\s*(Passed|Failed|Skipped)\s+([^\s\[]+)(?:\s+\[([^\]]+)\])?/gim;
      let m: RegExpExecArray | null;
      while ((m = lineRegex.exec(output)) !== null) {
        const statusRaw = m[1].toLowerCase();
        const fullName = m[2];
        const parts = fullName.split('.');
        const methodName = parts[parts.length - 1] || fullName;
        const suiteName = parts.slice(0, -1).join('.') || 'Tests';
        const durationMatch = m[3]?.match(/(\d+)\s*ms/);
        tests.push({
          id: fullName,
          name: methodName,
          suite: suiteName,
          project: path.basename(params.targetPath, path.extname(params.targetPath)),
          status:
            statusRaw === 'passed'
              ? 'passed'
              : statusRaw === 'failed'
              ? 'failed'
              : 'skipped',
          durationMs: durationMatch ? Number(durationMatch[1]) : undefined,
        });
      }
      resolve({ success: code === 0, tests });
    });
    proc.on('error', (err) => {
      params.onOutput(`Test run failed: ${err.message}`);
      resolve({ success: false, tests: [] });
    });
  });
}

export async function installCsharpLs(onOutput: (line: string) => void): Promise<boolean> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  return new Promise((resolve) => {
    onOutput('Installing csharp-ls global tool via dotnet...');
    const proc = spawn(dotnetBin, ['tool', 'install', '--global', 'csharp-ls'], { env });
    const handle = (buf: Buffer) => {
      for (const l of buf.toString('utf-8').split(/\r?\n/)) {
        if (l) onOutput(l);
      }
    };
    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
