"""One-command, checked local PNG production. Python + Pillow + fontTools only."""
import argparse
import hashlib
import io
import json
import re
import sys
import time
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image
import render
from formats import resolved_spec

ROOT=Path(__file__).resolve().parent
TOOL='SOAR-clean-editorial-v2.4.1'

def load_json(path):
    try:return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError,ValueError) as error:raise ValueError(f'{path}: {error}') from error

def slug(title):
    ascii_title=unicodedata.normalize('NFKD',title).encode('ascii','ignore').decode()
    return re.sub(r'[^a-z0-9]+','-',ascii_title.lower()).strip('-')[:80].rstrip('-') or 'diagram'

def produce(brief,out=None):
    start=time.perf_counter()
    presets=load_json(ROOT/'presets.json')
    spec=resolved_spec(brief,presets)
    out=Path(out or ROOT/'generated').resolve()
    if not (out.is_relative_to(ROOT) or out.is_relative_to(Path(tempfile.gettempdir()).resolve())):raise ValueError('--out must stay inside the tool or temporary directory')
    for weight in ('title','body','medium'):
        print('Font:',weight,render.font(40,weight).getname())
    # Explicit preflight remains active even under python -O.
    for item in spec['layout']:
        if item['kind']=='text' and item['size']<40:raise ValueError('Body text below 40 px')
    stream=io.BytesIO()
    render.render(spec,stream)  # All glyph, container, stroke, crowding and margin checks.
    data=stream.getvalue()
    with Image.open(io.BytesIO(data)) as image:
        expected=(spec['canvas']['width'],spec['canvas']['height'])
        if image.size!=expected or image.mode!='RGB' or image.format!='PNG':
            raise ValueError(f'Expected RGB PNG {expected}, got {image.mode} {image.size}')
    filename=f"{brief['format']}-{slug(brief['title'])}"
    path=out/(filename+'.png')
    originals={ROOT/'png'/f"{s['id']}-{s['slug']}.png" for s in render.load_catalogue()[:32]}
    if path in originals:raise ValueError('Refusing to overwrite an original PNG: '+str(path))
    metadata={
        'format':brief['format'],'resolved_copy':brief,'resolved_layout':spec,
        'checks_passed':{'fonts_loaded':True,'supported_glyphs':True,'safe_margin_px':spec['canvas']['safe_margin'],
                        'glyph_stroke_clearance_px':20,'text_clearance_px':20,'min_body_text_px':40,
                        'container_padding_px':24,'size':list(expected),'mode':'RGB','format':'PNG'},
        'sha256':hashlib.sha256(data).hexdigest(),'render_seconds':round(time.perf_counter()-start,4),
        'render_time':datetime.now(timezone.utc).isoformat(),
        'tool_version':f"{TOOL} / {brief['format']} / r01 / {brief['platform']} / en",
        'png':path.name,'visual_review':'not automated'
    }
    out.mkdir(parents=True,exist_ok=True)
    # No output is written until the complete render has passed.
    path.write_bytes(data)
    path.with_suffix('.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    entry={key:metadata[key] for key in ('format','sha256','render_time','render_seconds','tool_version','png')}
    with (out/'manifest.jsonl').open('a',encoding='utf-8') as file:file.write(json.dumps(entry,ensure_ascii=False)+'\n')
    print('PASS',path)
    return path,metadata

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--spec',type=Path);group.add_argument('--batch',type=Path)
    parser.add_argument('--out',type=Path)
    args=parser.parse_args(argv)
    paths=[args.spec] if args.spec else sorted(args.batch.glob('*.json'))
    if not paths:parser.error('--batch: no .json briefs found')
    failed=0
    for path in paths:
        try:produce(load_json(path),args.out)
        except (ValueError,AssertionError,OSError,KeyError,TypeError) as error:
            print(f'FAIL {path}: {error}',file=sys.stderr);failed+=1
    return 1 if failed else 0

if __name__=='__main__':raise SystemExit(main())
