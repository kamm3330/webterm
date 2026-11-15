#!/usr/bin/env python3
"""
WebTerm – Linux-Terminal im Browser.

Nur Python-Standardbibliothek (kein pip install nötig).
Frontend: xterm.js (wird per CDN geladen).

Start:   python3 webterm.py              -> http://127.0.0.1:8022
Optionen: python3 webterm.py --help
"""

import argparse
import asyncio
import base64
import fcntl
import hashlib
import json
import os
import pty
import pwd
import secrets
import signal
import struct
import sys
import termios
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


# --------------------------------------------------------------------------- #
#  Minimale WebSocket-Implementierung (RFC 6455)
# --------------------------------------------------------------------------- #
class WebSocket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.closed = False
        self._lock = asyncio.Lock()

    async def recv(self):
        """Liefert (opcode, payload) einer kompletten Nachricht oder None bei Close."""
        buf = bytearray()
        msg_opcode = None
        while True:
            hdr = await self.reader.readexactly(2)
            fin = hdr[0] & 0x80
            opcode = hdr[0] & 0x0F
            masked = hdr[1] & 0x80
            length = hdr[1] & 0x7F
            if length == 126:
                length = struct.unpack("!H", await self.reader.readexactly(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", await self.reader.readexactly(8))[0]
            if length > 16 * 1024 * 1024:
                raise ConnectionError("Frame zu groß")
            mask = await self.reader.readexactly(4) if masked else None
            data = bytearray(await self.reader.readexactly(length))
            if mask:
                for i in range(length):
                    data[i] ^= mask[i & 3]

            if opcode == 0x8:  # Close
                await self.close()
                return None
            if opcode == 0x9:  # Ping -> Pong
                await self._send_frame(0xA, bytes(data))
                continue
            if opcode == 0xA:  # Pong
                continue
            if opcode in (0x1, 0x2):
                msg_opcode = opcode
                buf = data
            elif opcode == 0x0:  # Fortsetzung
                buf += data
            if fin and msg_opcode is not None:
                return msg_opcode, bytes(buf)

    async def _send_frame(self, opcode: int, payload: bytes):
        if self.closed and opcode != 0x8:
            return
        n = len(payload)
        if n < 126:
            hdr = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            hdr = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            hdr = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        async with self._lock:
            self.writer.write(hdr + payload)
            await self.writer.drain()

    async def send_binary(self, data: bytes):
        await self._send_frame(0x2, data)

    async def send_text(self, text: str):
        await self._send_frame(0x1, text.encode("utf-8"))

    async def close(self):
        if not self.closed:
            self.closed = True
            try:
                await self._send_frame(0x8, b"")
            except Exception:
                pass


# --------------------------------------------------------------------------- #
#  Terminal-Sitzung (PTY + Shell)
# --------------------------------------------------------------------------- #
class TerminalSession:
    def __init__(self, ws: WebSocket, shell: list, cols=80, rows=24):
        self.ws = ws
        self.shell = shell
        self.cols, self.rows = cols, rows
        self.pid = None
        self.fd = None
        self.loop = asyncio.get_running_loop()
        self.out_queue: asyncio.Queue = asyncio.Queue()

    def start(self):
        pid, fd = pty.fork()
        if pid == 0:  # Kindprozess
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            try:
                pw = pwd.getpwuid(os.getuid())
                env.update(HOME=pw.pw_dir, USER=pw.pw_name, LOGNAME=pw.pw_name)
            except KeyError:
                pass
            env["SHELL"] = self.shell[0]
            env["COLORTERM"] = "truecolor"
            env.setdefault("LANG", "C.UTF-8")
            env.pop("TMUX", None)
            try:
                os.chdir(os.path.expanduser("~"))
            except Exception:
                pass
            try:
                os.execvpe(self.shell[0], self.shell, env)
            except Exception as e:
                os.write(2, f"Konnte Shell nicht starten: {e}\r\n".encode())
                os._exit(1)
        self.pid, self.fd = pid, fd
        os.set_blocking(fd, False)
        self.resize(self.cols, self.rows)
        self.loop.add_reader(fd, self._on_readable)

    def _on_readable(self):
        try:
            data = os.read(self.fd, 65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            data = b""
        if not data:
            self.loop.remove_reader(self.fd)
            self.out_queue.put_nowait(None)
        else:
            self.out_queue.put_nowait(data)

    def write(self, data: bytes):
        if self.fd is None:
            return
        view = memoryview(data)
        while view:
            try:
                n = os.write(self.fd, view)
                view = view[n:]
            except BlockingIOError:
                # PTY-Puffer voll – kurz blockierend schreiben
                os.set_blocking(self.fd, True)
                try:
                    n = os.write(self.fd, view)
                    view = view[n:]
                finally:
                    os.set_blocking(self.fd, False)
            except OSError:
                return

    def resize(self, cols: int, rows: int):
        self.cols, self.rows = max(1, int(cols)), max(1, int(rows))
        if self.fd is not None:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ,
                        struct.pack("HHHH", self.rows, self.cols, 0, 0))

    def stop(self):
        if self.fd is not None:
            try:
                self.loop.remove_reader(self.fd)
            except Exception:
                pass
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None
        if self.pid:
            try:
                os.killpg(os.getpgid(self.pid), signal.SIGHUP)
            except Exception:
                try:
                    os.kill(self.pid, signal.SIGHUP)
                except Exception:
                    pass
            self._reap(self.pid, 0)
            self.pid = None

    def _reap(self, pid, attempt):
        """Beendeten Kindprozess einsammeln (keine Zombies)."""
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return
        if done == 0:
            if attempt == 5:
                try:
                    os.kill(pid, signal.SIGKILL)
                except Exception:
                    pass
            if attempt < 10:
                self.loop.call_later(0.5, self._reap, pid, attempt + 1)


# --------------------------------------------------------------------------- #
#  HTTP-Server
# --------------------------------------------------------------------------- #
class Server:
    def __init__(self, args):
        self.args = args
        self.token = args.token

    def _authorized(self, query: dict, headers: dict) -> bool:
        if not self.token:
            return True
        tok = query.get("token", [""])[0]
        cookie = headers.get("cookie", "")
        for part in cookie.split(";"):
            k, _, v = part.strip().partition("=")
            if k == "webterm_token":
                tok = tok or v
        return secrets.compare_digest(tok, self.token)

    async def handle(self, reader, writer):
        try:
            request_line = (await reader.readline()).decode("latin-1").strip()
            if not request_line:
                return
            method, target, _ = request_line.split(" ", 2)
            headers = {}
            while True:
                line = (await reader.readline()).decode("latin-1")
                if line in ("\r\n", "\n", ""):
                    break
                k, _, v = line.partition(":")
                headers[k.strip().lower()] = v.strip()

            url = urlsplit(target)
            query = parse_qs(url.query)

            if not self._authorized(query, headers):
                return await self._respond(writer, 403, b"403 - Token fehlt oder falsch",
                                           "text/plain; charset=utf-8")

            if url.path == "/ws" and headers.get("upgrade", "").lower() == "websocket":
                return await self._websocket(reader, writer, headers, query)

            if method != "GET":
                return await self._respond(writer, 405, b"405", "text/plain")

            path = url.path
            if path == "/":
                path = "/index.html"
            file = (STATIC_DIR / path.lstrip("/")).resolve()
            if STATIC_DIR not in file.parents or not file.is_file():
                return await self._respond(writer, 404, b"404 - nicht gefunden", "text/plain")
            extra = {}
            if self.token and "token" in query:
                extra["Set-Cookie"] = (f"webterm_token={self.token}; Path=/; "
                                       "HttpOnly; SameSite=Strict")
            await self._respond(writer, 200, file.read_bytes(),
                                MIME.get(file.suffix, "application/octet-stream"), extra)
        except (ConnectionError, asyncio.IncompleteReadError, ValueError):
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def _respond(self, writer, status, body: bytes, ctype, extra=None):
        reason = {200: "OK", 403: "Forbidden", 404: "Not Found",
                  405: "Method Not Allowed"}.get(status, "")
        head = [f"HTTP/1.1 {status} {reason}",
                f"Content-Type: {ctype}",
                f"Content-Length: {len(body)}",
                "Cache-Control: no-cache",
                "X-Frame-Options: DENY",
                "Connection: close"]
        for k, v in (extra or {}).items():
            head.append(f"{k}: {v}")
        writer.write(("\r\n".join(head) + "\r\n\r\n").encode() + body)
        await writer.drain()

    async def _websocket(self, reader, writer, headers, query):
        # Schutz gegen Cross-Site-WebSocket-Hijacking: Origin muss zum Host passen
        origin = headers.get("origin")
        if origin and urlsplit(origin).netloc != headers.get("host", ""):
            return await self._respond(writer, 403, b"403 - fremder Origin", "text/plain")

        key = headers.get("sec-websocket-key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        writer.write((
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        await writer.drain()

        ws = WebSocket(reader, writer)
        cols = int(query.get("cols", ["80"])[0] or 80)
        rows = int(query.get("rows", ["24"])[0] or 24)
        session = TerminalSession(ws, self.args.shell, cols, rows)
        session.start()
        print(f"[webterm] Sitzung gestartet (PID {session.pid})", flush=True)

        async def pump_output():
            while True:
                data = await session.out_queue.get()
                if data is None:
                    await ws.send_text(json.dumps({"t": "exit"}))
                    await ws.close()
                    return
                # Ausgaben bündeln, um viele kleine Frames zu vermeiden
                while not session.out_queue.empty():
                    nxt = session.out_queue.get_nowait()
                    if nxt is None:
                        session.out_queue.put_nowait(None)
                        break
                    data += nxt
                await ws.send_binary(data)

        out_task = asyncio.create_task(pump_output())
        try:
            while not ws.closed:
                msg = await ws.recv()
                if msg is None:
                    break
                opcode, payload = msg
                if opcode == 0x2:  # binär = Tastatureingabe
                    session.write(payload)
                    continue
                try:
                    m = json.loads(payload.decode("utf-8"))
                except ValueError:
                    continue
                if m.get("t") == "i":
                    session.write(m.get("d", "").encode("utf-8"))
                elif m.get("t") == "r":
                    session.resize(m.get("c", 80), m.get("r", 24))
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            out_task.cancel()
            session.stop()
            print("[webterm] Sitzung beendet", flush=True)


def default_shell() -> str:
    """Login-Shell des Benutzers aus /etc/passwd – nicht $SHELL, denn cron/systemd setzen
    dort oft /bin/sh (= dash: keine Pfeiltasten-Historie, keine Bash-Aliase)."""
    try:
        sh = pwd.getpwuid(os.getuid()).pw_shell
    except KeyError:
        sh = ""
    if not sh or not os.access(sh, os.X_OK) or os.path.basename(sh) in ("sh", "dash", "nologin", "false"):
        for cand in ("/bin/bash", "/usr/bin/bash", os.environ.get("SHELL", ""), "/bin/sh"):
            if cand and os.access(cand, os.X_OK) and os.path.basename(cand) not in ("nologin", "false"):
                return cand
    return sh or "/bin/sh"


def main():
    p = argparse.ArgumentParser(description="Linux-Terminal im Browser")
    p.add_argument("--host", default="127.0.0.1",
                   help="Adresse (Standard: 127.0.0.1 = nur dieser Rechner)")
    p.add_argument("--port", type=int, default=8022, help="Port (Standard: 8022)")
    p.add_argument("--token", default=None,
                   help="Zugangs-Token. Wird automatisch erzeugt, wenn --host "
                        "nicht localhost ist.")
    p.add_argument("--no-token", action="store_true",
                   help="Kein Token verwenden (NICHT empfohlen bei Netzwerkzugriff)")
    p.add_argument("--shell", default=None,
                   help="Zu startendes Programm (Standard: Login-Shell aus /etc/passwd)")
    args = p.parse_args()

    args.shell = (args.shell or default_shell()).split()
    if len(args.shell) == 1 and os.path.basename(args.shell[0]) in ("bash", "zsh", "fish", "ksh"):
        args.shell += ["-l", "-i"]  # interaktive Login-Shell (lädt .profile/.bashrc -> Aliase)
    elif len(args.shell) == 1 and args.shell[0].endswith("sh"):
        args.shell.append("-l")

    local = args.host in ("127.0.0.1", "localhost", "::1")
    if not args.token and not local and not args.no_token:
        args.token = secrets.token_urlsafe(18)
    if args.no_token:
        args.token = None

    async def run():
        srv = Server(args)
        server = await asyncio.start_server(srv.handle, args.host, args.port)
        shown = "localhost" if local else (args.host if args.host != "0.0.0.0" else "<IP-dieses-Rechners>")
        url = f"http://{shown}:{args.port}/"
        if args.token:
            url += f"?token={args.token}"
        print(f"[webterm] läuft auf  {url}", flush=True)
        print(f"[webterm] Shell: {' '.join(args.shell)}   (Beenden mit Strg+C)", flush=True)
        async with server:
            await server.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[webterm] beendet.")


if __name__ == "__main__":
    if not STATIC_DIR.is_dir():
        sys.exit(f"Ordner {STATIC_DIR} fehlt.")
    main()
