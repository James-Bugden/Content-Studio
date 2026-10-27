"""Private Vercel Python function. No credentials or request copy are logged."""
import base64
import contextlib
import hmac
import io
import json
import os
import re
import sys
import tempfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'image-renderer'))
import make

MAX_BODY = 64 * 1024


def invalid_label(error, brief=None):
    # The tool's full errors may quote private copy or filesystem paths. Return
    # only a recognised field path or an index into the resolved layout.
    text = str(error)
    match = re.match(r'((?:(?:[ENX]\d\d|NEW-0[1-5])\.)?(?:brief|fields|title|alt_text|example_label|language|platform|format)(?:[.\[][A-Za-z0-9_]+\]?)*)(?=:)', text)
    if match:
        return match.group(1)[:120]
    def labels(value, path):
        if isinstance(value, str):
            yield path, value
        elif isinstance(value, list):
            for i, entry in enumerate(value):
                yield from labels(entry, f'{path}[{i}]')
        elif isinstance(value, dict):
            for key, entry in value.items():
                if re.fullmatch(r'[A-Za-z0-9_]+', key):
                    yield from labels(entry, f'{path}.{key}' if path else key)
    for path, value in labels(brief or {}, ''):
        if path in ('format', 'platform', 'language'):
            continue
        if value and (value in text or any(len(word) > 40 and word in text for word in value.split())):
            return path[:120]
        if 'Unsupported font glyphs' in text and any(char in text for char in value if ord(char) > 127):
            return path[:120]
    match = re.search(r'(?:layout|text)\[?(\d+)\]?', text, re.I)
    return 'layout label ' + match.group(1) if match else 'brief label'


def handle(payload, supplied_secret):
    secret = os.environ.get('IMAGE_RENDERER_SECRET')
    if not secret or not hmac.compare_digest(supplied_secret or '', secret):
        return 403, {'error': 'Forbidden'}
    if not isinstance(payload, dict) or set(payload) != {'brief'}:
        return 422, {'label': 'brief'}
    try:
        # Uses the original make.produce, formats validation, fonts and renderer.
        # Only the system temporary directory is writable on Vercel.
        with tempfile.TemporaryDirectory(prefix='cs-image-') as out:
            with contextlib.redirect_stdout(io.StringIO()):
                path, sidecar = make.produce(payload['brief'], out)
            png = path.read_bytes()
        if len(png) > 3_000_000:
            return 422, {'label': 'brief'}
        return 200, {'png': base64.b64encode(png).decode('ascii'), 'sidecar': sidecar}
    except (ValueError, AssertionError, OSError, KeyError, TypeError) as error:
        return 422, {'label': invalid_label(error, payload['brief'])}


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        secret = os.environ.get('IMAGE_RENDERER_SECRET')
        supplied = self.headers.get('X-Image-Renderer-Secret', '')
        if not secret or not hmac.compare_digest(supplied, secret):
            return self.respond(403, {'error': 'Forbidden'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                return self.respond(413, {'error': 'Request too large'})
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return self.respond(400, {'error': 'Invalid JSON'})
        status, body = handle(payload, supplied)
        self.respond(status, body)

    def respond(self, status, body):
        data = json.dumps(body, ensure_ascii=True).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
