/* eslint-disable no-control-regex */
/**
 * Minimal terminal emulation for the "Microsoft Visual Studio Debug Console" window.
 *
 * The output buffer is a plain string that may contain SGR colour sequences (ESC[..m).
 * A trailing incomplete control sequence (a lone CR or a partial ESC sequence that was
 * split across two PTY chunks) is kept at the end of the buffer and completed with the
 * next chunk, so "\r" + "\n" arriving in separate chunks is still treated as a newline.
 */

const PENDING_RE = /(?:\r|\x1b(?:\[[0-9;?]*|[()])?)$/;
const TRAILING_SGR_RE = /(?:\x1b\[[0-9;]*m)+$/;

/** Removes the last visible character of the current line (keeps colour sequences). */
function deleteLastVisible(out: string): string {
  const sgr = TRAILING_SGR_RE.exec(out);
  const tail = sgr ? sgr[0] : '';
  const body = sgr ? out.slice(0, -tail.length) : out;
  if (body.length === 0 || body[body.length - 1] === '\n') return out;
  return body.slice(0, -1) + tail;
}

function clearCurrentLine(out: string): string {
  const lastNl = out.lastIndexOf('\n');
  return lastNl === -1 ? '' : out.slice(0, lastNl + 1);
}

export function applyTerminalChunk(prev: string, rawChunk: string): string {
  let carry = '';
  const pm = PENDING_RE.exec(prev);
  if (pm) {
    carry = pm[0];
    prev = prev.slice(0, -carry.length);
  }
  let text = carry + rawChunk;
  let pending = '';
  const tm = PENDING_RE.exec(text);
  if (tm) {
    pending = tm[0];
    text = text.slice(0, -pending.length);
  }

  text = text.replace(/\r\n/g, '\n');

  // Console.Clear(): ESC[H ESC[2J / ESC[3J
  if (/\x1b\[[23]J/.test(text)) {
    const parts = text.split(/\x1b\[[23]J/);
    prev = '';
    text = parts[parts.length - 1] ?? '';
  }

  // OSC sequences (window title etc.)
  text = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  // Charset selection ESC(B and single-char escapes (keypad mode ESC= / ESC>, save/restore ESC7/ESC8 …)
  text = text.replace(/\x1b[()][0-9A-Za-z]/g, '');
  text = text.replace(/\x1b[=>78cMDE]/g, '');
  // All CSI sequences except SGR (colours) and erase-in-line
  text = text.replace(/\x1b\[(?![0-9;]*m)(?![012]?K)[0-9;?]*[ -/]*[@-~]/g, '');

  let out = prev;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\x1b') {
      const rest = text.slice(i);
      const k = /^\x1b\[([012]?)K/.exec(rest);
      if (k) {
        i += k[0].length - 1;
        if (k[1] === '2') out = clearCurrentLine(out);
        continue;
      }
      const sgr = /^\x1b\[[0-9;]*m/.exec(rest);
      if (sgr) {
        out += sgr[0];
        i += sgr[0].length - 1;
        continue;
      }
      // Unknown/unsupported escape: drop the ESC itself
      continue;
    }
    if (ch === '\x08' || ch === '\x7f') {
      out = deleteLastVisible(out);
      continue;
    }
    if (ch === '\r') {
      out = clearCurrentLine(out);
      continue;
    }
    if (ch === '\x07' || ch === '\x00') continue; // bell / NUL
    out += ch;
  }

  if (out.length > 120000) out = out.slice(-120000);
  return out + pending;
}

/** Visible text without colour codes / pending sequences (used for cursor position + tests). */
export function terminalPlainText(buffer: string): string {
  return buffer.replace(PENDING_RE, '').replace(/\x1b\[[0-9;]*m/g, '');
}

/** 1-based cursor position (row, col) for answering DSR (ESC[6n) queries. */
export function terminalCursorPosition(buffer: string, rows = 32, cols = 120): { row: number; col: number } {
  const plain = terminalPlainText(buffer);
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

export interface TerminalSegment {
  text: string;
  color?: string;
  background?: string;
}

/** Splits the buffer into coloured segments for rendering. */
export function terminalSegments(buffer: string): TerminalSegment[] {
  const src = buffer.replace(PENDING_RE, '');
  const segs: TerminalSegment[] = [];
  let fg: number | null = null;
  let bg: number | null = null;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string) => {
    if (!text) return;
    let color: string | undefined;
    if (fg !== null) color = fg >= 8 ? BRIGHT[fg - 8] : bold ? BRIGHT[fg] : NORMAL[fg];
    const background = bg !== null ? (bg >= 8 ? BRIGHT[bg - 8] : NORMAL[bg]) : undefined;
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
        bg = null;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c >= 30 && c <= 37) fg = c - 30;
      else if (c === 39) fg = null;
      else if (c >= 40 && c <= 47) bg = c - 40;
      else if (c === 49) bg = null;
      else if (c >= 90 && c <= 97) fg = c - 90 + 8;
      else if (c >= 100 && c <= 107) bg = c - 100 + 8;
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const idx = codes[i + 2] ?? 0;
        if (idx < 16) {
          if (c === 38) fg = idx;
          else bg = idx;
        }
        i += 2;
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
