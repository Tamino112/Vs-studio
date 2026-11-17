import { TaskListItem } from '../types/ide';

export interface OutlineMember {
  name: string;
  kind: 'method' | 'property' | 'ctor' | 'field';
  signature: string;
  line: number;
}

export interface OutlineType {
  name: string;
  kind: 'class' | 'struct' | 'record' | 'interface' | 'enum';
  line: number;
  members: OutlineMember[];
}

export function parseCSharpOutline(content: string): OutlineType[] {
  const lines = content.split(/\r?\n/);
  const types: OutlineType[] = [];

  let currentType: OutlineType | null = null;
  const typeRegex = /^\s*(?:public|private|internal|protected|static|abstract|sealed|partial|readonly|\s)*\b(class|struct|record|interface|enum)\s+([A-Za-z_]\w*)/;
  const methodRegex = /^\s*(?:public|private|internal|protected|static|async|virtual|override|abstract|extern|sealed|\s)+(?:[\w<>\[\]?.,\s]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
  const propRegex = /^\s*(?:public|private|internal|protected|static|virtual|override|required|\s)+(?:[\w<>\[\]?.,]+)\s+([A-Za-z_]\w*)\s*\{\s*(?:get|set|init)/;

  const ensureFallbackType = () => {
    if (!currentType) {
      currentType = {
        name: '<Global / Top-Level>',
        kind: 'class',
        line: 1,
        members: [],
      };
      types.push(currentType);
    }
    return currentType;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const tm = typeRegex.exec(line);
    if (tm) {
      currentType = {
        name: tm[2],
        kind: tm[1] as OutlineType['kind'],
        line: lineNum,
        members: [],
      };
      types.push(currentType);
      continue;
    }

    const pm = propRegex.exec(line);
    if (pm && !line.trimStart().startsWith('//')) {
      ensureFallbackType().members.push({
        name: pm[1],
        kind: 'property',
        signature: `${pm[1]} { get; set; }`,
        line: lineNum,
      });
      continue;
    }

    const mm = methodRegex.exec(line);
    if (
      mm &&
      !line.trimStart().startsWith('//') &&
      !['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return', 'new'].includes(mm[1])
    ) {
      const target = ensureFallbackType();
      target.members.push({
        name: mm[1],
        kind: mm[1] === target.name ? 'ctor' : 'method',
        signature: `${mm[1]}(${mm[2].trim()})`,
        line: lineNum,
      });
    }
  }

  // Visual Studio shows Program / Top-level statements in navigation bar when using .NET top-level Program.cs
  if (types.length === 0 && lines.some((l) => l.trim() && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('using '))) {
    const firstCodeIdx = lines.findIndex(
      (l) => l.trim() && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('using '),
    );
    types.push({
      name: 'Program',
      kind: 'class',
      line: firstCodeIdx >= 0 ? firstCodeIdx + 1 : 1,
      members: [
        {
          name: '<Main>$',
          kind: 'method',
          signature: '<Main>$(string[] args)',
          line: firstCodeIdx >= 0 ? firstCodeIdx + 1 : 1,
        },
      ],
    });
  }

  return types;
}

export function extractTodoTasks(file: string, content: string): TaskListItem[] {
  const lines = content.split(/\r?\n/);
  const items: TaskListItem[] = [];
  const regex = /\/\/\s*(TODO|HACK|FIXME|UNDONE)\b[:\s]*(.*)/i;
  for (let i = 0; i < lines.length; i++) {
    const m = regex.exec(lines[i]);
    if (m) {
      const tag = m[1].toUpperCase() as TaskListItem['tag'];
      items.push({
        id: `${file}:${i + 1}`,
        priority: tag === 'FIXME' || tag === 'HACK' ? 'High' : tag === 'TODO' ? 'Normal' : 'Low',
        tag,
        description: (m[2] || tag).trim(),
        file,
        line: i + 1,
      });
    }
  }
  return items;
}
