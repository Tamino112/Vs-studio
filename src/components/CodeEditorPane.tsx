import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

import { selectEffectiveDiagnosticsForFile, useIdeStore } from '../store/useIdeStore';
import { OpenTab } from '../types/ide';
import { registerMonacoThemes } from '../themes/vsThemes';
import { CSharpFileIcon, CSharpProjectIcon, NuGetIcon, VsLogoIcon } from './VsIcons';
import {
  CSHARP_SEMANTIC_LEGEND,
  encodeCSharpSemanticTokens,
  getBuiltInCSharpCompletions,
  getBuiltInCSharpHover,
  getBuiltInCSharpSignatureHelp,
  mapLspCompletionKind,
} from '../utils/csharpIntellisense';
import { getBuiltInCSharpCodeActions } from '../utils/csharpDiagnostics';
import { NuGetManagerTab } from './NuGetManagerTab';
import { parseCSharpOutline } from '../utils/csharpOutline';

// Configure Monaco workers locally (offline safe for macOS .app)
if (typeof self !== 'undefined' && !(self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment) {
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') return new jsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
}

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value?: string };
  insertText?: string;
  insertTextFormat?: number;
  filterText?: string;
  sortText?: string;
  textEdit?: { newText?: string; range?: LspRange };
  additionalTextEdits?: Array<{ newText?: string; range?: LspRange }>;
}

interface LspSignatureHelp {
  signatures?: Array<{
    label: string;
    documentation?: string | { value?: string };
    parameters?: Array<{
      label: string | [number, number];
      documentation?: string | { value?: string };
    }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

interface LspCodeAction {
  title?: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: {
    changes?: Record<string, Array<{ range: LspRange; newText: string }>>;
    documentChanges?: Array<{
      textDocument?: { uri?: string };
      edits?: Array<{ range: LspRange; newText: string }>;
    }>;
  };
}

// Track active file path per Monaco model URI so split document groups & providers resolve LSP correctly
const modelPathRegistry = new Map<string, string>();

function getTabForModel(model: monaco.editor.ITextModel): OpenTab | undefined {
  const state = useIdeStore.getState();
  const mappedPath = modelPathRegistry.get(model.uri.toString());
  if (mappedPath) {
    const found = state.openTabs.find((t) => t.kind === 'code' && t.path === mappedPath);
    if (found) return found;
  }
  if (model.uri.scheme === 'file') {
    const foundByUri = state.openTabs.find((t) => t.kind === 'code' && t.path === model.uri.fsPath);
    if (foundByUri) return foundByUri;
  }
  return state.openTabs.find((t) => t.id === state.activeTabId);
}

function getOrCreateFileModel(filePath: string, content: string, language: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(filePath);
  const key = uri.toString();
  modelPathRegistry.set(key, filePath);
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(content, language, uri);
  } else {
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
    if (model.getValue() !== content) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
    }
  }
  return model;
}

function toMonacoRange(r: LspRange): monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

