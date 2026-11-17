import type * as monaco from 'monaco-editor';

export interface MemberItem {
  label: string;
  kind: 'Method' | 'Property' | 'Field' | 'Event' | 'EnumMember';
  detail: string;
  insertText?: string;
  isSnippet?: boolean;
  documentation?: string;
}

const TYPE_MEMBERS: Record<string, MemberItem[]> = {
  Console: [
    { label: 'WriteLine', kind: 'Method', detail: 'void Console.WriteLine(string? value)', documentation: 'Writes the specified data, followed by the current line terminator, to the standard output stream.' },
    { label: 'Write', kind: 'Method', detail: 'void Console.Write(string? value)', documentation: 'Writes the specified value to the standard output stream.' },
    { label: 'ReadLine', kind: 'Method', detail: 'string? Console.ReadLine()', documentation: 'Reads the next line of characters from the standard input stream.' },
    { label: 'ReadKey', kind: 'Method', detail: 'ConsoleKeyInfo Console.ReadKey()', documentation: 'Obtains the next character or function key pressed by the user.' },
    { label: 'Read', kind: 'Method', detail: 'int Console.Read()' },
    { label: 'Clear', kind: 'Method', detail: 'void Console.Clear()' },
    { label: 'Beep', kind: 'Method', detail: 'void Console.Beep()' },
    { label: 'ResetColor', kind: 'Method', detail: 'void Console.ResetColor()' },
    { label: 'SetCursorPosition', kind: 'Method', detail: 'void Console.SetCursorPosition(int left, int top)' },
    { label: 'ForegroundColor', kind: 'Property', detail: 'ConsoleColor Console.ForegroundColor { get; set; }' },
    { label: 'BackgroundColor', kind: 'Property', detail: 'ConsoleColor Console.BackgroundColor { get; set; }' },
    { label: 'Title', kind: 'Property', detail: 'string Console.Title { get; set; }' },
    { label: 'Out', kind: 'Property', detail: 'TextWriter Console.Out { get; }' },
    { label: 'Error', kind: 'Property', detail: 'TextWriter Console.Error { get; }' },
    { label: 'In', kind: 'Property', detail: 'TextReader Console.In { get; }' },
    { label: 'WindowWidth', kind: 'Property', detail: 'int Console.WindowWidth { get; set; }' },
    { label: 'WindowHeight', kind: 'Property', detail: 'int Console.WindowHeight { get; set; }' },
  ],
  Math: [
    { label: 'Abs', kind: 'Method', detail: 'T Math.Abs(T value)' },
    { label: 'Max', kind: 'Method', detail: 'T Math.Max(T val1, T val2)' },
    { label: 'Min', kind: 'Method', detail: 'T Math.Min(T val1, T val2)' },
    { label: 'Pow', kind: 'Method', detail: 'double Math.Pow(double x, double y)' },
    { label: 'Sqrt', kind: 'Method', detail: 'double Math.Sqrt(double d)' },
    { label: 'Round', kind: 'Method', detail: 'double Math.Round(double a)' },
    { label: 'Floor', kind: 'Method', detail: 'double Math.Floor(double d)' },
    { label: 'Ceiling', kind: 'Method', detail: 'double Math.Ceiling(double a)' },
    { label: 'Clamp', kind: 'Method', detail: 'T Math.Clamp(T value, T min, T max)' },
    { label: 'PI', kind: 'Field', detail: 'const double Math.PI = 3.1415926535897931' },
    { label: 'E', kind: 'Field', detail: 'const double Math.E = 2.7182818284590451' },
  ],
  File: [
    { label: 'ReadAllText', kind: 'Method', detail: 'string File.ReadAllText(string path)' },
    { label: 'ReadAllTextAsync', kind: 'Method', detail: 'Task<string> File.ReadAllTextAsync(string path)' },
    { label: 'ReadAllLines', kind: 'Method', detail: 'string[] File.ReadAllLines(string path)' },
    { label: 'WriteAllText', kind: 'Method', detail: 'void File.WriteAllText(string path, string? contents)' },
    { label: 'WriteAllTextAsync', kind: 'Method', detail: 'Task File.WriteAllTextAsync(string path, string? contents)' },
    { label: 'Exists', kind: 'Method', detail: 'bool File.Exists(string? path)' },
    { label: 'Delete', kind: 'Method', detail: 'void File.Delete(string path)' },
    { label: 'Copy', kind: 'Method', detail: 'void File.Copy(string source, string dest)' },
  ],
  Directory: [
    { label: 'Exists', kind: 'Method', detail: 'bool Directory.Exists(string? path)' },
    { label: 'CreateDirectory', kind: 'Method', detail: 'DirectoryInfo Directory.CreateDirectory(string path)' },
    { label: 'GetFiles', kind: 'Method', detail: 'string[] Directory.GetFiles(string path)' },
    { label: 'GetDirectories', kind: 'Method', detail: 'string[] Directory.GetDirectories(string path)' },
    { label: 'GetCurrentDirectory', kind: 'Method', detail: 'string Directory.GetCurrentDirectory()' },
  ],
  Path: [
    { label: 'Combine', kind: 'Method', detail: 'string Path.Combine(params string[] paths)' },
    { label: 'Join', kind: 'Method', detail: 'string Path.Join(params string?[] paths)' },
    { label: 'GetFileName', kind: 'Method', detail: 'string? Path.GetFileName(string? path)' },
    { label: 'GetExtension', kind: 'Method', detail: 'string? Path.GetExtension(string? path)' },
    { label: 'GetDirectoryName', kind: 'Method', detail: 'string? Path.GetDirectoryName(string? path)' },
  ],
  Environment: [
    { label: 'CurrentDirectory', kind: 'Property', detail: 'string Environment.CurrentDirectory { get; set; }' },
    { label: 'MachineName', kind: 'Property', detail: 'string Environment.MachineName { get; }' },
    { label: 'UserName', kind: 'Property', detail: 'string Environment.UserName { get; }' },
    { label: 'OSVersion', kind: 'Property', detail: 'OperatingSystem Environment.OSVersion { get; }' },
    { label: 'Version', kind: 'Property', detail: 'Version Environment.Version { get; }' },
    { label: 'NewLine', kind: 'Property', detail: 'string Environment.NewLine { get; }' },
    { label: 'Exit', kind: 'Method', detail: 'void Environment.Exit(int exitCode)' },
    { label: 'GetEnvironmentVariable', kind: 'Method', detail: 'string? Environment.GetEnvironmentVariable(string variable)' },
  ],
  DateTime: [
    { label: 'Now', kind: 'Property', detail: 'DateTime DateTime.Now { get; }' },
    { label: 'UtcNow', kind: 'Property', detail: 'DateTime DateTime.UtcNow { get; }' },
    { label: 'Today', kind: 'Property', detail: 'DateTime DateTime.Today { get; }' },
    { label: 'Parse', kind: 'Method', detail: 'DateTime DateTime.Parse(string s)' },
    { label: 'TryParse', kind: 'Method', detail: 'bool DateTime.TryParse(string? s, out DateTime result)' },
  ],
  Task: [
    { label: 'Delay', kind: 'Method', detail: 'Task Task.Delay(int millisecondsDelay)' },
    { label: 'Run', kind: 'Method', detail: 'Task Task.Run(Action action)' },
    { label: 'WhenAll', kind: 'Method', detail: 'Task Task.WhenAll(params Task[] tasks)' },
    { label: 'WhenAny', kind: 'Method', detail: 'Task<Task> Task.WhenAny(params Task[] tasks)' },
    { label: 'FromResult', kind: 'Method', detail: 'Task<T> Task.FromResult<T>(T result)' },
    { label: 'CompletedTask', kind: 'Property', detail: 'Task Task.CompletedTask { get; }' },
  ],
  Convert: [
    { label: 'ToInt32', kind: 'Method', detail: 'int Convert.ToInt32(object? value)' },
    { label: 'ToDouble', kind: 'Method', detail: 'double Convert.ToDouble(object? value)' },
    { label: 'ToString', kind: 'Method', detail: 'string? Convert.ToString(object? value)' },
    { label: 'ToBoolean', kind: 'Method', detail: 'bool Convert.ToBoolean(object? value)' },
  ],
  Guid: [
    { label: 'NewGuid', kind: 'Method', detail: 'Guid Guid.NewGuid()' },
    { label: 'CreateVersion7', kind: 'Method', detail: 'Guid Guid.CreateVersion7() (.NET 9+)' },
    { label: 'Empty', kind: 'Field', detail: 'readonly Guid Guid.Empty' },
    { label: 'Parse', kind: 'Method', detail: 'Guid Guid.Parse(string input)' },
  ],
  JsonSerializer: [
    { label: 'Serialize', kind: 'Method', detail: 'string JsonSerializer.Serialize<T>(T value)' },
    { label: 'Deserialize', kind: 'Method', detail: 'T? JsonSerializer.Deserialize<T>(string json)' },
  ],
  string: [
    { label: 'Length', kind: 'Property', detail: 'int string.Length { get; }' },
    { label: 'IsNullOrEmpty', kind: 'Method', detail: 'bool string.IsNullOrEmpty(string? value)' },
    { label: 'IsNullOrWhiteSpace', kind: 'Method', detail: 'bool string.IsNullOrWhiteSpace(string? value)' },
    { label: 'Split', kind: 'Method', detail: 'string[] string.Split(params char[]? separator)' },
    { label: 'Trim', kind: 'Method', detail: 'string string.Trim()' },
    { label: 'ToLower', kind: 'Method', detail: 'string string.ToLower()' },
    { label: 'ToUpper', kind: 'Method', detail: 'string string.ToUpper()' },
    { label: 'Contains', kind: 'Method', detail: 'bool string.Contains(string value)' },
    { label: 'StartsWith', kind: 'Method', detail: 'bool string.StartsWith(string value)' },
    { label: 'EndsWith', kind: 'Method', detail: 'bool string.EndsWith(string value)' },
    { label: 'Replace', kind: 'Method', detail: 'string string.Replace(string oldValue, string? newValue)' },
    { label: 'Substring', kind: 'Method', detail: 'string string.Substring(int startIndex)' },
    { label: 'Join', kind: 'Method', detail: 'string string.Join(string? separator, IEnumerable<string?> values)' },
  ],
  List: [
    { label: 'Count', kind: 'Property', detail: 'int List<T>.Count { get; }' },
    { label: 'Add', kind: 'Method', detail: 'void List<T>.Add(T item)' },
    { label: 'AddRange', kind: 'Method', detail: 'void List<T>.AddRange(IEnumerable<T> collection)' },
    { label: 'Remove', kind: 'Method', detail: 'bool List<T>.Remove(T item)' },
    { label: 'Clear', kind: 'Method', detail: 'void List<T>.Clear()' },
    { label: 'Contains', kind: 'Method', detail: 'bool List<T>.Contains(T item)' },
    { label: 'Sort', kind: 'Method', detail: 'void List<T>.Sort()' },
    { label: 'Where', kind: 'Method', detail: 'IEnumerable<T> Enumerable.Where<T>(Func<T, bool> predicate)' },
    { label: 'Select', kind: 'Method', detail: 'IEnumerable<TResult> Enumerable.Select<T, TResult>(Func<T, TResult> selector)' },
    { label: 'FirstOrDefault', kind: 'Method', detail: 'T? Enumerable.FirstOrDefault<T>()' },
    { label: 'ToList', kind: 'Method', detail: 'List<T> Enumerable.ToList<T>()' },
    { label: 'Any', kind: 'Method', detail: 'bool Enumerable.Any<T>()' },
  ],
  WebApplication: [
    { label: 'CreateBuilder', kind: 'Method', detail: 'WebApplicationBuilder WebApplication.CreateBuilder(string[] args)' },
    { label: 'CreateSlimBuilder', kind: 'Method', detail: 'WebApplicationBuilder WebApplication.CreateSlimBuilder(string[] args)' },
  ],
  builder: [
    { label: 'Services', kind: 'Property', detail: 'IServiceCollection WebApplicationBuilder.Services { get; }' },
    { label: 'Configuration', kind: 'Property', detail: 'ConfigurationManager WebApplicationBuilder.Configuration { get; }' },
    { label: 'Logging', kind: 'Property', detail: 'ILoggingBuilder WebApplicationBuilder.Logging { get; }' },
    { label: 'Environment', kind: 'Property', detail: 'IWebHostEnvironment WebApplicationBuilder.Environment { get; }' },
    { label: 'Build', kind: 'Method', detail: 'WebApplication WebApplicationBuilder.Build()' },
  ],
  app: [
    { label: 'MapGet', kind: 'Method', detail: 'RouteHandlerBuilder MapGet(string pattern, Delegate handler)' },
    { label: 'MapPost', kind: 'Method', detail: 'RouteHandlerBuilder MapPost(string pattern, Delegate handler)' },
    { label: 'MapPut', kind: 'Method', detail: 'RouteHandlerBuilder MapPut(string pattern, Delegate handler)' },
    { label: 'MapDelete', kind: 'Method', detail: 'RouteHandlerBuilder MapDelete(string pattern, Delegate handler)' },
    { label: 'MapControllers', kind: 'Method', detail: 'ControllerActionEndpointConventionBuilder MapControllers()' },
    { label: 'UseHttpsRedirection', kind: 'Method', detail: 'IApplicationBuilder UseHttpsRedirection()' },
    { label: 'UseAuthorization', kind: 'Method', detail: 'IApplicationBuilder UseAuthorization()' },
    { label: 'Run', kind: 'Method', detail: 'void WebApplication.Run()' },
  ],
  Assert: [
    { label: 'True', kind: 'Method', detail: 'void Assert.True(bool condition)' },
    { label: 'False', kind: 'Method', detail: 'void Assert.False(bool condition)' },
    { label: 'Equal', kind: 'Method', detail: 'void Assert.Equal<T>(T expected, T actual)' },
    { label: 'NotEqual', kind: 'Method', detail: 'void Assert.NotEqual<T>(T expected, T actual)' },
    { label: 'NotNull', kind: 'Method', detail: 'void Assert.NotNull(object? @object)' },
    { label: 'Null', kind: 'Method', detail: 'void Assert.Null(object? @object)' },
    { label: 'Throws', kind: 'Method', detail: 'T Assert.Throws<T>(Action testCode)' },
  ],
};

