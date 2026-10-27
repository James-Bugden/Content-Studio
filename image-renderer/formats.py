"""Strict copy schemas and bindings to the 37 authored layouts. No network."""
import copy
import math
import re
import render as r

S = 'text'
NUM = 'number'
def array(schema, n, maximum=None):
    return ('array',schema,n,n if maximum is None else maximum)

# Exact counts are deliberate: these are small editorial diagrams, not tables
# of arbitrary length. E03 alone has a variable-size authored layout.
SCHEMAS = {
 'E01': {'options':array(S,2),'rows':array({'dimension':S,'left':S,'right':S},3)},
 'E02': {'before':S,'after':S},
 'E03': {'steps':array(S,2,4)},
 'E04': {'question':S,'yes_label':S,'no_label':S,'yes_action':S,'no_action':S,'caveat':S},
 'E05': {'parts':array(S,3),'callouts':array(S,3)},
 'E06': {'sources':array(S,3),'result':S},
 'E07': {'rows':array({'label':S,'prompt':S},3)},
 'E08': {'profile':S,'control':S,'annotation':S,'visibility_label':S,'setting':S,'caveat':S},
 'E09': {'proof_heading':S,'rows':array({'need':S,'proof':S},3)},
 'E10': {'asker':S,'question':S,'speaker':S,'answer':S},
 'N01': {'caveat':S,'x_axis':S,'y_axis':S,'cells':array(S,4)},
 'N02': {'low':S,'high':S,'positions':array(S,3)},
 'N03': {'caveat':S,'stages':array(S,3)},
 'N04': {'steps':array(S,3),'repeat':S},
 'N05': {'milestones':array({'day':S,'task':S},4)},
 'N06': {'levels':array(S,4),'caveat':S},
 'N07': {'stated':S,'ask_heading':S,'questions':S},
 'N08': {'sets':array(S,3),'overlap':S},
 'N09': {'layers':array({'label':S,'copy':S},3)},
 'N10': {'claim':S,'proofs':array(S,3)},
 'X02': {'headings':array(S,3),'rows':array({'need':S,'status':S,'next':S},3)},
 'X03': {'need':S,'weak_proof':S,'problem':S,'repair':S},
 'X04': {'inputs':array(S,3),'result':S},
 'X05': {'start':S,'routes':array(S,3),'goal':S},
 'X06': {'goal':S,'proof':S,'task':S,'start_label':S,'direction_label':S},
 'X08': {'broad':S,'context':S,'specific':S},
 'X10': {'caveat':S,'causes':array({'label':S,'question':S},4),'effect':S},
 'X11': {'centre':S,'people':array(S,4)},
 'X12': {'cells':array({'label':S,'copy':S},4)},
 'X14': {'rows':array({'action':S,'copy':S},3)},
 'X15': {'stages':array({'label':S,'copy':S},3)},
 'X16': {'goal':S,'pillars':array(S,3),'foundation':S},
 'NEW-01': {'lanes':array({'role':S,'step':S},4)},
 'NEW-02': {'person':S,'ai':S,'supply':S,'approve':S,'check':S,'draft':S,'revision_label':S},
 'NEW-03': {'steps':array({'kind':S,'label':S},6)},
 'NEW-04': {'measure':S,'groups':array({'label':S,'count':NUM},2),'base_count':NUM,'unit':S},
 'NEW-05': {'cohort':S,'window':S,'base_count':NUM,'stages':array({'label':S,'count':NUM},4)}
}
EXAMPLE = set('E01 E02 E05 E08 E09 E10 N02 N07 N09 N10 X02 X03 X05 X08 X12 X15 NEW-01 NEW-02 NEW-03 NEW-04 NEW-05'.split())
ROOT_REQUIRED={'format','title','fields','alt_text','platform','language'}

def validate(value,schema,path):
    if isinstance(schema,dict):
        if not isinstance(value,dict): raise ValueError(f'{path}: expected an object')
        missing=set(schema)-set(value); extra=set(value)-set(schema)
        if missing or extra:
            bits=[]
            if missing: bits.append('missing field(s): '+', '.join(sorted(missing)))
            if extra: bits.append('extra field(s): '+', '.join(sorted(extra)))
            raise ValueError(path+': '+'; '.join(bits))
        for k,s in schema.items(): validate(value[k],s,path+'.'+k)
    elif isinstance(schema,tuple):
        _,sub,lo,hi=schema
        if not isinstance(value,list) or not lo<=len(value)<=hi:
            raise ValueError(f'{path}: expected {lo}' + (f' to {hi}' if hi!=lo else '') + ' items')
        for i,item in enumerate(value):validate(item,sub,f'{path}[{i}]')
    elif schema==S:
        if not isinstance(value,str) or not value.strip():raise ValueError(f'{path}: expected non-empty text')
        if any(c in value for c in ['\u2014',';']): raise ValueError(f'{path}: no em dash or semicolon')
        if any(ord(c)<32 and c!='\n' for c in value):raise ValueError(f'{path}: unsupported control character')
    elif schema==NUM:
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
            raise ValueError(f'{path}: expected a finite non-negative number')

