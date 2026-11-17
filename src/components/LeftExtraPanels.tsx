import React, { useEffect, useMemo, useState } from 'react';
import { useIdeStore } from '../store/useIdeStore';
import { FileNode } from '../types/ide';
import { OutlineType, parseCSharpOutline } from '../utils/csharpOutline';
import { CSharpProjectIcon } from './VsIcons';

interface FileOutlineEntry {
  projectId: string;
  projectName: string;
  filePath: string;
  fileName: string;
  types: OutlineType[];
}

function collectCsFiles(nodes: FileNode[], acc: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.isDirectory && n.children) {
      collectCsFiles(n.children, acc);
    } else if (!n.isDirectory && n.name.toLowerCase().endsWith('.cs')) {
      acc.push(n);
    }
  }
  return acc;
}

export const ClassViewPanel: React.FC = () => {
  const { solution, projectTrees, openTabs, openFile } = useIdeStore();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [diskContents, setDiskContents] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!solution || !window.vsApi) return;
    let cancelled = false;
    const loadAll = async () => {
      const next: Record<string, string> = {};
      const csFiles: FileNode[] = [];
      for (const proj of solution.projects) {
        collectCsFiles(projectTrees[proj.id] || [], csFiles);
      }
      if (solution.projects.length === 0) {
        collectCsFiles(projectTrees[solution.dir] || [], csFiles);
      }
      for (const f of csFiles.slice(0, 80)) {
        try {
          next[f.path] = await window.vsApi.fs.readFile(f.path);
        } catch {
          // ignore unreadable files
        }
      }
      if (!cancelled) setDiskContents(next);
    };
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [solution, projectTrees]);

  const entries = useMemo<FileOutlineEntry[]>(() => {
    if (!solution) return [];
    const openByPath = new Map(openTabs.filter((t) => t.kind === 'code').map((t) => [t.path, t.content]));
    const result: FileOutlineEntry[] = [];

    const addProjFiles = (projectId: string, projectName: string, nodes: FileNode[]) => {
      for (const f of collectCsFiles(nodes)) {
        const content = openByPath.get(f.path) ?? diskContents[f.path];
        if (!content) continue;
        const types = parseCSharpOutline(content);
        if (types.length > 0) {
          result.push({
            projectId,
            projectName,
            filePath: f.path,
            fileName: f.name,
            types,
          });
        }
      }
    };

    for (const proj of solution.projects) {
      addProjFiles(proj.id, proj.name, projectTrees[proj.id] || []);
    }
    if (solution.projects.length === 0) {
      addProjFiles(solution.dir, solution.name, projectTrees[solution.dir] || []);
    }
    return result;
  }, [solution, projectTrees, openTabs, diskContents]);

  const q = search.trim().toLowerCase();
  const isOpen = (key: string, defaultOpen = true) => (expanded[key] !== undefined ? expanded[key] : defaultOpen);
  const toggle = (key: string, defaultOpen = true) =>
    setExpanded((s) => ({ ...s, [key]: !isOpen(key, defaultOpen) }));

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<string, { projectName: string; items: Array<{ entry: FileOutlineEntry; type: OutlineType }> }>();
    for (const entry of entries) {
      for (const t of entry.types) {
        const typeMatches = !q || t.name.toLowerCase().includes(q) || t.members.some((m) => m.name.toLowerCase().includes(q));
        if (!typeMatches) continue;
        if (!map.has(entry.projectId)) {
          map.set(entry.projectId, { projectName: entry.projectName, items: [] });
        }
        map.get(entry.projectId)!.items.push({ entry, type: t });
      }
    }
    return Array.from(map.entries());
  }, [entries, q]);

  const typeIcon = (kind: OutlineType['kind']) => {
    if (kind === 'interface') return { icon: 'codicon-symbol-interface', color: '#75BEFF' };
    if (kind === 'enum') return { icon: 'codicon-symbol-enum', color: '#B5CEA8' };
    if (kind === 'struct') return { icon: 'codicon-symbol-structure', color: '#4EC9B0' };
    return { icon: 'codicon-symbol-class', color: '#EE9D28' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--vs-bg-panel)' }}>
      <div style={{ padding: '5px 6px', borderBottom: '1px solid var(--vs-border-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <span
            className="codicon codicon-search"
            style={{ position: 'absolute', left: 7, top: 5, fontSize: 12, color: 'var(--vs-fg-muted)' }}
          />
          <input
            className="vs-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Class View"
            style={{ width: '100%', paddingLeft: 24, height: 22, fontSize: 11 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', fontSize: 12 }}>
        {!solution ? (
          <div style={{ padding: 12, color: 'var(--vs-fg-muted)' }}>Open a solution to browse classes and members.</div>
        ) : grouped.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--vs-fg-muted)' }}>No C# types found.</div>
        ) : (
          grouped.map(([projId, group]) => {
            const pKey = `proj:${projId}`;
            const pOpen = isOpen(pKey, true) || Boolean(q);
            return (
              <div key={projId}>
                <div
                  onClick={() => toggle(pKey, true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    color: 'var(--vs-fg-bright)',
                  }}
                >
                  <span
                    className={`codicon ${pOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
                    style={{ fontSize: 12, color: 'var(--vs-fg-muted)' }}
                  />
                  <CSharpProjectIcon size={14} />
                  <span>{group.projectName}</span>
                </div>

                {pOpen &&
                  group.items.map(({ entry, type }, idx) => {
                    const tKey = `type:${entry.filePath}:${type.name}:${idx}`;
                    const tOpen = isOpen(tKey, true) || Boolean(q);
                    const ic = typeIcon(type.kind);
                    const filteredMembers = q
                      ? type.members.filter(
                          (m) => m.name.toLowerCase().includes(q) || type.name.toLowerCase().includes(q),
                        )
                      : type.members;
                    return (
                      <div key={tKey}>
                        <div
                          onClick={() => {
                            toggle(tKey, true);
                            void openFile(entry.filePath, type.line, 1);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '3px 8px 3px 22px',
                            cursor: 'pointer',
                          }}
                        >
                          <span
                            className={`codicon ${tOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
                            style={{ fontSize: 12, color: 'var(--vs-fg-muted)' }}
                          />
                          <span className={`codicon ${ic.icon}`} style={{ fontSize: 13, color: ic.color }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {type.name}
                          </span>
                          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--vs-fg-muted)' }}>
                            {entry.fileName}
                          </span>
                        </div>

                        {tOpen &&
                          filteredMembers.map((m, mIdx) => (
                            <div
                              key={`${m.name}:${m.line}:${mIdx}`}
                              onClick={() => void openFile(entry.filePath, m.line, 1)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '2px 8px 2px 44px',
                                cursor: 'pointer',
                                color: 'var(--vs-fg)',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vs-bg-hover)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              <span
                                className={`codicon ${
                                  m.kind === 'property'
                                    ? 'codicon-symbol-property'
                                    : m.kind === 'field'
                                    ? 'codicon-symbol-field'
                                    : 'codicon-symbol-method'
                                }`}
                                style={{
                                  fontSize: 12.5,
                                  color: m.kind === 'property' ? 'var(--vs-fg)' : '#B180D7',
                                }}
                              />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.signature}
                              </span>
                            </div>
                          ))}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

interface ToolboxSnippet {
  name: string;
  description: string;
  icon: string;
  code: string;
}

const TOOLBOX_CATEGORIES: Array<{ category: string; items: ToolboxSnippet[] }> = [
  {
    category: 'General C#',
    items: [
      { name: 'Console.WriteLine', description: 'Write line to standard output', icon: 'codicon-terminal', code: 'Console.WriteLine("");\n' },
      { name: 'Console.ReadLine', description: 'Read line from standard input', icon: 'codicon-terminal', code: 'var input = Console.ReadLine();\n' },
      { name: 'try / catch', description: 'Exception handling block', icon: 'codicon-shield', code: 'try\n{\n    \n}\ncatch (Exception ex)\n{\n    Console.WriteLine(ex.Message);\n}\n' },
      { name: 'foreach loop', description: 'Iterate over collection', icon: 'codicon-sync', code: 'foreach (var item in collection)\n{\n    \n}\n' },
      { name: 'for loop', description: 'Indexed for loop', icon: 'codicon-sync', code: 'for (int i = 0; i < count; i++)\n{\n    \n}\n' },
      { name: 'switch expression', description: 'Pattern matching switch', icon: 'codicon-git-branch', code: 'var result = value switch\n{\n    _ => default\n};\n' },
    ],
  },
  {
    category: 'Types & Members',
    items: [
      { name: 'Class', description: 'Public class declaration', icon: 'codicon-symbol-class', code: 'public class MyClass\n{\n    public MyClass()\n    {\n    }\n}\n' },
      { name: 'Record', description: 'Immutable positional record', icon: 'codicon-symbol-structure', code: 'public record MyRecord(string Name, int Value);\n' },
      { name: 'Interface', description: 'Public interface contract', icon: 'codicon-symbol-interface', code: 'public interface IMyService\n{\n    Task ExecuteAsync(CancellationToken ct = default);\n}\n' },
      { name: 'Auto-Property', description: 'Public { get; set; } property', icon: 'codicon-symbol-property', code: 'public string Name { get; set; } = string.Empty;\n' },
      { name: 'Async Task Method', description: 'Asynchronous method', icon: 'codicon-symbol-method', code: 'public async Task<string> GetDataAsync(CancellationToken ct = default)\n{\n    await Task.CompletedTask;\n    return string.Empty;\n}\n' },
    ],
  },
  {
    category: 'LINQ & Collections',
    items: [
      { name: 'LINQ Where & Select', description: 'Filter and project sequence', icon: 'codicon-filter', code: 'var query = items\n    .Where(x => x is not null)\n    .Select(x => x.ToString())\n    .ToList();\n' },
      { name: 'List<T>', description: 'Generic List initialization', icon: 'codicon-symbol-array', code: 'var items = new List<string>();\n' },
      { name: 'Dictionary<TKey, TValue>', description: 'Generic Dictionary', icon: 'codicon-symbol-object', code: 'var map = new Dictionary<string, object>();\n' },
    ],
  },
  {
    category: 'ASP.NET Core (.NET 10)',
    items: [
      { name: 'MapGet Endpoint', description: 'Minimal API GET route', icon: 'codicon-globe', code: 'app.MapGet("/api/items", () =>\n{\n    return Results.Ok(Array.Empty<string>());\n});\n' },
      { name: 'MapPost Endpoint', description: 'Minimal API POST route', icon: 'codicon-globe', code: 'app.MapPost("/api/items", (object dto) =>\n{\n    return Results.Created("/api/items/1", dto);\n});\n' },
    ],
  },
  {
    category: 'Testing (xUnit)',
    items: [
      { name: '[Fact] Test Method', description: 'xUnit unit test', icon: 'codicon-beaker', code: '[Fact]\npublic void Should_ReturnExpectedResult()\n{\n    // Arrange\n\n    // Act\n\n    // Assert\n    Assert.True(true);\n}\n' },
      { name: '[Theory] InlineData', description: 'Parameterized xUnit test', icon: 'codicon-beaker', code: '[Theory]\n[InlineData(1, 2, 3)]\npublic void Add_ShouldSum(int a, int b, int expected)\n{\n    Assert.Equal(expected, a + b);\n}\n' },
    ],
  },
];

export const ToolboxPanel: React.FC = () => {
  const { insertSnippetIntoEditor, activeTabId } = useIdeStore();
  const [search, setSearch] = useState('');
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({
    'General C#': true,
    'Types & Members': true,
  });

  const q = search.trim().toLowerCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--vs-bg-panel)' }}>
      <div style={{ padding: '5px 6px', borderBottom: '1px solid var(--vs-border-subtle)' }}>
        <div style={{ position: 'relative' }}>
          <span
            className="codicon codicon-search"
            style={{ position: 'absolute', left: 7, top: 5, fontSize: 12, color: 'var(--vs-fg-muted)' }}
          />
          <input
            className="vs-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Toolbox"
            style={{ width: '100%', paddingLeft: 24, height: 22, fontSize: 11 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: 12 }}>
        {TOOLBOX_CATEGORIES.map((cat) => {
          const items = q
            ? cat.items.filter(
                (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
              )
            : cat.items;
          if (items.length === 0) return null;
          const expanded = q ? true : Boolean(openCats[cat.category]);
          return (
            <div key={cat.category}>
              <div
                onClick={() => setOpenCats((s) => ({ ...s, [cat.category]: !expanded }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  background: 'var(--vs-bg-chrome)',
                  borderBottom: '1px solid var(--vs-border-subtle)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: 'var(--vs-fg-bright)',
                }}
              >
                <span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
                <span>{cat.category}</span>
              </div>

              {expanded &&
                items.map((item) => (
                  <div
                    key={item.name}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', item.code)}
                    onDoubleClick={() => insertSnippetIntoEditor(item.code)}
                    title={`${item.description} — Double-click to insert into active editor`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 10px 4px 18px',
                      borderBottom: '1px solid var(--vs-border-subtle)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--vs-bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span className={`codicon ${item.icon}`} style={{ fontSize: 13, color: 'var(--vs-accent)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                    </div>
                    <button
                      className="vs-btn"
                      disabled={!activeTabId}
                      onClick={(e) => {
                        e.stopPropagation();
                        insertSnippetIntoEditor(item.code);
                      }}
                      title="Insert into active editor"
                      style={{ padding: '1px 6px', fontSize: 10.5 }}
                    >
                      Insert
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
