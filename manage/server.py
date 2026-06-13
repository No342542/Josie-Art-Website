#!/usr/bin/env python3
"""
Manage tool for THIS gallery site (bundled inside the site, so the whole thing
travels as a single git clone).

Run it with the "Manage …" launcher in the folder above, or:
    python3 manage/server.py --port 8090

It runs only on your own computer (127.0.0.1) — nothing is exposed to the network.
It serves a visual admin page where you add/remove/reorder photos, edit text,
manage a 30-day trash, and Publish (git push) to your live site.
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

HERE = os.path.dirname(os.path.abspath(__file__))   # .../<site>/manage
SITE_DIR = os.path.dirname(HERE)                     # .../<site>   (the repo root)
UI_DIR = os.path.join(HERE, "ui")
DATA_PATH = os.path.join(SITE_DIR, "assets", "js", "data.js")
ART_DIR = os.path.join(SITE_DIR, "assets", "img", "artwork")
RELATED_DIR = os.path.join(SITE_DIR, "assets", "img", "related")
VIDEO_DIR = os.path.join(SITE_DIR, "assets", "video")
TRASH_DIR = os.path.join(SITE_DIR, "assets", "_trash")
TRASH_DAYS = 30

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".mp4": "video/mp4", ".webm": "video/webm", ".ico": "image/x-icon",
}
WEB_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif")
CONVERT_EXTS = (".tif", ".tiff", ".heic", ".heif", ".bmp")   # converted to JPEG via macOS `sips`
IMAGE_EXTS = WEB_EXTS + CONVERT_EXTS
VIDEO_EXTS = (".mp4", ".webm", ".mov")


# ---------- data.js read / write ----------
def _extract(text, marker, open_c, close_c):
    i = text.index(marker) + len(marker)
    while text[i] != open_c:
        i += 1
    start, depth, in_str, esc = i, 0, False, False
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == open_c:
                depth += 1
            elif ch == close_c:
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        i += 1
    raise ValueError("Unbalanced " + open_c + close_c + " in data.js")


def read_data():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        txt = f.read()
    return (json.loads(_extract(txt, "window.SITE", "{", "}")),
            json.loads(_extract(txt, "window.ARTWORKS", "[", "]")))


def write_data(site, artworks):
    name = site.get("name", "")
    header = (
        "/* ==========================================================================\n"
        "   " + name + " - GALLERY CONTENT.  Managed by the \"Manage " + name + "\" tool.\n"
        "   You can hand-edit it too: keep it valid JSON inside the { } and [ ].\n"
        "   ========================================================================== */\n"
    )
    rows = ",\n".join("  " + json.dumps(a, ensure_ascii=False) for a in artworks)
    out = (header +
           "window.SITE = " + json.dumps(site, ensure_ascii=False, indent=2) + ";\n\n" +
           "window.ARTWORKS = [\n" + rows + "\n];\n")
    tmp = DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(out)
    os.replace(tmp, DATA_PATH)


def site_name():
    try:
        return read_data()[0].get("name", "Gallery")
    except Exception:
        return "Gallery"


# ---------- helpers ----------
def safe_name(name):
    name = os.path.basename(name).strip().lower()
    return re.sub(r"[^a-z0-9._-]+", "-", name).strip("-.") or "file"


def unique_path(folder, filename):
    base, ext = os.path.splitext(filename)
    candidate, n = filename, 1
    while os.path.exists(os.path.join(folder, candidate)):
        candidate = "{}-{}{}".format(base, n, ext)
        n += 1
    return candidate


def within(child, parent):
    child, parent = os.path.realpath(child), os.path.realpath(parent)
    return child == parent or child.startswith(parent + os.sep)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def save_image(blob, fname, folder, url_prefix):
    """Save an uploaded image. Web formats are kept as-is; camera/scan formats
    (TIFF, HEIC, BMP) are converted to JPEG with macOS `sips` so they display on
    the web. Returns (url_path, error)."""
    ext = os.path.splitext(fname)[1].lower()
    os.makedirs(folder, exist_ok=True)
    if ext in CONVERT_EXTS:
        tmp = os.path.join(folder, unique_path(folder, "_src_" + fname))
        with open(tmp, "wb") as f:
            f.write(blob)
        out_name = unique_path(folder, os.path.splitext(os.path.basename(fname))[0] + ".jpg")
        out = os.path.join(folder, out_name)
        try:
            r = subprocess.run(["sips", "-s", "format", "jpeg", tmp, "--out", out],
                               capture_output=True, text=True, timeout=180)
        except FileNotFoundError:
            r = None
        try:
            os.remove(tmp)
        except OSError:
            pass
        if r is None:
            return None, "Couldn't convert this image (the Mac 'sips' tool wasn't found). Please export it as JPG or PNG."
        if r.returncode != 0 or not os.path.isfile(out):
            return None, "Couldn't convert this image. Please export it as JPG or PNG and try again."
        return url_prefix + out_name, None
    fname = unique_path(folder, fname)
    with open(os.path.join(folder, fname), "wb") as f:
        f.write(blob)
    return url_prefix + fname, None


# ---------- trash ----------
def load_trash():
    p = os.path.join(TRASH_DIR, "trash.json")
    if os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_trash(records):
    os.makedirs(TRASH_DIR, exist_ok=True)
    p = os.path.join(TRASH_DIR, "trash.json")
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def purge_old():
    records = load_trash()
    now = datetime.now(timezone.utc)
    kept, changed = [], False
    for r in records:
        try:
            dt = datetime.fromisoformat(r.get("deletedAt"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            dt = now
        if (now - dt).days < TRASH_DAYS:
            kept.append(r)
        else:
            changed = True
            for b in (r.get("imageTrash"), r.get("videoTrash")):
                if b:
                    fp = os.path.join(TRASH_DIR, b)
                    if os.path.isfile(fp):
                        os.remove(fp)
    if changed:
        save_trash(kept)
    return kept


def days_left(deleted_at):
    try:
        dt = datetime.fromisoformat(deleted_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return TRASH_DAYS
    return max(0, TRASH_DAYS - (datetime.now(timezone.utc) - dt).days)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    def _read_json(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def _serve_file(self, abspath):
        if not os.path.isfile(abspath):
            return self._send(404, "Not found")
        ext = os.path.splitext(abspath)[1].lower()
        with open(abspath, "rb") as f:
            self._send(200, f.read(), CONTENT_TYPES.get(ext, "application/octet-stream"))

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/data":
            try:
                site, art = read_data()
                return self._json(200, {"site": site, "artworks": art})
            except Exception as e:
                return self._json(500, {"error": str(e)})
        if path == "/api/trash":
            recs = purge_old()
            items = [{
                "art": r["art"], "deletedAt": r["deletedAt"],
                "daysLeft": days_left(r["deletedAt"]),
                "thumb": ("/assets/_trash/" + r["imageTrash"]) if r.get("imageTrash") else None,
            } for r in recs]
            return self._json(200, {"items": items, "count": len(items)})
        if path in ("/admin", "/admin/"):
            return self._serve_file(os.path.join(UI_DIR, "index.html"))
        if path.startswith("/admin/"):
            target = os.path.join(UI_DIR, path[len("/admin/"):])
            return self._serve_file(target) if within(target, UI_DIR) else self._send(403, "Forbidden")
        if path == "/":
            path = "/index.html"
        target = os.path.join(SITE_DIR, path.lstrip("/"))
        return self._serve_file(target) if within(target, SITE_DIR) else self._send(403, "Forbidden")

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/save":
                return self._save()
            if path == "/api/upload":
                return self._upload()
            if path == "/api/trash":
                return self._trash()
            if path == "/api/restore":
                return self._restore()
            if path == "/api/purge":
                return self._purge()
            if path == "/api/publish":
                return self._publish()
        except Exception as e:
            return self._json(500, {"error": str(e)})
        return self._send(404, "Not found")

    def _save(self):
        p = self._read_json()
        site, art = p.get("site"), p.get("artworks")
        if not isinstance(site, dict) or not isinstance(art, list):
            return self._json(400, {"error": "bad payload"})
        write_data(site, art)
        return self._json(200, {"ok": True, "count": len(art)})

    def _upload(self):
        p = self._read_json()
        kind = p.get("kind", "image")
        raw = p.get("dataBase64", "")
        if raw.strip().startswith("data:") and "," in raw:
            raw = raw.split(",", 1)[1]
        blob = base64.b64decode(raw)
        fname = safe_name(p.get("filename", "upload"))
        ext = os.path.splitext(fname)[1].lower()
        if kind == "video":
            if ext not in VIDEO_EXTS:
                return self._json(400, {"error": "Please choose an .mp4 video"})
            os.makedirs(VIDEO_DIR, exist_ok=True)
            fname = unique_path(VIDEO_DIR, fname)
            with open(os.path.join(VIDEO_DIR, fname), "wb") as f:
                f.write(blob)
            return self._json(200, {"path": "assets/video/" + fname})
        if ext not in IMAGE_EXTS:
            return self._json(400, {"error": "Please choose an image (JPG, PNG, HEIC, TIFF, GIF or WebP)."})
        if kind == "related":
            path, err = save_image(blob, fname, RELATED_DIR, "assets/img/related/")
            return self._json(400, {"error": err}) if err else self._json(200, {"path": path})
        path, err = save_image(blob, fname, ART_DIR, "assets/img/artwork/")
        if err:
            return self._json(400, {"error": err})
        return self._json(200, {"path": path, "id": os.path.splitext(os.path.basename(path))[0]})

    def _move_to_trash(self, rel):
        rel = (rel or "").lstrip("/")
        if not rel:
            return None
        src = os.path.join(SITE_DIR, rel)
        if (within(src, ART_DIR) or within(src, VIDEO_DIR)) and os.path.isfile(src):
            os.makedirs(TRASH_DIR, exist_ok=True)
            base = unique_path(TRASH_DIR, os.path.basename(src))
            shutil.move(src, os.path.join(TRASH_DIR, base))
            return base
        return None

    def _trash(self):
        art = self._read_json().get("art")
        if not isinstance(art, dict):
            return self._json(400, {"error": "bad payload"})
        rec = {"art": art, "imageTrash": self._move_to_trash(art.get("image")),
               "videoTrash": self._move_to_trash(art.get("video")), "deletedAt": now_iso()}
        recs = purge_old()
        recs.insert(0, rec)
        save_trash(recs)
        return self._json(200, {"ok": True, "count": len(recs)})

    def _restore_file(self, trash_base, orig_rel, folder, url_prefix):
        src = os.path.join(TRASH_DIR, trash_base)
        orig_rel = orig_rel.lstrip("/")
        dest = os.path.join(SITE_DIR, orig_rel)
        if os.path.exists(dest):
            nb = unique_path(folder, os.path.basename(orig_rel))
            dest = os.path.join(folder, nb)
            orig_rel = url_prefix + nb
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.isfile(src):
            shutil.move(src, dest)
        return orig_rel

    def _restore(self):
        wid = self._read_json().get("id")
        recs = purge_old()
        rec = next((r for r in recs if r["art"].get("id") == wid), None)
        if not rec:
            return self._json(404, {"error": "not in trash"})
        art = rec["art"]
        if rec.get("imageTrash") and art.get("image"):
            art["image"] = self._restore_file(rec["imageTrash"], art["image"], ART_DIR, "assets/img/artwork/")
        if rec.get("videoTrash") and art.get("video"):
            art["video"] = self._restore_file(rec["videoTrash"], art["video"], VIDEO_DIR, "assets/video/")
        recs = [r for r in recs if r is not rec]
        save_trash(recs)
        return self._json(200, {"art": art, "count": len(recs)})

    def _purge(self):
        wid = self._read_json().get("id")
        recs = purge_old()
        keep = []
        for r in recs:
            if r["art"].get("id") == wid:
                for b in (r.get("imageTrash"), r.get("videoTrash")):
                    if b:
                        fp = os.path.join(TRASH_DIR, b)
                        if os.path.isfile(fp):
                            os.remove(fp)
            else:
                keep.append(r)
        save_trash(keep)
        return self._json(200, {"ok": True, "count": len(keep)})

    def _git(self, args):
        p = subprocess.run(["git"] + args, cwd=SITE_DIR, capture_output=True, text=True, timeout=180)
        return p.returncode, p.stdout.strip(), p.stderr.strip()

    def _publish(self):
        code, top, _ = self._git(["rev-parse", "--show-toplevel"])
        if code != 0:
            return self._json(200, {"ok": False, "needsSetup": True,
                "message": "This site isn't connected to GitHub yet. See the Publish section of the "
                           "README to set it up once (it takes a few minutes)."})
        rc, remotes, _ = self._git(["remote"])
        if rc != 0 or not remotes:
            return self._json(200, {"ok": False, "needsSetup": True,
                "message": "No GitHub remote is set for this site yet. See the Publish section of the README."})
        self._git(["add", "-A"])
        rc, status, _ = self._git(["status", "--porcelain"])
        if status:
            self._git(["commit", "-m", "Update " + site_name() + " gallery (Manage tool)"])
        _, branch, _ = self._git(["rev-parse", "--abbrev-ref", "HEAD"])
        br = branch or "main"
        code, out, err = self._git(["push"])
        if code != 0:
            # Push refused — almost always a "non-fast-forward": the live site moved
            # ahead (a code update landed, or another device published) so this branch
            # is behind. Auto-integrate the remote, keeping THIS device's content on any
            # overlap (you own your gallery's content), then retry — so Publish heals
            # itself instead of dead-ending. A genuine auth/network failure still falls
            # through to the message below.
            f, _, _ = self._git(["fetch", "origin", br])
            if f == 0:
                self._git(["merge", "-X", "ours", "--no-edit", "origin/" + br])
                code, out, err = self._git(["push"])
                if code != 0:
                    code, out, err = self._git(["push", "-u", "origin", br])
        if code != 0:
            return self._json(200, {"ok": False, "needsAuth": True,
                "message": "Couldn't reach GitHub — you may need to sign in on this Mac once "
                           "(see the README). If an update just landed, close this window, reopen "
                           "Manage, and Publish again. Details:\n\n" + (err or out)})
        return self._json(200, {"ok": True, "message": "Published! Your live site updates in about a minute."})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()
    if not os.path.isfile(DATA_PATH):
        sys.exit("Can't find the site content at " + DATA_PATH)
    purge_old()
    # Bind the port, retrying briefly in case a just-stopped previous copy is still
    # releasing it — so re-launching never fails with "address already in use".
    httpd = None
    for _ in range(12):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
            break
        except OSError:
            time.sleep(0.5)
    if httpd is None:
        sys.exit("Port {} is still busy. Close the other 'Manage' window using it and try again."
                 .format(args.port))
    base = "http://127.0.0.1:{}/".format(args.port)
    print("\n  Manage {}".format(site_name()))
    print("    Website : {}".format(base))
    print("    Editor  : {}admin/".format(base))
    print("  Keep this window open while you work. Press Ctrl+C (or close it) when done.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
