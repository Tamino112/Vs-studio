import { contextBridge, ipcRenderer } from 'electron';

export const vsApi = {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    /** Closes the main window without asking the renderer again (after the save prompt). */
    forceClose: () => ipcRenderer.invoke('window:forceClose'),
    closeAck: () => ipcRenderer.invoke('window:closeAck'),
    cancelClose: () => ipcRenderer.invoke('window:cancelClose'),
    setTitleBarOverlay: (opts: { color: string; symbolColor: string }) =>
      ipcRenderer.invoke('window:setTitleBarOverlay', opts),
  },
  dialog: {
    openSolution: (): Promise<string | null> => ipcRenderer.invoke('dialog:openSolution'),
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
    openProjectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProjectFile'),
    /** VS "Save changes to the following items?" prompt: Yes / No / Cancel */
    confirmSave: (titles: string[]): Promise<'save' | 'discard' | 'cancel'> =>
      ipcRenderer.invoke('dialog:confirmSave', titles),
  },
  env: {
    detect: () => ipcRenderer.invoke('env:detect'),
    defaultProjectsDir: (): Promise<string> => ipcRenderer.invoke('env:defaultProjectsDir'),
    templates: () => ipcRenderer.invoke('env:templates'),
    installCsharpLs: (): Promise<boolean> => ipcRenderer.invoke('env:installCsharpLs'),
  },
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    add: (item: unknown) => ipcRenderer.invoke('recent:add', item),
    togglePin: (path: string) => ipcRenderer.invoke('recent:togglePin', path),
  },
  solution: {
    open: (targetPath: string) => ipcRenderer.invoke('solution:open', targetPath),
    create: (params: unknown) => ipcRenderer.invoke('solution:create', params),
    addNewProject: (params: unknown) => ipcRenderer.invoke('solution:addNewProject', params),
    addExistingProject: (slnPath: string, csprojPath: string) =>
      ipcRenderer.invoke('solution:addExistingProject', slnPath, csprojPath),
    addReference: (slnPath: string, srcCsproj: string, targetCsproj: string) =>
      ipcRenderer.invoke('project:addReference', slnPath, srcCsproj, targetCsproj),
    removeReference: (slnPath: string, srcCsproj: string, targetCsproj: string) =>
      ipcRenderer.invoke('project:removeReference', slnPath, srcCsproj, targetCsproj),
    updateProperty: (slnPath: string, csprojPath: string, prop: string, val: string) =>
      ipcRenderer.invoke('project:updateProperty', slnPath, csprojPath, prop, val),
  },
  fs: {
    tree: (dirPath: string, showAllFiles: boolean) =>
      ipcRenderer.invoke('fs:tree', dirPath, showAllFiles),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    createDir: (dirPath: string): Promise<void> => ipcRenderer.invoke('fs:createDir', dirPath),
    rename: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    delete: (targetPath: string): Promise<void> => ipcRenderer.invoke('fs:delete', targetPath),
    search: (rootDir: string, query: string, opts?: unknown) =>
      ipcRenderer.invoke('fs:search', rootDir, query, opts),
    revealInFinder: (targetPath: string) => ipcRenderer.invoke('fs:revealInFinder', targetPath),
  },
  dotnet: {
    build: (params: unknown) => ipcRenderer.invoke('dotnet:build', params),
    clean: (params: unknown) => ipcRenderer.invoke('dotnet:clean', params),
    test: (params: unknown) => ipcRenderer.invoke('dotnet:test', params),
  },
  nuget: {
    search: (query: string) => ipcRenderer.invoke('nuget:search', query),
    install: (csprojPath: string, pkgId: string, version?: string) =>
      ipcRenderer.invoke('nuget:install', csprojPath, pkgId, version),
    remove: (csprojPath: string, pkgId: string) =>
      ipcRenderer.invoke('nuget:remove', csprojPath, pkgId),
  },
  git: {
    status: (dir: string) => ipcRenderer.invoke('git:status', dir),
    init: (dir: string) => ipcRenderer.invoke('git:init', dir),
    stage: (dir: string, rel: string) => ipcRenderer.invoke('git:stage', dir, rel),
    unstage: (dir: string, rel: string) => ipcRenderer.invoke('git:unstage', dir, rel),
    stageAll: (dir: string) => ipcRenderer.invoke('git:stageAll', dir),
    commit: (dir: string, msg: string) => ipcRenderer.invoke('git:commit', dir, msg),
    diff: (dir: string, rel: string, staged: boolean) =>
      ipcRenderer.invoke('git:diff', dir, rel, staged),
    checkout: (dir: string, branch: string, create = false) =>
      ipcRenderer.invoke('git:checkout', dir, branch, create),
    clone: (url: string, targetDir: string) => ipcRenderer.invoke('git:clone', url, targetDir),
    pull: (dir: string) => ipcRenderer.invoke('git:pull', dir),
    push: (dir: string) => ipcRenderer.invoke('git:push', dir),
  },
  lsp: {
    start: (rootDir: string, pathOverride?: string): Promise<boolean> =>
      ipcRenderer.invoke('lsp:start', rootDir, pathOverride),
    stop: () => ipcRenderer.invoke('lsp:stop'),
    didOpen: (file: string, text: string) => ipcRenderer.invoke('lsp:didOpen', file, text),
    didChange: (file: string, text: string) => ipcRenderer.invoke('lsp:didChange', file, text),
    didSave: (file: string, text: string) => ipcRenderer.invoke('lsp:didSave', file, text),
    completion: (file: string, line: number, ch: number) =>
      ipcRenderer.invoke('lsp:completion', file, line, ch),
    hover: (file: string, line: number, ch: number) =>
      ipcRenderer.invoke('lsp:hover', file, line, ch),
    definition: (file: string, line: number, ch: number) =>
      ipcRenderer.invoke('lsp:definition', file, line, ch),
    signatureHelp: (file: string, line: number, ch: number) =>
      ipcRenderer.invoke('lsp:signatureHelp', file, line, ch),
    codeAction: (
      file: string,
      sl: number,
      sc: number,
      el: number,
      ec: number,
      diagnostics: unknown[] = [],
    ) => ipcRenderer.invoke('lsp:codeAction', file, sl, sc, el, ec, diagnostics),
    references: (file: string, line: number, ch: number) =>
      ipcRenderer.invoke('lsp:references', file, line, ch),
    rename: (file: string, line: number, ch: number, newName: string) =>
      ipcRenderer.invoke('lsp:rename', file, line, ch, newName),
    format: (file: string) => ipcRenderer.invoke('lsp:format', file),
  },
  debug: {
    start: (params: unknown) => ipcRenderer.invoke('debug:start', params),
    startWithoutDebugging: (csproj: string, config: string, options?: unknown) =>
      ipcRenderer.invoke('debug:startWithoutDebugging', csproj, config, options),
    stop: () => ipcRenderer.invoke('debug:stop'),
    continue: () => ipcRenderer.invoke('debug:continue'),
    stepOver: () => ipcRenderer.invoke('debug:stepOver'),
    stepInto: () => ipcRenderer.invoke('debug:stepInto'),
    stepOut: () => ipcRenderer.invoke('debug:stepOut'),
    pause: () => ipcRenderer.invoke('debug:pause'),
    syncBreakpoints: (bps: unknown) => ipcRenderer.invoke('debug:syncBreakpoints', bps),
    evaluate: (expr: string, frameId?: number) =>
      ipcRenderer.invoke('debug:evaluate', expr, frameId),
    sendInput: (text: string) => ipcRenderer.invoke('debug:sendInput', text),
  },
  console: {
    open: () => ipcRenderer.invoke('console:open'),
    close: () => ipcRenderer.invoke('console:close'),
    isOpen: () => ipcRenderer.invoke('console:isOpen'),
    getSnapshot: () => ipcRenderer.invoke('console:getSnapshot'),
  },
  terminal: {
    create: (id: string, cwd: string) => ipcRenderer.invoke('terminal:create', id, cwd),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('vsApi', vsApi);
