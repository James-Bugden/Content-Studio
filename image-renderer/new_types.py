"""Five extra layout families. Uses the original renderer's fonts and validator."""
def catalogue(r):
    result=[]
    def text(s,x,y,w=952,size=40,**kw): return r.T(s,x,y,w,size,**kw)
    def centred(s,box,size=44,colour=None):
        return r.centred_text_in_box(text(s,box[0],box[1],box[2]-box[0],size,
            colour=colour or r.INK,weight='medium'),box)
    def card(s,x,y,w,h,size=44,fill=None,outline=None):
        return [r.R(x,y,w,h,fill or r.PALE,outline),centred(s,[x,y,x+w,y+h],size)]
    def add(id,slug,family,title,alt,p,checked):
        result.append(dict(id=id,slug=slug,layout_family=family,title=title,alt_text=alt,
            labels=[i['text'] for i in p if i['kind']=='text'],layout=p,
            canvas=dict(width=1080,height=1350,mode='RGB',background=r.BG,safe_margin=64),
            title_layout=r.T(title,64,64,952,72,r.INK,'title'),
            footer=r.T('SOAR',64,1252,200,28,r.INK,'medium'),
            fixed_geometry=True,checked=checked,uncertain='Illustrative placeholders only. No measured results.'))

    # Real horizontal bands with staggered steps and hand-offs in the gutters.
    p=[text('Example process. Teams differ.',64,280)]
    roles=['Recruiter','Interview\npanel','Hiring\nmanager','Approver']
    tasks=['Shares a\nshortlist','Checks proof\nCan block','Recommends\na hire','Approves\nthe hire']
    xs=[320,432,536,640]
    for n,(role,task,x) in enumerate(zip(roles,tasks,xs)):
        y=368+n*208
        p += [r.R(64,y,952,176,r.PALE if n%2==0 else '#F2F6F3'),
              centred(role,[64,y,320,y+176],40)]
        w=min(360,992-x)
        p += card(task,x,y+16,w,144,40,r.BG,r.GREEN if n==3 else r.INK)
        if n<3:
            start=round((x+w/2)/8)*8
            next_x=round((xs[n+1]+min(360,992-xs[n+1])/2)/8)*8
            p += [r.L([(start,y+176),(start,y+192),(next_x,y+192),(next_x,y+208)],True)]
    add('NEW-01','decision-swimlane','decision swimlane','How a hiring decision\nis made',
        'Example process. Teams differ. Four horizontal actor bands contain staggered steps. The recruiter shares a shortlist, the panel checks proof and can block, the hiring manager recommends a hire, and the approver approves it. Three arrows cross lanes in this order.',p,
        'True actor bands. Staggered tasks. Ordered cross-lane arrows. Panel block point. Recommendation separate from approval.')

    p=[text('Example workflow',64,280),
       r.R(64,376,952,416,r.PALE),centred('You',[64,376,264,792],44),
       r.R(64,872,952,280,'#F2F6F3'),centred('AI',[64,872,264,1152],44)]
    p += card('Supply\nreal facts',288,408,312,144,44,r.BG,r.INK)
    p += card('If right:\napprove',656,408,336,144,44,r.BG,r.GREEN)
    p += card('Facts right?\nWords clear?',656,608,336,144,40,r.BG,r.INK)
    p += card('Draft from\nreal facts',432,960,376,144,44,r.BG,r.INK)
    p += [r.L([(448,568),(448,824),(480,824),(480,944)],True),
          r.L([(824,1032),(960,1032),(960,816),(824,816),(824,768)],True),
          r.L([(824,592),(824,568)],True),
          r.L([(640,680),(624,680),(624,944)],True),
          text('If wrong:\nrevise',656,840,288,40,align='center')]
    add('NEW-02','human-ai-verification','human and AI verification lanes','Use AI, then check\nwhat it writes',
        'Example workflow. The You band contains supplying real facts, checking facts and wording, and approving for use. The AI band contains drafting from real facts. Arrows cross between the two actors. If wrong, one return arrow sends the draft back to AI. If right, the person approves it.',p,
        'Two real actor bands. Cross-lane hand-offs. Labelled facts decision. One return arrow for revision. Person approves.')

    p=[text('Not to scale. Example.',64,280)]
    steps=[(64,384,'Work','Review\nCVs'),(400,384,'Wait','Find a\nshared time'),
           (736,384,'Work','Meet the\npanel'),(736,872,'Wait','Wait for\nfeedback'),
           (400,872,'Work','Review\nevidence'),(64,872,'Wait','Wait for\nsign-off')]
    for x,y,kind,task in steps:
        p += [r.R(x,y,280,320,r.PALE if kind=='Work' else r.BG,r.INK if kind=='Wait' else None),
              centred(kind,[x,y,x+280,y+96],40),centred(task,[x,y+96,x+280,y+320],44)]
    p += [r.L([(344,544),(400,544)],True),r.L([(680,544),(736,544)],True),
          r.L([(872,704),(872,872)],True),r.L([(736,1032),(680,1032)],True),
          r.L([(400,1032),(344,1032)],True)]
    add('NEW-03','wait-work-strip','work and wait strip','Why hiring takes\nso long',
        'Not to scale. Example. A strip reads left to right, then down and back to the left. Review CVs is work. Finding a shared time is a wait. Meeting the panel is work. Waiting for feedback is a wait. Reviewing evidence is work. Waiting for sign-off is a wait. Box sizes do not show time.',p,
        'Equal-size steps show order only. Work has pale fill. Waiting has an outline and a word label. No duration claims.')

    p=[text('Example data. Replace with\na sourced number.',64,280),
       text('People who heard back',64,456,952,48,weight='medium')]
    for y,label,value in [(560,'This group',30),(832,'Benchmark',50)]:
        p += [text(label,64,y,800,44,weight='medium'),r.R(64,y+72,800,80,r.PALE),
              r.R(64,y+72,800*value/100,80,r.GREEN),
              centred(f'{value}%',[880,y+56,1040,y+168],44)]
    p += [text('Common scale: 0 to 100%',64,1048),
          text('Base: 100 people in each group',64,1152)]
    add('NEW-04','contextual-data-chart','contextual data chart','Show the number\nand its base',
        'Example data. Replace with a sourced number. A common scale from zero to 100 per cent compares people who heard back. This group has 30 of 100 people. The benchmark has 50 of 100 people. Both use a base of 100 people. All values are fake placeholders.',p,
        'Same zero-based scale and base for both bars. Bar lengths are 30 and 50 per cent of a 100 per cent track. Denominator always visible.')

    p=[text('Example numbers',64,280,952,48,weight='medium'),
       text('Cohort: [new users]',64,360),text('Window: [start date to end date]',64,424),
       text('Base: [100 users who opened it]',64,488)]
    for y,label,value in [(584,'Opened the tool',100),(744,'Started a draft',60),
                          (904,'Finished a draft',25),(1064,'Saved a file',10)]:
        p += [text(label,64,y,800,44,weight='medium'),r.R(64,y+72,800,56,r.PALE),
              r.R(64,y+72,800*value/100,56,r.GREEN),
              centred(str(value),[880,y+48,1040,y+152],44)]
    add('NEW-05','stage-conversion-bars','stage conversion bars','Where a free tool\nloses users',
        'Example numbers. Placeholder cohort: new users. Placeholder window: start date to end date. Base: 100 users who opened the tool. Ordered bars show 100 opened it, 60 started a draft, 25 finished a draft and 10 saved a file. Counts use the same zero-based scale. These are fake values, not measured results.',p,
        'Ordered stages and raw user counts. Common zero baseline, same cohort and window. All bars use the original base, not the previous stage.')
    return result
