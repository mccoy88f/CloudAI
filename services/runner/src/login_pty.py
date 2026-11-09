import os
import pty
import select
import sys


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(2)
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execvp(sys.argv[1], sys.argv[1:])
    stdin = sys.stdin.fileno()
    stdout = sys.stdout.fileno()
    os.set_blocking(stdin, False)
    code = 1
    try:
        while True:
            ready, _, _ = select.select([fd, stdin], [], [], 0.2)
            if fd in ready:
                try:
                    chunk = os.read(fd, 8192)
                except OSError:
                    chunk = b""
                if not chunk:
                    break
                os.write(stdout, chunk)
            if stdin in ready:
                try:
                    chunk = os.read(stdin, 8192)
                except OSError:
                    chunk = b""
                if chunk:
                    os.write(fd, chunk)
        _, status = os.waitpid(pid, 0)
        code = os.waitstatus_to_exitcode(status)
    except ChildProcessError:
        code = 1
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    sys.exit(code)


if __name__ == "__main__":
    main()
