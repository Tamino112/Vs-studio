import { spawn, execFileSync, ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
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

const CONPTY_BRIDGE_CS = String.raw`
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace VsConPtyBridge
{
    internal static class Program
    {
        private const int STD_INPUT_HANDLE = -10;
        private const int STD_OUTPUT_HANDLE = -11;
        private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        private const int STARTF_USESTDHANDLES = 0x00000100;
        private const uint INFINITE = 0xFFFFFFFF;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;
        private static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;
        private static volatile bool childExited = false;

        [StructLayout(LayoutKind.Sequential)]
        private struct COORD
        {
            public short X;
            public short Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            public int bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFOEX
        {
            public STARTUPINFO StartupInfo;
            public IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CreatePipe(
            out IntPtr hReadPipe,
            out IntPtr hWritePipe,
            ref SECURITY_ATTRIBUTES lpPipeAttributes,
            int nSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern int CreatePseudoConsole(
            COORD size,
            IntPtr hInput,
            IntPtr hOutput,
            uint dwFlags,
            out IntPtr phPC);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern void ClosePseudoConsole(IntPtr hPC);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(
            IntPtr lpAttributeList,
            int dwAttributeCount,
            int dwFlags,
            ref IntPtr lpSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(
            IntPtr lpAttributeList,
            uint dwFlags,
            IntPtr Attribute,
            IntPtr lpValue,
            IntPtr cbSize,
            IntPtr lpPreviousValue,
            IntPtr lpReturnSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessW(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFOEX lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessW(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool ReadFile(
            IntPtr hFile,
            byte[] lpBuffer,
            int nNumberOfBytesToRead,
            out int lpNumberOfBytesRead,
            IntPtr lpOverlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool WriteFile(
            IntPtr hFile,
            byte[] lpBuffer,
            int nNumberOfBytesToWrite,
            out int lpNumberOfBytesWritten,
            IntPtr lpOverlapped);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob,
            int JobObjectInfoClass,
            IntPtr lpJobObjectInfo,
            uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        private static string QuoteWin32Arg(string arg)
        {
            if (arg == null) return "\"\"";
            if (arg.Length == 0) return "\"\"";
            bool needsQuotes = false;
            for (int i = 0; i < arg.Length; i++)
            {
                char c = arg[i];
                if (c == ' ' || c == '\t' || c == '"')
                {
                    needsQuotes = true;
                    break;
                }
            }
            if (!needsQuotes) return arg;

            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            int backslashes = 0;
            for (int i = 0; i < arg.Length; i++)
            {
                char c = arg[i];
                if (c == '\\')
                {
                    backslashes++;
                }
                else if (c == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                    backslashes = 0;
                }
                else
                {
                    if (backslashes > 0)
                    {
                        sb.Append('\\', backslashes);
                        backslashes = 0;
                    }
                    sb.Append(c);
                }
            }
            if (backslashes > 0)
            {
                sb.Append('\\', backslashes * 2);
            }
            sb.Append('"');
            return sb.ToString();
        }

        private static string BuildCommandLine(string[] args, int startIdx)
        {
            string cmd = args[startIdx];
            bool isBatch = cmd.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) ||
                           cmd.EndsWith(".bat", StringComparison.OrdinalIgnoreCase);

            StringBuilder sb = new StringBuilder();
            if (isBatch)
            {
                sb.Append("cmd.exe /c \"\"");
                sb.Append(cmd.Replace("\"", ""));
                sb.Append('"');
                for (int i = startIdx + 1; i < args.Length; i++)
                {
                    sb.Append(' ').Append(QuoteWin32Arg(args[i]));
                }
                sb.Append('"');
                return sb.ToString();
            }

            sb.Append(QuoteWin32Arg(cmd));
            for (int i = startIdx + 1; i < args.Length; i++)
            {
                sb.Append(' ').Append(QuoteWin32Arg(args[i]));
            }
            return sb.ToString();
        }

        private static IntPtr CreateKillOnCloseJob()
        {
            IntPtr hJob = CreateJobObjectW(IntPtr.Zero, null);
            if (hJob == IntPtr.Zero) return IntPtr.Zero;

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, ptr, false);
                SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, ptr, (uint)size);
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
            return hJob;
        }

        private static void Main(string[] args)
        {
            if (args.Length >= 2 && args[0] == "--new-console")
            {
                STARTUPINFO nsi = new STARTUPINFO();
                nsi.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                nsi.dwFlags = 0x00000001; // STARTF_USESHOWWINDOW
                nsi.wShowWindow = 1; // SW_SHOWNORMAL
                PROCESS_INFORMATION npi;
                string newCmd = BuildCommandLine(args, 1);
                if (!CreateProcessW(
                    null,
                    new StringBuilder(newCmd),
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    0x00000010, // CREATE_NEW_CONSOLE
                    IntPtr.Zero,
                    null,
                    ref nsi,
                    out npi))
                {
                    Environment.Exit(Marshal.GetLastWin32Error());
                    return;
                }
                Console.WriteLine(npi.dwProcessId);
                CloseHandle(npi.hThread);
                CloseHandle(npi.hProcess);
                Environment.Exit(0);
                return;
            }

            if (args.Length < 3)
            {
                Environment.Exit(1);
                return;
            }

            short cols = 120;
            short rows = 32;
            short parsedCols;
            short parsedRows;
            if (short.TryParse(args[0], out parsedCols) && parsedCols > 0) cols = parsedCols;
            if (short.TryParse(args[1], out parsedRows) && parsedRows > 0) rows = parsedRows;

            IntPtr stdIn = GetStdHandle(STD_INPUT_HANDLE);
            IntPtr stdOut = GetStdHandle(STD_OUTPUT_HANDLE);

            SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
            sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            sa.bInheritHandle = 0;

            IntPtr inRead = IntPtr.Zero;
            IntPtr inWrite = IntPtr.Zero;
            IntPtr outRead = IntPtr.Zero;
            IntPtr outWrite = IntPtr.Zero;

            if (!CreatePipe(out inRead, out inWrite, ref sa, 0) ||
                !CreatePipe(out outRead, out outWrite, ref sa, 0))
            {
                Environment.Exit(120);
                return;
            }

            COORD size;
            size.X = cols;
            size.Y = rows;

            IntPtr hPC = IntPtr.Zero;
            int hr = CreatePseudoConsole(size, inRead, outWrite, 0, out hPC);
            if (hr != 0 || hPC == IntPtr.Zero)
            {
                CloseHandle(inRead);
                CloseHandle(inWrite);
                CloseHandle(outRead);
                CloseHandle(outWrite);
                Environment.Exit(120);
                return;
            }

            IntPtr attrSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
            IntPtr attrList = Marshal.AllocHGlobal(attrSize);
            if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref attrSize) ||
                !UpdateProcThreadAttribute(
                    attrList,
                    0,
                    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    hPC,
                    (IntPtr)IntPtr.Size,
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                Marshal.FreeHGlobal(attrList);
                ClosePseudoConsole(hPC);
                CloseHandle(inRead);
                CloseHandle(inWrite);
                CloseHandle(outRead);
                CloseHandle(outWrite);
                Environment.Exit(121);
                return;
            }

            STARTUPINFOEX si = new STARTUPINFOEX();
            si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            // Required when vs-conpty is launched with redirected stdio pipes (Node stdio:['pipe',...]):
            // otherwise NtCreateUserProcess duplicates the parent's pipe handles instead of binding ConPTY.
            si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            si.StartupInfo.hStdInput = IntPtr.Zero;
            si.StartupInfo.hStdOutput = IntPtr.Zero;
            si.StartupInfo.hStdError = IntPtr.Zero;
            si.lpAttributeList = attrList;

            PROCESS_INFORMATION pi;
            string cmdLine = BuildCommandLine(args, 2);
            bool started = CreateProcessW(
                null,
                new StringBuilder(cmdLine),
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero,
                null,
                ref si,
                out pi);

            DeleteProcThreadAttributeList(attrList);
            Marshal.FreeHGlobal(attrList);
            // Close ConPTY-side pipe handles immediately in parent so ClosePseudoConsole triggers clean EOF
            CloseHandle(inRead);
            CloseHandle(outWrite);

            if (!started)
            {
                int err = Marshal.GetLastWin32Error();
                ClosePseudoConsole(hPC);
                CloseHandle(inWrite);
                CloseHandle(outRead);
                Console.Error.WriteLine("ConPTY CreateProcessW failed: " + err);
                Environment.Exit(122);
                return;
            }

            IntPtr hJob = CreateKillOnCloseJob();
            if (hJob != IntPtr.Zero)
            {
                try { AssignProcessToJobObject(hJob, pi.hProcess); } catch { }
            }

            Thread outThread = new Thread(delegate()
            {
                byte[] buf = new byte[4096];
                while (true)
                {
                    int read = 0;
                    if (!ReadFile(outRead, buf, buf.Length, out read, IntPtr.Zero) || read <= 0)
                        break;
                    int offset = 0;
                    while (offset < read)
                    {
                        byte[] chunk = buf;
                        if (offset > 0)
                        {
                            chunk = new byte[read - offset];
                            Buffer.BlockCopy(buf, offset, chunk, 0, read - offset);
                        }
                        int written = 0;
                        if (!WriteFile(stdOut, chunk, read - offset, out written, IntPtr.Zero) || written <= 0)
                            return;
                        offset += written;
                    }
                }
            });
            outThread.IsBackground = true;
            outThread.Start();

            Thread inThread = new Thread(delegate()
            {
                byte[] buf = new byte[4096];
                while (true)
                {
                    int read = 0;
                    if (!ReadFile(stdIn, buf, buf.Length, out read, IntPtr.Zero) || read <= 0)
                    {
                        if (!childExited)
                        {
                            try { TerminateProcess(pi.hProcess, 1); } catch { }
                        }
                        break;
                    }
                    int offset = 0;
                    while (offset < read)
                    {
                        byte[] chunk = buf;
                        if (offset > 0)
                        {
                            chunk = new byte[read - offset];
                            Buffer.BlockCopy(buf, offset, chunk, 0, read - offset);
                        }
                        int written = 0;
                        if (!WriteFile(inWrite, chunk, read - offset, out written, IntPtr.Zero) || written <= 0)
                        {
                            if (!childExited)
                            {
                                Console.Error.WriteLine("[vs-conpty] WriteFile(inWrite) failed: " + Marshal.GetLastWin32Error());
                            }
                            return;
                        }
                        offset += written;
                    }
                }
            });
            inThread.IsBackground = true;
            inThread.Start();

            WaitForSingleObject(pi.hProcess, INFINITE);
            childExited = true;
            uint exitCode = 0;
            GetExitCodeProcess(pi.hProcess, out exitCode);

            // Give conhost a brief moment to flush remaining VT screen updates before tearing down ConPTY
            Thread.Sleep(50);
            ClosePseudoConsole(hPC);
            outThread.Join(3000);

            CloseHandle(inWrite);
            CloseHandle(outRead);
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            if (hJob != IntPtr.Zero) CloseHandle(hJob);

            Environment.Exit((int)exitCode);
        }
    }
}
`;

let cachedWinConptyExe: string | null | undefined = undefined;

function findWindowsCscBinary(): string | null {
  const winDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return null;
}

function getWindowsConptyHelper(): string | null {
  if (process.platform !== 'win32') return null;
  if (cachedWinConptyExe !== undefined) {
    if (cachedWinConptyExe && fsSync.existsSync(cachedWinConptyExe)) return cachedWinConptyExe;
  }

  const hash = crypto.createHash('sha256').update(CONPTY_BRIDGE_CS).digest('hex').slice(0, 12);
  const cacheDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'vs-studio-community')
    : path.join(os.tmpdir(), 'vs-studio-community');
  const exePath = path.join(cacheDir, `vs-conpty-${hash}.exe`);

  if (fsSync.existsSync(exePath)) {
    cachedWinConptyExe = exePath;
    return exePath;
  }

  const csc = findWindowsCscBinary();
  if (!csc) {
    cachedWinConptyExe = null;
    return null;
  }

  try {
    fsSync.mkdirSync(cacheDir, { recursive: true });
    const uniq = `${process.pid}-${Date.now()}`;
    const csPath = path.join(cacheDir, `vs-conpty-${hash}-${uniq}.cs`);
    const tmpExe = path.join(cacheDir, `vs-conpty-${hash}-${uniq}.exe`);
    fsSync.writeFileSync(csPath, CONPTY_BRIDGE_CS, 'utf-8');
    try {
      execFileSync(csc, ['/nologo', '/optimize+', '/platform:anycpu', '/target:exe', `/out:${tmpExe}`, csPath], {
        stdio: 'pipe',
        timeout: 20000,
        windowsHide: true,
      });
      try {
        fsSync.renameSync(tmpExe, exePath);
      } catch {
        // Another parallel spawn may have finished writing exePath first
      }
      if (fsSync.existsSync(exePath)) {
        cachedWinConptyExe = exePath;
        return exePath;
      }
    } finally {
      try { fsSync.unlinkSync(csPath); } catch { /* ignore */ }
      try { if (fsSync.existsSync(tmpExe)) fsSync.unlinkSync(tmpExe); } catch { /* ignore */ }
    }
  } catch {
    // Fallback cleanly to piped spawn if compilation is blocked
  }

  cachedWinConptyExe = null;
  return null;
}

