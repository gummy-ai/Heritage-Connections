"""Serve only public website files, never .env, source workbooks, or private API state."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = {"index.html", "styles.css", "app.js"}
PUBLIC_PREFIXES = ("assets/", "image_matching/public/")
PUBLIC_TYPES = {".html", ".css", ".js", ".json", ".jpg", ".jpeg", ".webp", ".png", ".svg", ".pdf", ".mp4", ".webm"}


class PublicHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        route = unquote(urlsplit(self.path).path).lstrip("/")
        if route.startswith("temp-website/"):
            route = route[len("temp-website/"):]
        if not route:
            route = "index.html"
        path = (ROOT / route).resolve()
        allowed = route in PUBLIC_FILES or route.startswith(PUBLIC_PREFIXES)
        if not path.is_relative_to(ROOT) or not allowed or path.suffix not in PUBLIC_TYPES or not path.is_file():
            self.send_error(404)
            return None
        self.path = "/" + route
        return super().send_head()

    def log_message(self, format, *args):
        pass  # Do not log request URLs or query strings.


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), PublicHandler)
    print(f"Local preview: http://localhost:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
