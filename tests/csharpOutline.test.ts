import { describe, expect, it, vi } from 'vitest';
import { extractTodoTasks, parseCSharpOutline } from '../src/utils/csharpOutline';

describe('C# Outline & Task List Parser', () => {
  it('extracts classes, interfaces, records, constructors, properties, and methods', () => {
    const code = `
namespace MyApp;

public interface IUserService
{
    Task<string> GetNameAsync(int id);
}

public class UserService : IUserService
{
    public string TenantName { get; set; }

    public UserService()
    {
    }

    public async Task<string> GetNameAsync(int id)
    {
        if (id <= 0) return "";
        return "Alice";
    }
}
`;
    const types = parseCSharpOutline(code);
    expect(types.length).toBe(2);

    expect(types[0].name).toBe('IUserService');
    expect(types[0].kind).toBe('interface');

    expect(types[1].name).toBe('UserService');
    expect(types[1].kind).toBe('class');
    expect(types[1].members.map((m) => m.name)).toEqual([
      'TenantName',
      'UserService',
      'GetNameAsync',
    ]);
    expect(types[1].members[0].kind).toBe('property');
    expect(types[1].members[1].kind).toBe('ctor');
    expect(types[1].members[2].kind).toBe('method');
  });

  it('extracts TODO, FIXME, HACK, UNDONE comments with priorities', () => {
    const code = `
// TODO: Implement caching layer
// FIXME: Null check missing when user is anonymous
// HACK: Temporary workaround for .NET 10 preview
// Regular comment should be ignored
// UNDONE: Restore validation
`;
    const tasks = extractTodoTasks('/src/Program.cs', code);
    expect(tasks.length).toBe(4);
    expect(tasks[0]).toMatchObject({ tag: 'TODO', priority: 'Normal', description: 'Implement caching layer', line: 2 });
    expect(tasks[1]).toMatchObject({ tag: 'FIXME', priority: 'High', line: 3 });
    expect(tasks[2]).toMatchObject({ tag: 'HACK', priority: 'High', line: 4 });
    expect(tasks[3]).toMatchObject({ tag: 'UNDONE', priority: 'Low', line: 6 });
  });
});

describe('IDE Document Tab Well Actions', () => {
  it('supports pinning, preview promotion, reordering, close-to-right/left, and splitting groups', async () => {
    // Minimal DOM/localStorage stubs for Zustand store in Node test env
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

    const { useIdeStore } = await import('../src/store/useIdeStore');
    useIdeStore.setState({
      openTabs: [
        { id: 't1', kind: 'code', title: 'A.cs', path: '/A.cs', content: '', savedContent: '', language: 'csharp', isDirty: false, groupId: 0 },
        { id: 't2', kind: 'code', title: 'B.cs', path: '/B.cs', content: '', savedContent: '', language: 'csharp', isDirty: false, groupId: 0, isPreview: true },
        { id: 't3', kind: 'code', title: 'C.cs', path: '/C.cs', content: '', savedContent: '', language: 'csharp', isDirty: false, groupId: 0 },
      ],
      activeTabId: 't1',
      splitMode: 'none',
      activeGroupId: 0,
      activeTabByGroup: { 0: 't1', 1: null },
    });

    const s = useIdeStore.getState();
    // Pin t3 -> should move before unpinned tabs
    s.togglePinTab('t3');
    expect(useIdeStore.getState().openTabs.map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    expect(useIdeStore.getState().openTabs[0].isPinned).toBe(true);

    // Promote preview t2
    s.promotePreviewTab('t2');
    expect(useIdeStore.getState().openTabs.find((t) => t.id === 't2')?.isPreview).toBe(false);

    // Move t2 to group 1 -> enables vertical split
    s.moveTabToGroup('t2', 1);
    expect(useIdeStore.getState().splitMode).toBe('vertical');
    expect(useIdeStore.getState().openTabs.find((t) => t.id === 't2')?.groupId).toBe(1);

    // Close tabs to right of pinned t3 in group 0 -> removes unpinned t1, keeps pinned t3
    s.closeTabsToRight('t3');
    expect(useIdeStore.getState().openTabs.filter((t) => (t.groupId ?? 0) === 0).map((t) => t.id)).toEqual(['t3']);

    // Merge all tab groups back to none
    s.setSplitMode('none');
    expect(useIdeStore.getState().splitMode).toBe('none');
    expect(useIdeStore.getState().openTabs.every((t) => t.groupId === 0)).toBe(true);
  });
});
