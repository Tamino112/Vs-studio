import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

import { useIdeStore } from '../store/useIdeStore';
import { registerMonacoThemes } from '../themes/vsThemes';
import { CSharpFileIcon, CSharpProjectIcon, NuGetIcon, VsLogoIcon } from './VsIcons';
import { NuGetManagerTab } from './NuGetManagerTab';

import {
  getBuiltInCSharpCompletions,
  mapLspCompletionKind,
} from '../utils/csharpIntellisense';

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

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value?: string };
  insertText?: string;
  insertTextFormat?: number;
  filterText?: string;
  sortText?: string;
  textEdit?: { newText?: string };
}

let providersRegistered = false;
function ensureCSharpProviders() {
  if (providersRegistered) return;
  providersRegistered = true;
  registerMonacoThemes(monaco);

  // Combined Roslyn LSP + context-aware .NET 10 C# IntelliSense provider
  monaco.languages.registerCompletionItemProvider('csharp', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems: async (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const builtIn = getBuiltInCSharpCompletions(monaco, model, position);

      const state = useIdeStore.getState();
      const tab = state.openTabs.find((t) => t.id === state.activeTabId);
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

        const mapped: monaco.languages.CompletionItem[] = lspItems.slice(0, 150).map((item) => {
          const insertText = item.textEdit?.newText || item.insertText || item.label;
          const doc =
            typeof item.documentation === 'string'
              ? item.documentation
              : item.documentation?.value;
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
            range,
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
    provideHover: async (_model, position) => {
      const state = useIdeStore.getState();
      const tab = state.openTabs.find((t) => t.id === state.activeTabId);
      if (!tab || tab.kind !== 'code' || !window.vsApi) return null;
      try {
        const res = (await window.vsApi.lsp.hover(
          tab.path,
          position.lineNumber - 1,
          position.column - 1,
        )) as { contents?: { value?: string } | string | Array<{ value?: string } | string> } | null;
        if (!res?.contents) return null;
        const arr = Array.isArray(res.contents) ? res.contents : [res.contents];
        const contents = arr
          .map((c) => (typeof c === 'string' ? c : c.value || ''))
          .filter(Boolean)
          .map((value) => ({ value }));
        return contents.length ? { contents } : null;
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerDefinitionProvider('csharp', {
    provideDefinition: async (_model, position) => {
      const state = useIdeStore.getState();
      const tab = state.openTabs.find((t) => t.id === state.activeTabId);
      if (!tab || tab.kind !== 'code' || !window.vsApi) return null;
      try {
        const res = (await window.vsApi.lsp.definition(
          tab.path,
          position.lineNumber - 1,
          position.column - 1,
        )) as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> | { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null;
        const locs = Array.isArray(res) ? res : res ? [res] : [];
        return locs.map((l) => ({
          uri: monaco.Uri.parse(l.uri),
          range: new monaco.Range(
            l.range.start.line + 1,
            l.range.start.character + 1,
            l.range.end.line + 1,
            l.range.end.character + 1,
          ),
        }));
      } catch {
        return null;
      }
    },
  });
}

export const CodeEditorPane: React.FC = () => {
  const {
    openTabs,
    activeTabId,
    setActiveTab,
    closeTab,
    updateTabContent,
    setTabCursor,
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
  } = useIdeStore();

  const activeTab = openTabs.find((t) => t.id === activeTabId) || null;
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const suppressChangeRef = useRef(false);

  const monacoThemeName = theme === 'dark' ? 'vs-community-dark' : 'vs-community-light';

  // Initialize standalone code editor
  useEffect(() => {
    ensureCSharpProviders();
    if (!editorContainerRef.current) return;

    const editor = monaco.editor.create(editorContainerRef.current, {
      value: '',
      language: 'csharp',
      theme: monacoThemeName,
      fontSize,
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: minimap },
      wordWrap: wordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 4,
      insertSpaces: true,
      quickSuggestions: true,
      renderWhitespace: 'selection',
    });

    editorRef.current = editor;

    editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return;
      const curTabId = useIdeStore.getState().activeTabId;
      if (curTabId) {
        updateTabContent(curTabId, editor.getValue());
      }
    });

    editor.onDidChangeCursorPosition((e) => {
      const curTabId = useIdeStore.getState().activeTabId;
      if (curTabId) {
        setTabCursor(curTabId, e.position.lineNumber, e.position.column);
      }
    });

    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
        const tab = useIdeStore.getState().openTabs.find((t) => t.id === useIdeStore.getState().activeTabId);
        if (tab && tab.kind === 'code') {
          toggleBreakpoint(tab.path, e.target.position.lineNumber);
        }
      }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const curTabId = useIdeStore.getState().activeTabId;
      if (curTabId) void saveTab(curTabId);
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update theme and options
  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName);
    editorRef.current?.updateOptions({
      fontSize,
      wordWrap: wordWrap ? 'on' : 'off',
      minimap: { enabled: minimap },
    });
  }, [monacoThemeName, fontSize, wordWrap, minimap]);

  // Sync active code tab into Monaco model
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab || activeTab.kind !== 'code') return;

    suppressChangeRef.current = true;
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, activeTab.language);
      if (model.getValue() !== activeTab.content) {
        model.setValue(activeTab.content);
      }
    }
    if (activeTab.cursorLine) {
      editor.revealLineInCenter(activeTab.cursorLine);
      editor.setPosition({
        lineNumber: activeTab.cursorLine,
        column: activeTab.cursorColumn || 1,
      });
    }
    suppressChangeRef.current = false;
  }, [activeTab?.id, activeTab?.kind, activeTab?.cursorLine, activeTab?.cursorColumn]);

  // Sync Breakpoints + Current Debug Line + Diagnostics Markers
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
          glyphMarginHoverMessage: { value: bp.enabled ? 'Breakpoint (Click to remove)' : 'Disabled Breakpoint' },
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

    const fileDiags = [
      ...buildDiagnostics.filter((d) => d.file === activeTab.path),
      ...(lspDiagnosticsByFile[activeTab.path] || []),
    ];

    monaco.editor.setModelMarkers(
      model,
      'vs-studio',
      fileDiags.map((d) => ({
        startLineNumber: Math.max(1, d.line),
        startColumn: Math.max(1, d.column),
        endLineNumber: Math.max(1, d.line),
        endColumn: Math.max(2, d.column + 12),
        message: `[${d.code}] ${d.description}`,
        severity:
          d.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : d.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
      })),
    );
  }, [activeTab?.path, activeTab?.kind, breakpoints, debugPausedLocation, buildDiagnostics, lspDiagnosticsByFile]);

  // Diff editor support
  useEffect(() => {
    if (activeTab?.kind !== 'diff' || !diffContainerRef.current) return;
    const diffEditor = monaco.editor.createDiffEditor(diffContainerRef.current, {
      automaticLayout: true,
      readOnly: true,
      theme: monacoThemeName,
      fontSize,
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
  }, [activeTab?.id, activeTab?.kind, activeTab?.diffOriginal, activeTab?.diffModified, activeTab?.language, monacoThemeName, fontSize]);

  // Determine Breadcrumb Project for active file
  const ownerProject = activeTab?.path
    ? solution?.projects.find((p) => activeTab.path.startsWith(p.dir))
    : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--vs-bg)' }}>
      {/* Visual Studio Document Tab Well */}
      <div
        style={{
          height: 28,
          background: 'var(--vs-bg-panel)',
          borderBottom: '1px solid var(--vs-border)',
          display: 'flex',
          alignItems: 'flex-end',
          overflowX: 'auto',
        }}
      >
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 27,
                padding: '0 10px',
                cursor: 'pointer',
                background: isActive ? 'var(--vs-bg-tab-active)' : 'var(--vs-bg-tab-inactive)',
                borderRight: '1px solid var(--vs-border)',
                borderTop: isActive ? '2px solid var(--vs-accent)' : '2px solid transparent',
                color: isActive ? 'var(--vs-fg-bright)' : 'var(--vs-fg)',
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.kind === 'nuget' ? (
                <NuGetIcon size={13} />
              ) : tab.title.endsWith('.cs') ? (
                <CSharpFileIcon size={13} />
              ) : tab.title.endsWith('.csproj') ? (
                <CSharpProjectIcon size={13} />
              ) : (
                <span className="codicon codicon-file" style={{ fontSize: 13 }} />
              )}
              <span>
                {tab.title}
                {tab.isDirty ? '*' : ''}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  opacity: 0.7,
                  display: 'inline-flex',
                  padding: 1,
                }}
              >
                <span className="codicon codicon-close" style={{ fontSize: 12 }} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Visual Studio Navigation / Breadcrumb Bar */}
      {activeTab?.kind === 'code' && (
        <div
          style={{
            height: 24,
            background: 'var(--vs-bg)',
            borderBottom: '1px solid var(--vs-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            gap: 12,
            fontSize: 11.5,
            color: 'var(--vs-fg-muted)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--vs-fg)' }}>
            <CSharpProjectIcon size={13} />
            {ownerProject?.name || solution?.name || 'Miscellaneous Files'}
          </span>
          <span>›</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--vs-fg)' }}>
            <span className="codicon codicon-symbol-class" style={{ color: '#EE9D28', fontSize: 13 }} />
            {activeTab.title}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11 }}>
            Click left margin to toggle Breakpoint (F9)
          </span>
        </div>
      )}

      {/* Editor Body */}
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
            <div style={{ fontSize: 15, color: 'var(--vs-fg)' }}>
              Visual Studio Community (.NET 10)
            </div>
            <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
              Select a file in <strong>Solution Explorer</strong> to edit code, press{' '}
              <code>⌘B</code> to Build Solution, or <code>F5</code> / <code>⌘R</code> to Start Debugging.
            </div>
          </div>
        )}

        {/* Monaco Standalone Editor (kept mounted for fast tab switching) */}
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
      </div>
    </div>
  );
};
