"""Deterministic editorial helper. Reads the routing gate and topic tables."""
import argparse
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parent
SHAPES={
 'compare':['comparison','myth vs fact','compare','offers'],
 'revision':['revision','before','after','weak','strong'],
 'order':['short order','order','steps','referral','prerequisites'],
 'time':['time','milestones','phased','week'],
 'decision':['decision','conditional','must-haves'],
 'causes':['causes','cause','why','diagnosis'],
 'scope':['scope','ownership'], 'overlap':['overlap','intersection'],
 'evidence':['evidence','proof','correspondence','support'],
 'loop':['loop','repeating','feedback','cycle'],
 'authority':['roles and authority','who does what','decisions','who checks'],
 'quantity':['number','statistic','measured','data','loss'],
 'waiting':['waiting','work vs waiting','takes long']}
ALIASES={'decision swimlane':'NEW-01','human-ai verification swimlane':'NEW-02',
         'wait/work strip':'NEW-03','contextual data chart':'NEW-04','stage-conversion bars':'NEW-05',
         'stage-conversion':'NEW-05'}
STOP=set('a an the to of in on and or for with how is are me my your you from one vs what do does more than into'.split())
SHAPE_TERMS={
 'compare':['side-by-side','comparison'], 'revision':['before/after','revision'],
 'order':['short sequence','ordered steps'], 'time':['timeline','milestones'],
 'decision':['branching decision'], 'causes':['fishbone','possible causes'],
 'scope':['ownership ladder','ordered scope'], 'overlap':['overlap','intersection'],
 'evidence':['evidence layers','evidence tree','coverage grid'],
 'loop':['feedback loop'], 'authority':['roles and authority','who does what'],
 'quantity':['number against a base','measured stage loss'], 'waiting':['work vs waiting']}

def tokens(text):
    # Small explicit vocabulary normalisation, no fuzzy model or network.
    words=re.findall(r'[a-z0-9]+',text.lower())
    synonyms={'compared':'compare','comparing':'compare','compares':'compare','referrals':'referral',
              'resumes':'resume','applications':'application','replies':'reply','users':'user',
              'steps':'step','offers':'offer','decisions':'decision','hiring':'hire',
              'drop':'loss','off':'loss','loses':'loss','recruiting':'hire'}
    return {synonyms.get(w,w) for w in words if w not in STOP}

def format_id(text):
    # Prose such as 'Text only, or N01' must not become a primary diagram.
    if re.match(r'\s*(Text only|Numbered text|Current real screenshot|Reconstructed)',text,re.I):return None
    for term,id in ALIASES.items():
        if term in text.lower():return id
    match=re.search(r'\b(?:E\d{2}|N\d{2}|X\d{2}|NEW-0[1-5])\b',text)
    return match.group() if match else None

def has_phrase(text,phrase):
    return re.search(r'\b'+re.escape(phrase)+r'\b',text,re.I) is not None

def read_map(path=ROOT/'FORMAT-TOPIC-MAP-v2.md'):
    text=path.read_text(encoding='utf-8')
    gate=text.split('## 1. Routing gate',1)[1].split('## 2.',1)[0].strip()
    rows=[];section=None
    for line in text.splitlines():
        if line.startswith('### 2a.'):section='2a'
        elif line.startswith('### 2b.'):section='2b'
        elif line.startswith('## 3.'):section=None
        if section and line.startswith('|'):
            cells=[c.strip().replace('**','') for c in line.strip('|').split('|')]
            if not cells or cells[0] in ('#','Real topic') or set(cells[0])<=set('-:'):continue
            if section=='2a' and len(cells)==6:rows.append(dict(topic=cells[1],shape=cells[2],primary=cells[3],runner=cells[4]))
            elif section=='2b' and len(cells)==5:rows.append(dict(topic=cells[0],shape=cells[2],primary=cells[3],runner=''))
    # Read the catalogue shape table as well. This makes --shape useful even
    # when no core topic has that shape (for example overlap).
    section4=text.split('## 4. The 32 formats',1)[1].split('## 5.',1)[0]
    shapes=[]
    for line in section4.splitlines():
        if line.startswith('|'):
            cells=[c.strip() for c in line.strip('|').split('|')]
            if len(cells)==5 and re.fullmatch(r'[ENX]\d{2}',cells[0]):
                shapes.append(dict(topic=cells[1],shape=' '.join(cells[1:]),primary=cells[0],runner='',catalogue=True))
    if len(rows)<60 or len(shapes)!=32 or not gate:raise ValueError('Map sections 1 / 2a / 2b / 4 are missing or malformed')
    rows.extend(shapes)
    return gate,rows

def recommend(topic,shape=None):
    gate,rows=read_map()
    query=tokens(topic);scores=[]
    for i,row in enumerate(rows):
        overlap=query & tokens(row['topic'])
        # A topic match needs more than a generic career word.
        distinctive=overlap-{'resume','job','career','role','hire','work','company','tool','user'}
        score=len(overlap)*3
        shape_match=shape and any(has_phrase(row['shape'],word) for word in SHAPES[shape])
        if shape and any(has_phrase(row['shape'],word) for word in SHAPE_TERMS[shape]):shape_match=True
        if row.get('catalogue'):
            # The catalogue is a fallback for an explicit shape, not a weak
            # keyword match allowed to outrank an exact topic in 2a or 2b.
            if not shape_match:continue
            score=-1
        if shape_match:score+=6
        if (len(overlap)>=2 and distinctive) or shape_match:
            scores.append((score,-i,row))
    if not scores:return None
    _,_,row=max(scores,key=lambda s:(s[0],s[1]))
    primary=format_id(row['primary']);runner=format_id(row['runner'])
    # Gate 2: preserve screenshot / reconstruction / wording routes from the map.
    if primary is None:return dict(primary=None,runner=runner,row=row,gate=gate)
    if runner is None:
        runner=next((format_id(other['primary']) for _,_,other in sorted(scores,key=lambda s:(-s[0],-s[1]))
                     if format_id(other['primary']) not in (None,primary)),None)
    return dict(primary=primary,runner=runner,row=row,gate=gate)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('topic')
    parser.add_argument('--shape',choices=SHAPES);args=parser.parse_args()
    result=recommend(args.topic,args.shape)
    if not result or not result['primary']:
        print('no good match: consider text only / screenshot / new layout')
        if result:print('Map route:',result['row']['primary'])
        return
    print('Primary:',result['primary']);print('Runner-up:',result['runner'] or 'none in map')
    print('Matched:',result['row']['topic'],'|',result['row']['shape'])
    print('Routing gate: one lesson; label examples and reconstructions; check charts against actual data with cohort, date and denominator; check at phone width')
    if result['primary'] in ('NEW-04','NEW-05'):print('Data gate: use this chart only after checking the data. Otherwise use text or investigate with X15.')

if __name__=='__main__':main()