const ALIAS_MAP: Record<string, string> = {
  String: 'string',
  Int32: 'int',
  Random: 'Random',
};

const RANDOM_MEMBERS: MemberItem[] = [
  { label: 'Next', kind: 'Method', detail: 'int Random.Next(int minValue, int maxValue)' },
  { label: 'NextDouble', kind: 'Method', detail: 'double Random.NextDouble()' },
  { label: 'Shared', kind: 'Property', detail: 'Random Random.Shared { get; }' },
];
TYPE_MEMBERS.Random = RANDOM_MEMBERS;

const GLOBAL_TYPES: Array<{ label: string; kind: 'Class' | 'Struct'; detail: string }> = [
  { label: 'Console', kind: 'Class', detail: 'System.Console' },
  { label: 'Math', kind: 'Class', detail: 'System.Math' },
  { label: 'File', kind: 'Class', detail: 'System.IO.File' },
  { label: 'Directory', kind: 'Class', detail: 'System.IO.Directory' },
  { label: 'Path', kind: 'Class', detail: 'System.IO.Path' },
  { label: 'Environment', kind: 'Class', detail: 'System.Environment' },
  { label: 'DateTime', kind: 'Struct', detail: 'System.DateTime' },
  { label: 'TimeSpan', kind: 'Struct', detail: 'System.TimeSpan' },
  { label: 'Guid', kind: 'Struct', detail: 'System.Guid' },
  { label: 'Convert', kind: 'Class', detail: 'System.Convert' },
  { label: 'Random', kind: 'Class', detail: 'System.Random' },
  { label: 'Task', kind: 'Class', detail: 'System.Threading.Tasks.Task' },
  { label: 'List', kind: 'Class', detail: 'System.Collections.Generic.List<T>' },
  { label: 'Dictionary', kind: 'Class', detail: 'System.Collections.Generic.Dictionary<TKey, TValue>' },
  { label: 'HashSet', kind: 'Class', detail: 'System.Collections.Generic.HashSet<T>' },
  { label: 'StringBuilder', kind: 'Class', detail: 'System.Text.StringBuilder' },
  { label: 'HttpClient', kind: 'Class', detail: 'System.Net.Http.HttpClient' },
  { label: 'JsonSerializer', kind: 'Class', detail: 'System.Text.Json.JsonSerializer' },
  { label: 'Exception', kind: 'Class', detail: 'System.Exception' },
  { label: 'ArgumentException', kind: 'Class', detail: 'System.ArgumentException' },
  { label: 'InvalidOperationException', kind: 'Class', detail: 'System.InvalidOperationException' },
  { label: 'WebApplication', kind: 'Class', detail: 'Microsoft.AspNetCore.Builder.WebApplication' },
  { label: 'Assert', kind: 'Class', detail: 'Xunit.Assert' },
  { label: 'CancellationToken', kind: 'Struct', detail: 'System.Threading.CancellationToken' },
];

