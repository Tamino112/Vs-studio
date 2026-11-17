import type * as monaco from 'monaco-editor';
import { DiagnosticItem } from '../types/ide';

const KNOWN_STATIC_CASE_MAP: Record<string, string> = {
  console: 'Console',
  datetime: 'DateTime',
  timespan: 'TimeSpan',
  guid: 'Guid',
  math: 'Math',
  file: 'File',
  directory: 'Directory',
  path: 'Path',
  environment: 'Environment',
  convert: 'Convert',
  random: 'Random',
  task: 'Task',
  stringbuilder: 'StringBuilder',
  httpclient: 'HttpClient',
  jsonserializer: 'JsonSerializer',
  webapplication: 'WebApplication',
  assert: 'Assert',
};

const CSHARP_KEYWORDS_SET = new Set([
  'var', 'string', 'int', 'long', 'double', 'float', 'decimal', 'bool', 'char', 'byte', 'sbyte',
  'short', 'ushort', 'uint', 'ulong', 'object', 'dynamic', 'void', 'public', 'private', 'internal',
  'protected', 'static', 'readonly', 'const', 'class', 'struct', 'record', 'interface', 'enum',
  'namespace', 'using', 'return', 'if', 'else', 'switch', 'case', 'default', 'for', 'foreach',
  'in', 'while', 'do', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'await',
  'async', 'true', 'false', 'null', 'this', 'base', 'is', 'as', 'not', 'and', 'or', 'typeof',
  'nameof', 'sizeof', 'out', 'ref', 'params', 'when', 'where', 'select', 'from', 'orderby',
  'get', 'set', 'init', 'required', 'partial', 'sealed', 'abstract', 'virtual', 'override', 'args',
]);

/**
 * Masks comments and string literals on a single line while extracting interpolated `{expr}` segments.
 */
function maskStringsAndComments(code: string): {
  masked: string;
  interpolations: Array<{ expr: string; offset: number }>;
  unclosedStringLines: Array<{ line: number; col: number; endCol: number }>;
} {
  const chars = code.split('');
  const maskedChars = [...chars];
  const interpolations: Array<{ expr: string; offset: number }> = [];
  const unclosedStringLines: Array<{ line: number; col: number; endCol: number }> = [];

  let i = 0;
  let line = 1;
  let lineStartOffset = 0;

  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (ch === '\n') {
      line++;
      lineStartOffset = i + 1;
      i++;
      continue;
    }

    // Line comment //
    if (ch === '/' && next === '/') {
      while (i < chars.length && chars[i] !== '\n') {
        maskedChars[i] = ' ';
        i++;
      }
      continue;
    }

    // Block comment /* */
    if (ch === '/' && next === '*') {
      maskedChars[i] = ' ';
      maskedChars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] === '\n') {
          line++;
          lineStartOffset = i + 1;
        } else {
          maskedChars[i] = ' ';
        }
        i++;
      }
      if (i < chars.length) {
        maskedChars[i] = ' ';
        maskedChars[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    // Interpolated ($"...") or normal ("...") string literals (non-raw single line check)
    const isInterpolated =
      (ch === '$' && next === '"') ||
      (ch === '$' && next === '@' && chars[i + 2] === '"') ||
      (ch === '@' && next === '$' && chars[i + 2] === '"');
    const isVerbatim = ch === '@' && next === '"';
    const isPlainString = ch === '"';

    if (isInterpolated || isVerbatim || isPlainString) {
      const startLine = line;
      const startCol = i - lineStartOffset + 1;
      let j = i;
      const quoteStartIdx = isInterpolated && (next === '@' || ch === '@') ? i + 2 : (isInterpolated || isVerbatim) ? i + 1 : i;
      if (isInterpolated && (next === '@' || ch === '@')) {
        maskedChars[j++] = ' ';
        maskedChars[j++] = ' ';
        maskedChars[j++] = '"';
      } else if (isInterpolated || isVerbatim) {
        maskedChars[j++] = ' ';
        maskedChars[j++] = '"';
      } else {
        maskedChars[j++] = '"';
      }

      // Raw string literal """..."""
      if (chars[j] === '"' && chars[j + 1] === '"') {
        i = j + 2;
        continue;
      }

      let closed = false;
      while (j < chars.length) {
        const c = chars[j];
        if (c === '\n') {
          if (!isVerbatim) {
            maskedChars[quoteStartIdx] = ' ';
            unclosedStringLines.push({
              line: startLine,
              col: startCol,
              endCol: j - lineStartOffset + 1,
            });
            break;
          }
          line++;
          lineStartOffset = j + 1;
        } else if (isVerbatim && c === '"' && chars[j + 1] === '"') {
          maskedChars[j] = ' ';
          maskedChars[j + 1] = ' ';
          j += 2;
          continue;
        } else if (!isVerbatim && c === '\\') {
          maskedChars[j] = ' ';
          if (j + 1 < chars.length && chars[j + 1] !== '\n') {
            maskedChars[j + 1] = ' ';
            j += 2;
            continue;
          }
        } else if (isInterpolated && c === '{') {
          if (chars[j + 1] === '{') {
            maskedChars[j] = ' ';
            maskedChars[j + 1] = ' ';
            j += 2;
            continue;
          }
          maskedChars[j] = ' ';
          const exprStart = j + 1;
          j++;
          let depth = 1;
          while (j < chars.length && depth > 0 && chars[j] !== '\n') {
            if (chars[j] === '{') depth++;
            else if (chars[j] === '}') depth--;
            if (depth > 0) {
              maskedChars[j] = chars[j];
            } else {
              maskedChars[j] = ' ';
            }
            j++;
          }
          const exprEnd = depth === 0 ? Math.max(exprStart, j - 1) : j;
          const rawExpr = code.slice(exprStart, exprEnd);
          interpolations.push({ expr: rawExpr, offset: exprStart });
          continue;
        } else if (c === '"') {
          maskedChars[j] = '"';
          j++;
          closed = true;
          break;
        } else {
          maskedChars[j] = ' ';
        }
        j++;
      }

      if (!closed) {
        maskedChars[quoteStartIdx] = ' ';
      }

      if (!closed && isVerbatim === false && j >= chars.length) {
        unclosedStringLines.push({
          line: startLine,
          col: startCol,
          endCol: j - lineStartOffset + 1,
        });
      }
      i = j;
      continue;
    }

    i++;
  }

  return {
    masked: maskedChars.join(''),
    interpolations,
    unclosedStringLines,
  };
}

