from pathlib import Path
import csv,json,re,subprocess,sys
if len(sys.argv)!=3:
 raise SystemExit('Uso: python3 prepare-master-book.py Livro.pdf DIRETORIO_PRIVADO')
source=subprocess.check_output(['pdftotext','-layout',sys.argv[1],'-'],text=True)
pages={}
for i,raw in enumerate(source.split('\f')[:24],1):
 lines=[line.rstrip() for line in raw.splitlines() if not re.match(r'^(HERÓIS DO OLIMPO / LIVRO DO MESTRE|A RUPTURA DA NÉVOA\s+\d{2})\s*$',line.strip())]
 pages[i]='\n'.join(line[1:] if line.startswith(' ') else line for line in lines).strip()
book={'pages':[{'page':n,'body':text} for n,text in pages.items()]}
chapters=[]
for page in range(8,16):
 title=re.search(r'Capítulo (\d+) • (.+)',pages[page])
 num=int(title[1])
 chapters.append({'id':f'capitulo-{num}','name':title[2],'number':num,'level':f'{num}–{num+1}','page':page,'body':pages[page][title.end():].strip()})
book['chapters']=chapters
quests=[]
for page in (16,17):
 for match in re.finditer(r'^SQ(\d+) • (.+)\n([\s\S]*?)(?=^SQ\d+ • |\Z)',pages[page],re.M):
  quests.append({'id':f'missao-{match[1]}','name':match[2],'page':page,'body':match[3].strip()})
book['quests']=quests
monster_links=[
 [1,2,3],[1,7],[2],[],[6],[3],[4],[5],[6],[8],[7],[4],[5],[1,3,6,7,8],[2,3,6,7,8],[8]]
monster_levels=['1–3']*6+['4–6']*4+[None]*6
monsters=[]
for page in (18,19,20):
 matches=list(re.finditer(r'^(.+?) \| ([^|\n]+?)\s*(?:\|\s*)?PV (\d+) • DEF (\d+) • Ataque (\+\d+) • Dano (\d+d\d+(?:\+\d+)?) • XP sugerido (\d+)\s*\n(Especial:[\s\S]*?)(?=\n\s*\n|\Z)',pages[page],re.M))
 for m in matches:
  current=len(monsters)
  content=re.split(r'\n\s*Como atua:',m[8],maxsplit=1)
  monsters.append({'id':f'criatura-{current+1}','name':m[1].strip(),'category':m[2].strip(),'boss':page==20,'hp':int(m[3]),'defense':int(m[4]),'attack':int(m[5]),'damage':m[6],'xp':int(m[7]),'level':monster_levels[current],'chapters':monster_links[current],'special':content[0].removeprefix('Especial: ').replace('\n',' ').strip(),'behavior':content[1].replace('\n',' ').strip(),'page':page})
book['monsters']=monsters
npc_links=[[1],[1,3,7],[2,6],[1,3,6,7,8],[2,3,6,7,8],[4]]
npcs=[]
for m in re.finditer(r'^([^\n]+)\nQuem é: ([^\n]+)\nInterpretação: ([^\n]+)\nSegredo: ([^\n]+)\nNa mesa: ([^\n]+)',pages[7],re.M):
 n=len(npcs)
 npcs.append({'id':f'npc-{n+1}','name':m[1].strip(),'description':m[2],'roleplay':m[3],'secret':m[4],'role':m[5],'page':7,'chapters':npc_links[n]})
book['npcs']=npcs
book['secrets']=[{'id':f'segredo-{i+1}','name':m[1].strip(),'body':m[2].replace('\n',' ').strip(),'page':6} for i,m in enumerate(re.finditer(r'^• (Capítulo \d+): ([\s\S]+?)(?=\n\s*\n|\Z)',pages[6],re.M))]
book['items']=[]
reward_text=pages[21].split('Economia',1)[0]
for i,m in enumerate(re.finditer(r'^\s*(\S[^\n]+?) {4,}(\S[^\n]+(?:\n {8,}\S[^\n]+)*)',reward_text,re.M)):
 if m[1].strip()=='Recurso': continue
 book['items'].append({'id':f'item-{i}','name':m[1].strip(),'body':' '.join(x.strip() for x in m[2].splitlines()),'page':21})
assert [len(book[x]) for x in ['pages','chapters','quests','monsters','npcs','secrets','items']]==[24,8,10,16,6,3,8],{k:len(v) for k,v in book.items()}
out=Path(sys.argv[2]).resolve()
out.mkdir(parents=True,exist_ok=True)
blob=json.dumps(book,ensure_ascii=False,separators=(',',':'))
(out/'book.json').write_text(blob)
with (out/'book.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['id','body']);w.writerow(['ruptura-da-nevoa',blob])
(out/'install.sql').write_text((Path(__file__).resolve().parent/'master-schema.sql').read_text()+'\ninsert into public.rpg_master_books(id,body) values (\'ruptura-da-nevoa\',$livro$'+blob+'$livro$::jsonb) on conflict (id) do update set body=excluded.body;\n')
print({k:len(v) for k,v in book.items()})
print(len(blob.encode()))