const CSHARP_KEYWORDS = [
  'var', 'string', 'int', 'long', 'double', 'float', 'decimal', 'bool', 'char', 'byte', 'object', 'dynamic',
  'void', 'public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'class', 'struct',
  'record', 'interface', 'enum', 'namespace', 'using', 'return', 'if', 'else', 'switch', 'case', 'default',
  'for', 'foreach', 'while', 'do', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'await',
  'async', 'true', 'false', 'null', 'this', 'base', 'is', 'as', 'typeof', 'nameof', 'sizeof',
];

function toMonacoKind(monacoInst: typeof monaco, k: MemberItem['kind']): monaco.languages.CompletionItemKind {
  switch (k) {
    case 'Method': return monacoInst.languages.CompletionItemKind.Method;
    case 'Property': return monacoInst.languages.CompletionItemKind.Property;
    case 'Field': return monacoInst.languages.CompletionItemKind.Field;
    case 'Event': return monacoInst.languages.CompletionItemKind.Event;
    case 'EnumMember': return monacoInst.languages.CompletionItemKind.EnumMember;
  }
}

export function mapLspCompletionKind(monacoInst: typeof monaco, lspKind?: number): monaco.languages.CompletionItemKind {
  switch (lspKind) {
    case 1: return monacoInst.languages.CompletionItemKind.Text;
    case 2: return monacoInst.languages.CompletionItemKind.Method;
    case 3: return monacoInst.languages.CompletionItemKind.Function;
    case 4: return monacoInst.languages.CompletionItemKind.Constructor;
    case 5: return monacoInst.languages.CompletionItemKind.Field;
    case 6: return monacoInst.languages.CompletionItemKind.Variable;
    case 7: return monacoInst.languages.CompletionItemKind.Class;
    case 8: return monacoInst.languages.CompletionItemKind.Interface;
    case 9: return monacoInst.languages.CompletionItemKind.Module;
    case 10: return monacoInst.languages.CompletionItemKind.Property;
    case 11: return monacoInst.languages.CompletionItemKind.Unit;
    case 12: return monacoInst.languages.CompletionItemKind.Value;
    case 13: return monacoInst.languages.CompletionItemKind.Enum;
    case 14: return monacoInst.languages.CompletionItemKind.Keyword;
    case 15: return monacoInst.languages.CompletionItemKind.Snippet;
    case 16: return monacoInst.languages.CompletionItemKind.Color;
    case 17: return monacoInst.languages.CompletionItemKind.File;
    case 18: return monacoInst.languages.CompletionItemKind.Reference;
    case 19: return monacoInst.languages.CompletionItemKind.Folder;
    case 20: return monacoInst.languages.CompletionItemKind.EnumMember;
    case 21: return monacoInst.languages.CompletionItemKind.Constant;
    case 22: return monacoInst.languages.CompletionItemKind.Struct;
    case 23: return monacoInst.languages.CompletionItemKind.Event;
    case 24: return monacoInst.languages.CompletionItemKind.Operator;
    case 25: return monacoInst.languages.CompletionItemKind.TypeParameter;
    default: return monacoInst.languages.CompletionItemKind.Text;
  }
}

