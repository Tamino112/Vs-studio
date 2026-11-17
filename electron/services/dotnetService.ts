import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { XMLParser } from 'fast-xml-parser';
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: merged,
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
  };
  const dotnetRoot = resolveDotnetRoot(home);
  if (dotnetRoot) env.DOTNET_ROOT = dotnetRoot;
  else delete env.DOTNET_ROOT;
  return env;
}

/** Finds the real .NET install dir (official pkg, ~/.dotnet install script or Homebrew). */
function resolveDotnetRoot(home: string): string | null {
  if (process.env.DOTNET_ROOT && fsSync.existsSync(process.env.DOTNET_ROOT)) return process.env.DOTNET_ROOT;
  const candidates = [
    '/usr/local/share/dotnet',
    path.join(home, '.dotnet'),
    '/opt/homebrew/opt/dotnet/libexec',
    '/usr/local/opt/dotnet/libexec',
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(path.join(c, 'dotnet'))) return c;
  }
  return null;
}

// ---- Tracked dotnet child processes (build/clean/test/tool) so they can be killed on quit ----
const trackedProcs = new Set<ChildProcess>();

export function killAllDotnetProcesses(): void {
  for (const p of trackedProcs) {
    try {
      p.kill();
    } catch {
      // ignore
    }
  }
  trackedProcs.clear();
}

/**
 * Spawns a dotnet command, decodes stdout/stderr as UTF-8 streams (no broken umlauts at
 * chunk boundaries) and reports complete lines only (no lines split in two in Output).
 */
