/* eslint-disable no-control-regex */
/**
 * Terminal emulation for the "Microsoft Visual Studio Debug Console" window and Developer Terminal.
 *
 * Supports POSIX PTY (macOS / Linux) and Windows ConPTY (VT sequences):
 * - Cursor positioning (H / f / A / B / C / D / E / F / G / d)
 * - Erase in display (J / 0J / 1J / 2J / 3J) & Erase in line (K / 0K / 1K / 2K / X / P / @)
 * - DEC private modes (?25l / ?25h / ?1049h / ?1049l), OSC (ESC]..BEL / ESC\\), charset switches
 * - Full SGR colours: 16-colour Campbell palette, 256-colour (38;5;n / 48;5;n), 24-bit RGB (38;2;r;g;b / 48;2;r;g;b), reverse video (7/27)
 * - Partial escape / CR / OSC / APC sequences split across PTY chunks
 */

const SCREEN_ROWS = 32;
const APC_CUR_RE = /\x1b_C:(\d+),(\d+)\x1b\\$/;
const PENDING_RE = /(?:\r|\x1b(?:\[[0-9;:<=>?]*[!"#$%&'()*+,\-./ ]*|\][^\x07\x1b]*(?:\x1b)?|[()_])?)$/;
const SGR_STRIP_RE = /\x1b\[[0-9;]*m/g;

interface CellStyle {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  inverse: boolean;
}

interface Cell {
  ch: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  inverse: boolean;
}

const EMPTY_STYLE: CellStyle = { fg: null, bg: null, bold: false, inverse: false };

function cloneStyle(s: CellStyle): CellStyle {
  return { fg: s.fg, bg: s.bg, bold: s.bold, inverse: s.inverse };
}

function styleKey(s: CellStyle): string {
  if (!s.fg && !s.bg && !s.bold && !s.inverse) return '';
  return `${s.bold ? '1' : '0'}|${s.inverse ? '1' : '0'}|${s.fg || ''}|${s.bg || ''}`;
}

function styleToSgrParams(s: CellStyle): string {
  const parts: string[] = [];
  if (s.bold) parts.push('1');
  if (s.inverse) parts.push('7');
  if (s.fg) parts.push(s.fg);
  if (s.bg) parts.push(s.bg);
  return parts.join(';');
}

function applySgrCodes(style: CellStyle, paramStr: string): void {
  const codes = paramStr === '' ? [0] : paramStr.split(';').map((c) => (c === '' ? 0 : Number(c) || 0));
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) {
      style.fg = null;
      style.bg = null;
      style.bold = false;
      style.inverse = false;
    } else if (c === 1) {
      style.bold = true;
    } else if (c === 22) {
      style.bold = false;
    } else if (c === 7) {
      style.inverse = true;
    } else if (c === 27) {
      style.inverse = false;
    } else if (c >= 30 && c <= 37) {
      style.fg = String(c);
    } else if (c === 39) {
      style.fg = null;
    } else if (c >= 40 && c <= 47) {
      style.bg = String(c);
    } else if (c === 49) {
      style.bg = null;
    } else if (c >= 90 && c <= 97) {
      style.fg = String(c);
    } else if (c >= 100 && c <= 107) {
      style.bg = String(c);
    } else if ((c === 38 || c === 48) && codes[i + 1] === 5 && i + 2 < codes.length) {
      const idx = Math.max(0, Math.min(255, codes[i + 2]));
      if (c === 38) style.fg = `38;5;${idx}`;
      else style.bg = `48;5;${idx}`;
      i += 2;
    } else if ((c === 38 || c === 48) && codes[i + 1] === 2 && i + 4 < codes.length) {
      const r = Math.max(0, Math.min(255, codes[i + 2]));
      const g = Math.max(0, Math.min(255, codes[i + 3]));
      const b = Math.max(0, Math.min(255, codes[i + 4]));
      if (c === 38) style.fg = `38;2;${r};${g};${b}`;
      else style.bg = `48;2;${r};${g};${b}`;
      i += 4;
    }
  }
}

function parseBufferToGrid(src: string): { lines: Cell[][]; endStyle: CellStyle } {
  const lines: Cell[][] = [[]];
  const style = cloneStyle(EMPTY_STYLE);
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (txt: string) => {
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (ch === '\n') {
        lines.push([]);
      } else {
        lines[lines.length - 1].push({
          ch,
          fg: style.fg,
          bg: style.bg,
          bold: style.bold,
          inverse: style.inverse,
        });
      }
    }
  };

  while ((m = re.exec(src))) {
    if (m.index > last) pushText(src.slice(last, m.index));
    last = re.lastIndex;
    applySgrCodes(style, m[1]);
  }
  if (last < src.length) pushText(src.slice(last));

  return { lines, endStyle: style };
}

function serializeGrid(lines: Cell[][]): string {
  // Trim trailing lines only beyond natural size when screen capped
  while (lines.length > 2000) lines.shift();

  let out = '';
  let activeKey = '';
  for (let r = 0; r < lines.length; r++) {
    if (r > 0) out += '\n';
    const row = lines[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const key = styleKey(cell);
      if (key !== activeKey) {
        if (!key) {
          out += '\x1b[0m';
        } else {
          const params = styleToSgrParams(cell);
          out += activeKey ? `\x1b[0;${params}m` : `\x1b[${params}m`;
        }
        activeKey = key;
      }
      out += cell.ch;
    }
  }

  if (out.length > 120000) {
    // Drop oldest full lines from the top so escape sequences stay intact
    const split = out.split('\n');
    while (split.length > 1 && out.length > 120000) {
      split.shift();
      out = split.join('\n');
    }
    if (out.length > 120000) out = out.slice(-120000);
  }
  return out;
}

function parseCsiParams(raw: string): number[] {
  if (!raw) return [];
  return raw.split(';').map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

export function applyTerminalChunk(prev: string, rawChunk: string): string {
  let savedCursor: { row: number; col: number } | null = null;
  let pendingCarry = '';

  const pm = PENDING_RE.exec(prev);
  if (pm) {
    pendingCarry = pm[0];
    prev = prev.slice(0, -pendingCarry.length);
  }
  const cm = APC_CUR_RE.exec(prev);
  if (cm) {
    savedCursor = { row: Number(cm[1]) || 0, col: Number(cm[2]) || 0 };
    prev = prev.slice(0, -cm[0].length);
  }

  let text = pendingCarry + rawChunk;
  let pending = '';
  const tm = PENDING_RE.exec(text);
  if (tm) {
    pending = tm[0];
    text = text.slice(0, -pending.length);
  }

  const parsed = parseBufferToGrid(prev);
  let lines = parsed.lines;
  const style = parsed.endStyle;

  let curRow = savedCursor ? savedCursor.row : lines.length - 1;
  let curCol = savedCursor ? savedCursor.col : lines[curRow]?.length ?? 0;

  const ensureRow = (r: number) => {
    while (lines.length <= r) lines.push([]);
  };

  const viewportTop = () => Math.max(0, lines.length - SCREEN_ROWS);

  const writeChar = (ch: string) => {
    ensureRow(curRow);
    const line = lines[curRow];
    while (line.length < curCol) {
      line.push({ ch: ' ', fg: null, bg: null, bold: false, inverse: false });
    }
    const cell: Cell = {
      ch,
      fg: style.fg,
      bg: style.bg,
      bold: style.bold,
      inverse: style.inverse,
    };
    if (curCol < line.length) line[curCol] = cell;
    else line.push(cell);
    curCol++;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\x1b') {
      const rest = text.slice(i);

      // OSC sequence: ESC ] ... (BEL or ST)
      const osc = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(rest);
      if (osc) {
        i += osc[0].length - 1;
        continue;
      }

      // Charset selection ESC ( B, ESC ) 0, etc.
      const charset = /^\x1b[()][0-9A-Za-z]/.exec(rest);
      if (charset) {
        i += charset[0].length - 1;
        continue;
      }

      // CSI sequence: ESC [ params final
      const csi = /^\x1b\[([0-9;:<=>?]*)([!"#$%&'()*+,\-./ ]*)([@-~])/.exec(rest);
      if (csi) {
        i += csi[0].length - 1;
        const paramRaw = csi[1];
        const inter = csi[2];
        const final = csi[3];

        // DEC private modes (?25l, ?25h, ?1049h, ?1h, etc.)
        if (paramRaw.startsWith('?') || paramRaw.startsWith('>') || paramRaw.startsWith('=') || inter) {
          if (final === 'h' && (paramRaw === '?1049' || paramRaw === '?1047' || paramRaw === '?47')) {
            lines = [[]];
            curRow = 0;
            curCol = 0;
          }
          continue;
        }

        const params = parseCsiParams(paramRaw);
        const p1 = params[0] ?? 0;

        if (final === 'm') {
          applySgrCodes(style, paramRaw);
        } else if (final === 'H' || final === 'f') {
          const targetRow1 = Math.max(1, params[0] || 1);
          const targetCol1 = Math.max(1, params[1] || 1);
          const absRow = viewportTop() + (targetRow1 - 1);
          curRow = Math.max(0, absRow);
          curCol = Math.max(0, targetCol1 - 1);
        } else if (final === 'A') {
          curRow = Math.max(viewportTop(), curRow - Math.max(1, p1));
        } else if (final === 'B') {
          curRow = curRow + Math.max(1, p1);
        } else if (final === 'C') {
          curCol = curCol + Math.max(1, p1);
        } else if (final === 'D') {
          curCol = Math.max(0, curCol - Math.max(1, p1));
        } else if (final === 'E') {
          curRow = curRow + Math.max(1, p1);
          curCol = 0;
        } else if (final === 'F') {
          curRow = Math.max(viewportTop(), curRow - Math.max(1, p1));
          curCol = 0;
        } else if (final === 'G' || final === '`') {
          curCol = Math.max(0, Math.max(1, p1) - 1);
        } else if (final === 'd') {
          curRow = Math.max(0, viewportTop() + Math.max(1, p1) - 1);
        } else if (final === 'J') {
          if (p1 === 2 || p1 === 3) {
            const relRow = Math.max(0, curRow - viewportTop());
            lines = [[]];
            curRow = p1 === 3 ? 0 : relRow;
            if (p1 === 3) curCol = 0;
          } else if (p1 === 1) {
            const top = viewportTop();
            const clearEnd = Math.min(curRow, lines.length);
            for (let r = top; r < clearEnd; r++) lines[r] = [];
            if (curRow < lines.length) {
              for (let c = 0; c <= curCol && c < lines[curRow].length; c++) {
                lines[curRow][c] = { ch: ' ', fg: null, bg: null, bold: false, inverse: false };
              }
            }
          } else {
            // ED 0 (ESC[J / ESC[0J): ConPTY uses ESC[H ESC[J for Console.Clear()
            if (curRow < lines.length) {
              lines[curRow] = lines[curRow].slice(0, curCol);
              lines.length = curRow + 1;
            }
          }
        } else if (final === 'K') {
          if (curRow < lines.length) {
            if (p1 === 2) {
              lines[curRow] = [];
            } else if (p1 === 1) {
              for (let c = 0; c <= curCol && c < lines[curRow].length; c++) {
                lines[curRow][c] = { ch: ' ', fg: null, bg: null, bold: false, inverse: false };
              }
            } else {
              lines[curRow] = lines[curRow].slice(0, curCol);
            }
          }
        } else if (final === 'X') {
          if (curRow < lines.length) {
            const count = Math.max(1, p1);
            const row = lines[curRow];
            for (let c = curCol; c < curCol + count && c < row.length; c++) {
              row[c] = { ch: ' ', fg: null, bg: null, bold: false, inverse: false };
            }
          }
        } else if (final === 'P') {
          if (curRow < lines.length) {
            lines[curRow].splice(curCol, Math.max(1, p1));
          }
        } else if (final === '@') {
          ensureRow(curRow);
          const count = Math.max(1, p1);
          const blanks: Cell[] = Array.from({ length: count }, () => ({
            ch: ' ',
            fg: null,
            bg: null,
            bold: false,
            inverse: false,
          }));
          while (lines[curRow].length < curCol) {
            lines[curRow].push({ ch: ' ', fg: null, bg: null, bold: false, inverse: false });
          }
          lines[curRow].splice(curCol, 0, ...blanks);
        }
        continue;
      }

      // Single-char escapes (ESC=, ESC>, ESC7, ESC8, ESCc, ESCM, ESCD, ESCE)
      if (rest.length >= 2) {
        i += 1;
        if (rest[1] === 'c') {
          lines = [[]];
          curRow = 0;
          curCol = 0;
        }
      }
      continue;
    }

    if (ch === '\r') {
      curCol = 0;
      continue;
    }
    if (ch === '\n') {
      curRow++;
      curCol = 0;
      ensureRow(curRow);
      continue;
    }
    if (ch === '\x08' || ch === '\x7f') {
      if (curCol > 0) {
        if (curRow < lines.length && curCol === lines[curRow].length) {
          lines[curRow].pop();
        }
        curCol--;
      }
      continue;
    }
    if (ch === '\t') {
      const nextStop = curCol + (8 - (curCol % 8));
      while (curCol < nextStop) writeChar(' ');
      continue;
    }
    if (ch === '\x07' || ch === '\x00') continue;

    writeChar(ch);
  }

  while (lines.length > 2000) {
    lines.shift();
    curRow = Math.max(0, curRow - 1);
  }

  const serialized = serializeGrid(lines);
  const naturalRow = lines.length - 1;
  const naturalCol = lines[naturalRow]?.length ?? 0;
  const needsCursorMarker = curRow !== naturalRow || curCol !== naturalCol;
  const cursorMarker = needsCursorMarker ? `\x1b_C:${curRow},${curCol}\x1b\\` : '';

  return serialized + cursorMarker + pending;
}

/** Visible text without colour codes / cursor marker / pending sequences (used for cursor position + tests). */
export function terminalPlainText(buffer: string): string {
  return buffer.replace(PENDING_RE, '').replace(APC_CUR_RE, '').replace(SGR_STRIP_RE, '');
}

/** 1-based cursor position (row, col) for answering DSR (ESC[6n) queries. */
export function terminalCursorPosition(buffer: string, rows = 32, cols = 120): { row: number; col: number } {
  const withoutPending = buffer.replace(PENDING_RE, '');
  const cm = APC_CUR_RE.exec(withoutPending);
  if (cm) {
    const absRow = Number(cm[1]) || 0;
    const absCol = Number(cm[2]) || 0;
    const totalLines = terminalPlainText(withoutPending).split('\n').length;
    const top = Math.max(0, totalLines - rows);
    return {
      row: Math.max(1, Math.min(rows, absRow - top + 1)),
      col: Math.max(1, Math.min(cols, absCol + 1)),
    };
  }
  const plain = terminalPlainText(withoutPending);
  const lines = plain.split('\n');
  const last = lines[lines.length - 1] ?? '';
  return {
    row: Math.max(1, Math.min(rows, lines.length)),
    col: Math.max(1, Math.min(cols, (last.length % cols) + 1)),
  };
}

export function containsCursorQuery(rawChunk: string): number {
  const m = rawChunk.match(/\x1b\[6n/g);
  return m ? m.length : 0;
}

// Windows Terminal / conhost "Campbell" palette – identical to the VS Debug Console on Windows.
const NORMAL = ['#0C0C0C', '#C50F1F', '#13A10E', '#C19C00', '#0037DA', '#881798', '#3A96DD', '#CCCCCC'];
const BRIGHT = ['#767676', '#E74856', '#16C60C', '#F9F1A5', '#3B78FF', '#B4009E', '#61D6D6', '#F2F2F2'];

function xterm256Color(idx: number): string {
  if (idx < 8) return NORMAL[idx];
  if (idx < 16) return BRIGHT[idx - 8];
  if (idx >= 232) {
    const gray = 8 + (idx - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  const v = idx - 16;
  const cube = [0, 95, 135, 175, 215, 255];
  const r = cube[Math.floor(v / 36)];
  const g = cube[Math.floor((v % 36) / 6)];
  const b = cube[v % 6];
  return `rgb(${r}, ${g}, ${b})`;
}

export interface TerminalSegment {
  text: string;
  color?: string;
  background?: string;
}

/** Splits the buffer into coloured segments for rendering. */
export function terminalSegments(buffer: string): TerminalSegment[] {
  const src = buffer.replace(PENDING_RE, '').replace(APC_CUR_RE, '');
  const segs: TerminalSegment[] = [];
  let fg: string | null = null;
  let fgIdx16: number | null = null;
  let bg: string | null = null;
  let bold = false;
  let inverse = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const push = (text: string) => {
    if (!text) return;
    let color: string | undefined =
      fgIdx16 !== null ? (fgIdx16 >= 8 ? BRIGHT[fgIdx16 - 8] : bold ? BRIGHT[fgIdx16] : NORMAL[fgIdx16]) : fg ?? undefined;
    let background: string | undefined = bg ?? undefined;
    if (inverse) {
      const tmp = color ?? '#CCCCCC';
      color = background ?? '#0C0C0C';
      background = tmp;
    }
    const prevSeg = segs[segs.length - 1];
    if (prevSeg && prevSeg.color === color && prevSeg.background === background) prevSeg.text += text;
    else segs.push({ text, color, background });
  };

  while ((m = re.exec(src))) {
    push(src.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] === '' ? [0] : m[1].split(';').map((c) => Number(c) || 0);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        fg = null;
        fgIdx16 = null;
        bg = null;
        bold = false;
        inverse = false;
      } else if (c === 1) {
        bold = true;
      } else if (c === 22) {
        bold = false;
      } else if (c === 7) {
        inverse = true;
      } else if (c === 27) {
        inverse = false;
      } else if (c >= 30 && c <= 37) {
        fgIdx16 = c - 30;
        fg = null;
      } else if (c === 39) {
        fg = null;
        fgIdx16 = null;
      } else if (c >= 40 && c <= 47) {
        bg = NORMAL[c - 40];
      } else if (c === 49) {
        bg = null;
      } else if (c >= 90 && c <= 97) {
        fgIdx16 = c - 90 + 8;
        fg = null;
      } else if (c >= 100 && c <= 107) {
        bg = BRIGHT[c - 100];
      } else if ((c === 38 || c === 48) && codes[i + 1] === 5 && i + 2 < codes.length) {
        const idx = Math.max(0, Math.min(255, codes[i + 2]));
        if (c === 38) {
          if (idx < 16) {
            fgIdx16 = idx;
            fg = null;
          } else {
            fgIdx16 = null;
            fg = xterm256Color(idx);
          }
        } else {
          bg = xterm256Color(idx);
        }
        i += 2;
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2 && i + 4 < codes.length) {
        const r = Math.max(0, Math.min(255, codes[i + 2]));
        const g = Math.max(0, Math.min(255, codes[i + 3]));
        const b = Math.max(0, Math.min(255, codes[i + 4]));
        const rgb = `rgb(${r}, ${g}, ${b})`;
        if (c === 38) {
          fgIdx16 = null;
          fg = rgb;
        } else {
          bg = rgb;
        }
        i += 4;
      }
    }
  }
  push(src.slice(last));
  return segs;
}

/** Formats an exit code like Visual Studio: "0 (0x0)", "-1 (0xffffffff)". */
export function formatExitCode(code: number): string {
  const hex = (code >>> 0).toString(16);
  return `${code} (0x${hex})`;
}
