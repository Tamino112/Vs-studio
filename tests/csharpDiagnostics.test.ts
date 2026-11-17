import { describe, expect, it, vi } from 'vitest';
import { analyzeCSharpCode, getBuiltInCSharpCodeActions } from '../src/utils/csharpDiagnostics';
import {
  encodeCSharpSemanticTokens,
  getBuiltInCSharpCompletions,
  getBuiltInCSharpHover,
  getBuiltInCSharpSignatureHelp,
} from '../src/utils/csharpIntellisense';
import { parseCSharpOutline } from '../src/utils/csharpOutline';

const mockMonaco = {
  languages: {
    CompletionItemKind: {
      Method: 0,
      Function: 1,
      Constructor: 2,
      Field: 3,
      Variable: 4,
      Class: 5,
      Struct: 6,
      Interface: 7,
      Module: 8,
      Property: 9,
      Event: 10,
      Operator: 11,
      Unit: 12,
      Value: 13,
      Constant: 14,
      Enum: 15,
      EnumMember: 16,
      Keyword: 17,
      Text: 18,
      Color: 19,
      File: 20,
      Reference: 21,
      Folder: 22,
      TypeParameter: 23,
      Snippet: 27,
    },
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
  },
};

function createMockModel(text: string, uriPath = '/src/Program.cs') {
  const lines = text.split('\n');
  return {
    uri: { toString: () => `file://${uriPath}` },
    getVersionId: () => 1,
    getValue: () => text,
    getLineContent: (ln: number) => lines[ln - 1] || '',
    getValueInRange: (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => {
      const line = lines[r.startLineNumber - 1] || '';
      return line.slice(r.startColumn - 1, r.endColumn - 1);
    },
    getWordUntilPosition: (pos: { lineNumber: number; column: number }) => {
      const line = lines[pos.lineNumber - 1] || '';
      const before = line.slice(0, pos.column - 1);
      const m = /([A-Za-z_]\w*)$/.exec(before);
      const startColumn = m ? pos.column - m[1].length : pos.column;
      return { word: m ? m[1] : '', startColumn, endColumn: pos.column };
    },
    getWordAtPosition: (pos: { lineNumber: number; column: number }) => {
      const line = lines[pos.lineNumber - 1] || '';
      const re = /[A-Za-z_]\w*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const start = m.index + 1;
        const end = start + m[0].length;
        if (pos.column >= start && pos.column <= end) {
          return { word: m[0], startColumn: start, endColumn: end };
        }
      }
      return null;
    },
  };
}