let providersRegistered = false;
function ensureCSharpProviders() {
  if (providersRegistered) return;
  providersRegistered = true;
  registerMonacoThemes(monaco);

  // Cross-file Go To Definition navigation handler
  monaco.editor.registerEditorOpener({
    openCodeEditor: async (_source, resource, selectionOrPosition) => {
      const targetPath = resource.fsPath || resource.path;
      if (!targetPath) return false;
      let line = 1;
      let column = 1;
      if (selectionOrPosition) {
        if ('lineNumber' in selectionOrPosition) {
          line = selectionOrPosition.lineNumber;
          column = selectionOrPosition.column;
        } else if ('startLineNumber' in selectionOrPosition) {
          line = selectionOrPosition.startLineNumber;
          column = selectionOrPosition.startColumn;
        }
      }
      await useIdeStore.getState().openFile(targetPath, line, column);
      return true;
    },
  });

  monaco.languages.registerCompletionItemProvider('csharp', {
    triggerCharacters: ['.', ' ', '{'],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const builtIn = getBuiltInCSharpCompletions(monaco, model, position);
      const tab = getTabForModel(model);
      if (!tab || tab.kind !== 'code' || !window.vsApi) {
        return { suggestions: builtIn };
      }

      try {
        const res = (await window.vsApi.lsp.completion(
          tab.path,
          position.lineNumber - 1,
          position.column - 1,
        )) as { items?: LspCompletionItem[] } | LspCompletionItem[] | null;

        const lspItems = Array.isArray(res) ? res : res?.items || [];
        if (lspItems.length === 0) {
          return { suggestions: builtIn };
        }

        const builtInFixEdits = builtIn[0]?.additionalTextEdits;
        const mapped: monaco.languages.CompletionItem[] = lspItems.slice(0, 150).map((item) => {
          const insertText = item.textEdit?.newText || item.insertText || item.label;
          const doc =
            typeof item.documentation === 'string'
              ? item.documentation
              : item.documentation?.value;
          const lspAdditional = item.additionalTextEdits
            ?.filter((e) => e.range && e.newText !== undefined)
            .map((e) => ({ range: toMonacoRange(e.range!), text: e.newText! }));
          return {
            label: item.label,
            kind: mapLspCompletionKind(monaco, item.kind),
            detail: item.detail,
            documentation: doc,
            insertText,
            insertTextRules:
              item.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            filterText: item.filterText || item.label,
            sortText: item.sortText,
            additionalTextEdits: lspAdditional?.length ? lspAdditional : builtInFixEdits,
            range: item.textEdit?.range ? toMonacoRange(item.textEdit.range) : range,
          };
        });

        const seen = new Set(mapped.map((m) => String(m.label)));
        const merged = [...mapped, ...builtIn.filter((b) => !seen.has(String(b.label)))];
        return { suggestions: merged };
      } catch {
        return { suggestions: builtIn };
      }
    },
  });

  monaco.languages.registerHoverProvider('csharp', {
    provideHover: async (model, position) => {
      const tab = getTabForModel(model);
      if (tab && tab.kind === 'code' && window.vsApi) {
        try {
          const res = (await window.vsApi.lsp.hover(
            tab.path,
            position.lineNumber - 1,
            position.column - 1,
          )) as { contents?: { value?: string } | string | Array<{ value?: string } | string> } | null;
          if (res?.contents) {
            const arr = Array.isArray(res.contents) ? res.contents : [res.contents];
            const contents = arr
              .map((c) => (typeof c === 'string' ? c : c.value || ''))
              .filter(Boolean)
              .map((value) => ({ value }));
            if (contents.length) return { contents };
          }
        } catch {
          // Fall back to built-in C# hover below
        }
      }
      return getBuiltInCSharpHover(model, position);
    },
  });

  monaco.languages.registerSignatureHelpProvider('csharp', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: async (model, position) => {
      const tab = getTabForModel(model);
      if (tab && tab.kind === 'code' && window.vsApi) {
        try {
          const res = (await window.vsApi.lsp.signatureHelp(
            tab.path,
            position.lineNumber - 1,
            position.column - 1,
          )) as LspSignatureHelp | null;
          if (res?.signatures?.length) {
            const sigHelp: monaco.languages.SignatureHelp = {
              signatures: res.signatures.map((s) => ({
                label: s.label,
                documentation: typeof s.documentation === 'string' ? s.documentation : s.documentation?.value,
                parameters: (s.parameters || []).map((p) => ({
                  label: p.label,
                  documentation: typeof p.documentation === 'string' ? p.documentation : p.documentation?.value,
                })),
              })),
              activeSignature: res.activeSignature ?? 0,
              activeParameter: res.activeParameter ?? 0,
            };
            return { value: sigHelp, dispose: () => {} };
          }
        } catch {
          // Fall back cleanly
        }
      }
      const builtIn = getBuiltInCSharpSignatureHelp(model, position);
      return builtIn ? { value: builtIn, dispose: () => {} } : null;
    },
  });

  monaco.languages.registerCodeActionProvider(
    'csharp',
    {
      provideCodeActions: async (model, range, context) => {
        const allModelMarkers = monaco.editor.getModelMarkers({ resource: model.uri });
        const lineMarkers = allModelMarkers.filter(
          (mk) =>
            mk.startLineNumber <= range.endLineNumber &&
            mk.endLineNumber >= range.startLineNumber,
        );
        const combinedMarkers: monaco.editor.IMarkerData[] = [];
        const seenMarkerKeys = new Set<string>();
        for (const mk of [...context.markers, ...lineMarkers]) {
          const k = `${mk.startLineNumber}:${mk.startColumn}:${mk.message}`;
          if (!seenMarkerKeys.has(k)) {
            seenMarkerKeys.add(k);
            combinedMarkers.push(mk);
          }
        }

        const actions: monaco.languages.CodeAction[] = getBuiltInCSharpCodeActions(
          monaco,
          model,
          combinedMarkers,
        );

        const tab = getTabForModel(model);
        if (tab && tab.kind === 'code' && window.vsApi) {
          try {
            const lspActions = (await window.vsApi.lsp.codeAction(
              tab.path,
              range.startLineNumber - 1,
              range.startColumn - 1,
              range.endLineNumber - 1,
              range.endColumn - 1,
              [],
            )) as LspCodeAction[] | null;

            if (Array.isArray(lspActions)) {
              for (const act of lspActions) {
                if (!act.title || !act.edit) continue;
                const edits: monaco.languages.IWorkspaceTextEdit[] = [];
                if (act.edit.changes) {
                  for (const [uriStr, textEdits] of Object.entries(act.edit.changes)) {
                    const targetUri = monaco.Uri.parse(uriStr);
                    for (const te of textEdits) {
                      edits.push({
                        resource: targetUri,
                        textEdit: { range: toMonacoRange(te.range), text: te.newText },
                        versionId: undefined,
                      });
                    }
                  }
                }
                if (act.edit.documentChanges) {
                  for (const dc of act.edit.documentChanges) {
                    if (!dc.textDocument?.uri || !dc.edits) continue;
                    const targetUri = monaco.Uri.parse(dc.textDocument.uri);
                    for (const te of dc.edits) {
                      edits.push({
                        resource: targetUri,
                        textEdit: { range: toMonacoRange(te.range), text: te.newText },
                        versionId: undefined,
                      });
                    }
                  }
                }
                if (edits.length > 0 && !actions.some((a) => a.title === act.title)) {
                  actions.push({
                    title: act.title,
                    kind: act.kind || 'quickfix',
                    isPreferred: act.isPreferred,
                    edit: { edits },
                  });
                }
              }
            }
          } catch {
            // Keep built-in actions if LSP fails
          }
        }

        return { actions, dispose: () => {} };
      },
    },
    { providedCodeActionKinds: ['quickfix'] },
  );

  monaco.languages.registerDefinitionProvider('csharp', {
    provideDefinition: async (model, position) => {
      const tab = getTabForModel(model);
      if (!tab || tab.kind !== 'code' || !window.vsApi) return null;
      try {
        const res = (await window.vsApi.lsp.definition(
          tab.path,
          position.lineNumber - 1,
          position.column - 1,
        )) as Array<{ uri: string; range: LspRange }> | { uri: string; range: LspRange } | null;
        const locs = Array.isArray(res) ? res : res ? [res] : [];
        return locs.map((l) => ({
          uri: monaco.Uri.parse(l.uri),
          range: toMonacoRange(l.range),
        }));
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerReferenceProvider('csharp', {
    provideReferences: async (model, position) => {
      const tab = getTabForModel(model);
      if (!tab || tab.kind !== 'code' || !window.vsApi) return null;
      try {
        const res = (await window.vsApi.lsp.references(
          tab.path,
          position.lineNumber - 1,
          position.column - 1,
        )) as Array<{ uri: string; range: LspRange }> | null;
        if (!Array.isArray(res)) return null;
        return res.map((l) => ({
          uri: monaco.Uri.parse(l.uri),
          range: toMonacoRange(l.range),
        }));
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerDocumentSemanticTokensProvider('csharp', {
    getLegend: () => CSHARP_SEMANTIC_LEGEND,
    provideDocumentSemanticTokens: (model) => {
      return {
        data: encodeCSharpSemanticTokens(model.getValue()),
      };
    },
    releaseDocumentSemanticTokens: () => {},
  });
}

const ZOOM_LEVELS = [50, 70, 85, 100, 115, 125, 150, 175, 200];

export const CodeEditorPane: React.FC = () => {
  const { splitMode, openTabs } = useIdeStore();

  // Dispose cached Monaco models once a file is closed across all document groups
  useEffect(() => {
    const openPaths = new Set(openTabs.filter((t) => t.kind === 'code').map((t) => t.path));
    for (const [uriStr, filePath] of Array.from(modelPathRegistry.entries())) {
      if (!openPaths.has(filePath)) {
        const model = monaco.editor.getModel(monaco.Uri.parse(uriStr));
        if (model && !model.isAttachedToEditor()) {
          model.dispose();
          modelPathRegistry.delete(uriStr);
        }
      }
    }
  }, [openTabs]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: splitMode === 'horizontal' ? 'column' : 'row',
        height: '100%',
        width: '100%',
        background: 'var(--vs-bg)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
        <DocumentGroupPane groupId={0} />
      </div>

      {splitMode !== 'none' && (
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            borderLeft: splitMode === 'vertical' ? '1px solid var(--vs-border)' : undefined,
            borderTop: splitMode === 'horizontal' ? '1px solid var(--vs-border)' : undefined,
          }}
        >
          <DocumentGroupPane groupId={1} />
        </div>
      )}
    </div>
  );
};

interface TabContextMenuState {
  x: number;
  y: number;
  tab: OpenTab;
}

const DocumentGroupPane: React.FC<{ groupId: number }> = ({ groupId }) => {
  const {
    openTabs,
    activeTabByGroup,
    activeGroupId,
    splitMode,
    tabLayout,
    colorizeTabsByProject,
    editorZoom,
    setTabLayout,
    setColorizeTabsByProject,
    setEditorZoom,
    setActiveGroup,
    setActiveTab,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsToRight,
    closeTabsToLeft,
    togglePinTab,
    promotePreviewTab,
    reorderTab,
    moveTabToGroup,
    setSplitMode,
    updateTabContent,
    setTabCursor,
    consumePendingReveal,
    pendingReveal,
    editorCommand,
    recordNavigation,
    saveTab,
    theme,
    fontSize,
    wordWrap,
    minimap,
    solution,
    breakpoints,
    toggleBreakpoint,
    debugPausedLocation,
    buildDiagnostics,
    lspDiagnosticsByFile,
    liveDiagnosticsByFile,
    lspHasPublished,
    lspStaleByFile,
    pendingInsertSnippet,
  } = useIdeStore();

  const groupTabs = useMemo(
    () => openTabs.filter((t) => (t.groupId ?? 0) === groupId),
    [openTabs, groupId],
  );
  const groupActiveTabId = activeTabByGroup[groupId] ?? groupTabs[0]?.id ?? null;
  const activeTab = groupTabs.find((t) => t.id === groupActiveTabId) || groupTabs[0] || null;
  const isFocusedGroup = activeGroupId === groupId;

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const viewStatesRef = useRef<Map<string, monaco.editor.ICodeEditorViewState | null>>(new Map());
  const prevModelUriRef = useRef<string | null>(null);
  const suppressChangeRef = useRef(false);
  const activeTabRef = useRef<OpenTab | null>(activeTab);
  activeTabRef.current = activeTab;
  const lastInsertedSnippetIdRef = useRef<number>(0);
  // Commands dispatched before this editor existed must not replay on mount
  const lastEditorCommandIdRef = useRef<number>(editorCommand?.id ?? 0);

  const [ctxMenu, setCtxMenu] = useState<TabContextMenuState | null>(null);
  const [activeFilesMenuOpen, setActiveFilesMenuOpen] = useState(false);
  const [activeFilesFilter, setActiveFilesFilter] = useState('');
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [navDropdown, setNavDropdown] = useState<'project' | 'type' | 'member' | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const monacoThemeName = theme === 'dark' ? 'vs-community-dark' : 'vs-community-light';
  const effectiveFontSize = Math.max(8, Math.round(fontSize * (editorZoom / 100)));

  // Dismiss popups on outside click
  useEffect(() => {
    const onGlobalClick = () => {
      setCtxMenu(null);
      setActiveFilesMenuOpen(false);
      setTabSettingsOpen(false);
      setNavDropdown(null);
    };
    window.addEventListener('click', onGlobalClick);
    return () => window.removeEventListener('click', onGlobalClick);
  }, []);

  // Initialize standalone code editor per document group
  useEffect(() => {
    ensureCSharpProviders();
    if (!editorContainerRef.current) return;

    const editor = monaco.editor.create(editorContainerRef.current, {
      model: null,
      theme: monacoThemeName,
      fontSize: effectiveFontSize,
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: minimap },
      wordWrap: wordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 4,
      insertSpaces: true,
      quickSuggestions: { other: 'on', comments: 'off', strings: 'on' },
      quickSuggestionsDelay: 40,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnCommitCharacter: true,
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
      parameterHints: { enabled: true },
      'semanticHighlighting.enabled': true,
      bracketPairColorization: { enabled: true },
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      padding: { top: 6 },
    });

    editorRef.current = editor;

    editor.onDidFocusEditorWidget(() => {
      setActiveGroup(groupId);
    });

    editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return;
      const curTab = activeTabRef.current;
      const m = editor.getModel();
      if (curTab && m) {
        updateTabContent(curTab.id, m.getValue());
      }
    });

    editor.onDidChangeCursorPosition((e) => {
      const curTab = activeTabRef.current;
      if (curTab) {
        setTabCursor(curTab.id, e.position.lineNumber, e.position.column);
      }
    });

    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
        const curTab = activeTabRef.current;
        if (curTab && curTab.kind === 'code') {
          toggleBreakpoint(curTab.path, e.target.position.lineNumber);
        }
      }
    });

    // NOTE: editor.addAction (not addCommand) – standalone addCommand keybindings are global,
    // so with two tab groups the last created editor would receive Save / F9 / Format.
    editor.addAction({
      id: 'vs.file.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const curTab = activeTabRef.current;
        if (curTab) void saveTab(curTab.id);
      },
    });

    editor.addAction({
      id: 'vs.debug.toggleBreakpoint',
      label: 'Toggle Breakpoint',
      keybindings: [monaco.KeyCode.F9],
      contextMenuGroupId: '9_breakpoints',
      run: () => {
        const curTab = activeTabRef.current;
        const pos = editor.getPosition();
        if (curTab && curTab.kind === 'code' && pos) {
          toggleBreakpoint(curTab.path, pos.lineNumber);
        }
      },
    });

    const formatDocument = () => {
      const curTab = activeTabRef.current;
      if (!curTab || curTab.kind !== 'code') return;
      if (curTab.language === 'csharp' && window.vsApi) {
        void window.vsApi.lsp.format(curTab.path).then((edits) => {
          const list = edits as Array<{ range?: LspRange; newText?: string }> | null;
          const m = editor.getModel();
          if (list?.length && m) {
            editor.executeEdits(
              'lsp-format',
              list
                .filter((ed) => ed.newText !== undefined)
                .map((ed) => ({
                  range: ed.range ? toMonacoRange(ed.range) : m.getFullModelRange(),
                  text: ed.newText!,
                })),
            );
          } else {
            void editor.getAction('editor.action.formatDocument')?.run();
          }
        });
      } else {
        void editor.getAction('editor.action.formatDocument')?.run();
      }
    };
    editor.addAction({
      id: 'vs.edit.formatDocument',
      label: 'Format Document',
      // Shift+Alt+F and the classic Visual Studio chord Ctrl+K, Ctrl+D
      keybindings: [
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        monaco.KeyMod.chord(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD,
        ),
      ],
      run: formatDocument,
    });

    editor.addAction({
      id: 'vs.edit.toggleLineComment',
      label: 'Toggle Line Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: () => {
        void editor.getAction('editor.action.commentLine')?.run();
      },
    });

    return () => {
      editor.setModel(null);
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Update theme, zoom & editor options
  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName);
    editorRef.current?.updateOptions({
      fontSize: effectiveFontSize,
      wordWrap: wordWrap ? 'on' : 'off',
      minimap: { enabled: minimap },
    });
  }, [monacoThemeName, effectiveFontSize, wordWrap, minimap]);

  // Swap per-file Monaco ITextModel ONLY when active tab identity/path changes (never on cursor/content change!)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    if (prevModelUriRef.current) {
      viewStatesRef.current.set(prevModelUriRef.current, editor.saveViewState());
    }

    // Decoration ids belong to the current model – drop them before swapping models,
    // otherwise breakpoint dots / the debug arrow stay behind as "ghosts" on the old model.
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);

    if (!activeTab || activeTab.kind !== 'code') {
      editor.setModel(null);
      prevModelUriRef.current = null;
      return;
    }

    suppressChangeRef.current = true;
    const model = getOrCreateFileModel(activeTab.path, activeTab.content, activeTab.language);
    const nextUri = model.uri.toString();
    if (editor.getModel() !== model) {
      editor.setModel(model);
      const savedState = viewStatesRef.current.get(nextUri);
      if (savedState) {
        editor.restoreViewState(savedState);
      } else if (activeTab.cursorLine) {
        editor.revealLineInCenter(activeTab.cursorLine);
        editor.setPosition({
          lineNumber: activeTab.cursorLine,
          column: activeTab.cursorColumn || 1,
        });
      }
    }
    prevModelUriRef.current = nextUri;
    suppressChangeRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, activeTab?.kind, activeTab?.path, activeTab?.language]);

  // Explicit programmatic reveals (from Error List, Search Results, Breakpoints, Navigation History, Definition)
  useEffect(() => {
    const editor = editorRef.current;
    if (!pendingReveal || !editor || !activeTab || activeTab.kind !== 'code') return;
    if (pendingReveal.filePath !== activeTab.path) return;

    editor.revealLineInCenter(pendingReveal.line);
    editor.setPosition({
      lineNumber: pendingReveal.line,
      column: pendingReveal.column || 1,
    });
    editor.focus();
    consumePendingReveal();
  }, [pendingReveal, activeTab, consumePendingReveal]);

  // Handle toolbar / Edit menu / global commands for the focused group
  useEffect(() => {
    if (!editorCommand || editorCommand.id === lastEditorCommandIdRef.current) return;
    if (activeGroupId !== groupId) return;
    // Consume the command even if no code tab is active – otherwise it would fire later
    // on an unrelated file as soon as a code tab gets activated.
    lastEditorCommandIdRef.current = editorCommand.id;
    const editor = editorRef.current;
    if (!editor || activeTab?.kind !== 'code') return;

    const cmd = editorCommand.command;

    if (cmd === 'undo') {
      editor.trigger('vs-toolbar', 'undo', null);
      editor.focus();
    } else if (cmd === 'redo') {
      editor.trigger('vs-toolbar', 'redo', null);
      editor.focus();
    } else if (cmd === 'comment') {
      void editor.getAction('editor.action.addCommentLine')?.run();
      editor.focus();
    } else if (cmd === 'uncomment') {
      void editor.getAction('editor.action.removeCommentLine')?.run();
      editor.focus();
    } else if (cmd === 'find') {
      void editor.getAction('actions.find')?.run();
    } else if (cmd === 'replace') {
      void editor.getAction('editor.action.startFindReplaceAction')?.run();
    } else if (cmd === 'toggleBreakpoint') {
      const ln = editor.getPosition()?.lineNumber || 1;
      toggleBreakpoint(activeTab.path, ln);
    } else if (cmd === 'format') {
      if (activeTab.language === 'csharp' && window.vsApi) {
        void window.vsApi.lsp.format(activeTab.path).then((edits) => {
          const list = edits as Array<{ range?: LspRange; newText?: string }> | null;
          const m = editor.getModel();
          if (list?.length && m) {
            editor.executeEdits(
              'lsp-format',
              list
                .filter((ed) => ed.newText !== undefined)
                .map((ed) => ({
                  range: ed.range ? toMonacoRange(ed.range) : m.getFullModelRange(),
                  text: ed.newText!,
                })),
            );
          } else {
            void editor.getAction('editor.action.formatDocument')?.run();
          }
          editor.focus();
        });
      } else {
        void editor.getAction('editor.action.formatDocument')?.run();
        editor.focus();
      }
    }
  }, [editorCommand, activeGroupId, groupId, activeTab, toggleBreakpoint]);

  // Insert Toolbox snippets into the active group's editor
  useEffect(() => {
    if (!pendingInsertSnippet || pendingInsertSnippet.id === lastInsertedSnippetIdRef.current) return;
    if (activeGroupId !== groupId) return;
    const editor = editorRef.current;
    if (!editor || activeTab?.kind !== 'code') return;

    lastInsertedSnippetIdRef.current = pendingInsertSnippet.id;
    const selection = editor.getSelection() || new monaco.Range(1, 1, 1, 1);
    editor.executeEdits('vs-toolbox', [
      {
        range: selection,
        text: pendingInsertSnippet.text,
        forceMoveMarkers: true,
      },
    ]);
    editor.focus();
  }, [pendingInsertSnippet, activeGroupId, groupId, activeTab?.kind]);

  // Sync Breakpoints + Current Debug Line + Exact Live/LSP/Build Diagnostic Markers
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab || activeTab.kind !== 'code') return;
    const model = editor.getModel();
    if (!model) return;

    const decos: monaco.editor.IModelDeltaDecoration[] = [];

    for (const bp of breakpoints.filter((b) => b.file === activeTab.path)) {
      decos.push({
        range: new monaco.Range(bp.line, 1, bp.line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: bp.enabled ? 'vs-breakpoint-glyph' : 'vs-breakpoint-disabled-glyph',
          glyphMarginHoverMessage: {
            value: bp.enabled ? 'Breakpoint (Click or press F9 to remove)' : 'Disabled Breakpoint',
          },
        },
      });
    }

    if (debugPausedLocation?.file === activeTab.path && debugPausedLocation.line) {
      const ln = debugPausedLocation.line;
      decos.push({
        range: new monaco.Range(ln, 1, ln, 1),
        options: {
          isWholeLine: true,
          className: 'vs-debug-current-line',
          glyphMarginClassName: 'vs-debug-arrow-glyph',
        },
      });
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decos);

    const fileDiags = selectEffectiveDiagnosticsForFile(
      {
        buildDiagnostics,
        lspDiagnosticsByFile,
        liveDiagnosticsByFile,
        lspHasPublished,
        lspStaleByFile,
      },
      activeTab.path,
    );

    const lineCount = model.getLineCount();
    monaco.editor.setModelMarkers(
      model,
      'vs-studio',
      fileDiags.map((d) => {
        const startLine = Math.max(1, Math.min(d.line, lineCount));
        const startLineMaxCol = model.getLineMaxColumn(startLine);
        const startCol = Math.max(1, Math.min(d.column || 1, startLineMaxCol));
        const endLine = Math.max(startLine, Math.min(d.endLine ?? startLine, lineCount));
        let endCol = d.endColumn;
        if (!endCol || (endLine === startLine && endCol <= startCol)) {
          const wordAt = model.getWordAtPosition({ lineNumber: startLine, column: startCol });
          endCol = wordAt && wordAt.endColumn > startCol ? wordAt.endColumn : startCol + 1;
        }
        const endLineMaxCol = model.getLineMaxColumn(endLine);
        const clampedEndCol = Math.max(
          startCol + (endLine === startLine ? 1 : 0),
          Math.min(endCol, endLineMaxCol),
        );

        return {
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: Math.max(startCol, Math.min(clampedEndCol, endLineMaxCol)),
          message: `[${d.code}] ${d.description}`,
          code: d.code,
          source: d.source,
          severity:
            d.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : d.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
        };
      }),
    );
  }, [
    activeTab?.id,
    activeTab?.path,
    activeTab?.kind,
    breakpoints,
    debugPausedLocation,
    buildDiagnostics,
    lspDiagnosticsByFile,
    liveDiagnosticsByFile,
    lspHasPublished,
    lspStaleByFile,
  ]);

  // Diff editor support
  useEffect(() => {
    if (activeTab?.kind !== 'diff' || !diffContainerRef.current) return;
    const diffEditor = monaco.editor.createDiffEditor(diffContainerRef.current, {
      automaticLayout: true,
      readOnly: true,
      theme: monacoThemeName,
      fontSize: effectiveFontSize,
    });
    const origModel = monaco.editor.createModel(activeTab.diffOriginal || '', activeTab.language);
    const modModel = monaco.editor.createModel(activeTab.diffModified || '', activeTab.language);
    diffEditor.setModel({ original: origModel, modified: modModel });
    diffEditorRef.current = diffEditor;
    return () => {
      diffEditor.dispose();
      origModel.dispose();
      modModel.dispose();
      diffEditorRef.current = null;
    };
  }, [
    activeTab?.id,
    activeTab?.kind,
    activeTab?.diffOriginal,
    activeTab?.diffModified,
    activeTab?.language,
    monacoThemeName,
    effectiveFontSize,
  ]);

  // Parse C# types & members for 3-Part Navigation Bar
  const outlineTypes = useMemo(() => {
    if (!activeTab || activeTab.kind !== 'code' || activeTab.language !== 'csharp') return [];
    return parseCSharpOutline(activeTab.content);
  }, [activeTab?.content, activeTab?.kind, activeTab?.language]);

  const cursorLine = activeTab?.cursorLine || 1;
  const activeOutlineType = useMemo(() => {
    if (outlineTypes.length === 0) return null;
    let matched = outlineTypes[0];
    for (const t of outlineTypes) {
      if (t.line <= cursorLine) matched = t;
    }
    return matched;
  }, [outlineTypes, cursorLine]);

  const activeOutlineMember = useMemo(() => {
    if (!activeOutlineType || activeOutlineType.members.length === 0) return null;
    let matched = activeOutlineType.members[0];
    for (const m of activeOutlineType.members) {
      if (m.line <= cursorLine) matched = m;
    }
    return matched;
  }, [activeOutlineType, cursorLine]);

  const jumpToLine = (line: number) => {
    if (!editorRef.current || !activeTab) return;
    recordNavigation(activeTab.path, activeTab.cursorLine || 1, activeTab.cursorColumn || 1);
    recordNavigation(activeTab.path, line, 1);
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.focus();
  };

  const ownerProject = activeTab?.path
    ? solution?.projects.find((p) => activeTab.path.startsWith(p.dir))
    : undefined;

  const pinnedTabs = groupTabs.filter((t) => t.isPinned);
  const unpinnedTabs = groupTabs.filter((t) => !t.isPinned);
  const isVerticalTabs = tabLayout === 'left' || tabLayout === 'right';

  const handleTabDropOnTab = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    setDragOverTabId(null);
    const draggedId = e.dataTransfer.getData('application/x-vs-tab');
    if (draggedId && draggedId !== targetTabId) {
      reorderTab(draggedId, targetTabId);
    }
  };

  const handleTabDropOnWell = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTabId(null);
    const draggedId = e.dataTransfer.getData('application/x-vs-tab');
    if (draggedId) {
      const draggedTab = openTabs.find((t) => t.id === draggedId);
      if (draggedTab && (draggedTab.groupId ?? 0) !== groupId) {
        moveTabToGroup(draggedId, groupId);
      }
    }
  };

  const renderTabIcon = (tab: OpenTab) => {
    if (tab.kind === 'nuget') return <NuGetIcon size={13} />;
    if (tab.kind === 'diff') return <span className="codicon codicon-git-compare" style={{ fontSize: 13, color: '#75BEFF' }} />;
    if (tab.title.endsWith('.cs')) return <CSharpFileIcon size={13} />;
    if (tab.title.endsWith('.csproj')) return <CSharpProjectIcon size={13} />;
    return <span className="codicon codicon-file" style={{ fontSize: 13 }} />;
  };

  const renderTabItem = (tab: OpenTab) => {
    const isActive = tab.id === activeTab?.id;
    const accentColor = colorizeTabsByProject && tab.projectColor
      ? tab.projectColor
      : isFocusedGroup
      ? 'var(--vs-accent)'
      : 'var(--vs-border)';

    const tabBorderStyle: React.CSSProperties = isVerticalTabs
      ? {
          borderLeft: `3px solid ${isActive || (colorizeTabsByProject && tab.projectColor) ? accentColor : 'transparent'}`,
          borderRadius: 5,
          margin: '1px 4px',
        }
      : {
          borderRadius: '6px 6px 0 0',
          marginTop: 3,
          marginRight: 2,
          border: isActive ? '1px solid var(--vs-border)' : '1px solid transparent',
          borderBottom: isActive ? '1px solid var(--vs-bg-tab-active)' : 'none',
          borderTop: `2px solid ${
            tab.isPreview
              ? 'var(--vs-purple)'
              : isActive || (colorizeTabsByProject && tab.projectColor)
              ? accentColor
              : 'transparent'
          }`,
        };

    return (
      <div
        key={tab.id}
        className={`vs-doc-tab ${isActive ? 'is-active' : ''} ${tab.isPinned ? 'is-pinned' : ''} ${tab.isDirty ? 'is-dirty' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-vs-tab', tab.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverTabId(tab.id);
        }}
        onDragLeave={() => setDragOverTabId((cur) => (cur === tab.id ? null : cur))}
        onDrop={(e) => handleTabDropOnTab(e, tab.id)}
        onClick={() => setActiveTab(tab.id, groupId)}
        onDoubleClick={() => {
          if (tab.isPreview) promotePreviewTab(tab.id);
        }}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            closeTab(tab.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setActiveTab(tab.id, groupId);
          setCtxMenu({ x: e.clientX, y: e.clientY, tab });
        }}
        title={`${tab.path}${tab.projectName ? ` (${tab.projectName})` : ''}${tab.isPreview ? ' — Preview Tab' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: isVerticalTabs ? 27 : 28,
          padding: isVerticalTabs ? '0 8px' : '0 8px 0 10px',
          cursor: 'pointer',
          background:
            dragOverTabId === tab.id
              ? 'var(--vs-bg-selection)'
              : isActive
              ? 'var(--vs-bg-tab-active)'
              : 'var(--vs-bg-tab-inactive)',
          color: isActive ? 'var(--vs-fg-tab-active, var(--vs-fg-bright))' : 'var(--vs-fg-tab-inactive, var(--vs-fg))',
          fontSize: 12,
          fontStyle: tab.isPreview ? 'italic' : 'normal',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          transition: 'background 0.12s ease',
          ...tabBorderStyle,
        }}
      >
        {colorizeTabsByProject && tab.projectColor && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: tab.projectColor,
              flexShrink: 0,
            }}
          />
        )}
        {renderTabIcon(tab)}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: isVerticalTabs ? 120 : 185,
          }}
        >
          {tab.title}
        </span>

        {isVerticalTabs && <span style={{ flex: 1 }} />}

        {/* Keep Open button on Preview Tabs */}
        {tab.isPreview && (
          <button
            className="vs-tab-icon-btn"
            title="Keep Tab Open"
            onClick={(e) => {
              e.stopPropagation();
              promotePreviewTab(tab.id);
            }}
            style={tabIconBtnStyle}
          >
            <span className="codicon codicon-open-preview" style={{ fontSize: 11 }} />
          </button>
        )}

        {/* Pin / Unpin button (smooth reveal on hover via CSS) */}
        <button
          className="vs-tab-pin-btn vs-tab-icon-btn"
          title={tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
          onClick={(e) => {
            e.stopPropagation();
            togglePinTab(tab.id);
          }}
          style={{
            ...tabIconBtnStyle,
            color: tab.isPinned ? 'var(--vs-accent-light, var(--vs-accent))' : 'inherit',
          }}
        >
          <span className={`codicon ${tab.isPinned ? 'codicon-pinned' : 'codicon-pin'}`} style={{ fontSize: 11 }} />
        </button>

        {/* Close / Dirty Dot button (Fluent dot -> close cross on hover) */}
        <button
          className="vs-tab-close-btn vs-tab-icon-btn"
          title="Close (Middle-click)"
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
          style={tabIconBtnStyle}
        >
          <span className="vs-dirty-glyph" style={{ fontSize: 10, color: 'var(--vs-accent-light, var(--vs-accent))', lineHeight: 1 }}>
            ●
          </span>
          <span className="vs-close-glyph codicon codicon-close" style={{ fontSize: 11 }} />
        </button>
      </div>
    );
  };

  const tabWellControls = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '0 6px',
        flexShrink: 0,
        position: 'relative',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Active Files Dropdown (▾) */}
      <button
        className="vs-tab-icon-btn"
        title="Active Files"
        onClick={() => {
          setActiveFilesMenuOpen((v) => !v);
          setTabSettingsOpen(false);
        }}
        style={tabWellActionBtnStyle}
      >
        <span className="codicon codicon-chevron-down" style={{ fontSize: 12 }} />
      </button>

      {/* Split / Unsplit Document Groups */}
      {splitMode === 'none' ? (
        <button
          className="vs-tab-icon-btn"
          title="Split Vertical Document Group"
          onClick={() => setSplitMode('vertical')}
          style={tabWellActionBtnStyle}
        >
          <span className="codicon codicon-split-horizontal" style={{ fontSize: 12 }} />
        </button>
      ) : (
        <button
          className="vs-tab-icon-btn"
          title="Merge Document Groups"
          onClick={() => setSplitMode('none')}
          style={tabWellActionBtnStyle}
        >
          <span className="codicon codicon-chrome-restore" style={{ fontSize: 12 }} />
        </button>
      )}

      {/* Tab Layout & Color Settings Gear (⚙) */}
      <button
        className="vs-tab-icon-btn"
        title="Tab Layout & Options"
        onClick={() => {
          setTabSettingsOpen((v) => !v);
          setActiveFilesMenuOpen(false);
        }}
        style={tabWellActionBtnStyle}
      >
        <span className="codicon codicon-settings-gear" style={{ fontSize: 12 }} />
      </button>

      {/* Active Files Searchable Dropdown */}
      {activeFilesMenuOpen && (
        <div
          className="vs-menu-popup"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            width: 280,
            zIndex: 950,
            padding: 6,
          }}
        >
          <input
            className="vs-input"
            placeholder="Filter active files..."
            value={activeFilesFilter}
            onChange={(e) => setActiveFilesFilter(e.target.value)}
            autoFocus
            style={{ width: '100%', height: 24, fontSize: 11.5, marginBottom: 6 }}
          />
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {openTabs
              .filter((t) => t.title.toLowerCase().includes(activeFilesFilter.toLowerCase()))
              .map((t) => (
                <button
                  key={t.id}
                  className="vs-menu-item-btn"
                  onClick={() => {
                    setActiveTab(t.id, t.groupId ?? 0);
                    setActiveFilesMenuOpen(false);
                  }}
                  style={{
                    justifyContent: 'flex-start',
                    gap: 6,
                    padding: '4px 8px',
                    background: t.id === activeTab?.id ? 'var(--vs-bg-selection)' : 'transparent',
                    color: t.id === activeTab?.id ? '#FFFFFF' : 'var(--vs-fg)',
                  }}
                >
                  {renderTabIcon(t)}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                    {t.isDirty ? '*' : ''}
                  </span>
                  {t.isPinned && <span className="codicon codicon-pinned" style={{ fontSize: 11 }} />}
                  {t.projectName && (
                    <span style={{ fontSize: 10, opacity: 0.7 }}>{t.projectName}</span>
                  )}
                </button>
              ))}
            {openTabs.length === 0 && (
              <div style={{ padding: 8, color: 'var(--vs-fg-muted)', fontSize: 11 }}>No open documents.</div>
            )}
          </div>
        </div>
      )}

      {/* Tab Settings Popup */}
      {tabSettingsOpen && (
        <div
          className="vs-menu-popup"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            width: 245,
            zIndex: 950,
          }}
        >
          <CtxMenuItem
            label="Place Tabs on Top"
            checked={tabLayout === 'top'}
            onClick={() => {
              setTabLayout('top');
              setTabSettingsOpen(false);
            }}
          />
          <CtxMenuItem
            label="Place Tabs on Left"
            checked={tabLayout === 'left'}
            onClick={() => {
              setTabLayout('left');
              setTabSettingsOpen(false);
            }}
          />
          <CtxMenuItem
            label="Place Tabs on Right"
            checked={tabLayout === 'right'}
            onClick={() => {
              setTabLayout('right');
              setTabSettingsOpen(false);
            }}
          />
          <div style={{ height: 1, background: 'var(--vs-border-subtle)', margin: '4px 4px' }} />
          <CtxMenuItem
            label="Colorize Tabs by Project"
            checked={colorizeTabsByProject}
            onClick={() => {
              setColorizeTabsByProject(!colorizeTabsByProject);
              setTabSettingsOpen(false);
            }}
          />
          <CtxMenuItem
            label="New Vertical Document Group"
            onClick={() => {
              setSplitMode('vertical');
              setTabSettingsOpen(false);
            }}
          />
          <CtxMenuItem
            label="New Horizontal Document Group"
            onClick={() => {
              setSplitMode('horizontal');
              setTabSettingsOpen(false);
            }}
          />
          <div style={{ height: 1, background: 'var(--vs-border-subtle)', margin: '4px 4px' }} />
          <CtxMenuItem
            label="Close All Documents"
            onClick={() => {
              closeAllTabs();
              setTabSettingsOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );

  const tabWellBar = (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleTabDropOnWell}
      style={
        isVerticalTabs
          ? {
              width: 202,
              background: 'var(--vs-bg-chrome)',
              borderRight: tabLayout === 'left' ? '1px solid var(--vs-border)' : undefined,
              borderLeft: tabLayout === 'right' ? '1px solid var(--vs-border)' : undefined,
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
            }
          : {
              height: 32,
              background: 'var(--vs-bg-chrome)',
              borderBottom: '1px solid var(--vs-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 4,
              flexShrink: 0,
            }
      }
    >
      {isVerticalTabs ? (
        <>
          <div
            style={{
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 6px',
              borderBottom: '1px solid var(--vs-border)',
              fontSize: 11,
              color: 'var(--vs-fg-muted)',
              fontWeight: 600,
            }}
          >
            <span>Open Documents ({groupTabs.length})</span>
            {tabWellControls}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {pinnedTabs.length > 0 && (
              <div style={{ borderBottom: '1px solid var(--vs-border-subtle)', marginBottom: 4, paddingBottom: 4 }}>
                <div style={{ fontSize: 10, padding: '2px 8px', color: 'var(--vs-fg-muted)', fontWeight: 600 }}>PINNED</div>
                {pinnedTabs.map(renderTabItem)}
              </div>
            )}
            {unpinnedTabs.map(renderTabItem)}
          </div>
        </>
      ) : (
        <>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', overflowX: 'auto', minWidth: 0, height: '100%' }}>
            {pinnedTabs.map(renderTabItem)}
            {pinnedTabs.length > 0 && unpinnedTabs.length > 0 && (
              <div
                style={{
                  width: 2,
                  height: 20,
                  alignSelf: 'center',
                  background: 'var(--vs-border)',
                  borderRadius: 1,
                  margin: '0 4px',
                  flexShrink: 0,
                }}
              />
            )}
            {unpinnedTabs.map(renderTabItem)}
          </div>
          {tabWellControls}
        </>
      )}
    </div>
  );

  const navigationBar = activeTab?.kind === 'code' && (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        height: 25,
        background: 'var(--vs-bg)',
        borderBottom: '1px solid var(--vs-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 6,
        fontSize: 11.5,
        color: 'var(--vs-fg-muted)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Column 1: Project Scope */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setNavDropdown((v) => (v === 'project' ? null : 'project'))}
          style={navBtnStyle}
        >
          <CSharpProjectIcon size={12} />
          <span>{ownerProject?.name || solution?.name || 'Miscellaneous Files'}</span>
          <span className="codicon codicon-chevron-down" style={{ fontSize: 10 }} />
        </button>
        {navDropdown === 'project' && solution && (
          <div className="vs-menu-popup" style={navMenuStyle}>
            {solution.projects.map((p) => (
              <CtxMenuItem
                key={p.id}
                label={p.name}
                checked={p.id === ownerProject?.id}
                onClick={() => setNavDropdown(null)}
              />
            ))}
          </div>
        )}
      </div>

      <span>›</span>

      {/* Column 2: Type / Class Scope */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setNavDropdown((v) => (v === 'type' ? null : 'type'))}
          style={navBtnStyle}
        >
          <span className="codicon codicon-symbol-class" style={{ color: '#EE9D28', fontSize: 12 }} />
          <span>{activeOutlineType?.name || activeTab.title}</span>
          <span className="codicon codicon-chevron-down" style={{ fontSize: 10 }} />
        </button>
        {navDropdown === 'type' && outlineTypes.length > 0 && (
          <div className="vs-menu-popup" style={navMenuStyle}>
            {outlineTypes.map((t, idx) => (
              <CtxMenuItem
                key={`${t.name}:${idx}`}
                label={t.name}
                checked={t === activeOutlineType}
                onClick={() => {
                  jumpToLine(t.line);
                  setNavDropdown(null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <span>›</span>

      {/* Column 3: Method / Member Scope */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setNavDropdown((v) => (v === 'member' ? null : 'member'))}
          style={navBtnStyle}
        >
          <span className="codicon codicon-symbol-method" style={{ color: '#B180D7', fontSize: 12 }} />
          <span>{activeOutlineMember?.signature || '(Top of File)'}</span>
          <span className="codicon codicon-chevron-down" style={{ fontSize: 10 }} />
        </button>
        {navDropdown === 'member' && activeOutlineType && activeOutlineType.members.length > 0 && (
          <div className="vs-menu-popup" style={navMenuStyle}>
            {activeOutlineType.members.map((m, idx) => (
              <CtxMenuItem
                key={`${m.name}:${idx}`}
                label={m.signature}
                checked={m === activeOutlineMember}
                onClick={() => {
                  jumpToLine(m.line);
                  setNavDropdown(null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--vs-fg-muted)' }}>
        F9 / Margin: Breakpoint · Cmd+.: Quick Fix
      </span>
    </div>
  );

  const editorBody = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {navigationBar}

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* Empty State Watermark */}
        {!activeTab && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--vs-fg-muted)',
              gap: 14,
            }}
          >
            <VsLogoIcon size={64} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--vs-fg)' }}>
              Visual Studio Community (.NET 10)
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
              Click a file in <strong>Solution Explorer</strong> to preview, double-click to keep open, or press{' '}
              <code>⌘B</code> to Build Solution / <code>F5</code> to Start Debugging.
            </div>
          </div>
        )}

        {/* Monaco Standalone Editor (kept mounted for instant tab switching) */}
        <div
          ref={editorContainerRef}
          style={{
            width: '100%',
            height: '100%',
            display: activeTab?.kind === 'code' ? 'block' : 'none',
          }}
        />

        {/* Diff Viewer */}
        {activeTab?.kind === 'diff' && (
          <div ref={diffContainerRef} style={{ width: '100%', height: '100%' }} />
        )}

        {/* NuGet Package Manager Document Tab */}
        {activeTab?.kind === 'nuget' && (
          <NuGetManagerTab initialProjectId={activeTab.projectId} />
        )}

        {/* Bottom-Left Visual Studio Editor Zoom Selector (100 %) */}
        {activeTab?.kind === 'code' && (
          <div
            style={{
              position: 'absolute',
              left: 8,
              bottom: 6,
              zIndex: 40,
              display: 'flex',
              alignItems: 'center',
              background: 'var(--vs-menu-bg, var(--vs-bg-panel))',
              border: '1px solid var(--vs-border)',
              borderRadius: 5,
              boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
              opacity: 0.92,
            }}
          >
            <select
              title="Editor Zoom"
              value={editorZoom}
              onChange={(e) => setEditorZoom(Number(e.target.value))}
              className="vs-select"
              style={{ border: 'none', height: 21, fontSize: 11, padding: '0 6px', background: 'transparent' }}
            >
              {ZOOM_LEVELS.map((z) => (
                <option key={z} value={z}>
                  {z} %
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      onMouseDown={() => setActiveGroup(groupId)}
      style={{
        display: 'flex',
        flexDirection: isVerticalTabs ? 'row' : 'column',
        width: '100%',
        height: '100%',
        background: 'var(--vs-bg)',
        position: 'relative',
      }}
    >
      {tabLayout === 'top' && tabWellBar}
      {tabLayout === 'left' && tabWellBar}
      {editorBody}
      {tabLayout === 'right' && tabWellBar}

      {/* Full Visual Studio Tab Right-Click Context Menu */}
      {ctxMenu && (
        <div
          className="vs-menu-popup"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 360),
            left: Math.min(ctxMenu.x, window.innerWidth - 240),
            width: 240,
            zIndex: 1000,
          }}
        >
          <CtxMenuItem label="Close" onClick={() => { closeTab(ctxMenu.tab.id); setCtxMenu(null); }} />
          <CtxMenuItem label="Close All Tabs" onClick={() => { closeAllTabs(groupId); setCtxMenu(null); }} />
          <CtxMenuItem label="Close All But This" onClick={() => { closeOtherTabs(ctxMenu.tab.id); setCtxMenu(null); }} />
          <CtxMenuItem
            label={isVerticalTabs ? 'Close Tabs Below' : 'Close Tabs to the Right'}
            onClick={() => { closeTabsToRight(ctxMenu.tab.id); setCtxMenu(null); }}
          />
          <CtxMenuItem
            label={isVerticalTabs ? 'Close Tabs Above' : 'Close Tabs to the Left'}
            onClick={() => { closeTabsToLeft(ctxMenu.tab.id); setCtxMenu(null); }}
          />
          <div style={{ height: 1, background: 'var(--vs-border-subtle)', margin: '4px 4px' }} />
          <CtxMenuItem
            label={ctxMenu.tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
            onClick={() => { togglePinTab(ctxMenu.tab.id); setCtxMenu(null); }}
          />
          {ctxMenu.tab.isPreview && (
            <CtxMenuItem
              label="Keep Tab Open"
              onClick={() => { promotePreviewTab(ctxMenu.tab.id); setCtxMenu(null); }}
            />
          )}
          <div style={{ height: 1, background: 'var(--vs-border-subtle)', margin: '4px 4px' }} />
          <CtxMenuItem
            label="Copy Full Path"
            onClick={() => {
              void navigator.clipboard?.writeText(ctxMenu.tab.path);
              setCtxMenu(null);
            }}
          />
          <CtxMenuItem
            label="Open Containing Folder"
            onClick={() => {
              void window.vsApi?.fs.revealInFinder(ctxMenu.tab.path);
              setCtxMenu(null);
            }}
          />
          <div style={{ height: 1, background: 'var(--vs-border-subtle)', margin: '4px 4px' }} />
          <CtxMenuItem
            label="New Vertical Document Group"
            onClick={() => {
              moveTabToGroup(ctxMenu.tab.id, groupId === 0 ? 1 : 0);
              setSplitMode('vertical');
              setCtxMenu(null);
            }}
          />
          <CtxMenuItem
            label="New Horizontal Document Group"
            onClick={() => {
              moveTabToGroup(ctxMenu.tab.id, groupId === 0 ? 1 : 0);
              setSplitMode('horizontal');
              setCtxMenu(null);
            }}
          />
          {splitMode !== 'none' && (
            <CtxMenuItem
              label={groupId === 0 ? 'Move to Next Tab Group' : 'Move to Previous Tab Group'}
              onClick={() => {
                moveTabToGroup(ctxMenu.tab.id, groupId === 0 ? 1 : 0);
                setCtxMenu(null);
              }}
            />
          )}
          {splitMode !== 'none' && (
            <CtxMenuItem
              label="Merge All Tab Groups"
              onClick={() => {
                setSplitMode('none');
                setCtxMenu(null);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

const tabIconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  padding: 0,
  borderRadius: 4,
};

const tabWellActionBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
  color: 'var(--vs-fg)',
};

const navBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  background: 'transparent',
  border: 'none',
  color: 'var(--vs-fg)',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 11.5,
};

const navMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 2px)',
  left: 0,
  minWidth: 220,
  maxHeight: 260,
  overflowY: 'auto',
  zIndex: 920,
};

const CtxMenuItem: React.FC<{
  label: string;
  checked?: boolean;
  onClick: () => void;
}> = ({ label, checked, onClick }) => (
  <button
    className="vs-menu-item-btn"
    onClick={onClick}
    style={{ justifyContent: 'flex-start', gap: 6, padding: '5px 10px' }}
  >
    <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
      {checked && <span className="codicon codicon-check" style={{ fontSize: 12 }} />}
    </span>
    <span>{label}</span>
  </button>
);
