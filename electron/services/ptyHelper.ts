import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';

const PTY_BRIDGE_PY = String.raw`
import errno, fcntl, os, pty, select, signal, struct, sys, termios

cmd = sys.argv[1:]
if not cmd:
    sys.exit(1)

master, slave = pty.openpty()
try:
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))
except Exception:
    pass

pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    try:
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    except Exception:
        pass
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    if slave > 2:
        os.close(slave)
    os.execvp(cmd[0], cmd)

os.close(slave)

def _forward_term(signum, frame):
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass

signal.signal(signal.SIGTERM, _forward_term)
signal.signal(signal.SIGHUP, _forward_term)

stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()
stdin_open = True
exit_status = None

def _write_all(fd, data):
    view = memoryview(data)
    while view:
        try:
            n = os.write(fd, view)
            view = view[n:]
        except OSError as e:
            if e.errno == errno.EINTR:
                continue
            break

while True:
    rfds = [master] + ([stdin_fd] if stdin_open else [])
    try:
        r, _, _ = select.select(rfds, [], [], 0.05)
    except InterruptedError:
        continue
    except Exception:
        break

    if master in r:
        try:
            chunk = os.read(master, 4096)
        except OSError as e:
            if e.errno in (errno.EIO, errno.EBADF):
                chunk = b""
            else:
                chunk = b""
        if not chunk:
            break
        _write_all(stdout_fd, chunk)

    if stdin_fd in r:
        try:
            in_data = os.read(stdin_fd, 4096)
        except OSError:
            in_data = b""
        if not in_data:
            # Parent (the IDE) closed the pipe / quit: hang up like a closed terminal window
            stdin_open = False
            try:
                os.killpg(pid, signal.SIGHUP)
            except Exception:
                try:
                    os.kill(pid, signal.SIGHUP)
                except Exception:
                    pass
        else:
            _write_all(master, in_data)

    if exit_status is None:
        try:
            wpid, st = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                exit_status = st
        except ChildProcessError:
            exit_status = 0

# Drain any remaining buffered output from master before closing
while True:
    try:
        r2, _, _ = select.select([master], [], [], 0.02)
    except Exception:
        break
    if not r2:
        break
    try:
        d2 = os.read(master, 4096)
    except OSError:
        break
    if not d2:
        break
    _write_all(stdout_fd, d2)

try:
    os.close(master)
except Exception:
    pass

if exit_status is None:
    try:
        _, exit_status = os.waitpid(pid, 0)
    except ChildProcessError:
        exit_status = 0

if hasattr(os, "waitstatus_to_exitcode"):
    sys.exit(os.waitstatus_to_exitcode(exit_status))
if os.WIFEXITED(exit_status):
    sys.exit(os.WEXITSTATUS(exit_status))
if os.WIFSIGNALED(exit_status):
    sys.exit(128 + os.WTERMSIG(exit_status))
sys.exit(0)
`;

function isRealExecutable(p: string): boolean {
  try {
    fsSync.accessSync(p, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findPython3Binary(): string | null {
  if (process.platform === 'win32') return null;

  const candidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
    '/Library/Developer/CommandLineTools/usr/bin/python3',
  ];

  for (const c of candidates) {
    if (isRealExecutable(c)) return c;
  }

  // On macOS, /usr/bin/python3 triggers a GUI Xcode CLT install popup if CLT is absent
  if (process.platform === 'darwin') {
    const hasClt =
      fsSync.existsSync('/Library/Developer/CommandLineTools/usr/bin/python3') ||
      fsSync.existsSync('/Applications/Xcode.app/Contents/Developer/usr/bin/python3');
    if (hasClt && isRealExecutable('/usr/bin/python3')) {
      return '/usr/bin/python3';
    }
    return null;
  }

  // Linux / Unix: check PATH and /usr/bin/python3
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const full = path.join(dir, 'python3');
    if (isRealExecutable(full)) return full;
  }
  if (isRealExecutable('/usr/bin/python3')) return '/usr/bin/python3';
  return null;
}

export function spawnWithPty(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): { proc: ChildProcessWithoutNullStreams; isPty: boolean } {
  const pythonBin = findPython3Binary();
  if (pythonBin) {
    const proc = spawn(pythonBin, ['-u', '-c', PTY_BRIDGE_PY, command, ...args], {
      cwd: options.cwd,
      env: {
        ...options.env,
        TERM: options.env.TERM || 'xterm-256color',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdin.on('error', () => {
      // ignore EPIPE after the program exited
    });
    return { proc, isPty: true };
  }

  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdin.on('error', () => {
    // ignore EPIPE after the program exited
  });
  return { proc, isPty: false };
}