describe('Real-Time C# Diagnostics & Exact Squiggle Ranges', () => {
  it('flags exact ranges for unused cool, lowercase console, and undefined interpolated hallio', () => {
    const code = 'string cool = "hallio";\nconsole.WriteLine($"{hallio}");';
    const diags = analyzeCSharpCode('/src/Program.cs', 'DemoApp', code);

    expect(diags.length).toBe(3);

    const unusedWarn = diags.find((d) => d.code === 'CS0219');
    expect(unusedWarn).toMatchObject({
      severity: 'warning',
      line: 1,
      column: 8,
      endLine: 1,
      endColumn: 12, // exact span of "cool"
    });

    const consoleErr = diags.find((d) => d.code === 'CS0103' && d.line === 2 && d.column === 1);
    expect(consoleErr).toMatchObject({
      severity: 'error',
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 8, // exact span of "console"
    });

    const hallioErr = diags.find((d) => d.code === 'CS0103' && d.line === 2 && d.column === 22);
    expect(hallioErr).toMatchObject({
      severity: 'error',
      line: 2,
      column: 22,
      endLine: 2,
      endColumn: 28, // exact span of "hallio" inside $"{hallio}"
    });
  });

  it('clears all errors and warnings once typos and interpolation variable are fixed', () => {
    const fixed = 'string cool = "hallio";\nConsole.WriteLine($"{cool}");';
    const diags = analyzeCSharpCode('/src/Program.cs', 'DemoApp', fixed);
    expect(diags).toEqual([]);
  });

  it('detects CS1002 missing semicolons (even with trailing comment) without false positives on multi-line code', () => {
    const missingSemi = 'string cool = "hallio"\nint count = 5; // inline note\nConsole.WriteLine(count) // forgotten';
    const diags = analyzeCSharpCode('/src/Program.cs', 'DemoApp', missingSemi);
    const semiErrs = diags.filter((d) => d.code === 'CS1002');
    expect(semiErrs.length).toBe(2);
    expect(semiErrs[0]).toMatchObject({ line: 1, column: 23, endLine: 1, endColumn: 24 });
    expect(semiErrs[1]).toMatchObject({ line: 3, column: 25, endLine: 3, endColumn: 26 });

    const multilineChain = [
      'var items = new List<string>();',
      'var result = items',
      '    .Where(x => x.Length > 0)',
      '    .ToList();',
      'Console.WriteLine(result.Count);',
    ].join('\n');
    expect(analyzeCSharpCode('/src/Program.cs', 'DemoApp', multilineChain).filter((d) => d.code === 'CS1002')).toEqual([]);
  });

  it('detects CS1010 unclosed string, CS1513/CS1026 delimiters, CS0117 unknown BCL members, and CS0029 literal mismatches', () => {
    const broken = [
      'string s = "unclosed;',
      'Console.WriteLne("typo");',
      'int x = "hello";',
      'string y = 123;',
      'public void Foo(int paramOnly) {',
    ].join('\n');

    const diags = analyzeCSharpCode('/src/Test.cs', 'DemoApp', broken);
    expect(diags.some((d) => d.code === 'CS1010' && d.line === 1)).toBe(true);
    expect(diags.some((d) => d.code === 'CS0117' && d.line === 2 && d.column === 9 && d.endColumn === 17)).toBe(true);
    expect(diags.some((d) => d.code === 'CS0029' && d.line === 3)).toBe(true);
    expect(diags.some((d) => d.code === 'CS0029' && d.line === 4)).toBe(true);
    expect(diags.some((d) => d.code === 'CS1513' && d.line === 5)).toBe(true);
    // Method parameter `paramOnly` must NOT be falsely flagged as unused local CS0219
    expect(diags.some((d) => d.code === 'CS0219' && d.description.includes('paramOnly'))).toBe(false);
  });

  it('provides Quick Fixes for casing typos, missing semicolons, and unused variables', () => {
    const code = 'string cool = "hallio";\nconsole.WriteLine("hi")\nList<int> nums = new();';
    const model = createMockModel(code);

    const actions = getBuiltInCSharpCodeActions(mockMonaco as never, model as never, [
      {
        startLineNumber: 2,
        startColumn: 1,
        endLineNumber: 2,
        endColumn: 8,
        message: "[CS0103] The name 'console' does not exist in the current context (did you mean 'Console'?)",
        severity: 8,
      },
      {
        startLineNumber: 2,
        startColumn: 24,
        endLineNumber: 2,
        endColumn: 25,
        message: '[CS1002] ; expected',
        severity: 8,
      },
      {
        startLineNumber: 1,
        startColumn: 8,
        endLineNumber: 1,
        endColumn: 12,
        message: "[CS0219] The variable 'cool' is assigned but its value is never used",
        severity: 4,
      },
    ] as never);

    expect(actions.some((a) => a.title === "Change 'console' to 'Console'" && a.isPreferred)).toBe(true);
    expect(actions.some((a) => a.title === "Add missing ';'" && a.isPreferred)).toBe(true);
    expect(actions.some((a) => a.title === "Remove unused variable 'cool'")).toBe(true);
  });
});