function inferVariableType(fullText: string, identifier: string): string | null {
  const esc = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match `var x = new TypeName...` or `TypeName x = ...` or `string x`
  const newRegex = new RegExp(`(?:var|[\\w<>\\[\\]?]+)\\s+${esc}\\s*=\\s*new\\s+([\\w]+)`, 'm');
  const mNew = newRegex.exec(fullText);
  if (mNew) return ALIAS_MAP[mNew[1]] || mNew[1];

  const varStringRegex = new RegExp(`\\bvar\\s+${esc}\\s*=\\s*(?:"|\\$|"|Console\\.ReadLine)`, 'm');
  if (varStringRegex.test(fullText)) return 'string';

  const explicitRegex = new RegExp(`\\b(string|List|Random|WebApplication|DateTime|Task|StringBuilder|HttpClient)\\b(?:<[^>]+>)?\\s+${esc}\\b`, 'm');
  const mExp = explicitRegex.exec(fullText);
  if (mExp) return mExp[1];

  const builderRegex = new RegExp(`\\bvar\\s+${esc}\\s*=\\s*WebApplication\\.Create`, 'm');
  if (builderRegex.test(fullText)) return 'builder';

  const appRegex = new RegExp(`\\bvar\\s+${esc}\\s*=\\s*builder\\.Build\\(`, 'm');
  if (appRegex.test(fullText)) return 'app';

  return null;
}