def validate_brief(brief,presets):
    if not isinstance(brief,dict):raise ValueError('brief: expected an object')
    missing=ROOT_REQUIRED-set(brief);extra=set(brief)-ROOT_REQUIRED-{'example_label'}
    if missing or extra:raise ValueError(f'brief: missing field(s): {", ".join(sorted(missing)) or "none"}; extra field(s): {", ".join(sorted(extra)) or "none"}')
    if not isinstance(brief['format'],str) or brief['format'] not in SCHEMAS:raise ValueError('format: expected one of '+', '.join(SCHEMAS))
    if brief['language']!='en':raise ValueError('language: only en is supported')
    if not isinstance(brief['platform'],str) or brief['platform'] not in presets:raise ValueError('platform: expected '+', '.join(presets))
    for key in ['title','alt_text']:validate(brief[key],S,key)
    if brief['title'].rstrip().endswith('.'):raise ValueError('title: remove terminal full stop')
    validate(brief['fields'],SCHEMAS[brief['format']],brief['format']+'.fields')
    if brief['format'] in EXAMPLE and 'example_label' not in brief:raise ValueError('example_label: required for '+brief['format'])
    if 'example_label' in brief:
        validate(brief['example_label'],S,'example_label')
        if brief['format'] in EXAMPLE and not re.search(r'\bexample\b|\bschematic\b',brief['example_label'],re.I):
            raise ValueError('example_label: must clearly say Example or Schematic')
        if brief['format'] not in EXAMPLE:raise ValueError('example_label: extra field for '+brief['format']+' (no caveat slot)')
    f=brief['fields'];id=brief['format']
    if id=='E04' and f['yes_action']==f['no_action']:raise ValueError('E04.fields: branches must lead to different actions')
    if id=='N05':
        # Fixed timeline has equal 2-day intervals. Keep real spacing honest.
        if [m['day'] for m in f['milestones']] not in [['Day -7','Day -5','Day -3','Day -1'],['Day \u22127','Day \u22125','Day \u22123','Day \u22121']]:
            raise ValueError('N05.fields.milestones.day: this layout requires Day -7, Day -5, Day -3, Day -1')
    if id=='NEW-03':
        if any(s['kind'] not in ('Work','Wait') for s in f['steps']):raise ValueError('NEW-03.fields.steps.kind: expected Work or Wait')
        if 'not to scale' not in brief['example_label'].lower():raise ValueError('example_label: NEW-03 requires Not to scale')
    if id in ('NEW-04','NEW-05'):
        base=f['base_count'];values=[g['count'] for g in f['groups' if id=='NEW-04' else 'stages']]
        if base<=0:raise ValueError(id+'.fields.base_count: must be greater than zero')
        if any(v>base for v in values):raise ValueError(id+'.fields: count exceeds base_count')
        if id=='NEW-05' and (values[0]!=base or any(a<b for a,b in zip(values,values[1:]))):
            raise ValueError('NEW-05.fields.stages: first count must equal base_count and later counts must not increase')
        if id=='NEW-04' and 'replace' not in brief['example_label'].lower():raise ValueError('example_label: NEW-04 requires a replace-with-sourced-data caveat')
    return brief