function spawnDotnetLines(
  bin: string,
  args: string[],
  opts: { cwd?: string; env: NodeJS.ProcessEnv },
  onLine: (line: string) => void,
  onClose: (code: number, output: string, error?: Error) => void,
): void {
  const proc = spawn(bin, args, { cwd: opts.cwd, env: opts.env });
  trackedProcs.add(proc);
  let output = '';
  const remainders = { out: '', err: '' };
  const make = (key: 'out' | 'err') => (text: string) => {
    output += text;
    const parts = (remainders[key] + text).split(/\r?\n/);
    remainders[key] = parts.pop() ?? '';
    for (const line of parts) if (line.length > 0) onLine(line);
  };
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', make('out'));
  proc.stderr.on('data', make('err'));
  let done = false;
  const finish = (code: number, err?: Error) => {
    if (done) return;
    done = true;
    trackedProcs.delete(proc);
    for (const key of ['out', 'err'] as const) {
      if (remainders[key].length > 0) onLine(remainders[key]);
      remainders[key] = '';
    }
    onClose(code, output, err);
  };
  proc.on('error', (err) => finish(1, err));
  proc.on('close', (code) => finish(code ?? 1));
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

  // Each step is tried separately so a failing "dotnet new sln" never overwrites a
  // project that "dotnet new <template>" already generated.
  try {
    const args = ['new', template, '-n', projectName, '-o', projectDir, '--framework', framework];
    if (useProgramMain && template === 'console') {
      args.push('--use-program-main');
    }
    await execFileAsync(dotnetBin, args, { env });
  } catch {
    // fallback below
  }
  if (!fsSync.existsSync(csprojPath)) {
    await scaffoldFallbackProject({ template, projectName, projectDir, framework, useProgramMain });
  }

  if (!fsSync.existsSync(slnPath)) {
    try {
      await execFileAsync(dotnetBin, ['new', 'sln', '-n', solutionName, '-o', solutionDir, '--format', 'sln'], { env });
    } catch {
      try {
        // SDKs before 9.0.200 do not know --format (and create .sln by default)
        await execFileAsync(dotnetBin, ['new', 'sln', '-n', solutionName, '-o', solutionDir], { env });
      } catch {
        // fallback below
      }
    }
  }
  let addedToSln = false;
  if (fsSync.existsSync(slnPath)) {
    try {
      await execFileAsync(dotnetBin, ['sln', slnPath, 'add', csprojPath], { env });
      addedToSln = true;
    } catch {
      try {
        await addProjectToSlnFile(slnPath, csprojPath);
        addedToSln = true;
      } catch {
        addedToSln = false;
      }
    }
  }
  if (!addedToSln) {
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
  try {
    const args = ['new', template, '-n', projectName, '-o', projectDir, '--framework', framework];
    if (useProgramMain && template === 'console') args.push('--use-program-main');
    await execFileAsync(dotnetBin, args, { env });
  } catch {
    // fallback below
  }
  if (!fsSync.existsSync(csprojPath)) {
    await scaffoldFallbackProject({ template, projectName, projectDir, framework, useProgramMain });
  }
  if (slnPath.endsWith('.sln') || slnPath.endsWith('.slnx')) {
    try {
      await execFileAsync(dotnetBin, ['sln', slnPath, 'add', csprojPath], { env });
    } catch {
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
    // MSBuild convention (what "dotnet add reference" writes): backslash separators
    const rel = path.relative(path.dirname(sourceCsproj), targetCsproj).replace(/\//g, '\\');
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
    const relWin = path.relative(path.dirname(sourceCsproj), targetCsproj).replace(/\//g, '\\');
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
      spawnDotnetLines(dotnetBin, args, { cwd: targetDir, env }, params.onOutput, (code, output, err) => {
        if (err) {
          const msg = `Failed to execute dotnet: ${err.message}`;
          params.onOutput(msg);
          resolve({ code: 1, output: msg });
          return;
        }
        resolve({ code, output });
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
    spawnDotnetLines(
      dotnetBin,
      ['clean', params.targetPath, '-c', params.configuration],
      { cwd: targetDir, env },
      params.onOutput,
      (code, _out, err) => resolve({ success: !err && code === 0 }),
    );
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

  const resultsDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'vs-testresults-'));
  return new Promise((resolve) => {
    params.onOutput(`========== Starting test run: ${path.basename(params.targetPath)} ==========`);
    spawnDotnetLines(
      dotnetBin,
      [
        'test',
        params.targetPath,
        '-c',
        params.configuration,
        '--verbosity',
        'normal',
        '--logger',
        'trx',
        '--results-directory',
        resultsDir,
      ],
      { cwd: targetDir, env },
      params.onOutput,
      (code, output, err) => {
        if (err) {
          params.onOutput(`Test run failed: ${err.message}`);
          fsSync.rmSync(resultsDir, { recursive: true, force: true });
          resolve({ success: false, tests: [] });
          return;
        }
        let tests: TestCaseResult[] = [];
        try {
          const trxFiles = fsSync.readdirSync(resultsDir).filter((f) => f.endsWith('.trx'));
          for (const f of trxFiles) {
            tests.push(...parseTrx(fsSync.readFileSync(path.join(resultsDir, f), 'utf-8')));
          }
        } catch {
          tests = [];
        }
        if (tests.length === 0) {
          tests = parseTestConsoleOutput(output, path.basename(params.targetPath, path.extname(params.targetPath)));
        }
        fsSync.rmSync(resultsDir, { recursive: true, force: true });
        const summary = {
          passed: tests.filter((t) => t.status === 'passed').length,
          failed: tests.filter((t) => t.status === 'failed').length,
          skipped: tests.filter((t) => t.status === 'skipped').length,
        };
        params.onOutput(
          `========== Test run finished: ${tests.length} Tests (${summary.passed} Passed, ${summary.failed} Failed, ${summary.skipped} Skipped) ==========`,
        );
        resolve({ success: code === 0, tests });
      },
    );
  });
}

/** "00:00:01.2345678" -> 1234 ms */
function parseTrxDuration(d: string | undefined): number | undefined {
  if (!d) return undefined;
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(d.trim());
  if (!m) return undefined;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

/** Parses a Visual Studio TRX result file (what VS Test Explorer itself uses). */
export function parseTrx(xml: string): TestCaseResult[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: (name) =>
    ['UnitTestResult', 'UnitTest'].includes(name) });
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const run = doc?.TestRun;
  if (!run) return [];
  const defs = new Map<string, { className: string; name: string; storage: string }>();
  for (const ut of run.TestDefinitions?.UnitTest ?? []) {
    defs.set(String(ut['@id']), {
      className: String(ut.TestMethod?.['@className'] ?? ''),
      name: String(ut.TestMethod?.['@name'] ?? ut['@name'] ?? ''),
      storage: String(ut['@storage'] ?? ''),
    });
  }
  const results: TestCaseResult[] = [];
  for (const r of run.Results?.UnitTestResult ?? []) {
    const def = defs.get(String(r['@testId']));
    const testName = String(r['@testName'] ?? def?.name ?? 'Test');
    const outcome = String(r['@outcome'] ?? '').toLowerCase();
    const className = def?.className ?? '';
    // Theory/TestCase display names already contain the class name in xUnit – strip it for the tree
    let name = testName;
    if (className && name.startsWith(className + '.')) name = name.slice(className.length + 1);
    const storage = def?.storage ?? '';
    const project = storage ? path.basename(storage).replace(/\.dll$/i, '') : 'Tests';
    const errInfo = r.Output?.ErrorInfo;
    results.push({
      id: `${project}:${className}.${testName}`,
      name,
      suite: className || 'Tests',
      project,
      status: outcome === 'passed' ? 'passed' : outcome === 'failed' || outcome === 'error' || outcome === 'timeout' ? 'failed' : 'skipped',
      durationMs: parseTrxDuration(r['@duration']),
      errorMessage: errInfo?.Message !== undefined ? String(errInfo.Message) : undefined,
      stackTrace: errInfo?.StackTrace !== undefined ? String(errInfo.StackTrace) : undefined,
    });
  }
  return results;
}

/** Fallback parser for console output when no TRX file was produced. */
export function parseTestConsoleOutput(output: string, project: string): TestCaseResult[] {
  const tests: TestCaseResult[] = [];
  // e.g. "  Passed MyTests.CalcTests.Add [3 ms]" / "  Failed MyTests.T(x: 1) [1 s]"
  const lineRegex = /^\s*(Passed|Failed|Skipped)\s+(.+?)\s+\[([^\]]+)\]\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(output)) !== null) {
    const statusRaw = m[1].toLowerCase();
    const fullName = m[2].trim();
    // Split namespace/class from method, ignoring dots inside a parameter list
    const parenIdx = fullName.indexOf('(');
    const head = parenIdx === -1 ? fullName : fullName.slice(0, parenIdx);
    const lastDot = head.lastIndexOf('.');
    const methodName = lastDot === -1 ? fullName : fullName.slice(lastDot + 1);
    const suiteName = lastDot === -1 ? 'Tests' : head.slice(0, lastDot);
    const dur = m[3];
    let durationMs: number | undefined;
    const ms = /([\d.]+)\s*ms/.exec(dur);
    const sec = /([\d.]+)\s*s\b/.exec(dur);
    const min = /(\d+)\s*m\b/.exec(dur);
    if (ms) durationMs = Number(ms[1]);
    else if (sec || min) durationMs = Math.round(((min ? Number(min[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0)) * 1000);
    tests.push({
      id: fullName,
      name: methodName,
      suite: suiteName,
      project,
      status: statusRaw === 'passed' ? 'passed' : statusRaw === 'failed' ? 'failed' : 'skipped',
      durationMs,
    });
  }
  return tests;
}

export async function installCsharpLs(onOutput: (line: string) => void): Promise<boolean> {
  const env = getAugmentedEnv();
  const dotnetBin = await getDotnetBin();
  return new Promise((resolve) => {
    onOutput('Installing csharp-ls global tool via dotnet...');
    spawnDotnetLines(dotnetBin, ['tool', 'install', '--global', 'csharp-ls'], { env }, onOutput, (code, _o, err) =>
      resolve(!err && code === 0),
    );
  });
}
