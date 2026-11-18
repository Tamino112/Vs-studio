import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export interface ProjectPackageRef {
  id: string;
  version: string;
}

export interface ProjectReference {
  name: string;
  path: string;
}

export interface CsProjectInfo {
  id: string;
  name: string;
  path: string;
  dir: string;
  sdk: string;
  outputType: string;
  targetFramework: string;
  nullable: string;
  implicitUsings: string;
  packages: ProjectPackageRef[];
  projectReferences: ProjectReference[];
  rawXml?: string;
}

export interface SolutionFolder {
  id: string;
  name: string;
  projectIds: string[];
}

export interface SolutionInfo {
  name: string;
  path: string;
  dir: string;
  format: 'sln' | 'slnx' | 'csproj' | 'folder';
  projects: CsProjectInfo[];
  folders: SolutionFolder[];
  startupProjectId: string | null;
  configurations: string[];
  platforms: string[];
}

export interface DiagnosticItem {
  id: string;
  severity: 'error' | 'warning' | 'message';
  code: string;
  description: string;
  project: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  source: 'Build' | 'IntelliSense';
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (tagName) =>
    tagName === 'PropertyGroup' ||
    tagName === 'ItemGroup' ||
    tagName === 'PackageReference' ||
    tagName === 'ProjectReference' ||
    tagName === 'Folder',
});

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export function generateGuid(): string {
  return crypto.randomUUID().toUpperCase();
}

export async function parseCsproj(csprojPath: string, explicitId?: string): Promise<CsProjectInfo> {
  const absPath = path.resolve(csprojPath);
  const rawXml = await fs.readFile(absPath, 'utf-8');
  const parsed = xmlParser.parse(rawXml);
  const projNode = parsed?.Project ?? {};
  const sdk = projNode['@_Sdk'] || 'Microsoft.NET.Sdk';

  let outputType = sdk.includes('.Web') ? 'Exe' : 'Library';
  let targetFramework = 'net10.0';
  let nullable = 'enable';
  let implicitUsings = 'enable';

  for (const pg of toArray<Record<string, unknown>>(projNode.PropertyGroup)) {
    if (pg.OutputType) outputType = String(pg.OutputType);
    if (pg.TargetFramework) targetFramework = String(pg.TargetFramework);
    else if (pg.TargetFrameworks) targetFramework = String(pg.TargetFrameworks).split(';')[0];
    if (pg.Nullable !== undefined) nullable = String(pg.Nullable);
    if (pg.ImplicitUsings !== undefined) implicitUsings = String(pg.ImplicitUsings);
  }

  const packages: ProjectPackageRef[] = [];
  const projectReferences: ProjectReference[] = [];

  for (const ig of toArray<Record<string, unknown>>(projNode.ItemGroup)) {
    for (const pkg of toArray<Record<string, unknown>>(ig.PackageReference as Record<string, unknown>[])) {
      const id = String(pkg['@_Include'] || pkg['@_Update'] || '');
      const version = String(pkg['@_Version'] || pkg.Version || '*');
      if (id) packages.push({ id, version });
    }
    for (const pr of toArray<Record<string, unknown>>(ig.ProjectReference as Record<string, unknown>[])) {
      const relInclude = String(pr['@_Include'] || '');
      if (relInclude) {
        const normalized = relInclude.replace(/\\/g, '/');
        const resolved = path.resolve(path.dirname(absPath), normalized);
        projectReferences.push({
          name: path.basename(resolved, path.extname(resolved)),
          path: resolved,
        });
      }
    }
  }

  const name = path.basename(absPath, path.extname(absPath));
  return {
    id: explicitId || absPath,
    name,
    path: absPath,
    dir: path.dirname(absPath),
    sdk,
    outputType,
    targetFramework,
    nullable,
    implicitUsings,
    packages,
    projectReferences,
    rawXml,
  };
}

export async function updateCsprojProperty(
  csprojPath: string,
  property: 'TargetFramework' | 'OutputType' | 'Nullable' | 'ImplicitUsings',
  value: string,
): Promise<void> {
  let content = await fs.readFile(csprojPath, 'utf-8');
  const tagRegex = new RegExp(`<${property}>[\\s\\S]*?<\\/${property}>`, 'i');
  if (tagRegex.test(content)) {
    content = content.replace(tagRegex, `<${property}>${value}</${property}>`);
  } else {
    content = content.replace(
      /<PropertyGroup>/i,
      `<PropertyGroup>\n    <${property}>${value}</${property}>`,
    );
  }
  await fs.writeFile(csprojPath, content, 'utf-8');
}

