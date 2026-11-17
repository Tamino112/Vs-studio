import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import {
  addExistingProjectToSolution,
  addNewProjectToSolution,
  addProjectReference,
  createSolutionWithProject,
  detectEnvironment,
  DOTNET_TEMPLATES,
  installCsharpLs,
  removeProjectReference,
  runDotnetBuild,
  runDotnetClean,
  runDotnetTest,
} from './services/dotnetService';
import {
  addRecentSolution,
  createDirectory,
  deletePath,
  getDefaultProjectsDir,
  getRecentSolutions,
  readDirectoryTree,
  readFileText,
  renamePath,
  searchInDirectory,
  togglePinRecentSolution,
  writeFileText,
} from './services/fileService';
import {
  parseSolution,
  updateCsprojProperty,
} from './services/solutionService';
import {
  installNugetPackage,
  removeNugetPackage,
  searchNugetPackages,
} from './services/nugetService';
import {
  checkoutGitBranch,
  cloneGitRepo,
  commitGit,
  getGitFileDiff,
  getGitStatus,
  initGitRepo,
  pullGit,
  pushGit,
  stageAllGitFiles,
  stageGitFile,
  unstageGitFile,
} from './services/gitService';
import { CSharpLspClient } from './services/lspService';
import { DotnetDebugManager } from './services/debugService';
import { TerminalManager } from './services/terminalService';

let mainWindow: BrowserWindow | null = null;
let debugConsoleWindow: BrowserWindow | null = null;
let consoleSessionCounter = 0;
let currentConsoleSnapshot: {
  session: {
    sessionId: number;
    projectName: string;
    configuration: string;
    targetFramework: string;
    exePath: string;
    command: string;
    pid?: number;
    isPty?: boolean;
    running: boolean;
    exitCode?: number | null;
  } | null;
  output: string;
} = {
  session: null,
  output: '',
};

const lspClient = new CSharpLspClient();
const debugManager = new DotnetDebugManager();
const terminalManager = new TerminalManager();

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendToDebugConsole(channel: string, payload: unknown): void {
  if (debugConsoleWindow && !debugConsoleWindow.isDestroyed()) {
    debugConsoleWindow.webContents.send(channel, payload);
  }
}

function openOrFocusDebugConsoleWindow(): void {
  if (debugConsoleWindow && !debugConsoleWindow.isDestroyed()) {
    if (debugConsoleWindow.isMinimized()) debugConsoleWindow.restore();
    debugConsoleWindow.show();
    debugConsoleWindow.focus();
    return;
  }

  const isMac = process.platform === 'darwin';
  debugConsoleWindow = new BrowserWindow({
    width: 920,
    height: 540,
    minWidth: 520,
    minHeight: 300,
    backgroundColor: '#0C0C0C',
    title: 'Microsoft Visual Studio Debug Console',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 10, y: 10 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '');
  if (devUrl && !app.isPackaged) {
    const sep = devUrl.includes('?') ? '&' : '?';
    debugConsoleWindow.loadURL(`${devUrl}${sep}view=debug-console`).catch(() => {
      debugConsoleWindow?.loadFile(path.join(__dirname, '../dist/index.html'), {
        query: { view: 'debug-console' },
      });
    });
  } else {
    debugConsoleWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { view: 'debug-console' },
    });
  }

  debugConsoleWindow.on('closed', () => {
    debugConsoleWindow = null;
  });
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#1E1E1E',
    title: 'Microsoft Visual Studio Community',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 10, y: 10 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '');
  if (devUrl && !app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (debugConsoleWindow && !debugConsoleWindow.isDestroyed()) {
      debugConsoleWindow.close();
    }
  });
}

function setupMacMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Visual Studio Community',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: () => sendToRenderer('menu:command', 'tools.options'),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendToRenderer('menu:command', 'file.newProject'),
        },
        {
          label: 'Open Project/Solution...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendToRenderer('menu:command', 'file.openSolution'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToRenderer('menu:command', 'file.save'),
        },
        {
          label: 'Save All',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToRenderer('menu:command', 'file.saveAll'),
        },
        { type: 'separator' },
        {
          label: 'Close Solution',
          click: () => sendToRenderer('menu:command', 'file.closeSolution'),
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Build',
      submenu: [
        {
          label: 'Build Solution',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToRenderer('menu:command', 'build.buildSolution'),
        },
        {
          label: 'Rebuild Solution',
          click: () => sendToRenderer('menu:command', 'build.rebuildSolution'),
        },
        {
          label: 'Clean Solution',
          click: () => sendToRenderer('menu:command', 'build.cleanSolution'),
        },
      ],
    },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Start Debugging',
          accelerator: 'F5',
          click: () => sendToRenderer('menu:command', 'debug.start'),
        },
        {
          label: 'Start Without Debugging',
          accelerator: 'CmdOrCtrl+F5',
          click: () => sendToRenderer('menu:command', 'debug.startWithoutDebugging'),
        },
        {
          label: 'Stop Debugging',
          accelerator: 'Shift+F5',
          click: () => sendToRenderer('menu:command', 'debug.stop'),
        },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  // Dialogs
  ipcMain.handle('dialog:openSolution', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open Project / Solution',
      properties: ['openFile'],
      filters: [
        { name: 'Solutions & C# Projects', extensions: ['sln', 'slnx', 'csproj'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:openProjectFile', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Add Existing Project',
      properties: ['openFile'],
      filters: [{ name: 'C# Project', extensions: ['csproj'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // Environment & Templates
  ipcMain.handle('env:detect', () => detectEnvironment());
  ipcMain.handle('env:defaultProjectsDir', () => getDefaultProjectsDir());
  ipcMain.handle('env:templates', () => DOTNET_TEMPLATES);
  ipcMain.handle('env:installCsharpLs', () =>
    installCsharpLs((line) => sendToRenderer('output:line', { channel: 'Language Server', line })),
  );

  // Recent solutions
  ipcMain.handle('recent:list', () => getRecentSolutions());
  ipcMain.handle('recent:add', (_e, item) => addRecentSolution(item));
  ipcMain.handle('recent:togglePin', (_e, p) => togglePinRecentSolution(p));

  // Solution & Project operations
  ipcMain.handle('solution:open', async (_e, targetPath: string) => {
    const sln = await parseSolution(targetPath);
    const kind = targetPath.endsWith('.sln') || targetPath.endsWith('.slnx')
      ? 'sln'
      : targetPath.endsWith('.csproj')
      ? 'csproj'
      : 'folder';
    await addRecentSolution({
      path: sln.path,
      name: sln.name,
      lastOpened: new Date().toISOString(),
      kind,
    });
    return sln;
  });

  ipcMain.handle('solution:create', async (_e, params) => {
    const res = await createSolutionWithProject(params);
    return parseSolution(res.slnPath);
  });

  ipcMain.handle('solution:addNewProject', async (_e, params) => {
    await addNewProjectToSolution(params);
    return parseSolution(params.slnPath);
  });

  ipcMain.handle('solution:addExistingProject', async (_e, slnPath: string, csprojPath: string) => {
    await addExistingProjectToSolution(slnPath, csprojPath);
    return parseSolution(slnPath);
  });

  ipcMain.handle('project:addReference', async (_e, slnPath: string, srcCsproj: string, targetCsproj: string) => {
    await addProjectReference(srcCsproj, targetCsproj);
    return parseSolution(slnPath);
  });

  ipcMain.handle('project:removeReference', async (_e, slnPath: string, srcCsproj: string, targetCsproj: string) => {
    await removeProjectReference(srcCsproj, targetCsproj);
    return parseSolution(slnPath);
  });

  ipcMain.handle('project:updateProperty', async (_e, slnPath: string, csprojPath: string, prop, val) => {
    await updateCsprojProperty(csprojPath, prop, val);
    return parseSolution(slnPath);
  });

  // File system
  ipcMain.handle('fs:tree', (_e, dirPath: string, showAllFiles: boolean) =>
    readDirectoryTree(dirPath, showAllFiles),
  );
  ipcMain.handle('fs:readFile', (_e, filePath: string) => readFileText(filePath));
  ipcMain.handle('fs:writeFile', (_e, filePath: string, content: string) =>
    writeFileText(filePath, content),
  );
  ipcMain.handle('fs:createDir', (_e, dirPath: string) => createDirectory(dirPath));
  ipcMain.handle('fs:rename', (_e, oldPath: string, newPath: string) => renamePath(oldPath, newPath));
  ipcMain.handle('fs:delete', (_e, targetPath: string) => deletePath(targetPath));
  ipcMain.handle('fs:search', (_e, rootDir: string, query: string, opts) =>
    searchInDirectory(rootDir, query, opts),
  );
  ipcMain.handle('fs:revealInFinder', (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath);
  });

  // Build & Test
  ipcMain.handle('dotnet:build', async (_e, params) => {
    return runDotnetBuild({
      ...params,
      onOutput: (line) => sendToRenderer('output:line', { channel: 'Build', line }),
    });
  });

  ipcMain.handle('dotnet:clean', async (_e, params) => {
    return runDotnetClean({
      ...params,
      onOutput: (line) => sendToRenderer('output:line', { channel: 'Build', line }),
    });
  });

  ipcMain.handle('dotnet:test', async (_e, params) => {
    return runDotnetTest({
      ...params,
      onOutput: (line) => sendToRenderer('output:line', { channel: 'Tests', line }),
    });
  });

  // NuGet
  ipcMain.handle('nuget:search', (_e, query: string) => searchNugetPackages(query));
  ipcMain.handle('nuget:install', async (_e, csprojPath: string, pkgId: string, version?: string) => {
    const res = await installNugetPackage(csprojPath, pkgId, version);
    for (const l of res.output.split(/\r?\n/)) {
      if (l) sendToRenderer('output:line', { channel: 'Package Manager', line: l });
    }
    return res;
  });
  ipcMain.handle('nuget:remove', async (_e, csprojPath: string, pkgId: string) => {
    const res = await removeNugetPackage(csprojPath, pkgId);
    for (const l of res.output.split(/\r?\n/)) {
      if (l) sendToRenderer('output:line', { channel: 'Package Manager', line: l });
    }
    return res;
  });

  // Git
  ipcMain.handle('git:status', (_e, dir: string) => getGitStatus(dir));
  ipcMain.handle('git:init', (_e, dir: string) => initGitRepo(dir));
  ipcMain.handle('git:stage', (_e, dir: string, rel: string) => stageGitFile(dir, rel));
  ipcMain.handle('git:unstage', (_e, dir: string, rel: string) => unstageGitFile(dir, rel));
  ipcMain.handle('git:stageAll', (_e, dir: string) => stageAllGitFiles(dir));
  ipcMain.handle('git:commit', (_e, dir: string, msg: string) => commitGit(dir, msg));
  ipcMain.handle('git:diff', (_e, dir: string, rel: string, staged: boolean) =>
    getGitFileDiff(dir, rel, staged),
  );
  ipcMain.handle('git:checkout', (_e, dir: string, branch: string, create: boolean) =>
    checkoutGitBranch(dir, branch, create),
  );
  ipcMain.handle('git:clone', (_e, url: string, targetDir: string) => cloneGitRepo(url, targetDir));
  ipcMain.handle('git:pull', (_e, dir: string) => pullGit(dir));
  ipcMain.handle('git:push', (_e, dir: string) => pushGit(dir));

  // LSP
  lspClient.setCallbacks(
    (file, diagnostics) => sendToRenderer('lsp:diagnostics', { file, diagnostics }),
    (line) => sendToRenderer('output:line', { channel: 'Language Server', line }),
  );
  ipcMain.handle('lsp:start', (_e, rootDir: string, pathOverride?: string) =>
    pathOverride ? lspClient.start(rootDir, pathOverride) : false,
  );
  ipcMain.handle('lsp:stop', () => lspClient.stop());
  ipcMain.handle('lsp:didOpen', (_e, file: string, text: string) => lspClient.didOpen(file, text));
  ipcMain.handle('lsp:didChange', (_e, file: string, text: string) => lspClient.didChange(file, text));
  ipcMain.handle('lsp:didSave', (_e, file: string, text: string) => lspClient.didSave(file, text));
  ipcMain.handle('lsp:completion', (_e, file: string, line: number, ch: number) =>
    lspClient.completion(file, line, ch),
  );
  ipcMain.handle('lsp:hover', (_e, file: string, line: number, ch: number) =>
    lspClient.hover(file, line, ch),
  );
  ipcMain.handle('lsp:definition', (_e, file: string, line: number, ch: number) =>
    lspClient.definition(file, line, ch),
  );
  ipcMain.handle('lsp:signatureHelp', (_e, file: string, line: number, ch: number) =>
    lspClient.signatureHelp(file, line, ch),
  );
  ipcMain.handle(
    'lsp:codeAction',
    (_e, file: string, sl: number, sc: number, el: number, ec: number, diagnostics: unknown[]) =>
      lspClient.codeAction(file, sl, sc, el, ec, diagnostics),
  );
  ipcMain.handle('lsp:references', (_e, file: string, line: number, ch: number) =>
    lspClient.references(file, line, ch),
  );
  ipcMain.handle('lsp:rename', (_e, file: string, line: number, ch: number, newName: string) =>
    lspClient.rename(file, line, ch, newName),
  );
  ipcMain.handle('lsp:format', (_e, file: string) => lspClient.formatDocument(file));

  // Debugger
  debugManager.setCallbacks({
    onOutput: (line) => sendToRenderer('output:line', { channel: 'Debug', line }),
    onStateChange: (state) => sendToRenderer('debug:state', state),
    onStopped: (data) => sendToRenderer('debug:stopped', data),
    onExited: (exitCode) => sendToRenderer('debug:exited', exitCode),
    onConsoleStart: (meta) => {
      consoleSessionCounter += 1;
      const session = {
        sessionId: consoleSessionCounter,
        ...meta,
        running: true,
        exitCode: null,
      };
      currentConsoleSnapshot = { session, output: '' };
      sendToDebugConsole('console:session', session);
      sendToRenderer('console:session', session);
    },
    onConsoleData: (chunk) => {
      currentConsoleSnapshot.output = (currentConsoleSnapshot.output + chunk).slice(-100000);
      sendToDebugConsole('console:data', chunk);
      sendToRenderer('console:data', chunk);
    },
    onConsoleExit: (info) => {
      if (currentConsoleSnapshot.session) {
        currentConsoleSnapshot.session = {
          ...currentConsoleSnapshot.session,
          running: false,
          exitCode: info.code,
          pid: info.pid ?? currentConsoleSnapshot.session.pid,
          exePath: info.exePath || currentConsoleSnapshot.session.exePath,
        };
      }
      sendToDebugConsole('console:exit', info);
      sendToRenderer('console:exit', info);
    },
  });
  ipcMain.handle('debug:start', (_e, params) => debugManager.startDebugging(params));
  ipcMain.handle('debug:startWithoutDebugging', (_e, csproj: string, config: string, options) =>
    debugManager.startWithoutDebugging(csproj, config, options),
  );
  ipcMain.handle('debug:stop', () => debugManager.stop());
  ipcMain.handle('debug:continue', () => debugManager.continue());
  ipcMain.handle('debug:stepOver', () => debugManager.stepOver());
  ipcMain.handle('debug:stepInto', () => debugManager.stepInto());
  ipcMain.handle('debug:stepOut', () => debugManager.stepOut());
  ipcMain.handle('debug:pause', () => debugManager.pause());
  ipcMain.handle('debug:syncBreakpoints', (_e, bps) => debugManager.syncBreakpoints(bps));
  ipcMain.handle('debug:evaluate', (_e, expr: string, frameId?: number) =>
    debugManager.evaluate(expr, frameId),
  );
  ipcMain.handle('debug:sendInput', (_e, text: string) => {
    if (!currentConsoleSnapshot.session?.isPty) {
      currentConsoleSnapshot.output = (currentConsoleSnapshot.output + text).slice(-100000);
    }
    debugManager.sendInput(text);
  });

  // Visual Studio Debug Console Window
  ipcMain.handle('console:open', () => {
    openOrFocusDebugConsoleWindow();
  });
  ipcMain.handle('console:close', () => {
    if (debugConsoleWindow && !debugConsoleWindow.isDestroyed()) {
      debugConsoleWindow.close();
    }
  });
  ipcMain.handle('console:getSnapshot', () => currentConsoleSnapshot);

  // Terminal
  ipcMain.handle('terminal:create', (_e, id: string, cwd: string) => {
    terminalManager.create(
      id,
      cwd,
      (data) => sendToRenderer('terminal:data', { id, data }),
      (code) => sendToRenderer('terminal:exit', { id, code }),
    );
  });
  ipcMain.handle('terminal:write', (_e, id: string, data: string) => terminalManager.write(id, data));
  ipcMain.handle('terminal:kill', (_e, id: string) => terminalManager.kill(id));
}

app.whenReady().then(() => {
  setupMacMenu();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  lspClient.stop();
  terminalManager.killAll();
  void debugManager.stop();
  if (process.platform !== 'darwin') app.quit();
});
