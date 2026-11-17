import { describe, expect, it } from 'vitest';
import {
  applyTerminalChunk,
  formatExitCode,
  terminalCursorPosition,
  terminalPlainText,
  terminalSegments,
} from '../src/utils/terminalRender';

const feed = (...chunks: string[]) => chunks.reduce((acc, c) => applyTerminalChunk(acc, c), '');

describe('Debug Console terminal rendering', () => {
  it('treats CRLF split across two chunks as a single newline', () => {
    const buf = feed('Hello World!\r', '\nPress any key');
    expect(terminalPlainText(buf)).toBe('Hello World!\nPress any key');
  });

  it('still rewinds the line on a bare carriage return', () => {
    expect(terminalPlainText(feed('Progress 10%\rProgress 20%'))).toBe('Progress 20%');
  });

  it('strips keypad / charset escapes emitted by .NET on a TTY', () => {
    expect(terminalPlainText(feed('\x1b=\x1b(BHallo\x1b>\x1b[?1h'))).toBe('Hallo');
  });

  it('handles escape sequences split across chunks', () => {
    expect(terminalPlainText(feed('A\x1b[3', '1mRot\x1b[0m'))).toBe('ARot');
  });

  it('handles backspace and Console.Clear()', () => {
    expect(terminalPlainText(feed('abc\x08\x08x'))).toBe('ax');
    expect(terminalPlainText(feed('old text\n', '\x1b[H\x1b[2Jnew'))).toBe('new');
  });

  it('renders Console.ForegroundColor with the Windows console palette', () => {
    const segs = terminalSegments(feed('\x1b[31mDarkRed\x1b[91mRed\x1b[39m plain'));
    expect(segs).toEqual([
      { text: 'DarkRed', color: '#C50F1F', background: undefined },
      { text: 'Red', color: '#E74856', background: undefined },
      { text: ' plain', color: undefined, background: undefined },
    ]);
  });

  it('computes cursor position for DSR replies', () => {
    expect(terminalCursorPosition(feed('line1\nab'))).toEqual({ row: 2, col: 3 });
  });

  it('formats exit codes like Visual Studio', () => {
    expect(formatExitCode(0)).toBe('0 (0x0)');
    expect(formatExitCode(-1)).toBe('-1 (0xffffffff)');
  });
});
