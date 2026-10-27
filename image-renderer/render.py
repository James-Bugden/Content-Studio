"""Deterministic SOAR diagrams. Run extras: python out/soar-diagrams/render.py --new.

Fonts are local converted fontsource files. --init writes the editable catalogue.
--convert-fonts rebuilds the three TTFs from the supplied local fontsource WOFFs.
The geometry validator checks actual glyph boxes against every outline, arrow,
connector, other text box and the 64 px safe margin. Filled areas are not strokes.
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
BG, INK, GREEN, PALE, RED = '#FFFDFC', '#111315', '#0A3D26', '#E7EFE9', '#A13D32'
FONTS = {}
CMAPS = {}

def font(size, weight='body'):
    path = ROOT / 'fonts' / {'title':'outfit-700.ttf', 'body':'manrope-400.ttf', 'medium':'manrope-500.ttf'}[weight]
    if not path.is_file():
        raise ValueError(f'Missing font: {path}')
    key = (size, weight)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str(path), size)
        assert FONTS[key].getname()[0].startswith('Outfit' if weight=='title' else 'Manrope')
        if weight not in CMAPS:
            with TTFont(path) as data: CMAPS[weight]=set(data.getBestCmap())
    return FONTS[key]

def wrap(text, width, size, weight):
    f = font(size, weight)
    lines = []
    for para in text.split('\n'):
        line = ''
        for word in para.split():
            trial = (line + ' ' + word).strip()
            if f.getlength(trial) > width and line:
                lines.append(line); line = word
            else: line = trial
        lines.append(line)
    return lines

def T(text, x, y, w=952, size=36, colour=INK, weight='body', align='left'):
    return dict(kind='text', text=text, x=x, y=y, w=w, size=size, colour=colour, weight=weight, align=align)
def R(x,y,w,h,fill=PALE,outline=None):
    return dict(kind='rect',x=x,y=y,w=w,h=h,fill=fill,outline=outline)
def C(x,y,r,fill=None,outline=INK):
    return dict(kind='circle',x=x,y=y,r=r,fill=fill,outline=outline)
def L(points,arrow=False,colour=INK,width=3):
    return dict(kind='line',points=points,arrow=arrow,colour=colour,width=width)

def catalogue():
    result=[]
    def add(id,slug,family,title,alt,items,checked,uncertain='None'):
        result.append(dict(id=id,slug=slug,layout_family=family,title=title,alt_text=alt,
                           labels=[p['text'] for p in items if p['kind']=='text'], layout=items,
                           canvas=dict(width=1080,height=1350,mode='RGB',background=BG,safe_margin=64),
                           title_layout=T(title,64,64,952,72,INK,'title'),
                           footer=T('SOAR',64,1252,200,28,INK,'medium'),
                           checked=checked,uncertain=uncertain))
    def txt(s,x,y,w=952,size=36,**kw): return T(s,x,y,w,size,**kw)
    def card(s,x,y,w,h,size=36,green=False):
        lines=wrap(s,w-56,size,'medium')
        th=len(lines)*int(size*1.5)
        item=T(s,x+28,y+(h-th)/2,w-56,size,GREEN if green else INK,'medium')
        item['container']=[x,y,x+w,y+h]
        return [R(x,y,w,h), item]

    p=[txt('Example offers',64,440,size=32),txt('Offer A',360,515,270,44,weight='medium'),txt('Offer B',720,515,270,44,weight='medium')]
    for i,(dim,a,b) in enumerate([('Pay','Higher base','Lower base'),('Work','Office daily','Hybrid'),('Growth','Deepen a skill','Try new work')]):
        y=620+i*155
        p += [R(64,y-18,952,125,PALE if i%2==0 else BG),txt(dim,88,y,230,34,weight='medium'),txt(a,360,y,290,34),txt(b,720,y,270,34)]
    p += [txt('Choose what fits your needs',64,1130,952,40,colour=GREEN)]
    add('E01','side-by-side','side-by-side comparison','Compare offers on the same terms','Two example offers are compared on pay, work and growth. Each has different trade-offs.',p,'Same three dimensions on both sides. Examples labelled. No universal winner.')

    p=[txt('Illustrative example',64,430,size=32),txt('Before',64,515,400,38,weight='medium')]
    p+=card('Helped with reports',64,575,952,130,42)
    p+=[L([(540,735),(540,795)],True),txt('After',64,835,400,38,weight='medium')]
    p+=card('Built a weekly sales report so the team could spot late orders',64,900,952,215,42,True)
    add('E02','before-after','before and after','Show what you did and why it mattered','An illustrative resume bullet changes from helped with reports to a clear task and purpose.',p,'Illustrative example. Specific task and purpose. No invented metric.')

    p=[]
    for y,s in [(450,'Choose someone who knows your work'),(700,'Share the role and why it fits'),(950,'Ask if they feel able to refer you')]: p+=card(s,170,y,740,170,40,green=y==950)
    p += [L([(540,650),(540,670)],True),L([(540,900),(540,920)],True)]
    add('E03','short-sequence','short sequence','Make a referral easy to consider','Three ordered steps: choose someone who knows your work, share the role and fit, then ask for a referral.',p,'Three steps. Arrows follow a real order.')

    p=card('Can you do the core tasks?',200,445,680,140,42)
    p += [L([(350,615),(350,685),(285,685),(285,725)],True),L([(730,615),(730,685),(795,685),(795,725)],True),txt('Yes',200,635,110,34),txt('Not yet',830,620,180,34)]
    p+=card('Apply with proof\nof those tasks',64,775,440,170,38,True)+card('Build proof or try\na closer role',576,775,440,170,38)
    p += [txt('Check any must-have licence or work permit first',64,1050,920,36)]
    add('E04','branching-decision','branching decision','Only half a match? Check the core tasks','The decision splits into applying with proof or building proof and trying a closer role. Check essential legal requirements first.',p,'Distinct branch actions. Essential requirements caveat.')

    p=[txt('Example headline',64,440,size=32)]
    p+=card('Data analyst',64,525,390,130,44)+card('SQL and Tableau',510,525,506,130,44)
    p+=card('Turning sales data into clear weekly reports',64,830,952,170,42,True)
    p += [L([(260,685),(260,725)]),txt('Names the role',64,755,400,34),L([(760,685),(760,725)]),txt('Names the tools',580,755,436,34),L([(540,1030),(540,1070)]),txt('Shows useful work',260,1100,600,36)]
    add('E05','annotated-anatomy','annotated anatomy','Give your headline a clear job','An example LinkedIn headline names a role, names the tools and shows useful work. Three callouts explain it.',p,'Three callouts. Leaders stop before text. Example labelled.')

    p=[]
    for x,s in [(64,'Job post'),(398,'Company\nwebsite'),(732,'People in\nthe role')]: p+=card(s,x,460,284,160,36)
    p += [L([(206,650),(206,770),(460,900)],True),L([(540,650),(540,900)],True),L([(874,650),(874,770),(620,900)],True)]
    p+=card('What the role needs',200,950,680,160,44,True)
    p += [txt('Each source helps define the role',64,1160,952,32)]
    add('E06','converging-inputs','converging inputs','Build a fuller view of the role','A job post, the company website and people in the role all help define what the role needs.',p,'All three arrows converge. Relationship named.')

    p=[]
    for y,heading,prompt in [(440,'Now','I work on…'),(690,'Proof','One thing I have done is…'),(940,'Next','I want this role because…')]:
        p += [txt(heading,64,y,952,40,weight='medium'),R(64,y+70,952,125),txt(prompt,92,y+104,890,36)]
    add('E07','fill-in-worksheet','fill-in worksheet','Build a short answer about yourself','Three fields help build an introduction: your work now, one piece of proof and why this role is next.',p,'Three useful fields. Room to fill in each answer.')

    p=[txt('LinkedIn schematic, not a real screenshot',64,440,952,32),R(64,530,630,585,PALE,INK),txt('Your profile',100,575,550,40,weight='medium')]
    p += [R(100,675,558,150,BG,INK),txt('Open to\nFinding a new job',130,705,500,32),L([(690,748),(745,748)]),txt('Start here',780,725,230,34)]
    p += [txt('Choose visibility',100,865,550,36),R(100,950,558,110,BG,INK),txt('Recruiters only',130,984,500,36,colour=GREEN)]
    p += [txt('LinkedIn tries to hide this from your employer. Privacy is not guaranteed.',64,1155,952,30)]
    add('E08','screenshot-annotation','sparse schematic annotation','Set who sees you are open to work','A labelled LinkedIn schematic shows Open to, Finding a new job, then Recruiters only. Employer privacy is not guaranteed.',p,'Explicit schematic label. One sparse leader. Privacy caveat.','LinkedIn labels and menu position can change. Offline task, current live UI not verified.')

    p=[txt('Example requirement',64,440,420,36,weight='medium'),txt('Resume proof',640,440,376,36,weight='medium')]
    for y,a,b in [(570,'Use SQL','Built a SQL report'),(790,'Work with teams','Planned a launch\nwith sales'),(1010,'Explain findings','Shared a clear\nweekly summary')]:
        p+=card(a,64,y,365,145,34)+[L([(459,y+72),(594,y+72)])]+card(b,624,y,392,145,34)
    add('E09','requirement-proof','requirement-to-proof pairs','Match each need to a piece of proof','Three example job requirements link to separate resume evidence in aligned rows.',p,'Three aligned pairs. Straight connectors do not cross. Example labelled.')

    p=[txt('Example wording',64,440,size=32),txt('Interviewer',64,525,952,36,weight='medium')]
    p+=card('Why are you leaving?',64,590,780,130,44)
    p += [txt('You',200,795,816,36,weight='medium')]
    p+=card('I want to do more data analysis. This role gives me scope to use SQL on real business questions.',200,865,816,280,40,True)
    add('E10','example-dialogue','example dialogue','Explain the move you want to make','An example interview exchange focuses on wanting more data analysis and why the new role fits.',p,'Example wording. Clear speaker labels. No personal claim presented as fact.')

    p=[txt('Use your judgement, not a score',64,410,952,32),L([(150,1080),(970,1080)],True),L([(150,1080),(150,540)],True),txt('More interest',590,1130,420,34),txt('More fit',64,470,350,34)]
    p += [L([(560,560),(560,1045)],colour=PALE),L([(190,800),(965,800)],colour=PALE)]
    p += [txt('Strong fit\nLow interest',215,620,290,36),txt('Apply first',635,650,300,42,colour=GREEN,weight='medium'),txt('Low fit\nLow interest',215,900,290,36),txt('Build proof\nthen review',635,900,300,36)]
    add('N01','two-axis-matrix','two-axis matrix','Choose which roles to try first','A judgement matrix compares interest and fit. High interest and strong fit is the first priority. High interest with low fit calls for more proof.',p,'Axes and direction labelled. Judgement caveat.','Fit and interest are personal judgements, not measured data.')

    p=[txt('Example answers',64,440,size=32),L([(110,610),(970,610)],True),txt('Vague',64,500,300,40),txt('Specific',740,500,276,40,colour=GREEN)]
    for x,s in [(64,'I helped\nthe team'),(398,'I built\na report'),(732,'I built a report\nto flag late\norders')]: p+=card(s,x,720,284,290,36)
    add('N02','spectrum','spectrum','Make your answer more specific','Example answers move from helped the team to built a report to flag late orders. The spectrum uses no scores.',p,'Example labelled. No fake scale values.')

    p=[txt('Stages only. Widths do not show a measured drop.',64,430,952,32)]
    for x,y,w,s in [(64,530,952,'Long list: roles worth a look'),(170,750,740,'Shortlist: fit your core needs'),(290,970,500,'Best ten: research first')]: p+=card(s,x,y,w,160,38,green=y==970)
    p += [L([(540,705),(540,735)],True),L([(540,925),(540,955)],True)]
    add('N03','filter-funnel','filter funnel','Cut a long job list to your best ten','Three narrowing stages go from a long list to roles that fit core needs to the best ten to research. Widths are not measured conversion.',p,'Widths explicitly schematic. Best ten is a target, not a result.')

    p=card('Apply',330,445,420,120,44,True)+card('Check replies',635,745,381,150,38)+card('Adjust resume',64,745,400,150,38)
    p += [L([(780,505),(910,505),(910,715)],True),L([(605,820),(494,820)],True),L([(180,715),(180,505),(300,505)],True),txt('Repeat after a small batch',170,1050,740,36)]
    add('N04','feedback-loop','feedback loop','Use each round to improve the next','Apply, check replies, adjust the resume, then return to applying. Repeat after a small batch.',p,'Closed directional loop. No one-way dead end.')

    p=[L([(135,490),(135,1120)])]
    for y,day,s in [(500,'Day −7','Read the role'),(680,'Day −5','Choose your examples'),(860,'Day −3','Practise out loud'),(1040,'Day −1','Check time and link')]:
        p += [C(135,y+25,10,INK,None),txt(day,200,y,220,38,weight='medium'),txt(s,450,y,566,38)]
    add('N05','timeline','timeline','Use the week before your interview','An equally spaced timeline marks day minus seven, minus five, minus three and minus one with preparation tasks.',p,'Real day labels. Each interval is two days. No unequal duration implied.')

    p=[]
    for x,y,w,h,s in [(64,980,952,150,'Helped: took on a task'),(64,810,770,150,'Contributed: did part of the work'),(64,640,600,150,'Led: guided the work'),(64,470,430,150,'Owned: made final calls')]: p+=card(s,x,y,w,h,36,green=y==470)
    p += [txt('Use the level that matches what you actually did',64,1170,952,32)]
    add('N06','ownership-ladder','ownership ladder','Name the scope you really held','Four steps distinguish helping, contributing, leading and owning a final decision. Use the scope you actually held.',p,'Distinct scope labels. No promise of promotion.')

    p=[txt('Example job post',64,440,size=40,weight='medium')]
    p+=card('Work with teams\nManage key projects',64,510,952,180,40)
    p += [L([(64,760),(1016,760)]),txt('Ask to find out',64,815,size=40,colour=GREEN,weight='medium')]
    p += [txt('Who makes the final call?\nWhat does a normal week look like?\nHow will good work be judged?',64,905,952,38)]
    add('N07','visible-hidden','visible and hidden','Read the post, then ask what is missing','Visible job post phrases sit above a line. Below are questions about decisions, daily work and how work is judged.',p,'No hidden percentage. Questions remain questions.')

    p=[C(410,725,245,None,INK),C(670,725,245,None,INK),C(540,925,245,None,INK),txt('Role\nneed',260,620,150,36),txt('Your\nproof',755,620,160,36),txt('What\nyou want',430,1020,280,36),txt('Fit',500,810,130,42,colour=GREEN,weight='medium')]
    add('N08','overlap','overlap diagram','Look for a fit in all three areas','Three overlapping circles represent role need, your proof and what you want. The shared centre is fit.',p,'Three meaningful sets. Shared centre labelled. No quantified areas.')

    p=[]
    for y,w,label,s in [(450,600,'Claim','I can improve a process'),(700,780,'Example','I made a clear handover guide'),(950,952,'Result','The next owner could use it')]:
        p += [R(64,y,w,190),txt(label,92,y+25,w-56,36,weight='medium'),txt(s,92,y+95,w-56,38,colour=GREEN if label=='Result' else INK)]
    p += [txt('Illustrative example',64,1170,size=30)]
    add('N09','evidence-layers','evidence layers','Support a claim with an example and result','Three illustrative layers state a claim, a handover guide example and its practical result.',p,'Three layers only. Illustrative example. No measured claim.')

    p=[txt('Example claim',64,430,size=32)]
    p+=card('I work well with other teams',150,500,780,140,42,True)
    p += [L([(540,670),(540,730),(206,730),(206,820)]),L([(540,730),(540,820)]),L([(540,730),(874,730),(874,820)])]
    for x,s in [(64,'Agreed a plan\nwith sales'),(398,'Shared risks\nwith support'),(732,'Resolved a\nhandover gap\nwith finance')]:p+=card(s,x,860,284,240,34)
    add('N10','evidence-tree','evidence tree','Show three kinds of teamwork proof','An example teamwork claim branches to planning with sales, sharing risks with support and resolving a handover gap with finance.',p,'Three distinct proof points. Branch lines do not touch text.')

    p=[txt('Example evidence check',64,430,size=32),txt('Need',64,510,360,36,weight='medium'),txt('Proof ready',450,510,290,36,weight='medium'),txt('Next step',790,510,226,36,weight='medium')]
    for y,a,b,c in [(610,'SQL','Yes','Pick a query'),(790,'Teamwork','Yes','Pick a story'),(970,'Forecasting','Gap','Build a case')]:
        p += [R(64,y-20,952,145),txt(a,88,y+15,300,34),txt(b,450,y+15,270,34,colour=GREEN if b=='Gap' else INK),txt(c,790,y+15,205,32)]
    add('X02','evidence-coverage-grid','evidence coverage grid','Find the gaps in your evidence','An example grid checks SQL, teamwork and forecasting. Forecasting has a gap and needs a case.',p,'Example labelled. Gaps shown with words, not colour alone.')

    p=card('Role needs SQL',64,470,400,150,38)+card('Resume says\n“good with data”',616,470,400,150,38)
    p += [L([(494,545),(586,545)],colour=RED),txt('Too vague to check',230,720,680,40,colour=RED,align='center'),L([(540,820),(540,890)],True)]
    p+=card('Add one SQL task and what it helped someone do',130,940,820,190,40,True)
    add('X03','bottleneck-repair','bottleneck and repair','Fix the weak link before applying','A role needs SQL but an example resume only says good with data. The repair is to add a SQL task and its use.',[txt('Illustrative example',64,410,size=30)]+p,'True correction uses red. Example labelled. Concrete repair.')

    p=[]
    for x,y,s in [(64,450,'Role link'),(64,720,'Why you fit'),(64,990,'Short resume')]:p+=card(s,x,y,350,130,38)
    p += [L([(444,515),(550,515),(550,785),(660,785)],True),L([(444,785),(660,785)],True),L([(444,1055),(550,1055),(550,785)])]
    p+=card('One clear request\nthey can forward',690,645,326,280,36,True)
    add('X04','dependency-map','dependency map','Prepare a referral request they can forward','A role link, why you fit and a short resume feed one clear request that can be forwarded.',p,'Three required inputs feed one request. No implied step order.')

    p=[txt('Example routes',64,420,size=32),txt('Your current role',64,495,952,38,weight='medium')]
    p += [L([(206,570),(206,660)],True),L([(540,570),(540,660)],True),L([(874,570),(874,660)],True)]
    p+=card('Internal\nproject',64,690,285,180,36)+card('Direct\napplication',398,690,284,180,36)+card('Adjacent\noperations role',732,690,284,210,34)
    p += [L([(206,900),(206,1090),(355,1090)],True),L([(540,900),(540,980)],True),L([(874,900),(874,1090),(725,1090)],True)]
    p+=card('Product operations',385,1020,310,150,36,True)
    add('X05','alternative-route-map','alternative route map','Explore more than one route into product operations','Three example routes lead from a current role through an internal project, direct application or adjacent operations role into product operations.',p,'Example routes. Different possible paths, not guaranteed outcomes.')

    p=card('Target role',650,450,366,130,40,True)+card('Proof it asks for',398,730,500,140,38)+card('One task to try now',64,1020,550,140,38)
    p += [L([(833,610),(833,665),(650,665),(650,700)],True),L([(490,900),(490,945),(340,945),(340,990)],True),txt('Start here',64,470,440,36),txt('Then work back',64,650,400,34)]
    add('X06','backcasting','backcasting','Work backwards from the role you want','Start with a target role, work backwards to the proof it needs, then choose one task to try now.',p,'Backward planning direction explicit. Arrows go from goal to present task.')

    p=[txt('Illustrative example',64,430,size=32)]
    p += [R(64,510,952,640),txt('I solve problems',100,545,880,42,weight='medium'),R(170,665,810,450,BG),txt('A late handover',205,700,740,40,weight='medium'),R(290,825,650,250,PALE),txt('I made a checklist so support knew what to do next',325,865,580,38,colour=GREEN)]
    add('X08','progressive-zoom','progressive zoom-in','Turn a broad claim into a specific answer','Nested areas zoom from solving problems to a late handover to a checklist that helped support know the next step.',p,'Nested focus, no decorative connectors. Illustrative example.')

    p=[txt('Possible causes to check, not proven causes',64,430,952,32),L([(110,830),(850,830)],True)]
    for points in [[(270,650),(430,830)],[(660,650),(760,830)],[(270,1040),(430,830)],[(660,1040),(760,830)]]:p+=[L(points)]
    p += [txt('Role fit',100,520,350,38,weight='medium'),txt('Core tasks missing?',64,575,450,32),txt('Resume proof',580,520,436,38,weight='medium'),txt('Claims too vague?',580,575,436,32),txt('Timing',100,1080,350,38,weight='medium'),txt('Role still open?',64,1140,450,32),txt('Route',580,1080,436,38,weight='medium'),txt('Right hiring contact?',580,1140,436,32),txt('Few\nreplies',895,780,121,32,colour=RED)]
    add('X10','fishbone','fishbone diagnosis','Investigate why applications get little response','A fishbone groups possible causes of few replies under role fit, resume proof, timing and route. These are questions to investigate.',p,'Possible causes labelled. No asserted diagnosis. Fishbone branches clear.')

    p=card('You',380,745,320,130,44)
    for x,y,s in [(64,450,'Recruiter\nWhat is the process?'),(590,450,'Hiring manager\nWhat matters first?'),(64,995,'Person in the role\nWhat is a normal day?'),(590,995,'Former colleague\nWhat proof can I show?')]:p+=card(s,x,y,426,170,32)
    p += [L([(277,650),(380,715)]),L([(803,650),(700,715)]),L([(277,965),(380,905)]),L([(803,965),(700,905)])]
    add('X11','stakeholder-network','stakeholder network','Ask different people different questions','A central you links to a recruiter for process, a hiring manager for priorities, a person in the role for daily work and a former colleague for proof.',p,'Four distinct sources and questions. Undirected links mean conversations.')

    p=[txt('Example: could product operations suit me?',64,430,952,32)]
    for x,y,head,body in [(64,525,'Question','Do I enjoy fixing team handovers?'),(575,525,'Small test','Map one handover with a colleague'),(64,850,'Look for','Did I enjoy the work and help the team?'),(575,850,'Decide','Try a bigger task or explore another role')]:
        p += [R(x,y,441,270),txt(head,x+28,y+27,385,36,weight='medium',colour=GREEN if head=='Decide' else INK),txt(body,x+28,y+95,385,34)]
    add('X12','experiment-board','experiment board','Turn career uncertainty into a small test','An example board asks if product operations fits, tries mapping a handover, looks for enjoyment and usefulness, then chooses a next step.',p,'Example labelled. Small test and a decision. No promised outcome.')

    p=[]
    for y,heading,body in [(450,'Remove','Claims you cannot back up'),(700,'Keep','Clear work examples and useful skills'),(950,'Add','The role you want and proof that fits')]:
        p += [txt(heading,64,y+35,270,44,weight='medium'),R(390,y,626,180),txt(body,420,y+40,566,38,colour=GREEN if heading=='Add' else INK)]
    add('X14','remove-keep-add','remove keep add','Edit your LinkedIn profile with a clear plan','Three editing actions remove unsupported claims, keep work examples and useful skills, and add a target role with fitting proof.',p,'Three distinct editing actions. No decorative symbols.')

    p=[]
    for y,head,body in [(440,'Hypothesis','The first step may be unclear'),(700,'Evidence to seek','Watch where new users stop'),(960,'Small test','Try a simpler first screen with a few users')]:
        p += [txt(head,64,y,952,38,weight='medium',colour=GREEN if head=='Small test' else INK),txt(body,64,y+75,952,40)]
    p += [L([(540,625),(540,660)],True),L([(540,885),(540,920)],True)]
    add('X15','hypothesis-evidence-test','hypothesis to evidence to test','Find out where your free tool loses people','An example hypothesis about an unclear first step leads to seeking evidence by watching users, then testing a simpler first screen.',[txt('Example investigation',64,385,size=30)]+p,'Hypothesis stays tentative. Evidence is to seek, not a fabricated finding.')

    p=[dict(kind='polygon',points=[(100,650),(540,445),(980,650)],fill=PALE,outline=INK),txt('A role worth\nmoving for',340,535,400,36,colour=GREEN,align='center')]
    for x,s in [(100,'Role needs'),(410,'Your proof'),(720,'Your needs')]:p+=card(s,x,720,260,210,34)
    p += [R(64,1020,952,150,PALE,INK),txt('Foundation: research and small tests',100,1068,880,36)]
    add('X16','strategy-house','strategy house','Build a career move on evidence','A strategy house has research and small tests as its foundation, role needs, your proof and your needs as pillars, and a role worth moving for as the roof.',p,'Foundation, three pillars and goal each explain part of the strategy.')
    return result

def segment_hits_rect(a,b,r,pad):
    # Exact segment vs expanded rectangle, with Liang-Barsky clipping.
    x0,y0,x1,y1=r; x0-=pad; y0-=pad; x1+=pad; y1+=pad
    lo,hi=0.,1.; dx=b[0]-a[0]; dy=b[1]-a[1]
    for p,q in [(-dx,a[0]-x0),(dx,x1-a[0]),(-dy,a[1]-y0),(dy,y1-a[1])]:
        if p==0:
            if q<0:return False
        else:
            t=q/p
            if p<0:lo=max(lo,t)
            else:hi=min(hi,t)
            if lo>hi:return False
    return True

def text_metrics(item):
    f = font(item['size'], item['weight'])
    lines = wrap(item['text'], item['w'], item['size'], item['weight'])
    step = round(item['size'] * (1.22 if item['weight']=='title' else 1.3))
    boxes = [f.getbbox(line) for line in lines]
    height = (len(lines)-1)*step + boxes[-1][3]-boxes[-1][1]
    return f, lines, boxes, step, height


def centred_text_in_box(item, box, horizontal=True):
    """Centre the union of visible glyph bounds, never the font ascender box."""
    item = dict(item)
    left, top, right, bottom = box
    item['x'], item['w'] = left+24, right-left-48
    if horizontal: item['align']='center'
    height = text_metrics(item)[-1]
    item['y'] = top + (bottom-top-height)/2
    item['container'] = box
    return item


def fit_diagram_block(spec):
    """Expand vertical geometry into the title/footer gap, on an 8 px grid.

    Type stays at its authored size. Shapes grow and centres spread, rather than
    raster stretching. No shrinking-to-fit or clipping is permitted.
    """
    from copy import deepcopy
    items=deepcopy(spec['layout'])
    for p in items:
        if p['kind']=='text': assert p['size']>=(40 if spec.get('fixed_geometry') else 38), 'Body text below minimum'
        if 'x' in p: assert 64 <= p['x'] <= 1016, 'Bad source x margin'
        if 'y' in p: assert 64 <= p['y'] <= 1286, 'Bad source y margin'
    if spec.get('fixed_geometry'):
        # New layouts are authored directly on the 8 px grid in the free block.
        for p in items:
            if p['kind']=='text' and 'container' in p:
                fixed=centred_text_in_box(p,p['container'])
                p.clear(); p.update(fixed)
        return items
    def bounds(p):
        if p['kind']=='text': return p['y'], p['y']+text_metrics(p)[-1]
        if p['kind']=='rect': return p['y'],p['y']+p['h']
        if p['kind']=='circle': return p['y']-p['r'],p['y']+p['r']
        return min(q[1] for q in p['points']),max(q[1] for q in p['points'])
    low=min(bounds(p)[0] for p in items); high=max(bounds(p)[1] for p in items)
    top=math.ceil((spec['title_layout']['y']+text_metrics(spec['title_layout'])[-1]+72)/8)*8
    bottom=1192
    scale=(bottom-top)/(high-low)
    def fy(y): return round((top+(y-low)*scale)/8)*8
    for p in items:
        k=p['kind']
        if k=='rect':
            end=fy(p['y']+p['h']); p['y']=fy(p['y']); p['h']=end-p['y']
        elif k=='text':
            p['y']=fy(p['y'])
            if 'container' in p:
                a,b,c,d=p['container']; p['container']=[a,fy(b),c,fy(d)]
            if 'centre_box' in p:
                a,b,c,d=p.pop('centre_box'); fixed=centred_text_in_box(p,[a,fy(b),c,fy(d)]); p.clear(); p.update(fixed)
        elif k=='circle': p['y']=fy(p['y'])
        else: p['points']=[[x,fy(y)] for x,y in p['points']]
        # Centred cards use their transformed container, including multiline text.
        if k=='text' and 'container' in p:
            fixed=centred_text_in_box(p,p['container'],p.get('align')!='left-in-box')
            p.clear(); p.update(fixed)
    return items


def render(spec, dest):
    canvas=spec['canvas']; canvas_width,canvas_height=canvas['width'],canvas['height']
    margin=canvas['safe_margin']
    im=Image.new('RGB',(canvas_width,canvas_height),BG); d=ImageDraw.Draw(im)
    texts=[]; strokes=[]
    def stroke(a,b,width=3):
        d.line([tuple(a),tuple(b)],fill=colour,width=width)
        strokes.append((a,b,width))
    items=[spec['title_layout']]+fit_diagram_block(spec)+[spec['footer']]
    if spec.get('fill_shared_overlap'):
        masks=[]
        for c in items:
            if c['kind']=='circle':
                mask=Image.new('L',im.size,0); md=ImageDraw.Draw(mask)
                x,y,r=c['x'],c['y'],c['r']; md.ellipse((x-r,y-r,x+r,y+r),fill=255); masks.append(mask)
        assert len(masks)==3
        shared=ImageChops.multiply(ImageChops.multiply(masks[0],masks[1]),masks[2])
        im.paste(PALE,(0,0,1080,1350),shared)
    for block_index,item in enumerate(items):
        k=item['kind']; colour=item.get('colour',INK)
        if k=='text':
            f,lines,boxes,step,height=text_metrics(item)
            missing={c for c in item['text'] if not c.isspace() and ord(c) not in CMAPS[item['weight']]}
            assert not missing, f'Unsupported font glyphs: {missing}'
            for n,line in enumerate(lines):
                bbox=f.getbbox(line); width=bbox[2]-bbox[0]
                x=item['x']+(item['w']-width)/2 if item['align']=='center' else item['x']
                y=item['y']+n*step
                pos=(x-bbox[0],y-bbox[1])
                actual=d.textbbox(pos,line,font=f)
                if 'container' in item:
                    cx,cy,cr,cb=item['container']
                    assert actual[0]>=cx+24 and actual[1]>=cy+24 and actual[2]<=cr-24 and actual[3]<=cb-24, f'Text outside its filled card: {line}'
                d.text(pos,line,font=f,fill=item['colour'])
                texts.append((actual,line,block_index))
        elif k=='rect':
            x,y,w,h=[item[v] for v in ['x','y','w','h']]
            d.rounded_rectangle((x,y,x+w,y+h),radius=24,fill=item['fill'],outline=item['outline'],width=3)
            if item['outline']:
                colour=item['outline']; pts=[(x,y),(x+w,y),(x+w,y+h),(x,y+h),(x,y)]
                # Register the actual rounded outline without painting square edges.
                radius=24
                for a,b in [((x+radius,y),(x+w-radius,y)),((x+w,y+radius),(x+w,y+h-radius)),((x+w-radius,y+h),(x+radius,y+h)),((x,y+h-radius),(x,y+radius))]:
                    strokes.append((a,b,3))
                for cx,cy,start in [(x+w-radius,y+radius,-90),(x+w-radius,y+h-radius,0),(x+radius,y+h-radius,90),(x+radius,y+radius,180)]:
                    for angle in range(start,start+90,3):
                        a=(cx+radius*math.cos(math.radians(angle)),cy+radius*math.sin(math.radians(angle)))
                        b=(cx+radius*math.cos(math.radians(angle+3)),cy+radius*math.sin(math.radians(angle+3)))
                        strokes.append((a,b,3))
        elif k=='circle':
            x,y,r=[item[v] for v in ['x','y','r']]
            d.ellipse((x-r,y-r,x+r,y+r),fill=item['fill'],outline=item['outline'],width=3)
            if item['outline']:
                for i in range(360):
                    a=(x+r*math.cos(i*math.pi/180),y+r*math.sin(i*math.pi/180))
                    b=(x+r*math.cos((i+1)*math.pi/180),y+r*math.sin((i+1)*math.pi/180))
                    strokes.append((a,b,3))
        elif k in ('line','polygon'):
            pts=item['points']
            if k=='polygon':
                d.polygon([tuple(p) for p in pts],fill=item['fill']); colour=item['outline']; pts=pts+[pts[0]]
            for a,b in zip(pts,pts[1:]):stroke(a,b,item.get('width',3))
            if item.get('arrow'):
                a,b=pts[-2:]; ang=math.atan2(b[1]-a[1],b[0]-a[0])
                for sign in [-1,1]:
                    q=(b[0]-16*math.cos(ang+sign*.46),b[1]-16*math.sin(ang+sign*.46))
                    stroke(b,q,3)
    errors=[]
    for box,label,block in texts:
        if box[0]<margin or box[1]<margin or box[2]>canvas_width-margin or box[3]>canvas_height-margin:errors.append(f'Outside safe margin: {label} {box}')
        for a,b,w in strokes:
            if segment_hits_rect(a,b,box,20+w/2):errors.append(f'Text/stroke clearance under 20 px: {label} {a} -> {b}')
    for i,(a,al,ablock) in enumerate(texts):
        for b,bl,bblock in texts[i+1:]:
            # Normal leading inside a paragraph is not a collision with another label.
            padding=0 if ablock==bblock else 20
            if a[0]<b[2]+padding and a[2]+padding>b[0] and a[1]<b[3]+padding and a[3]+padding>b[1]:errors.append(f'Text clearance under 20 px: {al} / {bl}')
    if errors:raise ValueError(spec['id']+'\n'+'\n'.join(errors[:20]))
    im.save(dest,format='PNG',optimize=False)
    return im

def load_catalogue():
    """Shared authored templates. Loading never renders or writes originals."""
    return json.loads((ROOT/'specs.json').read_text(encoding='utf-8'))

def sequence_layout(steps):
    """Two to four genuine ordered steps, with room for arrows between cards."""
    if not 2 <= len(steps) <= 4:
        raise ValueError('steps: expected 2 to 4 items')
    top,bottom=400,1192
    stride=(bottom-top)/len(steps)
    items=[]
    for i,copy in enumerate(steps):
        y=round((top+i*stride)/8)*8
        h=round((stride-64)/8)*8
        box=[168,y,912,y+h]
        items += [R(168,y,744,h),centred_text_in_box(T(copy,168,y,744,44,weight='medium'),box)]
        if i<len(steps)-1:
            next_y=round((top+(i+1)*stride)/8)*8
            items.append(L([(540,y+h+16),(540,next_y-16)],True))
    return items

def sheets(specs):
    for width,name in [(216,'contact-sheet.png'),(390,'contact-sheet-390.png')]:
        h=round(width*1350/1080); cols=4; gap=24; labelh=36
        sheet=Image.new('RGB',(cols*(width+gap)+gap,8*(h+labelh+gap)+gap),BG)
        d=ImageDraw.Draw(sheet)
        for i,s in enumerate(specs):
            x=gap+(i%cols)*(width+gap); y=gap+(i//cols)*(h+labelh+gap)
            d.text((x,y),s['id'],font=font(24,'medium'),fill=INK)
            with Image.open(ROOT/'png'/f"{s['id']}-{s['slug']}.png") as im:
                sheet.paste(im.resize((width,h),Image.Resampling.LANCZOS),(x,y+labelh))
        sheet.save(ROOT/name)

def new_sheets(specs):
    """Separate extra row. Preserve both original 32-image sheets byte for byte."""
    for width,name in [(216,'contact-sheet-new.png'),(390,'contact-sheet-new-390.png')]:
        h=round(width*1350/1080); gap=24; labelh=36
        sheet=Image.new('RGB',(len(specs)*(width+gap)+gap,h+labelh+2*gap),BG)
        d=ImageDraw.Draw(sheet)
        for i,s in enumerate(specs):
            x=gap+i*(width+gap)
            d.text((x,gap),s['id'],font=font(24,'medium'),fill=INK)
            with Image.open(ROOT/'png'/f"{s['id']}-{s['slug']}.png") as im:
                phone=im.resize((width,h),Image.Resampling.LANCZOS)
                sheet.paste(phone,(x,gap+labelh))
                if width==390:phone.save(ROOT/'qa'/f"{s['id']}-390.png")
        sheet.save(ROOT/name)


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--init',action='store_true'); parser.add_argument('--only'); parser.add_argument('--new',action='store_true'); parser.add_argument('--convert-fonts',action='store_true'); args=parser.parse_args()
    if args.convert_fonts:
        source=Path('C:/Users/jbbug/OneDrive/Documents/GitHub/soar/node_modules/@fontsource')
        for family,weight in [('outfit',700),('manrope',400),('manrope',500)]:
            path=source/family/'files'/f'{family}-latin-{weight}-normal.woff'
            assert path.exists(), f'Missing supplied font: {path}'
            with TTFont(path) as data:
                data.flavor=None
                data.recalcTimestamp=False
                data.save(ROOT/'fonts'/f'{family}-{weight}.ttf')
    for weight in ['title','body','medium']:print(weight,font(40,weight).getname())
    path=ROOT/'specs.json'
    if args.init:
        assert not path.exists(), '--init refuses to overwrite authored specs.json'
        path.write_text(json.dumps(catalogue(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    specs=json.loads(path.read_text(encoding='utf-8')); assert len(specs) in (32,37)
    # Once extras exist, a default run must never overwrite the original 32.
    extras=args.new or (len(specs)==37 and not args.only)
    if extras:specs=[s for s in specs if s['id'].startswith('NEW-')]
    failures=[]
    for s in specs:
        if args.only and args.only!=s['id']:continue
        try:
            dest=ROOT/'png'/f"{s['id']}-{s['slug']}.png"
            render(s,dest)
            with Image.open(dest) as check:assert check.size==(1080,1350) and check.mode=='RGB' and check.format=='PNG'
            print(s['id'],'PASS RGB 1080x1350, glyph and stroke checks')
        except Exception as e:failures.append(str(e)); print('FAIL',s['id'],e)
    if failures:raise SystemExit(f'{len(failures)} image(s) failed. Fix before delivery.')
    if not args.only:
        if extras:new_sheets(specs)
        else:sheets(specs)

if __name__=='__main__':main()
