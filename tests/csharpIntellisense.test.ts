import { describe, expect, it } from 'vitest';
import { getBuiltInCSharpCompletions, mapLspCompletionKind } from '../src/utils/csharpIntellisense';

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

function createMockModel(text: string) {
  const lines = text.split('\n');
  return {
    getValue: () => text,
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
  };
}

describe('C# Built-in IntelliSense', () => {
  it('returns Console members for console. (case-insensitive) and excludes statement snippets', () => {
    const model = createMockModel('console.');
    const items = getBuiltInCSharpCompletions(mockMonaco as never, model as never, { lineNumber: 1, column: 9 } as never);
    const labels = items.map((i) => i.label);

    expect(labels).toContain('WriteLine');
    expect(labels).toContain('ReadLine');
    expect(labels).toContain('ForegroundColor');
    expect(labels).not.toContain('cw');
    expect(labels).not.toContain('ctor');
    expect(labels).not.toContain('async');
    expect(labels).not.toContain('prop');
  });

  it('infers variable types for dot completions (e.g. var items = new List<string>(); items.)', () => {
    const code = 'var items = new List<string>();\nitems.';
    const model = createMockModel(code);
    const items = getBuiltInCSharpCompletions(mockMonaco as never, model as never, { lineNumber: 2, column: 7 } as never);
    const labels = items.map((i) => i.label);

    expect(labels).toContain('Add');
    expect(labels).toContain('Where');
    expect(labels).toContain('Count');
  });

  it('provides global types, keywords, and snippets when not after a dot', () => {
    const model = createMockModel('Con');
    const items = getBuiltInCSharpCompletions(mockMonaco as never, model as never, { lineNumber: 1, column: 4 } as never);
    const labels = items.map((i) => i.label);

    expect(labels).toContain('Console');
    expect(labels).toContain('cw');
    expect(labels).toContain('var');
  });

  it('maps LSP CompletionItemKind codes accurately', () => {
    expect(mapLspCompletionKind(mockMonaco as never, 2)).toBe(0); // Method
    expect(mapLspCompletionKind(mockMonaco as never, 7)).toBe(5); // Class
    expect(mapLspCompletionKind(mockMonaco as never, 15)).toBe(27); // Snippet
  });
});