function extractDocumentSymbols(
  monacoInst: typeof monaco,
  fullText: string,
): Array<{ label: string; kind: monaco.languages.CompletionItemKind; detail: string }> {
  const found = new Map<string, { label: string; kind: monaco.languages.CompletionItemKind; detail: string }>();

  const typeDecl = /\b(?:class|struct|record|interface|enum)\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = typeDecl.exec(fullText)) !== null) {
    found.set(m[1], {
      label: m[1],
      kind: monacoInst.languages.CompletionItemKind.Class,
      detail: 'Declared type',
    });
  }

  const varDecl =
    /\b(?:var|string|int|long|double|float|bool|char|byte|decimal|object|dynamic|DateTime|Guid|Task(?:<[^>]+>)?|List<[^>]+>|Dictionary<[^>]+>|[A-Z][A-Za-z0-9_]*)(?:<[^>]+>)?(?:\[\])?\??\s+([A-Za-z_]\w*)\s*[=;,)]/g;
  while ((m = varDecl.exec(fullText)) !== null) {
    if (!found.has(m[1]) && !CSHARP_KEYWORDS.includes(m[1])) {
      found.set(m[1], {
        label: m[1],
        kind: monacoInst.languages.CompletionItemKind.Variable,
        detail: 'Local / field',
      });
    }
  }

  return [...found.values()];
}

