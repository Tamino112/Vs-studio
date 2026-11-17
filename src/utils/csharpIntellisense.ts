import type * as monaco from 'monaco-editor';
import {
  BCL_TYPES,
  DOTNET_NAMESPACES,
  LINQ_EXTENSION_MEMBERS,
  MemberItem,
  OBJECT_INSTANCE_MEMBERS,
  OBJECT_STATIC_MEMBERS,
  TypeSpec,
  VS_CSHARP_SNIPPETS,
} from './csharpBclCatalog';

export type { MemberItem };

// Lookup maps indexed by canonical name, alias, and lowercase name
const TYPE_BY_NAME = new Map<string, TypeSpec>();
const TYPE_BY_LOWER = new Map<string, { spec: TypeSpec; preferredSpelling: string }>();

for (const spec of BCL_TYPES) {
  TYPE_BY_NAME.set(spec.canonicalName, spec);
  TYPE_BY_LOWER.set(spec.canonicalName.toLowerCase(), {
    spec,
    preferredSpelling: spec.canonicalName,
  });
  for (const alias of spec.aliases || []) {
    TYPE_BY_NAME.set(alias, spec);
    const low = alias.toLowerCase();
    if (!TYPE_BY_LOWER.has(low)) {
      TYPE_BY_LOWER.set(low, { spec, preferredSpelling: alias });
    }
  }
}

const PRIMITIVE_TYPE_KEYWORDS = [
  'int', 'long', 'short', 'byte', 'sbyte', 'uint', 'ulong', 'ushort', 'nint', 'nuint',
  'double', 'float', 'decimal', 'bool', 'char', 'string', 'object', 'dynamic', 'void',
];

const STATEMENT_KEYWORDS = [
  'var', 'const', 'if', 'else', 'switch', 'case', 'default',
  'for', 'foreach', 'in', 'while', 'do', 'break', 'continue',
  'return', 'yield', 'try', 'catch', 'finally', 'throw',
  'using', 'await', 'async', 'lock', 'checked', 'unchecked',
  'new', 'true', 'false', 'null', 'this', 'base',
];

const EXPRESSION_KEYWORDS = [
  'true', 'false', 'null', 'new', 'await', 'nameof', 'typeof', 'sizeof', 'default',
  'this', 'base', 'is', 'as', 'not', 'and', 'or', 'out', 'ref', 'in', 'var', 'with',
];

const MEMBER_MODIFIER_KEYWORDS = [
  'public', 'private', 'protected', 'internal', 'static', 'readonly', 'const',
  'virtual', 'override', 'abstract', 'sealed', 'required', 'async', 'partial', 'event', 'extern', 'unsafe',
];

const ALL_CSHARP_KEYWORDS = new Set<string>([
  ...PRIMITIVE_TYPE_KEYWORDS,
  ...STATEMENT_KEYWORDS,
  ...EXPRESSION_KEYWORDS,
  ...MEMBER_MODIFIER_KEYWORDS,
  'class', 'struct', 'record', 'interface', 'enum', 'namespace', 'delegate',
  'get', 'set', 'init', 'value', 'where', 'when', 'params', 'operator', 'implicit', 'explicit',
]);

const MODIFIER_ONLY_SET = new Set<string>([
  ...MEMBER_MODIFIER_KEYWORDS,
  'global', 'file', 'scoped', 'ref', 'out', 'in', 'params',
]);

interface UserTypeInfo {
  name: string;
  kind: 'Class' | 'Struct' | 'Interface' | 'Enum' | 'Record';
  staticMembers: MemberItem[];
  instanceMembers: MemberItem[];
  startOffset: number;
  endOffset: number;
}

interface LocalSymbolInfo {
  name: string;
  typeName: string;
  rawTypeDisplay: string;
  elementType?: string;
  kind: 'local' | 'parameter' | 'field';
  line: number;
}

function normalizeTypeName(raw: string): { baseType: string; elementType?: string } {
  const cleaned = raw.trim().replace(/\?$/, '').trim();
  if (!cleaned) return { baseType: 'object' };

  // Array type e.g. string[] or int[,]
  const arrMatch = /^([A-Za-z_][\w.]*)\s*\[,*\]$/.exec(cleaned);
  if (arrMatch) {
    const elem = normalizeTypeName(arrMatch[1]).baseType;
    return { baseType: 'Array', elementType: elem };
  }

  // Generic type e.g. List<string>, Task<int>, Dictionary<string, Customer>
  const genMatch = /^([A-Za-z_][\w.]*)\s*<(.+)>$/.exec(cleaned);
  if (genMatch) {
    const outerRaw = genMatch[1].split('.').pop() || genMatch[1];
    const genericArgs = genMatch[2].split(',').map((s) => s.trim()).filter(Boolean);
    const isDict = /^(?:I?(?:ReadOnly)?Dictionary|ConcurrentDictionary)$/.test(outerRaw);
    const chosenArg = isDict && genericArgs.length >= 2 ? genericArgs[1] : genericArgs[0] || '';
    const outerSpec = TYPE_BY_NAME.get(outerRaw);
    const elem = chosenArg ? normalizeTypeName(chosenArg).baseType : undefined;
    return { baseType: outerSpec ? outerSpec.canonicalName : outerRaw, elementType: elem };
  }

  const shortName = cleaned.split('.').pop() || cleaned;
  const spec = TYPE_BY_NAME.get(shortName);
  return { baseType: spec ? spec.canonicalName : shortName };
}

function parseUserTypes(code: string): Map<string, UserTypeInfo> {
  const result = new Map<string, UserTypeInfo>();

  // Match class / struct / record / interface / enum headers
  const headerRe = /\b(class|struct|record(?:\s+class|\s+struct)?|interface|enum)\s+([A-Za-z_]\w*)(?:\s*\(([^)]*)\))?[^{;]*(\{|;)/g;
  let m: RegExpExecArray | null;

  while ((m = headerRe.exec(code)) !== null) {
    const kwRaw = m[1];
    const name = m[2];
    const primaryCtorParams = m[3];
    const terminator = m[4];
    const kind: UserTypeInfo['kind'] =
      kwRaw.startsWith('record') ? 'Record'
      : kwRaw === 'struct' ? 'Struct'
      : kwRaw === 'interface' ? 'Interface'
      : kwRaw === 'enum' ? 'Enum'
      : 'Class';

    const staticMembers: MemberItem[] = [];
    const instanceMembers: MemberItem[] = [];

    // Record / primary-constructor properties: e.g. `record Person(string Name, int Age)`
    if (primaryCtorParams) {
      for (const part of primaryCtorParams.split(',')) {
        const pMatch = /^\s*(?:params\s+|in\s+|ref\s+|out\s+)?([A-Za-z_][\w<>[\]?,.\s]*?)\s+([A-Za-z_]\w*)\s*(?:=.*)?$/.exec(part);
        if (pMatch) {
          const propTypeRaw = pMatch[1].trim();
          const propName = pMatch[2];
          if (kind === 'Record') {
            instanceMembers.push({
              label: propName,
              kind: 'Property',
              detail: `${propTypeRaw} ${name}.${propName} { get; init; }`,
              returnType: normalizeTypeName(propTypeRaw).baseType,
            });
          }
        }
      }
    }

    let startOffset = m.index;
    let endOffset = m.index + m[0].length;

    if (terminator === '{') {
      const openBraceIdx = m.index + m[0].length - 1;
      let depth = 1;
      let i = openBraceIdx + 1;
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        i++;
      }
      startOffset = openBraceIdx;
      endOffset = i;
      const body = code.slice(openBraceIdx + 1, Math.max(openBraceIdx + 1, i - 1));

      if (kind === 'Enum') {
        const cleanedBody = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const entry of cleanedBody.split(',')) {
          const em = /^\s*(?:\[[^\]]*\]\s*)*([A-Za-z_]\w*)/.exec(entry);
          if (em && !ALL_CSHARP_KEYWORDS.has(em[1])) {
            staticMembers.push({
              label: em[1],
              kind: 'EnumMember',
              detail: `${name}.${em[1]}`,
              returnType: name,
            });
          }
        }
      } else {
        // Extract properties, methods, and fields at depth 0 of the type body
        const memberLines = body.split(/\r?\n/);
        let braceDepth = 0;
        for (const rawLine of memberLines) {
          const line = rawLine.replace(/\/\/.*$/, '').trim();
          if (braceDepth === 0 && line) {
            const isStatic = /\b(?:static|const)\b/.test(line);
            const methodMatch =
              /^(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|new|partial)\s+)*([A-Za-z_][\w<>[\]?,.]*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line);
            if (methodMatch && methodMatch[2] !== name && !ALL_CSHARP_KEYWORDS.has(methodMatch[2])) {
              const retRaw = methodMatch[1];
              const mName = methodMatch[2];
              const params = methodMatch[3].trim();
              const item: MemberItem = {
                label: mName,
                kind: 'Method',
                detail: `${retRaw} ${name}.${mName}(${params})`,
                returnType: normalizeTypeName(retRaw).baseType,
              };
              (isStatic ? staticMembers : instanceMembers).push(item);
            } else {
              const propOrFieldMatch =
                /^(?:(?:public|private|protected|internal|static|readonly|const|required|virtual|override|abstract|new)\s+)*([A-Za-z_][\w<>[\]?,.]*)\s+([A-Za-z_]\w*)\s*(\{|=>|=|;)/.exec(line);
              if (propOrFieldMatch && !ALL_CSHARP_KEYWORDS.has(propOrFieldMatch[2]) && !ALL_CSHARP_KEYWORDS.has(propOrFieldMatch[1]) || (propOrFieldMatch && PRIMITIVE_TYPE_KEYWORDS.includes(propOrFieldMatch[1]) && !ALL_CSHARP_KEYWORDS.has(propOrFieldMatch[2]))) {
                const tRaw = propOrFieldMatch[1];
                const mName = propOrFieldMatch[2];
                const sep = propOrFieldMatch[3];
                const isProp = sep === '{' || sep === '=>';
                const item: MemberItem = {
                  label: mName,
                  kind: isProp ? 'Property' : /\bconst\b/.test(line) ? 'Constant' : 'Field',
                  detail: isProp ? `${tRaw} ${name}.${mName} { get; set; }` : `${tRaw} ${name}.${mName}`,
                  returnType: normalizeTypeName(tRaw).baseType,
                };
                (isStatic ? staticMembers : instanceMembers).push(item);
              }
            }
          }
          for (const ch of line) {
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
          }
        }
      }
    }

    result.set(name, { name, kind, staticMembers, instanceMembers, startOffset, endOffset });
  }

  return result;
}