describe('C# IntelliSense Case Auto-Fix, Signature Help, Hover, Semantic Tokens & Top-Level Outline', () => {
  it('attaches additionalTextEdits on console. completions to auto-correct console -> Console', () => {
    const model = createMockModel('console.');
    const items = getBuiltInCSharpCompletions(mockMonaco as never, model as never, { lineNumber: 1, column: 9 } as never);
    const writeLine = items.find((i) => i.label === 'WriteLine');
    expect(writeLine).toBeDefined();
    expect(writeLine?.additionalTextEdits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 },
        text: 'Console',
      },
    ]);
  });

  it('returns signature help and quick info hover for BCL members and local variables', () => {
    const sigModel = createMockModel('Console.WriteLine(');
    const sig = getBuiltInCSharpSignatureHelp(sigModel as never, { lineNumber: 1, column: 19 } as never);
    expect(sig?.signatures[0].label).toContain('Console.WriteLine');

    const hoverModel = createMockModel('string cool = "hi";\nConsole.WriteLine(cool);');
    const memberHover = getBuiltInCSharpHover(hoverModel as never, { lineNumber: 2, column: 12 } as never);
    expect(JSON.stringify(memberHover?.contents)).toContain('Console.WriteLine');

    const varHover = getBuiltInCSharpHover(hoverModel as never, { lineNumber: 2, column: 20 } as never);
    expect(JSON.stringify(varHover?.contents)).toContain('string cool');
  });

  it('encodes semantic tokens including variables inside string interpolations', () => {
    const code = 'string cool = "hallio";\nConsole.WriteLine($"{cool}");';
    const data = encodeCSharpSemanticTokens(code);
    // Token tuples: [deltaLine, deltaChar, length, tokenType (0=type,1=method,2=var), modifiers]
    const tokens: Array<{ len: number; kind: number }> = [];
    for (let i = 0; i < data.length; i += 5) {
      tokens.push({ len: data[i + 2], kind: data[i + 3] });
    }
    expect(tokens).toContainEqual({ len: 4, kind: 2 }); // cool declaration
    expect(tokens).toContainEqual({ len: 7, kind: 0 }); // Console type
    expect(tokens).toContainEqual({ len: 9, kind: 1 }); // WriteLine method
    expect(tokens.filter((t) => t.len === 4 && t.kind === 2).length).toBe(2); // declaration + $"{cool}"
  });

  it('produces Program -> <Main>$(string[] args) outline for top-level C# files', () => {
    const types = parseCSharpOutline('Console.WriteLine("Hello .NET 10");');
    expect(types.length).toBe(1);
    expect(types[0].name).toBe('Program');
    expect(types[0].members[0].signature).toBe('<Main>$(string[] args)');
  });

  it('merges live and LSP diagnostics cleanly while typing (stale LSP state vs published)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
    });
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: () => undefined,
        style: { setProperty: () => undefined },
      },
    });

    const { selectEffectiveDiagnosticsForFile } = await import('../src/store/useIdeStore');
    const file = '/src/Program.cs';
    const liveItem = {
      id: 'live:1',
      severity: 'error' as const,
      code: 'CS0103',
      description: "The name 'console' does not exist",
      project: 'App',
      file,
      line: 2,
      column: 1,
      endLine: 2,
      endColumn: 8,
      source: 'IntelliSense',
    };
    const deepLspItem = {
      id: 'lsp:deep',
      severity: 'warning' as const,
      code: 'CS8600',
      description: 'Converting null literal',
      project: 'App',
      file,
      line: 5,
      column: 1,
      endLine: 5,
      endColumn: 5,
      source: 'Language Server',
    };

    // Before LSP publishes -> live diagnostics win immediately
    const preLsp = selectEffectiveDiagnosticsForFile(
      {
        buildDiagnostics: [],
        lspDiagnosticsByFile: {},
        liveDiagnosticsByFile: { [file]: [liveItem] },
        lspHasPublished: {},
        lspStaleByFile: {},
      },
      file,
    );
    expect(preLsp).toEqual([liveItem]);

    // While user is actively typing (stale LSP) -> live diagnostics override CS0103 while keeping deep LSP warnings on other lines
    const staleLsp = selectEffectiveDiagnosticsForFile(
      {
        buildDiagnostics: [],
        lspDiagnosticsByFile: { [file]: [deepLspItem] },
        liveDiagnosticsByFile: { [file]: [liveItem] },
        lspHasPublished: { [file]: true },
        lspStaleByFile: { [file]: true },
      },
      file,
    );
    expect(staleLsp.map((d) => d.code)).toEqual(['CS0103', 'CS8600']);

    // Once fresh LSP diagnostics arrive -> LSP diagnostics are authoritative
    const freshLsp = selectEffectiveDiagnosticsForFile(
      {
        buildDiagnostics: [],
        lspDiagnosticsByFile: { [file]: [deepLspItem] },
        liveDiagnosticsByFile: { [file]: [liveItem] },
        lspHasPublished: { [file]: true },
        lspStaleByFile: { [file]: false },
      },
      file,
    );
    expect(freshLsp).toEqual([deepLspItem]);
  });
});