export function getBuiltInCSharpHover(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.Hover | null {
  const wordInfo = model.getWordAtPosition(position);
  if (!wordInfo) return null;
  const line = model.getLineContent(position.lineNumber);
  const word = wordInfo.word;

  // Member hover like Console.WriteLine
  const before = line.slice(0, wordInfo.startColumn - 1);
  const dotMatch = /([A-Za-z_]\w*)\.\s*$/.exec(before);
  if (dotMatch) {
    const ownerRaw = dotMatch[1];
    const matchedOwner = Object.keys(TYPE_MEMBERS).find((k) => k.toLowerCase() === ownerRaw.toLowerCase());
    if (matchedOwner) {
      const member = TYPE_MEMBERS[matchedOwner].find((m) => m.label === word);
      if (member) {
        return {
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: wordInfo.startColumn,
            endColumn: wordInfo.endColumn,
          },
          contents: [
            { value: `\`\`\`csharp\n${member.detail}\n\`\`\`` },
            ...(member.documentation ? [{ value: member.documentation }] : []),
          ],
        };
      }
    }
  }

  // Global type hover
  const globalType = GLOBAL_TYPES.find((g) => g.label === word);
  if (globalType) {
    return {
      range: {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
      },
      contents: [{ value: `\`\`\`csharp\n${globalType.kind.toLowerCase()} ${globalType.detail}\n\`\`\`` }],
    };
  }

  // Declared variable type hover
  const fullText = model.getValue();
  const varTypeMatch = new RegExp(`\\b(var|string|int|long|double|float|bool|char|byte|decimal|object|dynamic|DateTime|Guid|Task(?:<[^>]+>)?|List<[^>]+>|Dictionary<[^>]+>|[A-Z][A-Za-z0-9_]*)(?:\\[\\])?\\??\\s+${word}\\b`).exec(fullText);
  if (varTypeMatch) {
    return {
      range: {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
      },
      contents: [{ value: `\`\`\`csharp\n(local variable) ${varTypeMatch[1]} ${word}\n\`\`\`` }],
    };
  }

  return null;
}

