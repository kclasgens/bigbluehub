"""Local server for Big Blue Hub: python3 serve.py, then open http://localhost:5173

Same as `python3 -m http.server`, but tells browsers to re-check files on every load
so an edited app.js / styles.css shows up without clearing Safari's cache.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'Big Blue Hub running at http://localhost:{PORT}')
    http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler).serve_forever()
