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
    { label: 'WriteLine', kind: 'Method', detail: 'void Console.WriteLine(string? value)', insertText: 'WriteLine(${1});', isSnippet: true, documentation: 'Writes the specified data, followed by the current line terminator, to the standard output stream.' },
    { label: 'Write', kind: 'Method', detail: 'void Console.Write(string? value)', insertText: 'Write(${1});', isSnippet: true, documentation: 'Writes the specified value to the standard output stream.' },
    { label: 'ReadLine', kind: 'Method', detail: 'string? Console.ReadLine()', insertText: 'ReadLine()', documentation: 'Reads the next line of characters from the standard input stream.' },
    { label: 'ReadKey', kind: 'Method', detail: 'ConsoleKeyInfo Console.ReadKey()', insertText: 'ReadKey()', documentation: 'Obtains the next character or function key pressed by the user.' },
    { label: 'Read', kind: 'Method', detail: 'int Console.Read()', insertText: 'Read()' },
    { label: 'Clear', kind: 'Method', detail: 'void Console.Clear()', insertText: 'Clear()' },
    { label: 'Beep', kind: 'Method', detail: 'void Console.Beep()', insertText: 'Beep()' },
    { label: 'ResetColor', kind: 'Method', detail: 'void Console.ResetColor()', insertText: 'ResetColor()' },
    { label: 'SetCursorPosition', kind: 'Method', detail: 'void Console.SetCursorPosition(int left, int top)', insertText: 'SetCursorPosition(${1:left}, ${2:top})', isSnippet: true },
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
    { label: 'Abs', kind: 'Method', detail: 'T Math.Abs(T value)', insertText: 'Abs(${1})', isSnippet: true },
    { label: 'Max', kind: 'Method', detail: 'T Math.Max(T val1, T val2)', insertText: 'Max(${1}, ${2})', isSnippet: true },
    { label: 'Min', kind: 'Method', detail: 'T Math.Min(T val1, T val2)', insertText: 'Min(${1}, ${2})', isSnippet: true },
    { label: 'Pow', kind: 'Method', detail: 'double Math.Pow(double x, double y)', insertText: 'Pow(${1}, ${2})', isSnippet: true },
    { label: 'Sqrt', kind: 'Method', detail: 'double Math.Sqrt(double d)', insertText: 'Sqrt(${1})', isSnippet: true },
    { label: 'Round', kind: 'Method', detail: 'double Math.Round(double a)', insertText: 'Round(${1})', isSnippet: true },
    { label: 'Floor', kind: 'Method', detail: 'double Math.Floor(double d)', insertText: 'Floor(${1})', isSnippet: true },
    { label: 'Ceiling', kind: 'Method', detail: 'double Math.Ceiling(double a)', insertText: 'Ceiling(${1})', isSnippet: true },
    { label: 'Clamp', kind: 'Method', detail: 'T Math.Clamp(T value, T min, T max)', insertText: 'Clamp(${1}, ${2}, ${3})', isSnippet: true },
    { label: 'PI', kind: 'Field', detail: 'const double Math.PI = 3.1415926535897931' },
    { label: 'E', kind: 'Field', detail: 'const double Math.E = 2.7182818284590451' },
  ],
  File: [
    { label: 'ReadAllText', kind: 'Method', detail: 'string File.ReadAllText(string path)', insertText: 'ReadAllText(${1})', isSnippet: true },
    { label: 'ReadAllTextAsync', kind: 'Method', detail: 'Task<string> File.ReadAllTextAsync(string path)', insertText: 'ReadAllTextAsync(${1})', isSnippet: true },
    { label: 'ReadAllLines', kind: 'Method', detail: 'string[] File.ReadAllLines(string path)', insertText: 'ReadAllLines(${1})', isSnippet: true },
    { label: 'WriteAllText', kind: 'Method', detail: 'void File.WriteAllText(string path, string? contents)', insertText: 'WriteAllText(${1}, ${2})', isSnippet: true },
    { label: 'WriteAllTextAsync', kind: 'Method', detail: 'Task File.WriteAllTextAsync(string path, string? contents)', insertText: 'WriteAllTextAsync(${1}, ${2})', isSnippet: true },
    { label: 'Exists', kind: 'Method', detail: 'bool File.Exists(string? path)', insertText: 'Exists(${1})', isSnippet: true },
    { label: 'Delete', kind: 'Method', detail: 'void File.Delete(string path)', insertText: 'Delete(${1})', isSnippet: true },
    { label: 'Copy', kind: 'Method', detail: 'void File.Copy(string source, string dest)', insertText: 'Copy(${1}, ${2})', isSnippet: true },
  ],
  Directory: [
    { label: 'Exists', kind: 'Method', detail: 'bool Directory.Exists(string? path)', insertText: 'Exists(${1})', isSnippet: true },
    { label: 'CreateDirectory', kind: 'Method', detail: 'DirectoryInfo Directory.CreateDirectory(string path)', insertText: 'CreateDirectory(${1})', isSnippet: true },
    { label: 'GetFiles', kind: 'Method', detail: 'string[] Directory.GetFiles(string path)', insertText: 'GetFiles(${1})', isSnippet: true },
    { label: 'GetDirectories', kind: 'Method', detail: 'string[] Directory.GetDirectories(string path)', insertText: 'GetDirectories(${1})', isSnippet: true },
    { label: 'GetCurrentDirectory', kind: 'Method', detail: 'string Directory.GetCurrentDirectory()', insertText: 'GetCurrentDirectory()' },
  ],
  Path: [
    { label: 'Combine', kind: 'Method', detail: 'string Path.Combine(params string[] paths)', insertText: 'Combine(${1})', isSnippet: true },
    { label: 'Join', kind: 'Method', detail: 'string Path.Join(params string?[] paths)', insertText: 'Join(${1})', isSnippet: true },
    { label: 'GetFileName', kind: 'Method', detail: 'string? Path.GetFileName(string? path)', insertText: 'GetFileName(${1})', isSnippet: true },
    { label: 'GetExtension', kind: 'Method', detail: 'string? Path.GetExtension(string? path)', insertText: 'GetExtension(${1})', isSnippet: true },
    { label: 'GetDirectoryName', kind: 'Method', detail: 'string? Path.GetDirectoryName(string? path)', insertText: 'GetDirectoryName(${1})', isSnippet: true },
  ],
  Environment: [
    { label: 'CurrentDirectory', kind: 'Property', detail: 'string Environment.CurrentDirectory { get; set; }' },
    { label: 'MachineName', kind: 'Property', detail: 'string Environment.MachineName { get; }' },
    { label: 'UserName', kind: 'Property', detail: 'string Environment.UserName { get; }' },
    { label: 'OSVersion', kind: 'Property', detail: 'OperatingSystem Environment.OSVersion { get; }' },
    { label: 'Version', kind: 'Property', detail: 'Version Environment.Version { get; }' },
    { label: 'NewLine', kind: 'Property', detail: 'string Environment.NewLine { get; }' },
    { label: 'Exit', kind: 'Method', detail: 'void Environment.Exit(int exitCode)', insertText: 'Exit(${1:0})', isSnippet: true },
    { label: 'GetEnvironmentVariable', kind: 'Method', detail: 'string? Environment.GetEnvironmentVariable(string variable)', insertText: 'GetEnvironmentVariable(${1})', isSnippet: true },
  ],
  DateTime: [
    { label: 'Now', kind: 'Property', detail: 'DateTime DateTime.Now { get; }' },
    { label: 'UtcNow', kind: 'Property', detail: 'DateTime DateTime.UtcNow { get; }' },
    { label: 'Today', kind: 'Property', detail: 'DateTime DateTime.Today { get; }' },
    { label: 'Parse', kind: 'Method', detail: 'DateTime DateTime.Parse(string s)', insertText: 'Parse(${1})', isSnippet: true },
    { label: 'TryParse', kind: 'Method', detail: 'bool DateTime.TryParse(string? s, out DateTime result)', insertText: 'TryParse(${1}, out var ${2:dt})', isSnippet: true },
  ],
  Task: [
    { label: 'Delay', kind: 'Method', detail: 'Task Task.Delay(int millisecondsDelay)', insertText: 'Delay(${1:1000})', isSnippet: true },
    { label: 'Run', kind: 'Method', detail: 'Task Task.Run(Action action)', insertText: 'Run(() => ${1})', isSnippet: true },
    { label: 'WhenAll', kind: 'Method', detail: 'Task Task.WhenAll(params Task[] tasks)', insertText: 'WhenAll(${1})', isSnippet: true },
    { label: 'WhenAny', kind: 'Method', detail: 'Task<Task> Task.WhenAny(params Task[] tasks)', insertText: 'WhenAny(${1})', isSnippet: true },
    { label: 'FromResult', kind: 'Method', detail: 'Task<T> Task.FromResult<T>(T result)', insertText: 'FromResult(${1})', isSnippet: true },
    { label: 'CompletedTask', kind: 'Property', detail: 'Task Task.CompletedTask { get; }' },
  ],
  Convert: [
    { label: 'ToInt32', kind: 'Method', detail: 'int Convert.ToInt32(object? value)', insertText: 'ToInt32(${1})', isSnippet: true },
    { label: 'ToDouble', kind: 'Method', detail: 'double Convert.ToDouble(object? value)', insertText: 'ToDouble(${1})', isSnippet: true },
    { label: 'ToString', kind: 'Method', detail: 'string? Convert.ToString(object? value)', insertText: 'ToString(${1})', isSnippet: true },
    { label: 'ToBoolean', kind: 'Method', detail: 'bool Convert.ToBoolean(object? value)', insertText: 'ToBoolean(${1})', isSnippet: true },
  ],
  Guid: [
    { label: 'NewGuid', kind: 'Method', detail: 'Guid Guid.NewGuid()', insertText: 'NewGuid()' },
    { label: 'CreateVersion7', kind: 'Method', detail: 'Guid Guid.CreateVersion7() (.NET 9+)', insertText: 'CreateVersion7()' },
    { label: 'Empty', kind: 'Field', detail: 'readonly Guid Guid.Empty' },
    { label: 'Parse', kind: 'Method', detail: 'Guid Guid.Parse(string input)', insertText: 'Parse(${1})', isSnippet: true },
  ],
  JsonSerializer: [
    { label: 'Serialize', kind: 'Method', detail: 'string JsonSerializer.Serialize<T>(T value)', insertText: 'Serialize(${1})', isSnippet: true },
    { label: 'Deserialize', kind: 'Method', detail: 'T? JsonSerializer.Deserialize<T>(string json)', insertText: 'Deserialize<${1:object}>(${2})', isSnippet: true },
  ],
  string: [
    { label: 'Length', kind: 'Property', detail: 'int string.Length { get; }' },
    { label: 'IsNullOrEmpty', kind: 'Method', detail: 'bool string.IsNullOrEmpty(string? value)', insertText: 'IsNullOrEmpty(${1})', isSnippet: true },
    { label: 'IsNullOrWhiteSpace', kind: 'Method', detail: 'bool string.IsNullOrWhiteSpace(string? value)', insertText: 'IsNullOrWhiteSpace(${1})', isSnippet: true },
    { label: 'Split', kind: 'Method', detail: 'string[] string.Split(params char[]? separator)', insertText: 'Split(${1})', isSnippet: true },
    { label: 'Trim', kind: 'Method', detail: 'string string.Trim()', insertText: 'Trim()' },
    { label: 'ToLower', kind: 'Method', detail: 'string string.ToLower()', insertText: 'ToLower()' },
    { label: 'ToUpper', kind: 'Method', detail: 'string string.ToUpper()', insertText: 'ToUpper()' },
    { label: 'Contains', kind: 'Method', detail: 'bool string.Contains(string value)', insertText: 'Contains(${1})', isSnippet: true },
    { label: 'StartsWith', kind: 'Method', detail: 'bool string.StartsWith(string value)', insertText: 'StartsWith(${1})', isSnippet: true },
    { label: 'EndsWith', kind: 'Method', detail: 'bool string.EndsWith(string value)', insertText: 'EndsWith(${1})', isSnippet: true },
    { label: 'Replace', kind: 'Method', detail: 'string string.Replace(string oldValue, string? newValue)', insertText: 'Replace(${1}, ${2})', isSnippet: true },
    { label: 'Substring', kind: 'Method', detail: 'string string.Substring(int startIndex)', insertText: 'Substring(${1})', isSnippet: true },
    { label: 'Join', kind: 'Method', detail: 'string string.Join(string? separator, IEnumerable<string?> values)', insertText: 'Join(${1}, ${2})', isSnippet: true },
  ],
  List: [
    { label: 'Count', kind: 'Property', detail: 'int List<T>.Count { get; }' },
    { label: 'Add', kind: 'Method', detail: 'void List<T>.Add(T item)', insertText: 'Add(${1})', isSnippet: true },
    { label: 'AddRange', kind: 'Method', detail: 'void List<T>.AddRange(IEnumerable<T> collection)', insertText: 'AddRange(${1})', isSnippet: true },
    { label: 'Remove', kind: 'Method', detail: 'bool List<T>.Remove(T item)', insertText: 'Remove(${1})', isSnippet: true },
    { label: 'Clear', kind: 'Method', detail: 'void List<T>.Clear()', insertText: 'Clear()' },
    { label: 'Contains', kind: 'Method', detail: 'bool List<T>.Contains(T item)', insertText: 'Contains(${1})', isSnippet: true },
    { label: 'Sort', kind: 'Method', detail: 'void List<T>.Sort()', insertText: 'Sort()' },
    { label: 'Where', kind: 'Method', detail: 'IEnumerable<T> Enumerable.Where<T>(Func<T, bool> predicate)', insertText: 'Where(x => ${1})', isSnippet: true },
    { label: 'Select', kind: 'Method', detail: 'IEnumerable<TResult> Enumerable.Select<T, TResult>(Func<T, TResult> selector)', insertText: 'Select(x => ${1})', isSnippet: true },
    { label: 'FirstOrDefault', kind: 'Method', detail: 'T? Enumerable.FirstOrDefault<T>()', insertText: 'FirstOrDefault()' },
    { label: 'ToList', kind: 'Method', detail: 'List<T> Enumerable.ToList<T>()', insertText: 'ToList()' },
    { label: 'Any', kind: 'Method', detail: 'bool Enumerable.Any<T>()', insertText: 'Any()' },
  ],
  WebApplication: [
    { label: 'CreateBuilder', kind: 'Method', detail: 'WebApplicationBuilder WebApplication.CreateBuilder(string[] args)', insertText: 'CreateBuilder(${1:args})', isSnippet: true },
    { label: 'CreateSlimBuilder', kind: 'Method', detail: 'WebApplicationBuilder WebApplication.CreateSlimBuilder(string[] args)', insertText: 'CreateSlimBuilder(${1:args})', isSnippet: true },
  ],
  builder: [
    { label: 'Services', kind: 'Property', detail: 'IServiceCollection WebApplicationBuilder.Services { get; }' },
    { label: 'Configuration', kind: 'Property', detail: 'ConfigurationManager WebApplicationBuilder.Configuration { get; }' },
    { label: 'Logging', kind: 'Property', detail: 'ILoggingBuilder WebApplicationBuilder.Logging { get; }' },
    { label: 'Environment', kind: 'Property', detail: 'IWebHostEnvironment WebApplicationBuilder.Environment { get; }' },
    { label: 'Build', kind: 'Method', detail: 'WebApplication WebApplicationBuilder.Build()', insertText: 'Build()' },
  ],
  app: [
    { label: 'MapGet', kind: 'Method', detail: 'RouteHandlerBuilder MapGet(string pattern, Delegate handler)', insertText: 'MapGet("${1:/}", () => ${2})', isSnippet: true },
    { label: 'MapPost', kind: 'Method', detail: 'RouteHandlerBuilder MapPost(string pattern, Delegate handler)', insertText: 'MapPost("${1:/}", () => ${2})', isSnippet: true },
    { label: 'MapPut', kind: 'Method', detail: 'RouteHandlerBuilder MapPut(string pattern, Delegate handler)', insertText: 'MapPut("${1:/}", () => ${2})', isSnippet: true },
    { label: 'MapDelete', kind: 'Method', detail: 'RouteHandlerBuilder MapDelete(string pattern, Delegate handler)', insertText: 'MapDelete("${1:/}", () => ${2})', isSnippet: true },
    { label: 'MapControllers', kind: 'Method', detail: 'ControllerActionEndpointConventionBuilder MapControllers()', insertText: 'MapControllers()' },
    { label: 'UseHttpsRedirection', kind: 'Method', detail: 'IApplicationBuilder UseHttpsRedirection()', insertText: 'UseHttpsRedirection()' },
    { label: 'UseAuthorization', kind: 'Method', detail: 'IApplicationBuilder UseAuthorization()', insertText: 'UseAuthorization()' },
    { label: 'Run', kind: 'Method', detail: 'void WebApplication.Run()', insertText: 'Run()' },
  ],
  Assert: [
    { label: 'True', kind: 'Method', detail: 'void Assert.True(bool condition)', insertText: 'True(${1})', isSnippet: true },
    { label: 'False', kind: 'Method', detail: 'void Assert.False(bool condition)', insertText: 'False(${1})', isSnippet: true },
    { label: 'Equal', kind: 'Method', detail: 'void Assert.Equal<T>(T expected, T actual)', insertText: 'Equal(${1:expected}, ${2:actual})', isSnippet: true },
    { label: 'NotEqual', kind: 'Method', detail: 'void Assert.NotEqual<T>(T expected, T actual)', insertText: 'NotEqual(${1}, ${2})', isSnippet: true },
    { label: 'NotNull', kind: 'Method', detail: 'void Assert.NotNull(object? @object)', insertText: 'NotNull(${1})', isSnippet: true },
    { label: 'Null', kind: 'Method', detail: 'void Assert.Null(object? @object)', insertText: 'Null(${1})', isSnippet: true },
    { label: 'Throws', kind: 'Method', detail: 'T Assert.Throws<T>(Action testCode)', insertText: 'Throws<${1:Exception}>(() => ${2})', isSnippet: true },
  ],
};