export function getBuiltInCSharpCompletions(
  monacoInst: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem[] {
  const lineUntilCursor = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const word = model.getWordUntilPosition(position);
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  // Check if user is after a dot: e.g. `Console.` or `console.Wr` or `"hello".`
  const memberAccessMatch = /([A-Za-z_]\w*|"[^"]*")\.\s*([A-Za-z_]\w*)?$/.exec(lineUntilCursor);
  if (memberAccessMatch) {
    const rawTarget = memberAccessMatch[1];
    const fullText = model.getValue();

    let resolvedKey: string | null = null;
    let needsCaseFix = false;
    if (rawTarget.startsWith('"')) {
      resolvedKey = 'string';
    } else {
      const lowerTarget = rawTarget.toLowerCase();
      const staticMatch = Object.keys(TYPE_MEMBERS).find((k) => k.toLowerCase() === lowerTarget);
      if (staticMatch) {
        resolvedKey = staticMatch;
        if (staticMatch !== rawTarget && /^[A-Z]/.test(staticMatch)) {
          needsCaseFix = true;
        }
      } else {
        const inferred = inferVariableType(fullText, rawTarget);
        if (inferred && TYPE_MEMBERS[inferred]) {
          resolvedKey = inferred;
        }
      }
    }

    if (!resolvedKey) return [];

    const targetStartColumn = lineUntilCursor.length - memberAccessMatch[0].length + 1;
    const fixEdits: monaco.languages.TextEdit[] | undefined = needsCaseFix
      ? [
          {
            range: {
              startLineNumber: position.lineNumber,
              startColumn: targetStartColumn,
              endLineNumber: position.lineNumber,
              endColumn: targetStartColumn + rawTarget.length,
            },
            text: resolvedKey,
          },
        ]
      : undefined;

    return TYPE_MEMBERS[resolvedKey].map((m) => ({
      label: m.label,
      kind: toMonacoKind(monacoInst, m.kind),
      detail: m.detail,
      documentation: m.documentation,
      insertText: m.insertText || m.label,
      insertTextRules: m.isSnippet
        ? monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      additionalTextEdits: fixEdits,
      range,
    }));
  }

  // Not after a dot: provide global .NET types, keywords, document symbols, and snippets
  const fullText = model.getValue();
  const docSymbols = extractDocumentSymbols(monacoInst, fullText);

  const snippets: monaco.languages.CompletionItem[] = [
    {
      label: 'cw',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'Console.WriteLine(${1:value});',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'Console.WriteLine snippet',
      range,
    },
    {
      label: 'prop',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'public ${1:int} ${2:MyProperty} { get; set; }',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'Auto-implemented property',
      range,
    },
    {
      label: 'ctor',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'public ${1:ClassName}(${2})\n{\n    ${0}\n}',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'Constructor',
      range,
    },
    {
      label: 'record',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'public record ${1:MyRecord}(${2:string Name});',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'C# record declaration',
      range,
    },
    {
      label: 'async',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'public async Task<${1:string}> ${2:ExecuteAsync}(CancellationToken ct = default)\n{\n    ${0}\n}',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'Async Task method',
      range,
    },
    {
      label: 'for',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++)\n{\n    ${0}\n}',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'for loop',
      range,
    },
    {
      label: 'foreach',
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      insertText: 'foreach (var ${1:item} in ${2:collection})\n{\n    ${0}\n}',
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: 'foreach loop',
      range,
    },
  ];

  return [
    ...docSymbols.map((s) => ({ ...s, insertText: s.label, range })),
    ...GLOBAL_TYPES.map((g) => ({
      label: g.label,
      kind:
        g.kind === 'Class'
          ? monacoInst.languages.CompletionItemKind.Class
          : monacoInst.languages.CompletionItemKind.Struct,
      detail: g.detail,
      insertText: g.label,
      range,
    })),
    ...CSHARP_KEYWORDS.map((kw) => ({
      label: kw,
      kind: monacoInst.languages.CompletionItemKind.Keyword,
      detail: 'C# keyword',
      insertText: kw,
      range,
    })),
    ...snippets,
  ];
}

