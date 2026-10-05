"""Gallery server. Serves the site, stores the shared archive, and requires a password."""

import hashlib
import hmac
import json
import secrets
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parent
STORE = ROOT / "data" / "shows.json"
SECRET_PATH = ROOT / "data" / "secret.txt"
PASSWORD_PATH = ROOT / "data" / "password.txt"
EMPTY = {"shows": [], "activeId": None}
COOKIE = "gallery"
SESSION_SECONDS = 60 * 60 * 24 * 30
FAILS = {}


def ensure_text(path, maker):
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    path.parent.mkdir(exist_ok=True)
    value = maker()
    path.write_text(value, encoding="utf-8")
    return value


def session_secret():
    return ensure_text(SECRET_PATH, lambda: secrets.token_hex(32))


def gallery_password():
    alphabet = "abcdefghijkmnpqrstuvwxyz23456789"

    def maker():
        groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)]
        return "-".join(groups)

    return ensure_text(PASSWORD_PATH, maker)


def sign(payload):
    return hmac.new(session_secret().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def make_token():
    expiry = str(int(time.time()) + SESSION_SECONDS)
    nonce = secrets.token_hex(8)
    payload = f"{expiry}.{nonce}"
    return f"{payload}.{sign(payload)}"


def valid_token(token):
    parts = (token or "").split(".")
    if len(parts) != 3:
        return False
    payload = f"{parts[0]}.{parts[1]}"
    if not hmac.compare_digest(sign(payload), parts[2]):
        return False
    try:
        return int(parts[0]) > time.time()
    except ValueError:
        return False


def too_many(ip):
    now = time.time()
    hits = [stamp for stamp in FAILS.get(ip, []) if now - stamp < 600]
    FAILS[ip] = hits
    return len(hits) >= 8


def note_fail(ip):
    FAILS.setdefault(ip, []).append(time.time())


LOGIN_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录 · 湖畔美术馆</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #e8e4dc;
      color: #1c2430;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    form {
      width: min(360px, calc(100% - 32px));
      padding: 28px 24px 22px;
      background: rgba(255, 252, 247, 0.94);
      border-radius: 16px;
    }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 650; }
    p { margin: 0 0 18px; color: #5c6570; font-size: 14px; line-height: 1.5; }
    input {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-size: 16px;
      padding: 10px 12px;
      border: 1px solid #c5d0e8;
      border-radius: 8px;
    }
    button {
      width: 100%;
      margin-top: 12px;
      font: inherit;
      font-size: 15px;
      padding: 10px 12px;
      border: 0;
      border-radius: 8px;
      background: #2f5fbf;
      color: #fff;
      cursor: pointer;
    }
    .err { color: #8d2b2b; }
  </style>
</head>
<body>
  <form method="post" action="/api/login">
    <h1>湖畔美术馆</h1>
    <p class="__KIND__">__MESSAGE__</p>
    <input type="password" name="password" autocomplete="current-password" placeholder="密码" required />
    <button type="submit">进入</button>
  </form>
</body>
</html>
"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def path_only(self):
        return self.path.split("?", 1)[0]

    def client_ip(self):
        forwarded = self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For") or ""
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def cookie_token(self):
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE:
                return value
        return ""

    def authed(self):
        return valid_token(self.cookie_token())

    def https(self):
        return self.headers.get("X-Forwarded-Proto", "http") == "https"

    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location, token=None):
        self.send_response(302)
        self.send_header("Location", location)
        if token:
            flags = "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + str(SESSION_SECONDS)
            if self.https():
                flags += "; Secure"
            self.send_header("Set-Cookie", f"{COOKIE}={token}{flags}")
        self.end_headers()

    def require_auth(self):
        if self.authed():
            return True
        if self.path_only().startswith("/api/"):
            body = b'{"error":"login"}'
            self.send_bytes(401, body, "application/json")
        else:
            self.redirect("/login")
        return False

    def send_login(self, failed=False):
        html = LOGIN_PAGE.replace("__KIND__", "err" if failed else "").replace(
            "__MESSAGE__",
            "密码不对，请再试一次。" if failed else "输入密码后即可进入。同一密码可以在电脑和平板上使用。",
        ).encode("utf-8")
        self.send_bytes(200, html, "text/html; charset=utf-8")

    def do_GET(self):
        path = self.path_only()
        if path == "/login":
            if self.authed():
                self.redirect("/")
            else:
                self.send_login(False)
            return
        if not self.require_auth():
            return
        if path == "/api/shows":
            self.send_store()
            return
        super().do_GET()

    def do_PUT(self):
        if not self.require_auth():
            return
        if self.path_only() != "/api/shows":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 2 or length > 80_000_000:
            self.send_error(413)
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self.send_error(400)
            return
        if not isinstance(data, dict) or not isinstance(data.get("shows"), list):
            self.send_error(400)
            return
        STORE.parent.mkdir(exist_ok=True)
        tmp = STORE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(STORE)
        self.send_bytes(200, b'{"ok":true}', "application/json")

    def do_POST(self):
        if self.path_only() != "/api/login":
            self.send_error(404)
            return
        ip = self.client_ip()
        if too_many(ip):
            self.send_bytes(429, "尝试次数太多，请稍后再试。".encode("utf-8"), "text/plain; charset=utf-8")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 1 or length > 4096:
            self.send_error(400)
            return
        raw = self.rfile.read(length).decode("utf-8", "replace")
        password = parse_qs(raw).get("password", [""])[0]
        if hmac.compare_digest(password, gallery_password()):
            self.redirect("/", make_token())
            return
        note_fail(ip)
        self.send_login(True)

    def send_store(self):
        if STORE.exists():
            body = STORE.read_bytes()
        else:
            body = json.dumps(EMPTY).encode("utf-8")
        self.send_bytes(200, body, "application/json; charset=utf-8")


if __name__ == "__main__":
    gallery_password()
    session_secret()
    ThreadingHTTPServer(("0.0.0.0", 5173), Handler).serve_forever()