const ALIAS_MAP: Record<string, string> = {
  String: 'string',
  Int32: 'int',
  Random: 'Random',
};

const RANDOM_MEMBERS: MemberItem[] = [
  { label: 'Next', kind: 'Method', detail: 'int Random.Next(int minValue, int maxValue)', insertText: 'Next(${1})', isSnippet: true },
  { label: 'NextDouble', kind: 'Method', detail: 'double Random.NextDouble()', insertText: 'NextDouble()' },
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

  const varDecl = /\b(?:var|string|int|long|double|float|bool|decimal|object|List<[^>]+>)\s+([A-Za-z_]\w*)\s*[=;,)]/g;
  while ((m = varDecl.exec(fullText)) !== null) {
    if (!found.has(m[1])) {
      found.set(m[1], {
        label: m[1],
        kind: monacoInst.languages.CompletionItemKind.Variable,
        detail: 'Local / field',
      });
    }
  }

  return [...found.values()];
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
    if (rawTarget.startsWith('"')) {
      resolvedKey = 'string';
    } else {
      const lowerTarget = rawTarget.toLowerCase();
      const staticMatch = Object.keys(TYPE_MEMBERS).find((k) => k.toLowerCase() === lowerTarget);
      if (staticMatch) {
        resolvedKey = staticMatch;
      } else {
        const inferred = inferVariableType(fullText, rawTarget);
        if (inferred && TYPE_MEMBERS[inferred]) {
          resolvedKey = inferred;
        }
      }
    }

    if (!resolvedKey) return [];

    return TYPE_MEMBERS[resolvedKey].map((m) => ({
      label: m.label,
      kind: toMonacoKind(monacoInst, m.kind),
      detail: m.detail,
      documentation: m.documentation,
      insertText: m.insertText || m.label,
      insertTextRules: m.isSnippet
        ? monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
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