def resolved_spec(brief,presets):
    validate_brief(brief,presets)
    spec=copy.deepcopy(next(s for s in r.load_catalogue() if s['id']==brief['format']))
    # Resolve the authored geometry once. Changing copy must not change the
    # relative positions of circles, labels or connectors in the template.
    if not spec.get('fixed_geometry'):
        spec['layout']=r.fit_diagram_block(spec)
        spec['fixed_geometry']=True
    spec['title']=brief['title'];spec['title_layout']['text']=brief['title'];spec['alt_text']=brief['alt_text']
    spec['canvas'].update(presets[brief['platform']])
    f=brief['fields'];id=brief['format'];ex=brief.get('example_label')
    # Bind every body text slot. No sample copy is silently inherited.
    flat=lambda rows,keys:[row[k] for row in rows for k in keys]
    if id=='E01': values=[ex]+f['options']+flat(f['rows'],['dimension','left','right'])
    elif id=='E02': values=[ex,'Before',f['before'],'After',f['after']]
    elif id=='E03':spec['layout']=r.sequence_layout(f['steps']);spec['fixed_geometry']=True;values=f['steps']
    elif id=='E04':values=[f[k] for k in ['question','yes_label','no_label','yes_action','no_action','caveat']]
    elif id=='E05':values=[ex]+f['parts']+f['callouts']
    elif id=='E06':values=f['sources']+[f['result']]
    elif id=='E07':values=flat(f['rows'],['label','prompt'])
    elif id=='E08':values=[ex]+[f[k] for k in ['profile','control','annotation','visibility_label','setting','caveat']]
    elif id=='E09':values=[ex,f['proof_heading']]+flat(f['rows'],['need','proof'])
    elif id=='E10':values=[ex]+[f[k] for k in ['asker','question','speaker','answer']]
    elif id=='N01':values=[f['caveat'],f['x_axis'],f['y_axis']]+f['cells']
    elif id=='N02':values=[ex,f['low'],f['high']]+f['positions']
    elif id=='N03':values=[f['caveat']]+f['stages']
    elif id=='N04':values=f['steps']+[f['repeat']]
    elif id=='N05':values=flat(f['milestones'],['day','task'])
    elif id=='N06':values=f['levels']+[f['caveat']]
    elif id=='N07':values=[ex,f['stated'],f['ask_heading'],f['questions']]
    elif id=='N08':values=f['sets']+[f['overlap']]
    elif id=='N09':values=flat(f['layers'],['label','copy'])+[ex]
    elif id=='N10':values=[ex,f['claim']]+f['proofs']
    elif id=='X02':values=[ex]+f['headings']+flat(f['rows'],['need','status','next'])
    elif id=='X03':values=[ex]+[f[k] for k in ['need','weak_proof','problem','repair']]
    elif id=='X04':values=f['inputs']+[f['result']]
    elif id=='X05':values=[ex,f['start']]+f['routes']+[f['goal']]
    elif id=='X06':values=[f[k] for k in ['goal','proof','task','start_label','direction_label']]
    elif id=='X08':values=[ex,f['broad'],f['context'],f['specific']]
    elif id=='X10':values=[f['caveat']]+flat(f['causes'],['label','question'])+[f['effect']]
    elif id=='X11':values=[f['centre']]+f['people']
    elif id=='X12':values=[ex]+flat(f['cells'],['label','copy'])
    elif id=='X14':values=flat(f['rows'],['action','copy'])
    elif id=='X15':values=[ex]+flat(f['stages'],['label','copy'])
    elif id=='X16':values=[f['goal']]+f['pillars']+[f['foundation']]
    elif id=='NEW-01':values=[ex]+flat(f['lanes'],['role','step'])
    elif id=='NEW-02':values=[ex]+[f[k] for k in ['person','ai','supply','approve','check','draft','revision_label']]
    elif id=='NEW-03':
        values=[ex]+flat(f['steps'],['kind','label'])
        for rect,step in zip([t for t in spec['layout'] if t['kind']=='rect'],f['steps']):
            rect.update(fill=r.PALE if step['kind']=='Work' else r.BG,outline=r.INK if step['kind']=='Wait' else None)
    elif id=='NEW-04':
        values=[ex,f['measure']]
        for group in f['groups']:values += [group['label'],f"{100*(group['count']/f['base_count']):g}%"]
        values += ['Common scale: 0 to 100%',f"Base: {f['base_count']:g} {f['unit']} per group"]
    elif id=='NEW-05':
        values=[ex,'Cohort: '+f['cohort'],'Window: '+f['window'],f"Base: [{f['base_count']:g} users at first stage]"]
        values+=flat([{'label':s['label'],'value':f"{s['count']:g}"} for s in f['stages']],['label','value'])
    slots=[t for t in spec['layout'] if t['kind']=='text']
    if len(slots)!=len(values):raise ValueError(f'{id}: internal schema binding mismatch')
    for t,value in zip(slots,values):t['text']=value
    if id in ('NEW-04','NEW-05'):
        bars=[t for t in spec['layout'] if t['kind']=='rect' and t['fill']==r.GREEN]
        for bar,row in zip(bars,f['groups' if id=='NEW-04' else 'stages']):
            bar['w']=800*(row['count']/f['base_count'])
        # Pillow cannot draw a zero-width rounded rectangle. Omit only its ink.
        spec['layout']=[t for t in spec['layout'] if not(t['kind']=='rect' and t.get('fill')==r.GREEN and t['w']==0)]
    for t in spec['layout']:
        if t['kind']=='text' and t['size']<40:raise ValueError(id+': text below 40 px')
    spec['labels']=values
    spec['checked']='Checked by make.py. See sidecar checks.'
    spec.pop('uncertain',None)
    return spec
