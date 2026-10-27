import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import threading
import unittest
from http.server import HTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from PIL import Image

spec = importlib.util.spec_from_file_location('image_function', Path(__file__).resolve().parents[2] / 'api/render-image.py')
function = importlib.util.module_from_spec(spec)
spec.loader.exec_module(function)
BRIEF = dict(format='E03', title='Make the task clear', fields=dict(steps=['Name the task', 'Show the evidence', 'Choose the next step']),
             alt_text='Three steps connect a task to evidence and a next step.', platform='linkedin', language='en')


class RenderTests(unittest.TestCase):
    def test_fails_closed_and_does_not_call_tool(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(function.make, 'produce') as produce:
            self.assertEqual(function.handle({'brief': BRIEF}, 'synthetic-secret')[0], 403)
            produce.assert_not_called()
        with patch.dict(os.environ, {'IMAGE_RENDERER_SECRET': 'synthetic-secret'}):
            self.assertEqual(function.handle({'brief': BRIEF}, 'wrong')[0], 403)

    def test_original_renderer_png_sidecar_and_temporary_cleanup(self):
        with patch.dict(os.environ, {'IMAGE_RENDERER_SECRET': 'synthetic-secret'}):
            status, body = function.handle({'brief': BRIEF}, 'synthetic-secret')
        self.assertEqual(status, 200, body)
        data = base64.b64decode(body['png'])
        self.assertEqual(hashlib.sha256(data).hexdigest(), body['sidecar']['sha256'])
        with Image.open(io.BytesIO(data)) as image:
            self.assertEqual((image.size, image.mode, image.format), ((1080, 1350), 'RGB', 'PNG'))
        self.assertEqual(body['sidecar']['resolved_copy'], BRIEF)
        self.assertFalse((function.make.ROOT / 'generated').exists())

    def test_strict_schema_invalid_language_extra_fields_and_copy_errors(self):
        cases = [dict(BRIEF, language='zh-TW'), dict(BRIEF, fields={'steps': ['Only one']}), dict(BRIEF, surprise='x'),
                 dict(BRIEF, fields={'steps': ['x' * 600, 'End']}), dict(BRIEF, title='Unsupported \u4e2d\u6587')]
        with patch.dict(os.environ, {'IMAGE_RENDERER_SECRET': 'synthetic-secret'}):
            for brief in cases:
                status, body = function.handle({'brief': brief}, 'synthetic-secret')
                self.assertEqual(status, 422, brief)
                self.assertIn('label', body)
                self.assertNotIn('x' * 100, json.dumps(body))
            self.assertEqual(function.handle({'brief': dict(BRIEF, fields={'steps': ['x' * 600, 'End']})}, 'synthetic-secret')[1]['label'], 'fields.steps[0]')
            self.assertEqual(function.handle({'brief': dict(BRIEF, title='Unsupported \u4e2d\u6587')}, 'synthetic-secret')[1]['label'], 'title')

    def test_real_handler_auth_size_and_malformed_json(self):
        with patch.dict(os.environ, {'IMAGE_RENDERER_SECRET': 'synthetic-secret'}):
            server = HTTPServer(('127.0.0.1', 0), function.handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for data, secret, expected in [(b'', 'wrong', 403), (b'{', 'synthetic-secret', 400), (b'', 'synthetic-secret', 413)]:
                    req = Request(f'http://127.0.0.1:{server.server_port}', data=data, headers={'X-Image-Renderer-Secret': secret, **({'Content-Length': str(function.MAX_BODY + 1)} if expected == 413 else {})})
                    with self.assertRaises(HTTPError) as error:
                        urlopen(req, timeout=5)
                    self.assertEqual(error.exception.code, expected)
                    self.assertIn('no-store', error.exception.headers['Cache-Control'])
                    error.exception.close()
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
