import json,subprocess,sys,pathlib
p=pathlib.Path(__file__).parent
label=sys.argv[1]
d=json.loads(subprocess.check_output(['agent-desktop','snapshot','--app','Wonder','--compact']))
(p/(label+'.ax.json')).write_text(json.dumps(d,indent=2))
def walk(n):
 if n.get('name') or n.get('value'): print(n.get('ref_id',''),n.get('role'),n.get('name',''),n.get('value',''),n.get('states',[]))
 for c in n.get('children',[]): walk(c)
walk(d['data']['tree'])
subprocess.run(['screencapture','-x','-l','171','-o',str(p/(label+'.png'))])