export function isPtyAvailable(): boolean {
  if (process.platform === 'win32') {
    return Boolean(getWindowsConptyHelper());
  }
  return Boolean(findPython3Binary());
}

/**
 * Launches a process inside a new visible Windows Console window and returns its PID
 * so the IDE can terminate it before subsequent builds to prevent MSB3027 file locks.
 */
export function spawnDetachedNewConsole(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): { pid: number } | null {
  if (process.platform !== 'win32') return null;
  const conpty = getWindowsConptyHelper();
  if (!conpty) return null;
  try {
    const out = execFileSync(conpty, ['--new-console', command, ...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      windowsHide: true,
    });
    const pid = Number(String(out).trim().split(/\r?\n/)[0]);
    return Number.isFinite(pid) && pid > 0 ? { pid } : null;
  } catch {
    return null;
  }
}

export function spawnWithPty(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): { proc: ChildProcessWithoutNullStreams; isPty: boolean } {
  if (process.platform === 'win32') {
    const conpty = getWindowsConptyHelper();
    if (conpty) {
      const proc = spawn(conpty, ['120', '32', command, ...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      proc.stdin.on('error', () => {
        // ignore EPIPE after the program exited
      });
      return { proc, isPty: true };
    }
  }

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
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    windowsHide: true,
  });
  proc.stdin.on('error', () => {
    // ignore EPIPE after the program exited
  });
  return { proc, isPty: false };
}
