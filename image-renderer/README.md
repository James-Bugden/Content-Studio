# SOAR editorial renderer

Provenance: owner's SOAR clean editorial diagrams tool, 2026-10-18,
SOAR-clean-editorial-v2.4.1. Copied with permission for #243. Code, authored
layout catalogue (`specs.json`), presets and three OFL fonts only. No sample
briefs, generated images or private posts are bundled. AUTOMATION.md documents
the strict brief schema. `specs.json` is required by `render.load_catalogue()`.

The original Python renderer is retained. The sole change to `make.py` allows
an explicit output directory below Python's system temporary directory, in
addition to its original local-tool directory. The function calls `make.produce`
in-process and removes its temporary PNG, sidecar and manifest after reading.
It does not invoke a subprocess or write into the deployed bundle.

Install `python -m pip install -r requirements.txt` from the repository root.
Run `python -m unittest discover -s tests/python -v`. CI currently has no
configured Python toolchain; run this command separately when changing Python.

Server configuration: IMAGE_RENDERER_SECRET must be set on both runtimes;
unset fails closed. The Next adapter derives the same-origin function URL
from APP_BASE_URL. No secret is exposed in client props, health or logging.
Do not send the secret to a browser. No CORS access is enabled.

Vercel's Python runtime supports BaseHTTPRequestHandler and functions config:
https://vercel.com/docs/functions/runtimes/python
https://vercel.com/docs/functions/configuring-functions/duration
Local Python tests verify the handler. A local Next build cannot prove Vercel's
mixed Python/Next routing, includeFiles packaging or deployment protection.
Verify `/api/render-image` on a synthetic preview before enabling live rendering.