function offsetToLineCol(code: string, offset: number): { line: number; column: number } {
  const slice = code.slice(0, offset);
  const lines = slice.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

export function analyzeCSharpCode(filePath: string, projectName: string, code: string): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const { masked, interpolations, unclosedStringLines } = maskStringsAndComments(code);

  // 1. Unclosed strings
  for (const u of unclosedStringLines) {
    diagnostics.push({
      id: `live:${filePath}:CS1010:${u.line}:${u.col}`,
      severity: 'error',
      code: 'CS1010',
      description: 'Newline in constant (unclosed string literal)',
      project: projectName,
      file: filePath,
      line: u.line,
      column: u.col,
      endLine: u.line,
      endColumn: Math.max(u.col + 1, u.endCol),
      source: 'IntelliSense',
    });
  }

  // 2. Unbalanced braces / parentheses
  const braceStack: Array<{ ch: '{' | '('; offset: number }> = [];
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '(') {
      braceStack.push({ ch, offset: i });
    } else if (ch === '}' || ch === ')') {
      const expected = ch === '}' ? '{' : '(';
      const top = braceStack[braceStack.length - 1];
      if (!top || top.ch !== expected) {
        const pos = offsetToLineCol(code, i);
        diagnostics.push({
          id: `live:${filePath}:CS1022:${pos.line}:${pos.column}`,
          severity: 'error',
          code: ch === '}' ? 'CS1513' : 'CS1026',
          description: `Unexpected '${ch}'`,
          project: projectName,
          file: filePath,
          line: pos.line,
          column: pos.column,
          endLine: pos.line,
          endColumn: pos.column + 1,
          source: 'IntelliSense',
        });
      } else {
        braceStack.pop();
      }
    }
  }
  for (const unclosed of braceStack.slice(-3)) {
    const pos = offsetToLineCol(code, unclosed.offset);
    diagnostics.push({
      id: `live:${filePath}:unclosed:${pos.line}:${pos.column}`,
      severity: 'error',
      code: unclosed.ch === '{' ? 'CS1513' : 'CS1026',
      description: `${unclosed.ch === '{' ? '}' : ')'} expected`,
      project: projectName,
      file: filePath,
      line: pos.line,
      column: pos.column,
      endLine: pos.line,
      endColumn: pos.column + 1,
      source: 'IntelliSense',
    });
  }

  // 3. Collect declared symbols & variables in document
  const declaredLocals: Array<{ name: string; offset: number; line: number; col: number }> = [];
  const declaredSymbols = new Set<string>(['args', 'app', 'builder', 'Program']);
  const sourceLines = code.split('\n');
  const maskedLines = masked.split('\n');

  const typePattern =
    '(?:var|string|int|long|double|float|decimal|bool|char|byte|sbyte|short|ushort|uint|ulong|object|dynamic|List<[^>]+>|Dictionary<[^>]+>|HashSet<[^>]+>|Task(?:<[^>]+>)?|[A-Z][A-Za-z0-9_]*)(?:<[^>]+>)?(?:\\[\\])?\\??';
  const varDeclRegex = new RegExp(`\\b${typePattern}\\s+([A-Za-z_]\\w*)\\s*(?:=|;|,|\\)|\\{)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = varDeclRegex.exec(masked)) !== null) {
    const name = m[1];
    if (CSHARP_KEYWORDS_SET.has(name)) continue;
    const nameOffset = m.index + m[0].indexOf(name);
    const pos = offsetToLineCol(code, nameOffset);
    declaredSymbols.add(name);
    const rawLine = sourceLines[pos.line - 1] || '';
    const beforeDeclOnLine = maskedLines[pos.line - 1]?.slice(0, pos.column - 1) || '';
    const insideParens = (beforeDeclOnLine.match(/\(/g)?.length || 0) > (beforeDeclOnLine.match(/\)/g)?.length || 0);
    // Track local declarations that have `=` assignment outside parameter lists for CS0219 check
    if (m[0].trimEnd().endsWith('=') && !insideParens && !/^\s*(?:public|private|internal|protected)\b/.test(rawLine)) {
      declaredLocals.push({ name, offset: nameOffset, line: pos.line, col: pos.column });
    }
  }

  const typeAndMemberDecl = /\b(?:class|struct|record|interface|enum|namespace)\s+([A-Za-z_]\w*)/g;
  while ((m = typeAndMemberDecl.exec(masked)) !== null) {
    declaredSymbols.add(m[1]);
  }
  const foreachDecl = /\bforeach\s*\([^)]*\b([A-Za-z_]\w*)\s+in\b/g;
  while ((m = foreachDecl.exec(masked)) !== null) {
    declaredSymbols.add(m[1]);
  }
  const paramDecl = /\b([A-Za-z_]\w*)\s*=>/g;
  while ((m = paramDecl.exec(masked)) !== null) {
    declaredSymbols.add(m[1]);
  }
  const outVarDecl = /\bout\s+(?:var|[A-Za-z_][\w<>[\]?,.\s]*?)\s+([A-Za-z_]\w*)\b/g;
  while ((m = outVarDecl.exec(masked)) !== null) {
    if (!CSHARP_KEYWORDS_SET.has(m[1])) declaredSymbols.add(m[1]);
  }
  const isPatternDecl = /\bis\s+(?:not\s+)?[A-Za-z_][\w<>[\]?]*\s+([A-Za-z_]\w*)\b/g;
  while ((m = isPatternDecl.exec(masked)) !== null) {
    if (!CSHARP_KEYWORDS_SET.has(m[1])) declaredSymbols.add(m[1]);
  }

  // 4. Case-sensitivity typos on common BCL types (e.g. `console.WriteLine`)
  const identRegex = /\b([a-z][A-Za-z0-9_]*)\b/g;
  while ((m = identRegex.exec(masked)) !== null) {
    const word = m[1];
    const correct = KNOWN_STATIC_CASE_MAP[word.toLowerCase()];
    if (!correct || word === correct) continue;
    const afterChar = masked[m.index + word.length];
    const prevChar = m.index > 0 ? masked[m.index - 1] : ' ';
    if (prevChar === '.') continue;
    if (declaredSymbols.has(word)) continue;
    if (afterChar === '.' || word.toLowerCase() === 'console') {
      const pos = offsetToLineCol(code, m.index);
      diagnostics.push({
        id: `live:${filePath}:CS0103:${pos.line}:${pos.column}:${word}`,
        severity: 'error',
        code: 'CS0103',
        description: `The name '${word}' does not exist in the current context (did you mean '${correct}'?)`,
        project: projectName,
        file: filePath,
        line: pos.line,
        column: pos.column,
        endLine: pos.line,
        endColumn: pos.column + word.length,
        source: 'IntelliSense',
      });
    }
  }

  // 5. Undefined identifiers inside string interpolations ($"{hallio}")
  for (const interp of interpolations) {
    const exprNoFormat = interp.expr.split(':')[0].split(',')[0].trim();
    if (/^[A-Za-z_]\w*$/.test(exprNoFormat)) {
      const id = exprNoFormat;
      if (!declaredSymbols.has(id) && !CSHARP_KEYWORDS_SET.has(id) && !Object.values(KNOWN_STATIC_CASE_MAP).includes(id)) {
        const innerOffset = interp.offset + interp.expr.indexOf(id);
        const pos = offsetToLineCol(code, innerOffset);
        diagnostics.push({
          id: `live:${filePath}:CS0103:${pos.line}:${pos.column}:${id}`,
          severity: 'error',
          code: 'CS0103',
          description: `The name '${id}' does not exist in the current context`,
          project: projectName,
          file: filePath,
          line: pos.line,
          column: pos.column,
          endLine: pos.line,
          endColumn: pos.column + id.length,
          source: 'IntelliSense',
        });
      }
    }
  }

  // 6. Unknown member invocations on well-known static BCL classes (e.g. Console.WriteLne)
  const KNOWN_BCL_MEMBERS: Record<string, Set<string>> = {
    Console: new Set([
      'WriteLine', 'Write', 'ReadLine', 'ReadKey', 'Read', 'Clear', 'Beep', 'ResetColor',
      'SetCursorPosition', 'ForegroundColor', 'BackgroundColor', 'Title', 'Out', 'Error', 'In',
      'WindowWidth', 'WindowHeight', 'BufferWidth', 'BufferHeight', 'CursorLeft', 'CursorTop',
      'CursorVisible', 'CursorSize', 'OutputEncoding', 'InputEncoding', 'KeyAvailable',
      'OpenStandardInput', 'OpenStandardOutput', 'OpenStandardError', 'SetIn', 'SetOut', 'SetError',
      'TreatControlCAsInput', 'CancelKeyPress', 'Equals', 'ReferenceEquals',
    ]),
    Math: new Set([
      'Abs', 'Acos', 'Acosh', 'Asin', 'Asinh', 'Atan', 'Atan2', 'Atanh', 'BigMul', 'Cbrt',
      'Ceiling', 'Clamp', 'Cos', 'Cosh', 'DivRem', 'E', 'Exp', 'Floor', 'FusedMultiplyAdd',
      'IEEERemainder', 'Log', 'Log10', 'Log2', 'Max', 'MaxMagnitude', 'Min', 'MinMagnitude',
      'PI', 'Pow', 'Round', 'ScaleB', 'Sign', 'Sin', 'SinCos', 'Sinh', 'Sqrt', 'Tan', 'Tanh',
      'Tau', 'Truncate',
    ]),
  };
  const bclCallRegex = /\b(Console|Math)\.([A-Za-z_]\w*)\s*\(/g;
  while ((m = bclCallRegex.exec(masked)) !== null) {
    const typeName = m[1];
    const memberName = m[2];
    const validSet = KNOWN_BCL_MEMBERS[typeName];
    if (validSet && !validSet.has(memberName)) {
      const memberOffset = m.index + typeName.length + 1;
      const pos = offsetToLineCol(code, memberOffset);
      diagnostics.push({
        id: `live:${filePath}:CS0117:${pos.line}:${pos.column}:${typeName}.${memberName}`,
        severity: 'error',
        code: 'CS0117',
        description: `'${typeName}' does not contain a definition for '${memberName}'`,
        project: projectName,
        file: filePath,
        line: pos.line,
        column: pos.column,
        endLine: pos.line,
        endColumn: pos.column + memberName.length,
        source: 'IntelliSense',
      });
    }
  }

  // 7. Obvious literal type mismatches (e.g. `int x = "hello";` or `string s = 123;`)
  for (let i = 0; i < sourceLines.length; i++) {
    const rawLine = sourceLines[i];
    const maskedLine = maskedLines[i] || '';
    if (maskedLine.trimStart().startsWith('//') || maskedLine.trimStart().startsWith('#')) continue;

    const strToNum = /^\s*(int|long|double|float|decimal|bool)\s+[A-Za-z_]\w*\s*=\s*(\$?"[^"]*")\s*;?\s*$/.exec(rawLine);
    if (strToNum) {
      const col = rawLine.indexOf(strToNum[2]) + 1;
      diagnostics.push({
        id: `live:${filePath}:CS0029:${i + 1}:${col}`,
        severity: 'error',
        code: 'CS0029',
        description: `Cannot implicitly convert type 'string' to '${strToNum[1]}'`,
        project: projectName,
        file: filePath,
        line: i + 1,
        column: col,
        endLine: i + 1,
        endColumn: col + strToNum[2].length,
        source: 'IntelliSense',
      });
    }

    const numToStr = /^\s*string\s+[A-Za-z_]\w*\s*=\s*(\d+(?:\.\d+)?|true|false)\s*;?\s*$/.exec(rawLine);
    if (numToStr) {
      const literal = numToStr[1];
      const literalType = literal === 'true' || literal === 'false' ? 'bool' : literal.includes('.') ? 'double' : 'int';
      const col = rawLine.indexOf(literal, rawLine.indexOf('=')) + 1;
      diagnostics.push({
        id: `live:${filePath}:CS0029:${i + 1}:${col}`,
        severity: 'error',
        code: 'CS0029',
        description: `Cannot implicitly convert type '${literalType}' to 'string'`,
        project: projectName,
        file: filePath,
        line: i + 1,
        column: col,
        endLine: i + 1,
        endColumn: col + literal.length,
        source: 'IntelliSense',
      });
    }

    // 8. Safe missing-semicolon detection on clear single-line statements (var decls / calls)
    const trimmed = maskedLine.trimEnd();
    if (
      trimmed &&
      !trimmed.endsWith(';') &&
      !trimmed.endsWith('{') &&
      !trimmed.endsWith('}') &&
      !trimmed.endsWith(',') &&
      !trimmed.endsWith(':') &&
      !trimmed.endsWith('=>') &&
      !trimmed.endsWith('(')
    ) {
      let nextNonEmpty = '';
      for (let k = i + 1; k < sourceLines.length; k++) {
        const cand = sourceLines[k].trim();
        if (cand && !cand.startsWith('//')) {
          nextNonEmpty = cand;
          break;
        }
      }
      const nextContinues = nextNonEmpty.startsWith('.') || nextNonEmpty.startsWith('{') || nextNonEmpty.startsWith('?') || nextNonEmpty.startsWith(':');
      const endsWithOperator = /[+\-*/?:&|=<>\[(.]$/.test(trimmed);
      const isCompleteStmt =
        /^\s*(?:var|string|int|long|double|float|decimal|bool|char)\s+[A-Za-z_]\w*\s*=\s*.+$/.test(trimmed) ||
        /^\s*(?:return\b.*|[A-Za-z_]\w*\.[A-Za-z_]\w*\s*\([^()]*\))$/.test(trimmed);
      const openParens = (maskedLine.match(/\(/g)?.length || 0) - (maskedLine.match(/\)/g)?.length || 0);
      if (
        isCompleteStmt &&
        !endsWithOperator &&
        !maskedLine.includes('=>') &&
        openParens === 0 &&
        !nextContinues &&
        !unclosedStringLines.some((u) => u.line === i + 1)
      ) {
        const col = trimmed.length + 1;
        diagnostics.push({
          id: `live:${filePath}:CS1002:${i + 1}:${col}`,
          severity: 'error',
          code: 'CS1002',
          description: '; expected',
          project: projectName,
          file: filePath,
          line: i + 1,
          column: col,
          endLine: i + 1,
          endColumn: col + 1,
          source: 'IntelliSense',
        });
      }
    }
  }

  // 9. Unused assigned local variables (CS0219), ignoring method/property definitions
  for (const decl of declaredLocals) {
    const lineStart = sourceLines[decl.line - 1] || '';
    if (/\b(?:public|private|internal|protected|static|const|readonly)\b/.test(lineStart)) {
      continue;
    }
    const usageRegex = new RegExp(`\\b${decl.name}\\b`, 'g');
    let matchCount = 0;
    while (usageRegex.exec(masked) !== null) {
      matchCount++;
    }
    if (matchCount <= 1) {
      diagnostics.push({
        id: `live:${filePath}:CS0219:${decl.line}:${decl.col}:${decl.name}`,
        severity: 'warning',
        code: 'CS0219',
        description: `The variable '${decl.name}' is assigned but its value is never used`,
        project: projectName,
        file: filePath,
        line: decl.line,
        column: decl.col,
        endLine: decl.line,
        endColumn: decl.col + decl.name.length,
        source: 'IntelliSense',
      });
    }
  }

  return diagnostics;
}

export function getBuiltInCSharpCodeActions(
  monacoInst: typeof monaco,
  model: monaco.editor.ITextModel,
  markers: monaco.editor.IMarkerData[],
): monaco.languages.CodeAction[] {
  const actions: monaco.languages.CodeAction[] = [];

  for (const marker of markers) {
    if (marker.message.includes('CS1002')) {
      actions.push({
        title: "Add missing ';'",
        kind: 'quickfix',
        isPreferred: true,
        edit: {
          edits: [
            {
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: marker.startLineNumber,
                  startColumn: marker.startColumn,
                  endLineNumber: marker.startLineNumber,
                  endColumn: marker.startColumn,
                },
                text: ';',
              },
              versionId: model.getVersionId(),
            },
          ],
        },
      });
    }

    const lineText = model.getLineContent(marker.startLineNumber);
    const spanText = model.getValueInRange({
      startLineNumber: marker.startLineNumber,
      startColumn: marker.startColumn,
      endLineNumber: marker.endLineNumber,
      endColumn: marker.endColumn,
    });

    const wordMatch = /The name '([A-Za-z_]\w*)' does not exist/.exec(marker.message);
    const badName = wordMatch?.[1] || spanText.trim();
    if (!badName) continue;

    // 1. Static BCL casing quick fix (console -> Console)
    const staticFix = KNOWN_STATIC_CASE_MAP[badName.toLowerCase()];
    if (staticFix && staticFix !== badName) {
      actions.push({
        title: `Change '${badName}' to '${staticFix}'`,
        kind: 'quickfix',
        isPreferred: true,
        edit: {
          edits: [
            {
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: marker.startLineNumber,
                  startColumn: marker.startColumn,
                  endLineNumber: marker.startLineNumber,
                  endColumn: marker.startColumn + badName.length,
                },
                text: staticFix,
              },
              versionId: model.getVersionId(),
            },
          ],
        },
      });
    }

    // 2. Suggest using statements for common types
    const usingSuggestions: Record<string, string> = {
      List: 'System.Collections.Generic',
      Dictionary: 'System.Collections.Generic',
      HashSet: 'System.Collections.Generic',
      JsonSerializer: 'System.Text.Json',
      StringBuilder: 'System.Text',
      HttpClient: 'System.Net.Http',
      Regex: 'System.Text.RegularExpressions',
    };
    const ns = usingSuggestions[badName];
    if (ns && !model.getValue().includes(`using ${ns};`)) {
      actions.push({
        title: `using ${ns};`,
        kind: 'quickfix',
        edit: {
          edits: [
            {
              resource: model.uri,
              textEdit: {
                range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                text: `using ${ns};\n`,
              },
              versionId: model.getVersionId(),
            },
          ],
        },
      });
    }

    // 3. Remove unused local variable CS0219
    if (marker.message.includes('CS0219') && lineText.trim().endsWith(';')) {
      actions.push({
        title: `Remove unused variable '${badName}'`,
        kind: 'quickfix',
        edit: {
          edits: [
            {
              resource: model.uri,
              textEdit: {
                range: {
                  startLineNumber: marker.startLineNumber,
                  startColumn: 1,
                  endLineNumber: marker.startLineNumber + 1,
                  endColumn: 1,
                },
                text: '',
              },
              versionId: model.getVersionId(),
            },
          ],
        },
      });
    }
  }

  return actions;
}