export function getBuiltInCSharpSignatureHelp(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.SignatureHelp | null {
  const before = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const callMatch = /([A-Za-z_]\w*\.[A-Za-z_]\w*)\s*\(([^()]*)$/.exec(before);
  if (!callMatch) return null;

  const [typeRaw, methodRaw] = callMatch[1].split('.');
  const matchedKey = Object.keys(TYPE_MEMBERS).find((k) => k.toLowerCase() === typeRaw.toLowerCase());
  if (!matchedKey) return null;

  const member = TYPE_MEMBERS[matchedKey].find((m) => m.label.toLowerCase() === methodRaw.toLowerCase());
  if (!member) return null;

  const activeParam = callMatch[2].split(',').length - 1;
  const sigText = member.detail;
  const paramsMatch = /\(([^)]*)\)/.exec(sigText);
  const parameters = (paramsMatch?.[1] || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ label: p }));

  return {
    signatures: [
      {
        label: sigText,
        documentation: member.documentation,
        parameters,
      },
    ],
    activeSignature: 0,
    activeParameter: Math.max(0, Math.min(activeParam, Math.max(0, parameters.length - 1))),
  };
}

export const CSHARP_SEMANTIC_LEGEND = {
  tokenTypes: ['type', 'method', 'variable', 'property', 'keyword'],
  tokenModifiers: ['static'],
};

const CONTROL_KEYWORDS = new Set([
  'if', 'else', 'switch', 'case', 'default', 'for', 'foreach', 'while', 'do',
  'break', 'continue', 'return', 'yield', 'try', 'catch', 'finally', 'throw', 'await',
]);

export function encodeCSharpSemanticTokens(code: string): Uint32Array {
  const lines = code.split(/\r?\n/);
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  const declaredVars = new Set<string>(['args', 'app', 'builder']);
  const varRegex = /\b(?:var|string|int|long|double|float|bool|char|byte|decimal|object|DateTime|Guid|Task(?:<[^>]+>)?|List<[^>]+>|Dictionary<[^>]+>|[A-Z][A-Za-z0-9_]*)(?:\[\])?\??\s+([A-Za-z_]\w*)\s*(?:=|;|,|\))/g;
  let vm: RegExpExecArray | null;
  while ((vm = varRegex.exec(code)) !== null) {
    declaredVars.add(vm[1]);
  }
  const knownTypes = new Set(GLOBAL_TYPES.map((t) => t.label));
  const declaredTypeRegex = /\b(?:class|struct|record|interface|enum)\s+([A-Za-z_]\w*)/g;
  while ((vm = declaredTypeRegex.exec(code)) !== null) {
    knownTypes.add(vm[1]);
  }

  const pushToken = (lineIdx: number, colIdx: number, length: number, typeIdx: number) => {
    if (length <= 0) return;
    const dLine = lineIdx - prevLine;
    const dChar = dLine === 0 ? colIdx - prevChar : colIdx;
    data.push(dLine, dChar, length, typeIdx, 0);
    prevLine = lineIdx;
    prevChar = colIdx;
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;

    // Mask string literals with spaces while preserving `{expr}` inside $"..."
    const scanLine = line.replace(/"(?:\\.|[^"\\])*"/g, (m, _off: number) => {
      if (line[_off - 1] === '$') {
        const buf = Array<string>(m.length).fill(' ');
        const interpRe = /\{([^{}]+)\}/g;
        let im: RegExpExecArray | null;
        while ((im = interpRe.exec(m)) !== null) {
          if (m[im.index - 1] === '{') continue;
          const inner = im[1].split(':')[0];
          for (let k = 0; k < inner.length; k++) {
            buf[im.index + 1 + k] = inner[k];
          }
        }
        return buf.join('');
      }
      return ' '.repeat(m.length);
    });

    const tokRegex = /\b([A-Za-z_]\w*)\b(\s*\()?/g;
    let m: RegExpExecArray | null;
    while ((m = tokRegex.exec(scanLine)) !== null) {
      const word = m[1];
      const isCall = Boolean(m[2]);
      const col = m.index;

      if (CONTROL_KEYWORDS.has(word)) {
        pushToken(lineIdx, col, word.length, 4); // control keyword
      } else if (knownTypes.has(word)) {
        pushToken(lineIdx, col, word.length, 0); // type
      } else if (isCall && !CSHARP_KEYWORDS.includes(word)) {
        pushToken(lineIdx, col, word.length, 1); // method
      } else if (declaredVars.has(word)) {
        pushToken(lineIdx, col, word.length, 2); // variable
      }
    }
  }

  return new Uint32Array(data);
}

