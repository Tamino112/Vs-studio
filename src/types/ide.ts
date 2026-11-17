export type VsThemeId = 'dark' | 'blue' | 'light';
export type KeymapMode = 'macos' | 'windows';

export interface RecentSolution {
  path: string;
  name: string;
  lastOpened: string;
  pinned?: boolean;
  kind: 'sln' | 'csproj' | 'folder';
}

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
  outputType: string; // Exe | Library | WinExe
  targetFramework: string; // e.g., net10.0
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

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  extension?: string;
}

export interface OpenTab {
  id: string;
  kind: 'code' | 'nuget' | 'diff' | 'settings';
  title: string;
  path: string;
  content: string;
  savedContent: string;
  language: string;
  isDirty: boolean;
  projectId?: string;
  projectName?: string;
  projectColor?: string;
  cursorLine?: number;
  cursorColumn?: number;
  diffOriginal?: string;
  diffModified?: string;
  isPinned?: boolean;
  isPreview?: boolean;
  groupId?: number;
}

export type TabLayoutPosition = 'top' | 'left' | 'right';
export type DocumentSplitMode = 'none' | 'vertical' | 'horizontal';

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

export interface OutputChannelData {
  Build: string[];
  Debug: string[];
  'Package Manager': string[];
  'Language Server': string[];
  Tests: string[];
}

export type OutputChannelName = keyof OutputChannelData;

export interface Breakpoint {
  id: string;
  file: string;
  line: number;
  enabled: boolean;
  condition?: string;
}

export interface DebugVariable {
  name: string;
  value: string;
  type: string;
  variablesReference?: number;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
}

export type DebugState = 'stopped' | 'running' | 'paused' | 'building';

export interface NuGetPackageSummary {
  id: string;
  version: string;
  versions: string[];
  description: string;
  authors: string;
  totalDownloads: number;
  iconUrl?: string;
  projectUrl?: string;
  verified?: boolean;
}

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

export interface DotnetTemplate {
  shortName: string;
  name: string;
  description: string;
  language: string;
  tags: string[];
  category: 'Console' | 'Web' | 'Library' | 'Test' | 'Desktop' | 'Worker';
  supportsTopLevelStatements?: boolean;
}

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

export interface SearchMatch {
  file: string;
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export interface TaskListItem {
  id: string;
  priority: 'High' | 'Normal' | 'Low';
  tag: 'TODO' | 'HACK' | 'FIXME' | 'UNDONE';
  description: string;
  file: string;
  line: number;
}

export type LeftPanelId = 'solutionExplorer' | 'classView' | 'toolbox';
export type RightPanelId = 'gitChanges' | 'properties';
export type BottomPanelId =
  | 'errorList'
  | 'output'
  | 'terminal'
  | 'testExplorer'
  | 'findResults'
  | 'taskList'
  | 'locals'
  | 'watch'
  | 'callStack'
  | 'breakpoints'
  | 'immediate';
