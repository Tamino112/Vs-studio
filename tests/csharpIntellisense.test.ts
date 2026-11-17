import { describe, expect, it } from 'vitest';
import {
  getBuiltInCSharpCompletions,
  getBuiltInCSharpHover,
  getBuiltInCSharpSignatureHelp,
  isDotCompletionPosition,
  mapLspCompletionKind,
} from '../src/utils/csharpIntellisense';
import { analyzeCSharpCode } from '../src/utils/csharpDiagnostics';

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

function completeAtEnd(code: string, triggerCharacter?: string) {
  const lines = code.split('\n');
  const lineNumber = lines.length;
  const column = lines[lines.length - 1].length + 1;
  const model = createMockModel(code);
  const ctx = triggerCharacter ? ({ triggerKind: 1, triggerCharacter } as never) : undefined;
  return getBuiltInCSharpCompletions(mockMonaco as never, model as never, { lineNumber, column } as never, ctx);
}

describe('C# Built-in IntelliSense & Visual Studio Tab Completion', () => {
  it('returns Console members for console. (case-insensitive) and excludes statement snippets', () => {
    const items = completeAtEnd('console.', '.');
    const labels = items.map((i) => i.label);

    expect(labels).toContain('WriteLine');
    expect(labels).toContain('ReadLine');
    expect(labels).toContain('ReadKey');
    expect(labels).toContain('ForegroundColor');
    expect(items.find((i) => i.label === 'ReadKey')?.insertText).toBe('ReadKey');
    expect(items.find((i) => i.label === 'WriteLine')?.insertText).toBe('WriteLine');
    expect(items[0]?.additionalTextEdits?.[0]?.text).toBe('Console');
    expect(labels).not.toContain('cw');
    expect(labels).not.toContain('ctor');
    expect(labels).not.toContain('async');
    expect(labels).not.toContain('prop');
  });

  it('offers TryParse, Parse, MaxValue, MinValue on int. and ranks TryParse #1 inside if (int.)', () => {
    const code = 'string eingabe = Console.ReadLine();\nif (int.Try';
    const items = completeAtEnd(code);
    const labels = items.map((i) => i.label);

    expect(labels).toContain('TryParse');
    expect(labels).toContain('Parse');
    expect(labels).toContain('MaxValue');
    expect(labels).toContain('MinValue');
    expect(labels).toContain('Clamp');
    // Strictly static members on `int.` — never instance `CompareTo` or snippets
    expect(labels).not.toContain('CompareTo');
    expect(labels).not.toContain('cw');
    expect(labels).not.toContain('if');

    const sorted = [...items].sort((a, b) => String(a.sortText).localeCompare(String(b.sortText)));
    expect(sorted[0].label).toBe('TryParse');
    expect(sorted[0].insertText).toBe('TryParse');
  });

  it('supports TryParse across all C# numeric, boolean, date/time, Guid, and Enum types', () => {
    for (const typeExpr of ['double.', 'decimal.', 'float.', 'long.', 'short.', 'byte.', 'bool.', 'char.', 'DateTime.', 'DateOnly.', 'TimeOnly.', 'TimeSpan.', 'Guid.', 'Enum.']) {
      const labels = completeAtEnd(typeExpr, '.').map((i) => i.label);
      expect(labels, `${typeExpr} should contain TryParse`).toContain('TryParse');
    }
  });

  it('strictly separates static vs. instance members on string and int', () => {
    const staticString = completeAtEnd('string.', '.').map((i) => i.label);
    expect(staticString).toContain('IsNullOrEmpty');
    expect(staticString).toContain('IsNullOrWhiteSpace');
    expect(staticString).toContain('Join');
    expect(staticString).toContain('Empty');
    expect(staticString).not.toContain('Trim');
    expect(staticString).not.toContain('Substring');

    const instString = completeAtEnd('string name = "Max";\nname.', '.').map((i) => i.label);
    expect(instString).toContain('Trim');
    expect(instString).toContain('Substring');
    expect(instString).toContain('Split');
    expect(instString).toContain('Contains');
    expect(instString).toContain('Length');
    expect(instString).not.toContain('IsNullOrEmpty');
    expect(instString).not.toContain('Join');

    const instInt = completeAtEnd('int count = 10;\ncount.', '.').map((i) => i.label);
    expect(instInt).toContain('ToString');
    expect(instInt).toContain('CompareTo');
    expect(instInt).toContain('Equals');
    expect(instInt).not.toContain('TryParse');
    expect(instInt).not.toContain('MaxValue');
  });

  it('resolves chained calls and LINQ element types accurately (Console.ReadLine()., Console.ReadKey()., DateTime.Now., First().)', () => {
    expect(completeAtEnd('Console.ReadLine().', '.').map((i) => i.label)).toContain('Trim');
    expect(completeAtEnd('Console.ReadKey().', '.').map((i) => i.label)).toEqual(
      expect.arrayContaining(['Key', 'KeyChar', 'Modifiers']),
    );
    expect(completeAtEnd('DateTime.Now.', '.').map((i) => i.label)).toEqual(
      expect.arrayContaining(['Year', 'Month', 'Day', 'AddDays', 'ToShortDateString']),
    );

    const linqCode = 'var names = new List<string>();\nnames.Where(x => x.Length > 2).';
    expect(completeAtEnd(linqCode, '.').map((i) => i.label)).toEqual(
      expect.arrayContaining(['Select', 'ToList', 'ToArray', 'FirstOrDefault']),
    );

    const elemCode = 'var names = new List<string>();\nnames.First().';
    expect(completeAtEnd(elemCode, '.').map((i) => i.label)).toEqual(
      expect.arrayContaining(['ToUpper', 'Trim', 'StartsWith']),
    );
  });

  it('suggests inline out declarations in TryParse arguments and resolves out/await/nullable/Dictionary variables afterwards', () => {
    const secondArg = completeAtEnd('if (int.TryParse(eingabe, ', ' ').map((i) => i.label);
    expect(secondArg[0]).toBe('out int result');
    expect(secondArg[1]).toBe('out var result');

    const afterOut = completeAtEnd('if (int.TryParse(eingabe, out ', ' ').map((i) => i.label);
    expect(afterOut[0]).toBe('int result');
    expect(afterOut[1]).toBe('var result');

    // Nested call `Console.ReadLine()` inside `int.TryParse(..., out var zahl)`
    const nestedOutCode =
      'if (int.TryParse(Console.ReadLine(), out var zahl))\n{\n  zahl.';
    const zahlMembers = completeAtEnd(nestedOutCode, '.').map((i) => i.label);
    expect(zahlMembers).toContain('CompareTo');
    expect(zahlMembers).not.toContain('TryParse');

    // Ensure csharpDiagnostics does NOT flag inline `out int zahl` inside $"..." as undefined CS0103
    const validTryParseProgram =
      'string? eingabe = Console.ReadLine();\nif (int.TryParse(eingabe, out int zahl))\n{\n    Console.WriteLine($"Eingegeben: {zahl}");\n}\n';
    const diags = analyzeCSharpCode('/App/Program.cs', 'App', validTryParseProgram);
    expect(diags.filter((d) => d.code === 'CS0103')).toHaveLength(0);

    // Dictionary<string, DateTime> TryGetValue out var + await Task<string> + int? nullable struct
    const dictCode =
      'var map = new Dictionary<string, DateTime>();\nif (map.TryGetValue("a", out var dt))\n{\n  dt.';
    expect(completeAtEnd(dictCode, '.').map((i) => i.label)).toContain('AddDays');

    const awaitCode = 'var content = await File.ReadAllTextAsync("test.txt");\ncontent.';
    expect(completeAtEnd(awaitCode, '.').map((i) => i.label)).toContain('Split');

    const nullableDot = completeAtEnd('int? maybe = 5;\nmaybe.', '.').map((i) => i.label);
    expect(nullableDot).toEqual(expect.arrayContaining(['HasValue', 'Value', 'GetValueOrDefault']));
    const nullableValueDot = completeAtEnd('int? maybe = 5;\nmaybe.Value.', '.').map((i) => i.label);
    expect(nullableValueDot).toContain('CompareTo');
  });

  it('filters completions strictly by syntax context (using, new, if-condition, enum assignment, class body, strings/comments)', () => {
    // 1. `using ` -> namespaces only
    const usingItems = completeAtEnd('using ', ' ').map((i) => i.label);
    expect(usingItems).toContain('System');
    expect(usingItems).toContain('System.Linq');
    expect(usingItems).not.toContain('Console');
    expect(usingItems).not.toContain('cw');

    const usingSub = completeAtEnd('using System.', '.').map((i) => i.label);
    expect(usingSub).toEqual(expect.arrayContaining(['Collections', 'IO', 'Linq', 'Text', 'Threading']));

    // 2. `new ` -> constructible types only (no static-only classes like Console or Math, no statement snippets)
    const newItems = completeAtEnd('var list = new ', ' ').map((i) => i.label);
    expect(newItems).toContain('List');
    expect(newItems).toContain('Dictionary');
    expect(newItems).toContain('StringBuilder');
    expect(newItems).not.toContain('Console');
    expect(newItems).not.toContain('Math');
    expect(newItems).not.toContain('cw');

    // 3. `if (` -> expression items only (no `cw`, `for`, `prop`, `ctor`, `public`, `namespace`)
    const ifExprItems = completeAtEnd('string input = "";\nif (in').map((i) => i.label);
    expect(ifExprItems).toContain('input');
    expect(ifExprItems).toContain('int');
    expect(ifExprItems).not.toContain('cw');
    expect(ifExprItems).not.toContain('for');
    expect(ifExprItems).not.toContain('prop');
    expect(ifExprItems).not.toContain('public');

    // 4. Enum assignment `Console.ForegroundColor = ` -> qualified ConsoleColor members at top
    const enumRhs = completeAtEnd('Console.ForegroundColor = ', ' ').map((i) => i.label);
    expect(enumRhs).toContain('ConsoleColor.Green');
    expect(enumRhs).toContain('ConsoleColor.Red');

    // 5. Class body `class Order { ` -> member snippets & modifiers, NOT statement snippets (`cw`, `while`)
    const classBodyItems = completeAtEnd('class Order\n{\n    pr').map((i) => i.label);
    expect(classBodyItems).toEqual(expect.arrayContaining(['prop', 'propg', 'propfull', 'ctor', 'private', 'protected']));
    expect(classBodyItems).not.toContain('cw');
    expect(classBodyItems).not.toContain('foreach');

    // 6. Plain strings & comments suppress code completions, while $"...{expr}" and /// work
    expect(completeAtEnd('string s = "int.', '.')).toHaveLength(0);
    expect(completeAtEnd('// int.', '.')).toHaveLength(0);
    expect(completeAtEnd('int num = 7;\nstring s = $"Wert: {num.', '.').map((i) => i.label)).toContain('CompareTo');
    expect(completeAtEnd('/// ', ' ').map((i) => i.label)).toEqual(expect.arrayContaining(['summary', 'param', 'returns']));

    // 7. Variable declaration identifier (`int meineZahl`) does not offer keywords that hijack Tab
    const namingItems = completeAtEnd('int meineZahl').map((i) => i.label);
    expect(namingItems).not.toContain('int');
    expect(namingItems).not.toContain('sizeof');
    expect(namingItems).not.toContain('cw');
  });

  it('discovers user-defined classes, records, and enums in the current file', () => {
    const code = [
      'enum OrderStatus { Pending, Paid, Shipped }',
      'record Customer(string Name, int Age);',
      'var c = new Customer("Ada", 30);',
      'c.',
    ].join('\n');
    const customerMembers = completeAtEnd(code, '.').map((i) => i.label);
    expect(customerMembers).toEqual(expect.arrayContaining(['Name', 'Age', 'ToString']));

    const enumCode = 'enum OrderStatus { Pending, Paid, Shipped }\nOrderStatus.';
    expect(completeAtEnd(enumCode, '.').map((i) => i.label)).toEqual(['Pending', 'Paid', 'Shipped']);
  });

  it('provides global types, keywords, and snippets at statement start', () => {
    const model = createMockModel('Con');
    const items = getBuiltInCSharpCompletions(mockMonaco as never, model as never, { lineNumber: 1, column: 4 } as never);
    const labels = items.map((i) => i.label);

    expect(labels).toContain('Console');
    expect(labels).toContain('cw');
    expect(labels).toContain('var');
    expect(isDotCompletionPosition(model as never, { lineNumber: 1, column: 4 } as never)).toBe(false);
    expect(isDotCompletionPosition(createMockModel('int.') as never, { lineNumber: 1, column: 5 } as never)).toBe(true);
  });

  it('provides accurate Hover and nested-parenthesis Signature Help for int.TryParse', () => {
    const hoverModel = createMockModel('if (int.TryParse(s, out int x))');
    const hover = getBuiltInCSharpHover(hoverModel as never, { lineNumber: 1, column: 12 } as never);
    expect(hover).not.toBeNull();
    expect(JSON.stringify(hover?.contents)).toContain('int.TryParse');

    const sigCode = 'if (int.TryParse(Console.ReadLine(), ';
    const sigModel = createMockModel(sigCode);
    const sig = getBuiltInCSharpSignatureHelp(
      sigModel as never,
      { lineNumber: 1, column: sigCode.length + 1 } as never,
    );
    expect(sig).not.toBeNull();
    expect(sig?.activeParameter).toBe(1);
    expect(sig?.signatures[sig.activeSignature].label).toContain('out int result');
  });

  it('maps LSP CompletionItemKind codes accurately', () => {
    expect(mapLspCompletionKind(mockMonaco as never, 2)).toBe(0); // Method
    expect(mapLspCompletionKind(mockMonaco as never, 7)).toBe(5); // Class
    expect(mapLspCompletionKind(mockMonaco as never, 15)).toBe(27); // Snippet
  });
});