export async function parseSolution(targetPath: string): Promise<SolutionInfo> {
  const absPath = path.resolve(targetPath);
  const stat = await fs.stat(absPath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(absPath);
    const slnFile = entries.find((e) => {
      const l = e.toLowerCase();
      return l.endsWith('.sln') || l.endsWith('.slnx');
    });
    if (slnFile) {
      return parseSolution(path.join(absPath, slnFile));
    }
    const csprojFiles = entries.filter((e) => e.toLowerCase().endsWith('.csproj'));
    const projects: CsProjectInfo[] = [];
    for (const file of csprojFiles) {
      projects.push(await parseCsproj(path.join(absPath, file)));
    }
    return {
      name: path.basename(absPath),
      path: absPath,
      dir: absPath,
      format: 'folder',
      projects,
      folders: [],
      startupProjectId:
        projects.find((p) => {
          const ot = p.outputType.toLowerCase();
          return ot === 'exe' || ot === 'winexe' || p.sdk.includes('.Web');
        })?.id ??
        projects[0]?.id ??
        null,
      configurations: ['Debug', 'Release'],
      platforms: ['Any CPU', 'arm64', 'x64'],
    };
  }

  if (absPath.toLowerCase().endsWith('.csproj')) {
    const proj = await parseCsproj(absPath);
    return {
      name: proj.name,
      path: absPath,
      dir: path.dirname(absPath),
      format: 'csproj',
      projects: [proj],
      folders: [],
      startupProjectId: proj.id,
      configurations: ['Debug', 'Release'],
      platforms: ['Any CPU', 'arm64', 'x64'],
    };
  }

  if (absPath.toLowerCase().endsWith('.slnx')) {
    const raw = await fs.readFile(absPath, 'utf-8');
    const parsed = xmlParser.parse(raw);
    const slnDir = path.dirname(absPath);
    const projects: CsProjectInfo[] = [];
    const folders: SolutionFolder[] = [];

    const collectProjects = async (projNodes: unknown[], folderId?: string) => {
      for (const node of toArray<Record<string, unknown>>(projNodes as Record<string, unknown>[])) {
        const rel = String(node['@_Path'] || '').replace(/\\/g, '/');
        if (rel.toLowerCase().endsWith('.csproj')) {
          const full = path.resolve(slnDir, rel);
          if (fsSync.existsSync(full)) {
            const info = await parseCsproj(full);
            projects.push(info);
            if (folderId) {
              const f = folders.find((x) => x.id === folderId);
              if (f) f.projectIds.push(info.id);
            }
          }
        }
      }
    };

    const solNode = parsed?.Solution ?? {};
    await collectProjects(toArray(solNode.Project));
    for (const fNode of toArray<Record<string, unknown>>(solNode.Folder)) {
      const name = String(fNode['@_Name'] || 'Folder');
      const id = `folder:${name}`;
      folders.push({ id, name, projectIds: [] });
      await collectProjects(toArray(fNode.Project), id);
    }

    return {
      name: path.basename(absPath, '.slnx'),
      path: absPath,
      dir: slnDir,
      format: 'slnx',
      projects,
      folders,
      startupProjectId:
        projects.find((p) => {
          const ot = p.outputType.toLowerCase();
          return ot === 'exe' || ot === 'winexe' || p.sdk.includes('.Web');
        })?.id ??
        projects[0]?.id ??
        null,
      configurations: ['Debug', 'Release'],
      platforms: ['Any CPU', 'arm64', 'x64'],
    };
  }

  // Classic .sln format
  const raw = await fs.readFile(absPath, 'utf-8');
  const slnDir = path.dirname(absPath);
  const projectRegex =
    /Project\("\{([A-F0-9-]+)\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([A-F0-9-]+)\}"/gi;
  const SOLUTION_FOLDER_TYPE = '2150E333-8FDC-42A3-9474-1A3956D46DE8';

  const projects: CsProjectInfo[] = [];
  const folders: SolutionFolder[] = [];

  let match: RegExpExecArray | null;
  while ((match = projectRegex.exec(raw)) !== null) {
    const typeGuid = match[1].toUpperCase();
    const projName = match[2];
    const relPath = match[3].replace(/\\/g, '/');
    const projGuid = match[4].toUpperCase();

    if (typeGuid === SOLUTION_FOLDER_TYPE) {
      folders.push({ id: projGuid, name: projName, projectIds: [] });
    } else if (relPath.toLowerCase().endsWith('.csproj')) {
      const fullPath = path.resolve(slnDir, relPath);
      if (fsSync.existsSync(fullPath)) {
        const info = await parseCsproj(fullPath, projGuid);
        projects.push(info);
      }
    }
  }

  // Parse NestedProjects if present
  const nestedMatch = raw.match(/GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/i);
  if (nestedMatch) {
    const lineRegex = /\{([A-F0-9-]+)\}\s*=\s*\{([A-F0-9-]+)\}/gi;
    let nm: RegExpExecArray | null;
    while ((nm = lineRegex.exec(nestedMatch[1])) !== null) {
      const childId = nm[1].toUpperCase();
      const parentId = nm[2].toUpperCase();
      const folder = folders.find((f) => f.id === parentId);
      if (folder) folder.projectIds.push(childId);
    }
  }

  return {
    name: path.basename(absPath, '.sln'),
    path: absPath,
    dir: slnDir,
    format: 'sln',
    projects,
    folders,
    startupProjectId:
      projects.find((p) => {
        const ot = p.outputType.toLowerCase();
        return ot === 'exe' || ot === 'winexe' || p.sdk.includes('.Web');
      })?.id ??
      projects[0]?.id ??
      null,
    configurations: ['Debug', 'Release'],
    platforms: ['Any CPU', 'arm64', 'x64'],
  };
}

export function createSlnContent(
  projects: Array<{ name: string; relPath: string; guid: string }>,
): string {
  const CSHARP_SDK_TYPE = 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC';
  const slnGuid = generateGuid();
  const lines: string[] = [
    '',
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    '# Visual Studio Version 17',
    'VisualStudioVersion = 17.14.36000.0',
    'MinimumVisualStudioVersion = 10.0.40219.1',
  ];

  for (const p of projects) {
    const winRel = p.relPath.replace(/\//g, '\\');
    lines.push(`Project("{${CSHARP_SDK_TYPE}}") = "${p.name}", "${winRel}", "{${p.guid}}"`);
    lines.push('EndProject');
  }

  lines.push('Global');
  lines.push('\tGlobalSection(SolutionConfigurationPlatforms) = preSolution');
  lines.push('\t\tDebug|Any CPU = Debug|Any CPU');
  lines.push('\t\tRelease|Any CPU = Release|Any CPU');
  lines.push('\tEndGlobalSection');
  lines.push('\tGlobalSection(ProjectConfigurationPlatforms) = postSolution');
  for (const p of projects) {
    lines.push(`\t\t{${p.guid}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU`);
    lines.push(`\t\t{${p.guid}}.Debug|Any CPU.Build.0 = Debug|Any CPU`);
    lines.push(`\t\t{${p.guid}}.Release|Any CPU.ActiveCfg = Release|Any CPU`);
    lines.push(`\t\t{${p.guid}}.Release|Any CPU.Build.0 = Release|Any CPU`);
  }
  lines.push('\tEndGlobalSection');
  lines.push('\tGlobalSection(SolutionProperties) = preSolution');
  lines.push('\t\tHideSolutionNode = FALSE');
  lines.push('\tEndGlobalSection');
  lines.push('\tGlobalSection(ExtensibilityGlobals) = postSolution');
  lines.push(`\t\tSolutionGuid = {${slnGuid}}`);
  lines.push('\tEndGlobalSection');
  lines.push('EndGlobal');
  lines.push('');

  return lines.join('\n');
}

export async function addProjectToSlnFile(slnPath: string, csprojPath: string): Promise<void> {
  if (slnPath.toLowerCase().endsWith('.slnx')) {
    const raw = await fs.readFile(slnPath, 'utf-8');
    const rel = path.relative(path.dirname(slnPath), csprojPath).replace(/\\/g, '/');
    if (raw.includes(rel)) return;
    const updated = raw.replace('</Solution>', `  <Project Path="${rel}" />\n</Solution>`);
    await fs.writeFile(slnPath, updated, 'utf-8');
    return;
  }

  const raw = await fs.readFile(slnPath, 'utf-8');
  const slnDir = path.dirname(slnPath);
  const rel = path.relative(slnDir, csprojPath).replace(/\//g, '\\');
  const name = path.basename(csprojPath, '.csproj');
  if (raw.includes(`"${rel}"`)) return;

  const guid = generateGuid();
  const CSHARP_SDK_TYPE = 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC';
  const projBlock = `Project("{${CSHARP_SDK_TYPE}}") = "${name}", "${rel}", "{${guid}}"\nEndProject\n`;

  let updated = raw.replace(/\nGlobal\b/, `\n${projBlock}Global`);
  const configLines =
    `\t\t{${guid}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU\n` +
    `\t\t{${guid}}.Debug|Any CPU.Build.0 = Debug|Any CPU\n` +
    `\t\t{${guid}}.Release|Any CPU.ActiveCfg = Release|Any CPU\n` +
    `\t\t{${guid}}.Release|Any CPU.Build.0 = Release|Any CPU\n`;

  updated = updated.replace(
    /(GlobalSection\(ProjectConfigurationPlatforms\)\s*=\s*postSolution\r?\n)/,
    `$1${configLines}`,
  );
  await fs.writeFile(slnPath, updated, 'utf-8');
}

export function parseMsbuildDiagnostics(output: string, defaultDir: string): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/);
  // Standard MSBuild line: /path/Program.cs(12,5): error CS0103: The name 'foo' does not exist in the current context [/path/App.csproj]
  const regex =
    /^\s*(.+?)\((\d+)(?:,(\d+))?(?:,(\d+),(\d+))?\):\s+(error|warning)\s+([A-Z]+\d+):\s+(.+?)(?:\s+\[(.+?)\])?\s*$/i;
  // Errors without a location: "App.csproj : error NU1101: …", "CSC : error CS5001: …", "MSBUILD : error MSB1009: …"
  const noLocRegex =
    /^\s*(.+?)\s*:\s+(error|warning)\s+([A-Z]+\d+):\s+(.+?)(?:\s+\[(.+?)\])?\s*$/i;

  for (const line of lines) {
    let rawFile: string;
    let lineNum = 1;
    let colNum = 1;
    let severity: 'error' | 'warning';
    let code: string;
    let description: string;
    let projectPath: string;
    const m = regex.exec(line);
    if (m) {
      rawFile = m[1].trim();
      lineNum = Number(m[2]) || 1;
      colNum = Number(m[3]) || 1;
      severity = m[6].toLowerCase() === 'warning' ? 'warning' : 'error';
      code = m[7];
      description = m[8].trim();
      projectPath = m[9]?.trim() || '';
    } else {
      const n = noLocRegex.exec(line);
      if (!n) continue;
      rawFile = n[1].trim();
      severity = n[2].toLowerCase() === 'warning' ? 'warning' : 'error';
      code = n[3];
      description = n[4].trim();
      projectPath = n[5]?.trim() || '';
      // Tool names like CSC / MSBUILD are not files
      if (!/[\\/.]/.test(rawFile)) rawFile = projectPath || '';
    }
    // Multi-targeting: "[/x/App.csproj::TargetFramework=net10.0]"
    projectPath = projectPath.split('::')[0];
    const projectName = projectPath ? path.basename(projectPath, path.extname(projectPath)) : '';

    const absFile = !rawFile
      ? ''
      : path.isAbsolute(rawFile)
        ? rawFile
        : path.resolve(projectPath ? path.dirname(projectPath) : defaultDir, rawFile);

    const key = `${severity}|${code}|${absFile}|${lineNum}|${colNum}|${description}`;
    if (seen.has(key)) continue;
    seen.add(key);

    diagnostics.push({
      id: key,
      severity,
      code,
      description,
      project: projectName,
      file: absFile,
      line: lineNum,
      column: colNum,
      source: 'Build',
    });
  }

  return diagnostics;
}