function inferRhsExpressionType(
  rhs: string,
  userTypes: Map<string, UserTypeInfo>,
  knownVars?: Map<string, LocalSymbolInfo>,
): { baseType: string; elementType?: string } | null {
  const expr = rhs.trim().replace(/;$/, '').trim();
  if (!expr) return null;

  // Unwrap `await <taskExpr>` -> extract T from Task<T> / ValueTask<T>
  const awaitMatch = /^await\s+(.+)$/.exec(expr);
  if (awaitMatch) {
    const innerExpr = awaitMatch[1].trim().replace(/\s*\.\s*ConfigureAwait\s*\([^)]*\)\s*$/, '');
    const callHead = /^([A-Za-z_][\w.]*)\s*\(/.exec(innerExpr);
    if (callHead) {
      const m = findMemberForSignature(callHead[1], userTypes, knownVars || new Map());
      const taskInner = /^(?:Task|ValueTask)<([^>]+)>/.exec(m?.detail || '');
      if (taskInner) return normalizeTypeName(taskInner[1]);
    }
    const innerType = inferRhsExpressionType(innerExpr, userTypes, knownVars);
    if (innerType?.baseType === 'Task' && innerType.elementType) {
      return { baseType: innerType.elementType };
    }
    return innerType;
  }

  if (/^(?:\$@"|@\$"|@"|\$"|")/.test(expr)) return { baseType: 'string' };
  if (/^'/.test(expr)) return { baseType: 'char' };
  if (/^(?:true|false)\b/.test(expr)) return { baseType: 'bool' };
  if (/^-?\d+_\d*$|^-?\d+$/.test(expr)) return { baseType: 'int' };
  if (/^-?\d+[Ll]$/.test(expr)) return { baseType: 'long' };
  if (/^-?\d+\.\d*[Ff]$|^-?\d+[Ff]$/.test(expr)) return { baseType: 'float' };
  if (/^-?\d+(?:\.\d+)?[Mm]$/.test(expr)) return { baseType: 'decimal' };
  if (/^-?\d+\.\d*(?:[Dd])?$/.test(expr)) return { baseType: 'double' };

  const newArrMatch = /^new\s+([A-Za-z_][\w.]*)\s*\[/.exec(expr);
  if (newArrMatch) return { baseType: 'Array', elementType: normalizeTypeName(newArrMatch[1]).baseType };
  if (/^new\s*\[\s*\]/.test(expr)) return { baseType: 'Array' };

  const newObjMatch = /^new\s+([A-Za-z_][\w.<>,\s?]*?)\s*(?:\(|\{|$)/.exec(expr);
  if (newObjMatch) return normalizeTypeName(newObjMatch[1]);

  if (/^WebApplication\.Create(?:Slim)?Builder\b/.test(expr)) return { baseType: 'WebApplicationBuilder' };
  if (/\.Build\s*\(\s*\)$/.test(expr) && /\bbuilder\b/.test(expr)) return { baseType: 'WebApplication' };

  // Chained member / call evaluation e.g. Console.ReadLine(), Console.ReadKey(), DateTime.Now, int.Parse(...)
  const chainType = resolveChainExpressionType(expr, userTypes, knownVars || new Map());
  if (chainType) return { baseType: chainType.typeName, elementType: chainType.elementType };

  return null;
}

function collectScopeVariables(
  code: string,
  cursorLine: number,
  userTypes: Map<string, UserTypeInfo>,
): Map<string, LocalSymbolInfo> {
  const vars = new Map<string, LocalSymbolInfo>();
  const lines = code.split(/\r?\n/);
  const maxLine = Math.min(lines.length, cursorLine);

  // Implicit top-level args in C# Console / Web templates
  if (!/\bstatic\s+(?:async\s+)?(?:void|int|Task(?:<int>)?)\s+Main\s*\(/.test(code)) {
    vars.set('args', {
      name: 'args',
      typeName: 'Array',
      rawTypeDisplay: 'string[]',
      elementType: 'string',
      kind: 'parameter',
      line: 1,
    });
  }

  for (let i = 0; i < maxLine; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\/\/.*$/, '');
    const lineNum = i + 1;

    // 1. `out Type name` or `out var name` inside TryParse / TryGetValue / nested calls
    const outRe = /\bout\s+(var|[A-Za-z_][\w<>[\]?]*)\s+([A-Za-z_]\w*)/g;
    let om: RegExpExecArray | null;
    while ((om = outRe.exec(line)) !== null) {
      const declType = om[1];
      const vName = om[2];
      if (ALL_CSHARP_KEYWORDS.has(vName)) continue;

      let resolved = 'object';
      let display = declType;
      let elemType: string | undefined;

      if (declType !== 'var') {
        const norm = normalizeTypeName(declType);
        resolved = norm.baseType;
        elemType = norm.elementType;
      } else {
        const callCtx = findActiveCall(line.slice(0, om.index + 4));
        if (callCtx) {
          const member = findMemberForSignature(callCtx.calleeExpr, userTypes, vars);
          const paramsInside = /\(([^)]*)\)/.exec(member?.detail || '')?.[1] || '';
          const paramSpec = paramsInside.split(',').map((p) => p.trim())[callCtx.argIndex] || '';
          const outParamMatch = /^out\s+([A-Za-z_][\w<>[\]?]*)/.exec(paramSpec);
          if (outParamMatch) {
            const rawOutType = outParamMatch[1];
            if (/^T(?:Value|Result)?\??$/.test(rawOutType) && callCtx.calleeExpr.includes('.')) {
              const recv = resolveChainExpressionType(
                callCtx.calleeExpr.slice(0, callCtx.calleeExpr.lastIndexOf('.')),
                userTypes,
                vars,
              );
              if (recv?.elementType) {
                resolved = recv.elementType;
                display = resolved;
              }
            } else {
              const norm = normalizeTypeName(rawOutType);
              resolved = norm.baseType;
              elemType = norm.elementType;
              display = resolved;
            }
          }
        }
      }
      vars.set(vName, { name: vName, typeName: resolved, rawTypeDisplay: display, elementType: elemType, kind: 'local', line: lineNum });
    }

    // 2. Pattern matching `is Type name`
    const isPatternRe = /\bis\s+([A-Za-z_][\w<>[\]]*)\s+([A-Za-z_]\w*)\b/g;
    while ((om = isPatternRe.exec(line)) !== null) {
      const tRaw = om[1];
      const vName = om[2];
      if (!ALL_CSHARP_KEYWORDS.has(tRaw) || PRIMITIVE_TYPE_KEYWORDS.includes(tRaw)) {
        if (!ALL_CSHARP_KEYWORDS.has(vName)) {
          const norm = normalizeTypeName(tRaw);
          vars.set(vName, { name: vName, typeName: norm.baseType, rawTypeDisplay: tRaw, elementType: norm.elementType, kind: 'local', line: lineNum });
        }
      }
    }

    // 3. `foreach (var/Type item in collection)`
    const foreachMatch = /\bforeach\s*\(\s*(var|[A-Za-z_][\w<>[\]?]*)\s+([A-Za-z_]\w*)\s+in\s+([^)]+)\)/.exec(line);
    if (foreachMatch) {
      const declType = foreachMatch[1];
      const itemVar = foreachMatch[2];
      const collExpr = foreachMatch[3].trim();
      if (declType !== 'var') {
        const norm = normalizeTypeName(declType);
        vars.set(itemVar, { name: itemVar, typeName: norm.baseType, rawTypeDisplay: declType, elementType: norm.elementType, kind: 'local', line: lineNum });
      } else {
        let elem = 'object';
        const collVar = vars.get(collExpr);
        if (collVar?.elementType) elem = collVar.elementType;
        else if (collVar?.typeName === 'string') elem = 'char';
        else {
          const inferredColl = inferRhsExpressionType(collExpr, userTypes, vars);
          if (inferredColl?.elementType) elem = inferredColl.elementType;
          else if (inferredColl?.baseType === 'string') elem = 'char';
        }
        vars.set(itemVar, { name: itemVar, typeName: elem, rawTypeDisplay: elem, kind: 'local', line: lineNum });
      }
    }

    // 4. `catch (ExceptionType ex)`
    const catchMatch = /\bcatch\s*\(\s*([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*\)/.exec(line);
    if (catchMatch) {
      const norm = normalizeTypeName(catchMatch[1]);
      vars.set(catchMatch[2], { name: catchMatch[2], typeName: norm.baseType, rawTypeDisplay: catchMatch[1], kind: 'local', line: lineNum });
    }

    // 5. Method / lambda parameters `(Type a, Type b)`
    const methodParamLine = /^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|sealed|partial)\s+)*[A-Za-z_][\w<>[\]?]*\s+[A-Za-z_]\w*\s*\(([^)]*)\)/.exec(line);
    if (methodParamLine && methodParamLine[1]) {
      for (const p of methodParamLine[1].split(',')) {
        const pm = /^\s*(?:params\s+|in\s+|ref\s+|out\s+|this\s+)?([A-Za-z_][\w<>[\]?]*)\s+([A-Za-z_]\w*)/.exec(p);
        if (pm && !ALL_CSHARP_KEYWORDS.has(pm[2])) {
          const norm = normalizeTypeName(pm[1]);
          vars.set(pm[2], { name: pm[2], typeName: norm.baseType, rawTypeDisplay: pm[1], elementType: norm.elementType, kind: 'parameter', line: lineNum });
        }
      }
    }

    // 6. Standard local / field declarations: `var x = ...;` or `Type x = ...;` or `Type x;`
    const declMatch = /^\s*(?:(?:public|private|protected|internal|static|readonly|const|using)\s+)*(var|[A-Za-z_][\w<>[\]?,.\s]*?\??)\s+([A-Za-z_]\w*)\s*(?:=\s*(.+?))?\s*;?\s*$/.exec(line);
    if (declMatch) {
      const rawType = declMatch[1].trim();
      const vName = declMatch[2];
      const rhs = declMatch[3] || '';
      if (
        !ALL_CSHARP_KEYWORDS.has(vName) &&
        (!ALL_CSHARP_KEYWORDS.has(rawType.replace(/\?$/, '')) || rawType === 'var' || PRIMITIVE_TYPE_KEYWORDS.includes(rawType.replace(/\?$/, ''))) &&
        rawType !== 'return' &&
        rawType !== 'throw' &&
        rawType !== 'await' &&
        rawType !== 'new' &&
        rawType !== 'namespace' &&
        rawType !== 'using'
      ) {
        if (rawType === 'var') {
          const inf = inferRhsExpressionType(rhs, userTypes, vars);
          const resolved = inf?.baseType || 'object';
          vars.set(vName, {
            name: vName,
            typeName: resolved,
            rawTypeDisplay: inf ? (inf.elementType ? `${resolved}<${inf.elementType}>` : resolved) : 'var',
            elementType: inf?.elementType,
            kind: 'local',
            line: lineNum,
          });
        } else {
          const norm = normalizeTypeName(rawType);
          if (TYPE_BY_NAME.has(norm.baseType) || userTypes.has(norm.baseType) || /^[A-Z]/.test(norm.baseType)) {
            vars.set(vName, {
              name: vName,
              typeName: norm.baseType,
              rawTypeDisplay: rawType,
              elementType: norm.elementType,
              kind: 'local',
              line: lineNum,
            });
          }
        }
      }
    }
  }

  return vars;
}

interface ResolvedReceiver {
  typeName: string;
  isStatic: boolean;
  elementType?: string;
  isNullableStruct?: boolean;
  caseFixTo?: string;
}

function getNullableStructMembers(innerType: string): MemberItem[] {
  return [
    {
      label: 'HasValue',
      kind: 'Property',
      detail: `bool ${innerType}?.HasValue { get; }`,
      documentation: 'Gets a value indicating whether the current Nullable<T> object has a valid value of its underlying type.',
      returnType: 'bool',
    },
    {
      label: 'Value',
      kind: 'Property',
      detail: `${innerType} ${innerType}?.Value { get; }`,
      documentation: 'Gets the value of the current Nullable<T> object if it has been assigned a valid underlying value.',
      returnType: innerType,
    },
    {
      label: 'GetValueOrDefault',
      kind: 'Method',
      detail: `${innerType} ${innerType}?.GetValueOrDefault()`,
      overloads: [
        `${innerType} ${innerType}?.GetValueOrDefault()`,
        `${innerType} ${innerType}?.GetValueOrDefault(${innerType} defaultValue)`,
      ],
      returnType: innerType,
    },
    ...OBJECT_INSTANCE_MEMBERS,
  ];
}

/**
 * Splits a chained member expression like `Console.ReadLine().Trim()` or `DateTime.Now.Date`
 * at top-level `.` / `?.` separators (ignoring dots inside `(...)`, `[...]`, `"..."`).
 */
function splitMemberChain(expr: string): string[] {
  const segments: string[] = [];
  let current = '';
  let paren = 0;
  let bracket = 0;
  let inStr = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inStr) {
      current += ch;
      if (ch === '\\' && i + 1 < expr.length) {
        current += expr[++i];
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      current += ch;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);

    if (paren === 0 && bracket === 0) {
      if (ch === '?' && expr[i + 1] === '.') {
        segments.push(current.trim());
        current = '';
        i++;
        continue;
      }
      if (ch === '.' && !/^\d$/.test(expr[i + 1] || '')) {
        segments.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function getAllInstanceMembers(typeName: string, userTypes: Map<string, UserTypeInfo>): MemberItem[] {
  const userType = userTypes.get(typeName);
  if (userType) {
    const seen = new Set(userType.instanceMembers.map((m) => m.label));
    return [
      ...userType.instanceMembers,
      ...OBJECT_INSTANCE_MEMBERS.filter((o) => !seen.has(o.label)),
    ];
  }

  const spec = TYPE_BY_NAME.get(typeName);
  if (!spec) return [];

  const combined: MemberItem[] = [...spec.instanceMembers];
  const seen = new Set(combined.map((m) => m.label));

  if (spec.isCollection && spec.canonicalName !== 'string') {
    for (const lm of LINQ_EXTENSION_MEMBERS) {
      if (!seen.has(lm.label)) {
        seen.add(lm.label);
        combined.push(lm);
      }
    }
  } else if (spec.canonicalName === 'string') {
    for (const lm of LINQ_EXTENSION_MEMBERS) {
      if (!seen.has(lm.label)) {
        seen.add(lm.label);
        combined.push(lm);
      }
    }
  }

  for (const om of OBJECT_INSTANCE_MEMBERS) {
    if (!seen.has(om.label)) {
      seen.add(om.label);
      combined.push(om);
    }
  }
  return combined;
}

function getAllStaticMembers(typeName: string, userTypes: Map<string, UserTypeInfo>): MemberItem[] {
  const userType = userTypes.get(typeName);
  if (userType) {
    if (userType.kind === 'Enum') return [...userType.staticMembers];
    const seen = new Set(userType.staticMembers.map((m) => m.label));
    return [...userType.staticMembers, ...OBJECT_STATIC_MEMBERS.filter((o) => !seen.has(o.label))];
  }

  const spec = TYPE_BY_NAME.get(typeName);
  if (!spec) return [];
  if (spec.kind === 'Enum') return [...spec.staticMembers];

  const seen = new Set(spec.staticMembers.map((m) => m.label));
  return [...spec.staticMembers, ...OBJECT_STATIC_MEMBERS.filter((o) => !seen.has(o.label))];
}

function resolveChainExpressionType(
  rawExpr: string,
  userTypes: Map<string, UserTypeInfo>,
  scopeVars: Map<string, LocalSymbolInfo>,
  enclosingClass?: string,
): ResolvedReceiver | null {
  const trimmed = rawExpr.trim();
  if (!trimmed) return null;

  const segments = splitMemberChain(trimmed);
  if (segments.length === 0) return null;

  const head = segments[0];
  let current: ResolvedReceiver | null = null;

  // 1. Resolve head segment
  if (/^(?:\$@"|@\$"|@"|\$"|").*"$/.test(head)) {
    current = { typeName: 'string', isStatic: false };
  } else if (/^'.*'$/.test(head)) {
    current = { typeName: 'char', isStatic: false };
  } else if (head === 'true' || head === 'false') {
    current = { typeName: 'bool', isStatic: false };
  } else if (/^\(\s*-?\d+\s*\)$/.test(head)) {
    current = { typeName: 'int', isStatic: false };
  } else if (head.startsWith('(') && head.endsWith(')')) {
    const innerParen = head.slice(1, -1).trim();
    const castMatch = /^\(\s*([A-Za-z_][\w<>[\]?]*)\s*\)\s*(.+)$/.exec(innerParen);
    if (castMatch) {
      const norm = normalizeTypeName(castMatch[1]);
      current = { typeName: norm.baseType, isStatic: false, elementType: norm.elementType };
    } else {
      const innerInf = inferRhsExpressionType(innerParen, userTypes, scopeVars);
      if (innerInf) {
        current = { typeName: innerInf.baseType, isStatic: false, elementType: innerInf.elementType };
      }
    }
  } else if (head === 'this' && enclosingClass) {
    current = { typeName: enclosingClass, isStatic: false };
  } else if (/^new\s+([A-Za-z_][\w.<>,\s?]*)\s*\(.*\)$/.test(head)) {
    const m = /^new\s+([A-Za-z_][\w.<>,\s?]*)\s*\(/.exec(head)!;
    const norm = normalizeTypeName(m[1]);
    current = { typeName: norm.baseType, isStatic: false, elementType: norm.elementType };
  } else {
    // Check index access e.g. `items[0]` or `args[0]` or `dict["key"]`
    const idxMatch = /^([A-Za-z_]\w*)\s*\[[^\]]+\]$/.exec(head);
    if (idxMatch) {
      const v = scopeVars.get(idxMatch[1]);
      if (v) {
        const elem = v.typeName === 'string' ? 'char' : v.elementType || 'object';
        current = { typeName: elem, isStatic: false };
      }
    } else if (/^[A-Za-z_]\w*$/.test(head)) {
      const isStructType = (tName: string) =>
        TYPE_BY_NAME.get(tName)?.kind === 'Struct' || userTypes.get(tName)?.kind === 'Struct';

      // Local variable / parameter takes precedence over case-insensitive type names unless exact primitive keyword
      const localVar = scopeVars.get(head);
      if (localVar && !PRIMITIVE_TYPE_KEYWORDS.includes(head)) {
        const isNullStruct = localVar.rawTypeDisplay.trim().endsWith('?') && isStructType(localVar.typeName);
        current = {
          typeName: localVar.typeName,
          isStatic: false,
          elementType: localVar.elementType,
          isNullableStruct: isNullStruct,
        };
      } else if (userTypes.has(head)) {
        current = { typeName: head, isStatic: true };
      } else if (TYPE_BY_NAME.has(head)) {
        current = { typeName: TYPE_BY_NAME.get(head)!.canonicalName, isStatic: true };
      } else if (localVar) {
        current = { typeName: localVar.typeName, isStatic: false, elementType: localVar.elementType };
      } else if (head === 'builder') {
        current = { typeName: 'WebApplicationBuilder', isStatic: false };
      } else if (head === 'app') {
        current = { typeName: 'WebApplication', isStatic: false };
      } else {
        // Case-insensitive static type match (e.g. `console.` -> `Console.`, `datetime.` -> `DateTime.`)
        const ciUser = [...userTypes.keys()].find((k) => k.toLowerCase() === head.toLowerCase());
        if (ciUser) {
          current = { typeName: ciUser, isStatic: true, caseFixTo: ciUser !== head ? ciUser : undefined };
        } else {
          const ciBcl = TYPE_BY_LOWER.get(head.toLowerCase());
          if (ciBcl) {
            const pref = ciBcl.preferredSpelling;
            current = {
              typeName: ciBcl.spec.canonicalName,
              isStatic: true,
              caseFixTo: pref !== head && /^[A-Z]/.test(pref) ? pref : undefined,
            };
          }
        }
      }
    }
  }

  if (!current) return null;

  // 2. Walk remaining chain segments: e.g. `.ReadLine()`, `.Now`, `.Where(...)`, `.Key`
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const segMatch = /^([A-Za-z_]\w*)(?:<[^>]*>)?\s*(\(.*\))?(?:\s*\[[^\]]+\])?$/.exec(seg);
    if (!segMatch) return null;
    const memberName = segMatch[1];
    const hasIndexer = /\]\s*$/.test(seg);

    const pool: MemberItem[] = current.isStatic
      ? getAllStaticMembers(current.typeName, userTypes)
      : current.isNullableStruct
      ? getNullableStructMembers(current.typeName)
      : getAllInstanceMembers(current.typeName, userTypes);

    const found: MemberItem | undefined =
      pool.find((m: MemberItem) => m.label === memberName) ||
      pool.find((m: MemberItem) => m.label.toLowerCase() === memberName.toLowerCase());
    if (!found || !found.returnType) {
      // Element-returning LINQ methods (First, FirstOrDefault, Single, Last, Max, Min) inherit collection's elementType!
      if (found && current.elementType && /^(?:First|FirstOrDefault|Single|SingleOrDefault|Last|LastOrDefault|ElementAt|ElementAtOrDefault|Min|Max|Peek|Pop|Dequeue|Find)$/.test(found.label)) {
        current = { typeName: current.elementType, isStatic: false };
        continue;
      }
      return null;
    }

    let nextType: string = found.returnType;
    let nextElem: string | undefined =
      nextType === 'IEnumerable' || nextType === 'List' || nextType === 'Array' || nextType === 'HashSet'
        ? current.elementType || (found.detail.startsWith('string[]') ? 'string' : undefined)
        : undefined;

    if (hasIndexer) {
      nextType = nextType === 'string' ? 'char' : nextElem || 'object';
      nextElem = undefined;
    }

    current = { typeName: nextType, isStatic: false, elementType: nextElem };
  }

  return current;
}

/**
 * Extracts the receiver expression immediately preceding `.` or `?.` before the cursor.
 * Handles parentheses & string literals, e.g. `if (int.TryP`, `Console.ReadLine().Tr`, `(a + b).ToS`, `"hi".Le`.
 */
function extractReceiverBeforeDot(linePrefix: string): {
  receiver: string;
  receiverStartCol: number;
  memberPartial: string;
} | null {
  const tailMatch = /(?:\?\.|\.)\s*([A-Za-z_]\w*)?$/.exec(linePrefix);
  if (!tailMatch) return null;

  const dotIdx = tailMatch.index; // 0-based index of `.` or `?`
  const memberPartial = tailMatch[1] || '';

  // Walk backwards from dotIdx - 1 to collect a balanced primary/member expression
  let i = dotIdx - 1;
  while (i >= 0 && /\s/.test(linePrefix[i])) i--;
  if (i < 0) return null;

  const endIdx = i + 1;
  let paren = 0;
  let bracket = 0;

  while (i >= 0) {
    const ch = linePrefix[i];
    if (ch === '"') {
      i--;
      while (i >= 0) {
        if (linePrefix[i] === '"' && linePrefix[i - 1] !== '\\') break;
        i--;
      }
      if (i > 0 && (linePrefix[i - 1] === '$' || linePrefix[i - 1] === '@')) i--;
      if (i > 0 && (linePrefix[i - 1] === '$' || linePrefix[i - 1] === '@')) i--;
      i--;
      continue;
    }
    if (ch === '\'') {
      i--;
      while (i >= 0 && linePrefix[i] !== '\'') i--;
      i--;
      continue;
    }
    if (ch === ')') {
      paren++;
      i--;
      continue;
    }
    if (ch === '(') {
      if (paren > 0) {
        paren--;
        i--;
        continue;
      }
      break;
    }
    if (ch === ']') {
      bracket++;
      i--;
      continue;
    }
    if (ch === '[') {
      if (bracket > 0) {
        bracket--;
        i--;
        continue;
      }
      break;
    }
    if (paren === 0 && bracket === 0) {
      // Stop at operators / delimiters that cannot be part of a primary/postfix receiver
      if (/[,;{}=<>!&|+\-*/%^?:~]/.test(ch) && !(ch === '?' && linePrefix[i + 1] === '.')) {
        break;
      }
      if (/\s/.test(ch)) {
        // Allow `new TypeName(...)` across space, otherwise stop at whitespace before identifier
        const rest = linePrefix.slice(i + 1, endIdx);
        const before = linePrefix.slice(0, i).trimEnd();
        if (/^[A-Z_a-z][\w.<>,]*\s*\(/.test(rest) && /\bnew$/.test(before)) {
          i--;
          continue;
        }
        break;
      }
    }
    i--;
  }

  let receiver = linePrefix.slice(i + 1, endIdx).trim();
  let startIdx = linePrefix.indexOf(receiver, i + 1);

  // Strip leading unary `!` or `await ` if glued e.g. `if (!int.TryParse` -> receiver is `int`
  const awaitPrefix = /^await\s+/.exec(receiver);
  if (awaitPrefix) {
    receiver = receiver.slice(awaitPrefix[0].length);
    startIdx += awaitPrefix[0].length;
  }
  if (!receiver) return null;

  return {
    receiver,
    receiverStartCol: startIdx + 1, // 1-based column
    memberPartial,
  };
}

type CursorLexState = 'code' | 'lineComment' | 'xmlDocComment' | 'blockComment' | 'plainString';

/**
 * Determines whether the cursor is inside a comment, plain string literal, or active code
 * (including inside `{...}` of an interpolated `$"..."` string, where C# expressions ARE valid!).
 */
function analyzeLexicalStateAtCursor(code: string, targetLine: number, targetCol: number): {
  state: CursorLexState;
  activeExprLinePrefix: string;
} {
  const lines = code.split(/\r?\n/);
  let inBlockComment = false;
  let inVerbatimString = false;
  let verbatimInterpolated = false;

  for (let ln = 1; ln <= Math.min(targetLine, lines.length); ln++) {
    const line = lines[ln - 1] || '';
    const limit = ln === targetLine ? Math.min(line.length, Math.max(0, targetCol - 1)) : line.length;
    let i = 0;

    while (i < limit) {
      if (inBlockComment) {
        if (line[i] === '*' && line[i + 1] === '/') {
          inBlockComment = false;
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if (inVerbatimString) {
        if (line[i] === '"' && line[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (line[i] === '"') {
          inVerbatimString = false;
          verbatimInterpolated = false;
          i++;
          continue;
        }
        if (verbatimInterpolated && line[i] === '{' && line[i + 1] !== '{') {
          const exprStart = i + 1;
          let depth = 1;
          i++;
          while (i < limit && depth > 0) {
            if (line[i] === '{') depth++;
            else if (line[i] === '}') depth--;
            i++;
          }
          if (depth > 0 && ln === targetLine) {
            return { state: 'code', activeExprLinePrefix: line.slice(exprStart, limit) };
          }
          continue;
        }
        i++;
        continue;
      }

      const ch = line[i];
      const next = line[i + 1];

      if (ch === '/' && next === '/') {
        if (ln === targetLine) {
          const isXml = line[i + 2] === '/';
          return { state: isXml ? 'xmlDocComment' : 'lineComment', activeExprLinePrefix: '' };
        }
        break;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      const isInterpVerb = (ch === '$' && next === '@' && line[i + 2] === '"') || (ch === '@' && next === '$' && line[i + 2] === '"');
      const isVerb = ch === '@' && next === '"';
      const isInterp = ch === '$' && next === '"';
      const isStr = ch === '"';

      if (isInterpVerb || isVerb) {
        inVerbatimString = true;
        verbatimInterpolated = isInterpVerb;
        i += isInterpVerb ? 3 : 2;
        continue;
      }

      if (isInterp || isStr) {
        i += isInterp ? 2 : 1;
        let closed = false;
        while (i < limit) {
          if (line[i] === '\\') {
            i += 2;
            continue;
          }
          if (isInterp && line[i] === '{') {
            if (line[i + 1] === '{') {
              i += 2;
              continue;
            }
            const exprStart = i + 1;
            let depth = 1;
            i++;
            while (i < limit && depth > 0) {
              if (line[i] === '{') depth++;
              else if (line[i] === '}') depth--;
              i++;
            }
            if (depth > 0 && ln === targetLine) {
              return { state: 'code', activeExprLinePrefix: line.slice(exprStart, limit) };
            }
            continue;
          }
          if (line[i] === '"') {
            closed = true;
            i++;
            break;
          }
          i++;
        }
        if (!closed && ln === targetLine) {
          return { state: 'plainString', activeExprLinePrefix: '' };
        }
        continue;
      }

      if (ch === '\'') {
        i++;
        while (i < limit) {
          if (line[i] === '\\') {
            i += 2;
            continue;
          }
          if (line[i] === '\'') {
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      i++;
    }

    if (ln === targetLine) {
      if (inBlockComment) return { state: 'blockComment', activeExprLinePrefix: '' };
      if (inVerbatimString) return { state: 'plainString', activeExprLinePrefix: '' };
      return { state: 'code', activeExprLinePrefix: line.slice(0, limit) };
    }
  }

  return { state: 'code', activeExprLinePrefix: '' };
}

interface ActiveCallContext {
  calleeExpr: string;
  argIndex: number;
  currentArgText: string;
}

/**
 * Finds the innermost unclosed method call `Callee(arg0, arg1, |` before the cursor,
 * properly balancing nested parentheses like `int.TryParse(Console.ReadLine(), |`.
 */
function findActiveCall(textBeforeCursor: string): ActiveCallContext | null {
  let depth = 0;
  let commaCount = 0;
  let lastCommaOrOpenIdx = -1;
  let inStr = false;

  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    const ch = textBeforeCursor[i];
    if (ch === '"' && textBeforeCursor[i - 1] !== '\\') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;

    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth > 0) {
        depth--;
      } else {
        const beforeParen = textBeforeCursor.slice(0, i).trimEnd();
        const calleeMatch = /([A-Za-z_][\w.]*\.[A-Za-z_]\w*|[A-Za-z_]\w*)$/.exec(beforeParen);
        if (!calleeMatch) return null;
        const callee = calleeMatch[1];
        if (['if', 'while', 'for', 'foreach', 'switch', 'catch', 'using', 'lock', 'typeof', 'sizeof', 'nameof'].includes(callee)) {
          return null;
        }
        const argStart = lastCommaOrOpenIdx === -1 ? i + 1 : lastCommaOrOpenIdx + 1;
        return {
          calleeExpr: callee,
          argIndex: commaCount,
          currentArgText: textBeforeCursor.slice(argStart),
        };
      }
    } else if (ch === ',' && depth === 0) {
      if (commaCount === 0) lastCommaOrOpenIdx = i;
      commaCount++;
    } else if ((ch === ';' || ch === '{' || ch === '}') && depth === 0) {
      break;
    }
  }
  return null;
}

function findMemberForSignature(
  calleeExpr: string,
  userTypes: Map<string, UserTypeInfo>,
  scopeVars: Map<string, LocalSymbolInfo>,
  enclosingClass?: string,
): MemberItem | null {
  if (calleeExpr.includes('.')) {
    const lastDot = calleeExpr.lastIndexOf('.');
    const receiverExpr = calleeExpr.slice(0, lastDot);
    const methodName = calleeExpr.slice(lastDot + 1);
    const resolved = resolveChainExpressionType(receiverExpr, userTypes, scopeVars, enclosingClass);
    if (!resolved) return null;
    const pool = resolved.isStatic
      ? getAllStaticMembers(resolved.typeName, userTypes)
      : getAllInstanceMembers(resolved.typeName, userTypes);
    return (
      pool.find((m) => m.label === methodName && m.kind === 'Method') ||
      pool.find((m) => m.label.toLowerCase() === methodName.toLowerCase() && m.kind === 'Method') ||
      null
    );
  }
  if (enclosingClass && userTypes.has(enclosingClass)) {
    const ut = userTypes.get(enclosingClass)!;
    return [...ut.instanceMembers, ...ut.staticMembers].find((m) => m.label === calleeExpr && m.kind === 'Method') || null;
  }
  return null;
}

function determineStructuralScope(codeBeforeCursor: string): {
  scope: 'topLevel' | 'classBody' | 'enumBody' | 'methodOrStatement';
  enclosingClass?: string;
} {
  // Lightweight brace-stack tracker ignoring comments and strings
  const stack: Array<{ kind: 'namespace' | 'class' | 'enum' | 'block'; name?: string }> = [];
  const tokenRe = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|\b(namespace|class|struct|record|interface|enum)\s+([A-Za-z_]\w*)|([{}])/g;
  let pendingHeader: { kind: 'namespace' | 'class' | 'enum'; name: string } | null = null;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(codeBeforeCursor)) !== null) {
    if (m[1] && m[2]) {
      const kw = m[1];
      pendingHeader = {
        kind: kw === 'namespace' ? 'namespace' : kw === 'enum' ? 'enum' : 'class',
        name: m[2],
      };
    } else if (m[3] === '{') {
      if (pendingHeader) {
        stack.push(pendingHeader);
        pendingHeader = null;
      } else {
        stack.push({ kind: 'block' });
      }
    } else if (m[3] === '}') {
      stack.pop();
      pendingHeader = null;
    }
  }

  let enclosingClass: string | undefined;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === 'class') {
      enclosingClass = stack[i].name;
      break;
    }
  }

  const top = stack[stack.length - 1];
  if (!top || top.kind === 'namespace') return { scope: 'topLevel', enclosingClass };
  if (top.kind === 'enum') return { scope: 'enumBody', enclosingClass };
  if (top.kind === 'class') return { scope: 'classBody', enclosingClass: top.name };
  return { scope: 'methodOrStatement', enclosingClass };
}

function toMonacoMemberKind(monacoInst: typeof monaco, k: MemberItem['kind']): monaco.languages.CompletionItemKind {
  switch (k) {
    case 'Method': return monacoInst.languages.CompletionItemKind.Method;
    case 'Property': return monacoInst.languages.CompletionItemKind.Property;
    case 'Field': return monacoInst.languages.CompletionItemKind.Field;
    case 'Constant': return monacoInst.languages.CompletionItemKind.Constant ?? monacoInst.languages.CompletionItemKind.Field;
    case 'Event': return monacoInst.languages.CompletionItemKind.Event;
    case 'EnumMember': return monacoInst.languages.CompletionItemKind.EnumMember;
  }
}

function toMonacoTypeKind(monacoInst: typeof monaco, k: TypeSpec['kind'] | UserTypeInfo['kind']): monaco.languages.CompletionItemKind {
  switch (k) {
    case 'Struct': return monacoInst.languages.CompletionItemKind.Struct;
    case 'Interface': return monacoInst.languages.CompletionItemKind.Interface;
    case 'Enum': return monacoInst.languages.CompletionItemKind.Enum;
    default: return monacoInst.languages.CompletionItemKind.Class;
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

export function isDotCompletionPosition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): boolean {
  const fullText = model.getValue();
  const lex = analyzeLexicalStateAtCursor(fullText, position.lineNumber, position.column);
  if (lex.state !== 'code') return false;
  return extractReceiverBeforeDot(lex.activeExprLinePrefix) !== null;
}

export function getBuiltInCSharpCompletions(
  monacoInst: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  context?: monaco.languages.CompletionContext,
): monaco.languages.CompletionItem[] {
  const fullText = model.getValue();
  const word = model.getWordUntilPosition(position);
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  const lex = analyzeLexicalStateAtCursor(fullText, position.lineNumber, position.column);

  // 1. Inside comments or plain string literals: no C# code suggestions (XML doc tags only for ///)
  if (lex.state === 'xmlDocComment') {
    const xmlTags = [
      { label: 'summary', insert: '<summary>\n/// $0\n/// </summary>', detail: 'XML documentation summary' },
      { label: 'param', insert: '<param name="${1:name}">$0</param>', detail: 'XML parameter documentation' },
      { label: 'returns', insert: '<returns>$0</returns>', detail: 'XML return value documentation' },
      { label: 'remarks', insert: '<remarks>$0</remarks>', detail: 'XML remarks documentation' },
      { label: 'exception', insert: '<exception cref="${1:Exception}">$0</exception>', detail: 'XML exception documentation' },
      { label: 'inheritdoc', insert: '<inheritdoc />', detail: 'Inherit XML documentation' },
    ];
    return xmlTags.map((x, idx) => ({
      label: x.label,
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      detail: x.detail,
      insertText: x.insert,
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `0${idx}_${x.label}`,
      range,
    }));
  }

  if (lex.state !== 'code') {
    return [];
  }

  const linePrefix = lex.activeExprLinePrefix;
  const beforeWord = linePrefix.slice(0, Math.max(0, linePrefix.length - word.word.length));
  const userTypes = parseUserTypes(fullText);
  const scopeVars = collectScopeVariables(fullText, position.lineNumber, userTypes);

  const linesUpToCursor = fullText.split(/\r?\n/).slice(0, position.lineNumber);
  linesUpToCursor[linesUpToCursor.length - 1] = linePrefix;
  const codeBeforeCursor = linesUpToCursor.join('\n');
  const { scope, enclosingClass } = determineStructuralScope(codeBeforeCursor);

  // 2. `using ...` namespace directive context: ONLY namespaces (+ `static`)
  const usingMatch = /^\s*(?:global\s+)?using\s+(static\s+)?([A-Za-z0-9_.]*)$/.exec(linePrefix);
  if (usingMatch && !usingMatch[1]) {
    const typedNs = usingMatch[2] || '';
    const lastDot = typedNs.lastIndexOf('.');
    if (lastDot !== -1) {
      const nsPrefix = typedNs.slice(0, lastDot + 1);
      const subSegments = new Set<string>();
      for (const ns of DOTNET_NAMESPACES) {
        if (ns.startsWith(nsPrefix)) {
          const rest = ns.slice(nsPrefix.length).split('.')[0];
          if (rest) subSegments.add(rest);
        }
      }
      return [...subSegments].map((seg) => ({
        label: seg,
        kind: monacoInst.languages.CompletionItemKind.Module,
        detail: `namespace ${nsPrefix}${seg}`,
        insertText: seg,
        sortText: `0_${seg}`,
        range,
      }));
    }
    return [
      ...DOTNET_NAMESPACES.map((ns) => ({
        label: ns,
        kind: monacoInst.languages.CompletionItemKind.Module,
        detail: 'namespace',
        insertText: ns,
        sortText: `0_${ns}`,
        range,
      })),
      {
        label: 'static',
        kind: monacoInst.languages.CompletionItemKind.Keyword,
        detail: 'using static directive',
        insertText: 'static ',
        sortText: '1_static',
        range,
      },
    ];
  }

  // 3. Member access after `.` or `?.`: ONLY members valid on that exact receiver!
  const dotAccess = extractReceiverBeforeDot(linePrefix);
  if (dotAccess) {
    const resolved = resolveChainExpressionType(dotAccess.receiver, userTypes, scopeVars, enclosingClass);
    if (!resolved) return [];

    const isNullConditionalDot = /\?\.\s*[A-Za-z_]\w*$|(?:\?\.)$/.test(linePrefix.trimEnd());
    const members = resolved.isStatic
      ? getAllStaticMembers(resolved.typeName, userTypes)
      : resolved.isNullableStruct && !isNullConditionalDot
      ? getNullableStructMembers(resolved.typeName)
      : getAllInstanceMembers(resolved.typeName, userTypes);

    if (members.length === 0) return [];

    const fixEdits: monaco.languages.TextEdit[] | undefined = resolved.caseFixTo
      ? [
          {
            range: {
              startLineNumber: position.lineNumber,
              startColumn: dotAccess.receiverStartCol,
              endLineNumber: position.lineNumber,
              endColumn: dotAccess.receiverStartCol + dotAccess.receiver.split('.')[0].length,
            },
            text: resolved.caseFixTo,
          },
        ]
      : undefined;

    // Detect boolean-expecting context (e.g. `if (int.|)` or `while (int.|)`) so `TryParse` / `Is...` rank #1!
    const beforeReceiver = linePrefix.slice(0, Math.max(0, dotAccess.receiverStartCol - 1));
    const expectsBool = /\b(?:if|while)\s*\([^()]*$/.test(beforeReceiver) || /(?:&&|\|\||!)\s*$/.test(beforeReceiver);
    const linqLabels = new Set(LINQ_EXTENSION_MEMBERS.map((l) => l.label));
    const objLabels = new Set(OBJECT_INSTANCE_MEMBERS.map((o) => o.label));

    return members.map((m, idx) => {
      let bucket = '1';
      if (expectsBool && m.returnType === 'bool') {
        bucket = m.label.startsWith('Try') ? '00' : '01';
      } else if (objLabels.has(m.label) && !resolved.isStatic) {
        bucket = '3';
      } else if (linqLabels.has(m.label) && !resolved.isStatic) {
        bucket = '2';
      }
      return {
        label: m.label,
        kind: toMonacoMemberKind(monacoInst, m.kind),
        detail: m.detail,
        documentation: m.documentation,
        insertText: m.insertText || m.label,
        insertTextRules: m.isSnippet
          ? monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        sortText: `${bucket}_${String(idx).padStart(3, '0')}_${m.label}`,
        additionalTextEdits: fixEdits,
        range,
      };
    });
  }

  // 4. Inside a new type/namespace/enum declaration name (`class Foo|`, `namespace Bar|`) -> don't hijack Tab!
  if (/^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|file)\s+)*(?:namespace|class|struct|record|interface|enum)\s+$/.test(beforeWord)) {
    return [];
  }
  if (scope === 'enumBody') {
    return [];
  }

  // 5. Variable / parameter identifier naming position (`int x|`, `out int res|`, `string name|`, `List<int> items|`):
  //    Never suggest C# keywords (`sizeof`, `null`, `for`) while the user is naming a variable!
  const varNameDeclMatch = /(?:^|[;(,\s])\b(var|int|long|short|byte|double|float|decimal|bool|char|string|object|DateTime|TimeSpan|Guid|Stopwatch|StringBuilder|HttpClient|CancellationToken|(?:List|Dictionary|HashSet|Queue|Stack|IEnumerable|Task)<[^>;]+>)\??\s+$/.exec(beforeWord);
  if (varNameDeclMatch) {
    const declType = varNameDeclMatch[1];
    if (!MODIFIER_ONLY_SET.has(declType)) {
      if (context?.triggerCharacter === ' ' && !/\bout\s+/.test(beforeWord)) {
        return [];
      }
      const isOut = /\bout\s+[\w<>?]+\s+$/.test(beforeWord);
      const suggestedNames = isOut
        ? ['result', 'value', 'parsed', 'number']
        : declType.startsWith('List') || declType.startsWith('IEnumerable')
        ? ['items', 'list', 'values']
        : declType.startsWith('Dictionary')
        ? ['map', 'dict', 'lookup']
        : declType === 'StringBuilder'
        ? ['sb', 'builder']
        : declType === 'Stopwatch'
        ? ['sw', 'stopwatch']
        : declType === 'HttpClient'
        ? ['client', 'httpClient']
        : declType === 'CancellationToken'
        ? ['cancellationToken', 'ct']
        : declType === 'string'
        ? ['input', 'text', 'name', 'value']
        : declType === 'int'
        ? ['value', 'count', 'index', 'number']
        : declType === 'bool'
        ? ['isValid', 'success', 'flag']
        : [];
      return suggestedNames.map((n, idx) => ({
        label: n,
        kind: monacoInst.languages.CompletionItemKind.Variable,
        detail: `Suggested variable name (${declType})`,
        insertText: n,
        sortText: `0${idx}_${n}`,
        range,
      }));
    }
  }

  // Helper builders for types, locals, keywords, snippets
  const makeTypeItems = (filterFn?: (spec: { name: string; kind: TypeSpec['kind'] | UserTypeInfo['kind']; fullName: string; isConstructible?: boolean }) => boolean, prefixSort = '1') => {
    const items: monaco.languages.CompletionItem[] = [];
    const seen = new Set<string>();

    for (const ut of userTypes.values()) {
      const entry = { name: ut.name, kind: ut.kind, fullName: ut.name, isConstructible: ut.kind === 'Class' || ut.kind === 'Struct' || ut.kind === 'Record' };
      if (filterFn && !filterFn(entry)) continue;
      seen.add(ut.name);
      items.push({
        label: ut.name,
        kind: toMonacoTypeKind(monacoInst, ut.kind),
        detail: `${ut.kind.toLowerCase()} ${ut.name}`,
        insertText: ut.name,
        sortText: `${prefixSort}0_${ut.name}`,
        range,
      });
    }

    for (const spec of BCL_TYPES) {
      // Primitive lowercase keywords (`int`, `string`, ...) are emitted as keywords where appropriate, or as types
      const namesToEmit = PRIMITIVE_TYPE_KEYWORDS.includes(spec.canonicalName)
        ? [spec.canonicalName, ...(spec.aliases || [])]
        : [spec.canonicalName, ...(spec.aliases || []).filter((a) => a.endsWith('Exception'))];

      for (const n of namesToEmit) {
        if (seen.has(n)) continue;
        const entry = { name: n, kind: spec.kind, fullName: spec.fullName, isConstructible: spec.isConstructible };
        if (filterFn && !filterFn(entry)) continue;
        seen.add(n);
        const isPrimitiveKw = PRIMITIVE_TYPE_KEYWORDS.includes(n);
        items.push({
          label: n,
          kind: isPrimitiveKw ? monacoInst.languages.CompletionItemKind.Keyword : toMonacoTypeKind(monacoInst, spec.kind),
          detail: `${spec.kind.toLowerCase()} ${spec.fullName}`,
          documentation: spec.documentation,
          insertText: n,
          sortText: `${prefixSort}${isPrimitiveKw ? '1' : '2'}_${n}`,
          range,
        });
      }
    }
    return items;
  };

  const makeLocalItems = (prefixSort = '0') =>
    [...scopeVars.values()].map((v) => ({
      label: v.name,
      kind: monacoInst.languages.CompletionItemKind.Variable,
      detail: `(${v.kind}) ${v.rawTypeDisplay} ${v.name}`,
      insertText: v.name,
      sortText: `${prefixSort}0_${v.name}`,
      range,
    }));

  // 6. Check active call parameter context (e.g. `int.TryParse(input, |)` or `int.TryParse(input, out |)`)
  const activeCall = findActiveCall(codeBeforeCursor.slice(-600));
  if (activeCall) {
    const targetMember = findMemberForSignature(activeCall.calleeExpr, userTypes, scopeVars, enclosingClass);
    const sigStr = targetMember?.detail || '';
    const paramsInside = /\(([^)]*)\)/.exec(sigStr)?.[1] || '';
    const paramList = paramsInside.split(',').map((p) => p.trim()).filter(Boolean);
    const activeParamSpec = paramList[activeCall.argIndex] || '';
    const argBeforeWord = activeCall.currentArgText.slice(0, Math.max(0, activeCall.currentArgText.length - word.word.length)).trim();

    // `int.TryParse(s, out |)` -> right after `out`!
    if (argBeforeWord === 'out' || /\bout\s+$/.test(beforeWord)) {
      const outTypeMatch = /\bout\s+([A-Za-z_][\w<>?]*)\s+([A-Za-z_]\w*)?/.exec(activeParamSpec);
      const expectedType = outTypeMatch?.[1] || 'var';
      const expectedVarName = outTypeMatch?.[2] || 'result';
      const items: monaco.languages.CompletionItem[] = [
        {
          label: `${expectedType} ${expectedVarName}`,
          kind: monacoInst.languages.CompletionItemKind.Snippet,
          detail: `Inline out variable (${expectedType})`,
          insertText: `${expectedType} \${1:${expectedVarName}}`,
          insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '00_0_outTyped',
          range,
        },
        {
          label: `var ${expectedVarName}`,
          kind: monacoInst.languages.CompletionItemKind.Snippet,
          detail: 'Inline out var declaration',
          insertText: `var \${1:${expectedVarName}}`,
          insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '00_1_outVar',
          range,
        },
        {
          label: expectedType,
          kind: monacoInst.languages.CompletionItemKind.Keyword,
          detail: `out parameter type (${expectedType})`,
          insertText: expectedType,
          sortText: '00_2_type',
          range,
        },
        {
          label: 'var',
          kind: monacoInst.languages.CompletionItemKind.Keyword,
          detail: 'Implicitly typed out variable',
          insertText: 'var',
          sortText: '00_3_var',
          range,
        },
        ...makeLocalItems('01'),
      ];
      return items;
    }

    // `int.TryParse(s, |)` -> parameter itself expects `out T result`!
    if (argBeforeWord === '' && activeParamSpec.startsWith('out ')) {
      const outTypeMatch = /^out\s+([A-Za-z_][\w<>?]*)\s+([A-Za-z_]\w*)?/.exec(activeParamSpec);
      const expectedType = outTypeMatch?.[1] || 'int';
      const expectedVarName = outTypeMatch?.[2] || 'result';
      const outSuggestions: monaco.languages.CompletionItem[] = [
        {
          label: `out ${expectedType} ${expectedVarName}`,
          kind: monacoInst.languages.CompletionItemKind.Snippet,
          detail: `Pass inline out ${expectedType} ${expectedVarName}`,
          insertText: `out ${expectedType} \${1:${expectedVarName}}`,
          insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '00_0_outFull',
          range,
        },
        {
          label: `out var ${expectedVarName}`,
          kind: monacoInst.languages.CompletionItemKind.Snippet,
          detail: `Pass inline out var ${expectedVarName}`,
          insertText: `out var \${1:${expectedVarName}}`,
          insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: '00_1_outVar',
          range,
        },
        {
          label: 'out',
          kind: monacoInst.languages.CompletionItemKind.Keyword,
          detail: 'C# out argument modifier',
          insertText: 'out ',
          sortText: '00_2_out',
          range,
        },
      ];
      if (context?.triggerCharacter === ' ') {
        return outSuggestions;
      }
      return [
        ...outSuggestions,
        ...makeLocalItems('01'),
        ...makeTypeItems(undefined, '02'),
      ];
    }
  }

  // 7. `new ...` object creation context: ONLY constructible types!
  if (/\bnew\s+$/.test(beforeWord)) {
    const lhsTypeMatch = /\b([A-Za-z_][\w<>]*)\s+[A-Za-z_]\w*\s*=\s*new\s+$/.exec(beforeWord);
    const preferredType = lhsTypeMatch && lhsTypeMatch[1] !== 'var' ? lhsTypeMatch[1] : null;
    const constructible = makeTypeItems((t) => Boolean(t.isConstructible), '1');
    if (preferredType) {
      constructible.unshift({
        label: preferredType,
        kind: monacoInst.languages.CompletionItemKind.Constructor,
        detail: `new ${preferredType}()`,
        insertText: `${preferredType}($0)`,
        insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: `00_${preferredType}`,
        range,
      });
    }
    return constructible;
  }

  // 8. `catch (|)` exception type context
  if (/\bcatch\s*\(\s*$/.test(beforeWord)) {
    return makeTypeItems((t) => t.name.endsWith('Exception'), '0');
  }

  // 9. `throw |` context
  if (/\bthrow\s+$/.test(beforeWord)) {
    const excSnippets = [
      'ArgumentNullException', 'ArgumentException', 'InvalidOperationException', 'NotImplementedException', 'FormatException',
    ].map((ex, idx) => ({
      label: `new ${ex}(...)`,
      filterText: `new ${ex}`,
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      detail: `Throw ${ex}`,
      insertText: `new ${ex}($0)`,
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `00_${idx}_${ex}`,
      range,
    }));
    return [
      {
        label: 'new',
        kind: monacoInst.languages.CompletionItemKind.Keyword,
        detail: 'Create exception instance',
        insertText: 'new ',
        sortText: '00_0_new',
        range,
      },
      ...excSnippets,
      ...makeLocalItems('01'),
    ];
  }

  // 10. Type-only positions: `is |`, `as |`, `typeof(|)`, `sizeof(|)`, `default(|)`, generic `<|`, `: |`, or after member modifiers
  if (/\b(?:as|typeof\s*\(|sizeof\s*\(|default\s*\()\s*$/.test(beforeWord) || /<[A-Za-z0-9_,\s]*$/.test(beforeWord) && /\b(?:List|Dictionary|HashSet|Queue|Stack|IEnumerable|Task|Func|Action)<\s*$/.test(beforeWord)) {
    return makeTypeItems(undefined, '0');
  }

  if (/\bis\s+$/.test(beforeWord)) {
    return [
      ...['not', 'null', 'true', 'false'].map((kw, i) => ({
        label: kw,
        kind: monacoInst.languages.CompletionItemKind.Keyword,
        detail: 'C# pattern keyword',
        insertText: kw,
        sortText: `00_${i}_${kw}`,
        range,
      })),
      ...makeTypeItems(undefined, '01'),
    ];
  }

  if (/\basync\s+$/.test(beforeWord)) {
    return [
      { label: 'Task', kind: monacoInst.languages.CompletionItemKind.Class, detail: 'System.Threading.Tasks.Task', insertText: 'Task', sortText: '00_0_Task', range },
      { label: 'Task<T>', filterText: 'Task', kind: monacoInst.languages.CompletionItemKind.Snippet, detail: 'Generic async Task<TResult>', insertText: 'Task<${1:string}>', insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet, sortText: '00_1_TaskT', range },
      { label: 'ValueTask', kind: monacoInst.languages.CompletionItemKind.Struct, detail: 'System.Threading.Tasks.ValueTask', insertText: 'ValueTask', sortText: '00_2_ValueTask', range },
      { label: 'void', kind: monacoInst.languages.CompletionItemKind.Keyword, detail: 'async void (event handlers)', insertText: 'void', sortText: '00_3_void', range },
    ];
  }

  // 11. Expected Enum on RHS of `=` / `==` / `!=` / `case ` (e.g. `Console.ForegroundColor = |` or `key.Key == |`)
  const enumAssignMatch = /([A-Za-z_][\w.]*)\s*(?:==|!=|=)\s*$/.exec(beforeWord);
  if (enumAssignMatch) {
    const lhsResolved = resolveChainExpressionType(enumAssignMatch[1], userTypes, scopeVars, enclosingClass);
    const lhsType = lhsResolved?.typeName;
    if (lhsType) {
      const bclEnum = TYPE_BY_NAME.get(lhsType);
      const userEnum = userTypes.get(lhsType);
      const enumMembers = bclEnum?.kind === 'Enum' ? bclEnum.staticMembers : userEnum?.kind === 'Enum' ? userEnum.staticMembers : null;
      if (enumMembers && enumMembers.length > 0) {
        const qualified = enumMembers.map((em, idx) => ({
          label: `${lhsType}.${em.label}`,
          kind: monacoInst.languages.CompletionItemKind.EnumMember,
          detail: em.detail,
          insertText: `${lhsType}.${em.label}`,
          sortText: `00_${String(idx).padStart(2, '0')}_${em.label}`,
          range,
        }));
        if (context?.triggerCharacter === ' ') return qualified;
        return [
          ...qualified,
          ...makeLocalItems('01'),
          ...makeTypeItems(undefined, '02'),
        ];
      }
    }
  }

  // Suppress noisy popup when just pressing Space in general places (like `; ` or `{ `)
  if (context?.triggerCharacter === ' ') {
    return [];
  }

  // 12. Object Initializer context: `new TypeName(...) { | }` -> writable properties of TypeName first!
  const objInitMatch = /\bnew\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*\{[^{};]*$/.exec(codeBeforeCursor.slice(-400));
  if (objInitMatch && (/[{,]\s*$/.test(beforeWord))) {
    const initTypeName = normalizeTypeName(objInitMatch[1]).baseType;
    const props = getAllInstanceMembers(initTypeName, userTypes).filter(
      (m) => (m.kind === 'Property' || m.kind === 'Field') && (m.detail.includes('set;') || m.detail.includes('init;') || m.kind === 'Field'),
    );
    if (props.length > 0) {
      return props.map((p, idx) => ({
        label: p.label,
        kind: toMonacoMemberKind(monacoInst, p.kind),
        detail: p.detail,
        insertText: `${p.label} = `,
        sortText: `00_${String(idx).padStart(2, '0')}_${p.label}`,
        range,
      }));
    }
  }

  // 13. Expression context (`if (|)`, `while (|)`, `switch (|)`, `Foo(|)`, `x = |`, `return |`, `&& |`, `|| |`, `$"...{|}"`)
  //     Exclude statement/declaration snippets (`cw`, `for`, `prop`, `ctor`) and modifiers (`public`, `class`, `namespace`)!
  const openParensOnLine = (beforeWord.match(/\(/g)?.length || 0) - (beforeWord.match(/\)/g)?.length || 0);
  const isExpressionPosition =
    openParensOnLine > 0 ||
    /(?:=|\breturn|\bawait|\bthrow|\?\?|&&|\|\||\?|:|,|\[|=>)\s*$/.test(beforeWord);

  if (isExpressionPosition) {
    return [
      ...makeLocalItems('00'),
      ...makeTypeItems((t) => t.name !== 'void', '01'),
      ...EXPRESSION_KEYWORDS.map((kw) => ({
        label: kw,
        kind: monacoInst.languages.CompletionItemKind.Keyword,
        detail: 'C# keyword',
        insertText: kw,
        sortText: `02_${kw}`,
        range,
      })),
    ];
  }

  // 14. Class / Struct / Interface Body context (member declarations ONLY — no `cw`, `if`, `for`, `return`!)
  if (scope === 'classBody') {
    const afterModifier = /^\s*(?:(?:public|private|protected|internal|static|readonly|const|virtual|override|abstract|sealed|required|partial)\s+)+$/.test(beforeWord);
    const memberSnippets: monaco.languages.CompletionItem[] = afterModifier
      ? []
      : VS_CSHARP_SNIPPETS.filter((s) => s.scopes.includes('classBody')).map((s) => ({
          label: s.label,
          kind: monacoInst.languages.CompletionItemKind.Snippet,
          detail: s.detail,
          insertText: s.insertText.replace(/\$\{1:ClassName\}/g, enclosingClass || '${1:ClassName}'),
          insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `00_${s.label}`,
          range,
        }));

    return [
      ...memberSnippets,
      ...MEMBER_MODIFIER_KEYWORDS.map((kw) => ({
        label: kw,
        kind: monacoInst.languages.CompletionItemKind.Keyword,
        detail: 'C# member modifier',
        insertText: kw,
        sortText: `01_${kw}`,
        range,
      })),
      ...makeTypeItems(undefined, '02'),
    ];
  }

  // 15. Statement / Top-Level `Program.cs` context
  const targetScope = scope === 'topLevel' ? 'topLevel' : 'statement';
  const snippetItems: monaco.languages.CompletionItem[] = VS_CSHARP_SNIPPETS
    .filter((s) => s.scopes.includes(targetScope))
    .map((s) => ({
      label: s.label,
      kind: monacoInst.languages.CompletionItemKind.Snippet,
      detail: s.detail,
      insertText: s.insertText,
      insertTextRules: monacoInst.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `01_snip_${s.label}`,
      range,
    }));

  const stmtKeywords = [
    ...STATEMENT_KEYWORDS,
    ...(scope === 'topLevel' ? ['public', 'private', 'internal', 'static', 'class', 'record', 'struct', 'interface', 'enum', 'namespace'] : []),
  ];
  const uniqueKw = [...new Set(stmtKeywords)];

  return [
    ...makeLocalItems('00'),
    ...makeTypeItems(undefined, '01'),
    ...uniqueKw.map((kw) => ({
      label: kw,
      kind: monacoInst.languages.CompletionItemKind.Keyword,
      detail: 'C# keyword',
      insertText: kw,
      sortText: `02_${kw}`,
      range,
    })),
    ...snippetItems,
  ];
}

export function getBuiltInCSharpHover(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.Hover | null {
  const fullText = model.getValue();
  const lines = fullText.split(/\r?\n/);
  const line = lines[position.lineNumber - 1] || '';

  // Support models with or without getWordAtPosition
  let word = '';
  let startColumn = position.column;
  let endColumn = position.column;

  if (typeof model.getWordAtPosition === 'function') {
    const info = model.getWordAtPosition(position);
    if (!info) return null;
    word = info.word;
    startColumn = info.startColumn;
    endColumn = info.endColumn;
  } else {
    const left = /[A-Za-z_]\w*$/.exec(line.slice(0, position.column - 1));
    const right = /^[A-Za-z_]\w*/.exec(line.slice(position.column - 1));
    word = (left?.[0] || '') + (right?.[0] || '');
    if (!word) return null;
    startColumn = position.column - (left?.[0].length || 0);
    endColumn = position.column + (right?.[0].length || 0);
  }

  const hoverRange: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn,
    endColumn,
  };

  const userTypes = parseUserTypes(fullText);
  const scopeVars = collectScopeVariables(fullText, lines.length, userTypes);

  // 1. Member hover after `.` or `?.`: e.g. `int.TryParse`, `Console.WriteLine`, `DateTime.Now`, `items.Where`
  const beforeWord = line.slice(0, startColumn - 1);
  const dotMatch = /(?:\?\.|\.)\s*$/.exec(beforeWord);
  if (dotMatch) {
    const dotPrefix = beforeWord.slice(0, dotMatch.index + dotMatch[0].length);
    const recInfo = extractReceiverBeforeDot(dotPrefix);
    if (recInfo) {
      const resolved = resolveChainExpressionType(recInfo.receiver, userTypes, scopeVars);
      if (resolved) {
        const pool = resolved.isStatic
          ? getAllStaticMembers(resolved.typeName, userTypes)
          : getAllInstanceMembers(resolved.typeName, userTypes);
        const member = pool.find((m) => m.label === word);
        if (member) {
          const extraOverloads =
            member.overloads && member.overloads.length > 1
              ? ` (+ ${member.overloads.length - 1} overload${member.overloads.length > 2 ? 's' : ''})`
              : '';
          return {
            range: hoverRange,
            contents: [
              { value: `\`\`\`csharp\n${member.detail}${extraOverloads}\n\`\`\`` },
              ...(member.documentation ? [{ value: member.documentation }] : []),
            ],
          };
        }
      }
    }
  }

  // 2. Local variable / parameter hover (takes priority over type names unless primitive keyword)
  const local = scopeVars.get(word);
  if (local && !PRIMITIVE_TYPE_KEYWORDS.includes(word)) {
    return {
      range: hoverRange,
      contents: [{ value: `\`\`\`csharp\n(${local.kind === 'parameter' ? 'parameter' : 'local variable'}) ${local.rawTypeDisplay} ${local.name}\n\`\`\`` }],
    };
  }

  // 3. Built-in BCL / primitive type hover (`int`, `string`, `Console`, `DateTime`, ...)
  const bcl = TYPE_BY_NAME.get(word);
  if (bcl) {
    return {
      range: hoverRange,
      contents: [
        { value: `\`\`\`csharp\n${bcl.kind.toLowerCase()} ${bcl.fullName}\n\`\`\`` },
        ...(bcl.documentation ? [{ value: bcl.documentation }] : []),
      ],
    };
  }

  // 4. User-defined type hover
  const ut = userTypes.get(word);
  if (ut) {
    return {
      range: hoverRange,
      contents: [{ value: `\`\`\`csharp\n${ut.kind.toLowerCase()} ${ut.name}\n\`\`\`` }],
    };
  }

  return null;
}

export function getBuiltInCSharpSignatureHelp(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.SignatureHelp | null {
  const fullText = model.getValue();
  const lex = analyzeLexicalStateAtCursor(fullText, position.lineNumber, position.column);
  if (lex.state !== 'code') return null;

  const linesUpToCursor = fullText.split(/\r?\n/).slice(0, position.lineNumber);
  linesUpToCursor[linesUpToCursor.length - 1] = lex.activeExprLinePrefix;
  const codeBeforeCursor = linesUpToCursor.join('\n');

  const activeCall = findActiveCall(codeBeforeCursor.slice(-800));
  if (!activeCall) return null;

  const userTypes = parseUserTypes(fullText);
  const scopeVars = collectScopeVariables(fullText, position.lineNumber, userTypes);
  const { enclosingClass } = determineStructuralScope(codeBeforeCursor);

  const member = findMemberForSignature(activeCall.calleeExpr, userTypes, scopeVars, enclosingClass);
  if (!member) return null;

  const rawSigs = member.overloads?.length ? member.overloads : [member.detail];
  const signatures: monaco.languages.SignatureInformation[] = rawSigs.map((sigText) => {
    const paramsMatch = /\(([^)]*)\)/.exec(sigText);
    const parameters = (paramsMatch?.[1] || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ label: p }));
    return {
      label: sigText,
      documentation: member.documentation,
      parameters,
    };
  });

  // Choose best matching overload for the current argument count (or `out` usage)
  const hasOutInCurrentArg = /\bout\b/.test(activeCall.currentArgText);
  let activeSignature = signatures.findIndex(
    (s) =>
      s.parameters.length > activeCall.argIndex &&
      (!hasOutInCurrentArg || String(s.parameters[activeCall.argIndex]?.label).includes('out ')),
  );
  if (activeSignature === -1) {
    activeSignature = signatures.findIndex((s) => s.parameters.length >= activeCall.argIndex + 1);
  }
  if (activeSignature === -1) activeSignature = 0;

  const chosenParams = signatures[activeSignature]?.parameters || [];
  return {
    signatures,
    activeSignature,
    activeParameter: Math.max(0, Math.min(activeCall.argIndex, Math.max(0, chosenParams.length - 1))),
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

  const userTypes = parseUserTypes(code);
  const scopeVars = collectScopeVariables(code, lines.length, userTypes);
  const declaredVars = new Set<string>(['args', 'app', 'builder', ...scopeVars.keys()]);

  const varRegex = /\b(?:var|string|int|long|double|float|bool|char|byte|decimal|object|DateTime|Guid|Task(?:<[^>]+>)?|List<[^>]+>|Dictionary<[^>]+>|[A-Z][A-Za-z0-9_]*)(?:\[\])?\??\s+([A-Za-z_]\w*)\s*(?:=|;|,|\))/g;
  let vm: RegExpExecArray | null;
  while ((vm = varRegex.exec(code)) !== null) {
    if (!ALL_CSHARP_KEYWORDS.has(vm[1])) declaredVars.add(vm[1]);
  }

  const knownTypes = new Set<string>(userTypes.keys());
  for (const spec of BCL_TYPES) {
    if (!PRIMITIVE_TYPE_KEYWORDS.includes(spec.canonicalName)) {
      knownTypes.add(spec.canonicalName);
    }
    for (const alias of spec.aliases || []) {
      if (!PRIMITIVE_TYPE_KEYWORDS.includes(alias)) {
        knownTypes.add(alias);
      }
    }
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
      const prevNonSpace = scanLine.slice(0, col).trimEnd();
      const afterDot = prevNonSpace.endsWith('.');

      if (!afterDot && CONTROL_KEYWORDS.has(word)) {
        pushToken(lineIdx, col, word.length, 4); // control keyword
      } else if (!afterDot && knownTypes.has(word)) {
        pushToken(lineIdx, col, word.length, 0); // type
      } else if (isCall && !ALL_CSHARP_KEYWORDS.has(word)) {
        pushToken(lineIdx, col, word.length, 1); // method
      } else if (afterDot) {
        // Check if this member after `.` is a known method even before `(` is typed (e.g. `if (int.TryParse)`)
        const prevIdent = /([A-Za-z_]\w*)\s*\.$/.exec(prevNonSpace)?.[1];
        const bclOwner = prevIdent ? TYPE_BY_NAME.get(prevIdent) : undefined;
        const knownMethod = bclOwner && [...bclOwner.staticMembers, ...bclOwner.instanceMembers].some((mb) => mb.label === word && mb.kind === 'Method');
        if (knownMethod) {
          pushToken(lineIdx, col, word.length, 1); // method
        } else {
          pushToken(lineIdx, col, word.length, 3); // property / field / enum member
        }
      } else if (declaredVars.has(word)) {
        pushToken(lineIdx, col, word.length, 2); // variable
      }
    }
  }

  return new Uint32Array(data);
}
