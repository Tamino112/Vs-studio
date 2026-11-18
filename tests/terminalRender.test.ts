import { describe, expect, it } from 'vitest';
import {
  applyTerminalChunk,
  containsCursorQuery,
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

  it('handles escape sequences and OSC titles split across chunks', () => {
    expect(terminalPlainText(feed('A\x1b[3', '1mRot\x1b[0m'))).toBe('ARot');
    expect(terminalPlainText(feed('\x1b]0;Microsoft Visual ', 'Studio Console\x07Ready'))).toBe('Ready');
  });

  it('handles backspace, cooked erase, and Console.Clear()', () => {
    expect(terminalPlainText(feed('abc\x08\x08x'))).toBe('ax');
    expect(terminalPlainText(feed('abc\x08 \x08'))).toBe('ab');
    expect(terminalPlainText(feed('old text\n', '\x1b[H\x1b[2Jnew'))).toBe('new');
  });

  it('renders ConPTY Berlin Uhr Console.Clear() iterations cleanly without phantom blank rows', () => {
    const frame1 =
      '\x1b[?25l[R]\r\n[R][O][O][O]\r\n[R][R][O][O]\r\n[O][O][O][O][O][O][O][O][O][O][O]\r\n[R][R][O][O]\r\n20:42:10\r\n\x1b[?25h';
    const clearAndFrame2 =
      '\x1b[25;1H\x1b[K\x1b[2J\x1b[1;1H\x1b[?25l[O]\r\n[R][R][O][O]\r\n[O][O][O][O]\r\n20:42:11\x1b[?25h';

    const buf1 = feed(frame1);
    expect(terminalPlainText(buf1)).toBe(
      '[R]\n[R][O][O][O]\n[R][R][O][O]\n[O][O][O][O][O][O][O][O][O][O][O]\n[R][R][O][O]\n20:42:10\n',
    );

    const buf2 = applyTerminalChunk(buf1, clearAndFrame2);
    expect(terminalPlainText(buf2)).toBe('[O]\n[R][R][O][O]\n[O][O][O][O]\n20:42:11');

    // Does not leave phantom blank rows after 40+ lines of scrollback followed by ESC[2J ESC[H
    let lots = '';
    for (let i = 1; i <= 40; i++) lots += `Line ${i}\r\n`;
    const clearedAfterScroll = feed(lots, '\x1b[2J\x1b[HFresh');
    expect(terminalPlainText(clearedAfterScroll)).toBe('Fresh');
  });

  it('renders Console.ForegroundColor, 256-color, 24-bit RGB, and inverse video', () => {
    const segs = terminalSegments(feed('\x1b[31mDarkRed\x1b[91mRed\x1b[39m plain'));
    expect(segs).toEqual([
      { text: 'DarkRed', color: '#C50F1F', background: undefined },
      { text: 'Red', color: '#E74856', background: undefined },
      { text: ' plain', color: undefined, background: undefined },
    ]);

    const ext = terminalSegments(feed('\x1b[38;5;208;48;2;10;20;30mRGB\x1b[7mInv\x1b[27m\x1b[0m'));
    expect(ext).toEqual([
      { text: 'RGB', color: 'rgb(255, 135, 0)', background: 'rgb(10, 20, 30)' },
      { text: 'Inv', color: 'rgb(10, 20, 30)', background: 'rgb(255, 135, 0)' },
    ]);
  });

  it('detects and computes cursor position for DSR (ESC[6n) replies', () => {
    expect(containsCursorQuery('hello\x1b[6n')).toBe(1);
    expect(terminalCursorPosition(feed('line1\nab'))).toEqual({ row: 2, col: 3 });
    expect(terminalCursorPosition(feed('line1\r\nline2\x1b[1A\x1b[3C'))).toEqual({ row: 1, col: 9 });
  });

  it('formats exit codes like Visual Studio', () => {
    expect(formatExitCode(0)).toBe('0 (0x0)');
    expect(formatExitCode(-1)).toBe('-1 (0xffffffff)');
  });
});
