const sections = {
  campanha:"Campanha Principal", bestiario:"Bestiário do Mestre", combate:"Mesa de Combate",
  missoes:"Missões Secundárias", npcs:"Personagens da Campanha", segredos:"Segredos da Névoa",
  tesouros:"Tesouros e Recompensas", diario:"Diário de Sessão", consulta:"Consulta e Improviso", livro:"Livro completo",
};
const statusNames = ["Não iniciado","Em andamento","Concluído"];
const conditions = ["Atordoado","Amedrontado","Encantado","Enraizado"];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const field = (value, missing="Não especificado") => esc(value == null || value === "" ? missing : value);
const bodyText = value => '<div class="gm-text">' + field(value) + '</div>';
const opt = (value,label,selected) => '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const btn = (label,action,id="") => '<button type="button" class="button secondary" data-gm-action="'+esc(action)+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';
const textArea = (label,name,value) => '<label>'+esc(label)+'<textarea rows="4" maxlength="16000" name="'+esc(name)+'">'+esc(value)+'</textarea></label>';
const pageMark = row => '<small class="gm-source">Livro do Mestre · p. '+esc(row.page)+'</small>';
const die = size => Math.floor(Math.random()*size)+1;
const id = () => crypto.randomUUID();
const emptyState = () => ({chapters:{},quests:{},npcs:{},revealed:{},encounters:[],custom:[],journal:[],active:""});

export function parseDice(expression) {
  const parts = /^(\d{1,2})d(\d{1,3})(?:\s*([+-])\s*(\d{1,3}))?$/i.exec(String(expression ?? "").trim());
  if (!parts || +parts[1]<1 || +parts[1]>30 || +parts[2]<2 || +parts[2]>100) return null;
  return {count:+parts[1],sides:+parts[2],bonus:(parts[3]==="-"?-1:1)*Number(parts[4]||0)};
}

export function orderCombatants(rows) {
  return [...rows].sort((left,right)=>right.initiative-left.initiative);
}

export function nextCombatTurn(encounter) {
  const order = orderCombatants(encounter.rows);
  if (!order.length) return;
  const current = order.findIndex(row=>row.id===encounter.turn);
  if (current===order.length-1) encounter.round++;
  encounter.turn = order[(current+1)%order.length].id;
}

export function createMasterTools({supabase,root,currentUser,getCharacters,onAward}) {
  let account = null;
  let book = null;
  let state = emptyState();
  let version = null;
  let section = "campanha";
  let activeRecord = "";
  let awardLog = [];
  let busy = false;
  let epoch = 0;
  let roll = "";
  let rewardDraft = null;
  const authorized = () => account && currentUser()?.id===account && currentUser()?.app_metadata?.role==="master";
  const info = () => root.querySelector(".gm-feedback");
  const feedback = (message,error=false) => {
    const target=info();
    if (target) {target.textContent=message;target.classList.toggle("gm-error",error);}
  };

  function close() {
    epoch++;
    account=null;book=null;state=emptyState();version=null;section="campanha";activeRecord="";
    awardLog=[];busy=false;roll="";rewardDraft=null;
    root.replaceChildren();
  }

  async function open() {
    const user = currentUser();
    if (user?.app_metadata?.role!=="master") return close();
    if (account===user.id && book) return;
    if (busy && account===user.id) return;
    close();
    const token = epoch;
    account=user.id;busy=true;
    root.textContent="Carregando o arquivo privado…";
    try {
      const [data,saved,awards] = await Promise.all([
        supabase.from("rpg_master_books").select("body").eq("id","ruptura-da-nevoa").maybeSingle(),
        supabase.from("rpg_master_state").select("state,version").eq("owner_id",account).maybeSingle(),
        supabase.from("rpg_master_awards").select("source,character_id,kind,detail,amount,granted_at").order("granted_at",{ascending:false}),
      ]);
      if (token!==epoch || !authorized()) return;
      if (data.error || saved.error || awards.error) throw (data.error || saved.error || awards.error);
      if (!data.data?.body) throw Error("O livro privado ainda não foi importado.");
      book=data.data.body;
      state={...emptyState(),...saved.data?.state};
      version=saved.data?.version ?? null;
      awardLog=awards.data || [];
      render();
    } catch(error) {
      if (token!==epoch) return;
      root.innerHTML='<p role="alert">Não foi possível abrir a Central. '+esc(error.message)+'</p>'+btn("Tentar novamente","reload");
    } finally { if (token===epoch) busy=false; }
  }

  async function save(change) {
    if (!authorized() || busy || !book) return;
    const token=epoch;
    const next=structuredClone(state);
    busy=true;
    feedback("Salvando…");
    try {
      change(next);
      const table=supabase.from("rpg_master_state");
      const query=version===null
        ? table.insert({owner_id:account,state:next})
        : table.update({state:next,version:version+1}).eq("owner_id",account).eq("version",version);
      const {data,error}=await query.select("version").maybeSingle();
      if (token!==epoch || !authorized()) return;
      if (error) throw error;
      if (!data) throw Error("Outro dispositivo salvou uma alteração primeiro. Recarregue a Central antes de tentar novamente.");
      state=next;
      version=data.version;
      render();
      feedback("Salvo.");
    } catch(error) {
      if (token===epoch) feedback(error.message || "Falha ao salvar.",true);
    } finally { if (token===epoch) busy=false; }
  }

  function recordNav(records,key) {
    const chosen=records.find(row=>row.id===activeRecord)||records[0];
    return {
      chosen,
      selector: '<label>Selecionar '+esc(key)+'<select data-gm-record>'+records.map(row=>opt(row.id,row.name,chosen?.id)).join("")+'</select></label>',
    };
  }

  function characterChecks(ids=[],name="characters",eligible=()=>true) {
    const rows=getCharacters().filter(eligible);
    return '<fieldset class="gm-people"><legend>Semideuses</legend>'+(
      rows.map(row=>'<label><input type="checkbox" name="'+esc(name)+'" value="'+esc(row.id)+'"'+(ids.includes(row.id)?" checked":"")+'> '+esc(row.display_name)+'</label>').join("")||'<p>Nenhuma ficha disponível.</p>'
    )+'</fieldset>';
  }

  function chapterOrQuest(quest) {
    const type=quest?"quests":"chapters";
    const {chosen:row,selector}=recordNav(book[type],quest?"missão":"capítulo");
    if (!row) return "<p>Sem registros.</p>";
    const saved=state[type][row.id]||{};
    const label=quest?row.name:"Capítulo "+row.number+" · "+row.name;
    const creatures=quest?[]:book.monsters.filter(creature=>creature.chapters?.includes(row.number));
    const shortcuts=creatures.length?'<div class="gm-actions">'+creatures.map(creature=>btn(creature.name,"visit-monster",creature.id)).join("")+'</div>':"";
    return selector+'<article class="gm-card"><h3>'+esc(label)+'</h3>'+pageMark(row)+
      (row.level?'<p>Nível recomendado '+esc(row.level)+'</p>':'')+bodyText(row.body)+shortcuts+
      '<form data-gm-form="'+type+'" data-id="'+esc(row.id)+'"><label>Progresso<select name="status">'+statusNames.map(value=>opt(value,value,saved.status||statusNames[0])).join("")+'</select></label>'+
      (quest?characterChecks(saved.players||[]):"")+textArea("Anotações privadas","note",saved.note)+
      '<button class="button gold">Salvar progresso</button></form></article>';
  }

  function monsterCard(row) {
    return '<article class="gm-card gm-monster"><h3>'+esc(row.name)+'</h3><p>'+field(row.category)+' · '+(row.boss?"Chefe ou antagonista":"Criatura")+'</p>'+
      (row.page?pageMark(row):'')+
      '<dl>'+Object.entries({PV:row.hp,Defesa:row.defense,Ataque:row.attack==null?null:'+'+row.attack,Dano:row.damage,XP:row.xp,Nível:row.level}).map(([key,value])=>'<div><dt>'+key+'</dt><dd>'+field(value)+'</dd></div>').join("")+'</dl>'+
      '<p><strong>Capítulos</strong> '+field(row.chapters?.join(", "))+'</p><p><strong>Habilidades e efeitos</strong> '+field(row.special)+'</p><p><strong>Comportamento</strong> '+field(row.behavior)+'</p>'+
      btn("Adicionar à mesa","add-enemy",row.id)+'</article>';
  }

  function bestiary() {
    const chosen=activeRecord && monsters().find(row=>row.id===activeRecord);
    return '<label>Buscar criatura<input type="search" data-gm-search placeholder="Nome ou categoria"></label>'+
      '<div class="gm-grid" data-gm-results>'+(chosen?[chosen]:monsters()).map(monsterCard).join("")+'</div>'+
      '<details class="gm-card"><summary>Criar criatura personalizada</summary><form data-gm-form="monster" class="gm-formgrid">'+
      '<label>Nome<input name="name" required maxlength="120"></label><label>Categoria<input name="category" maxlength="120"></label>'+
      ['hp','defense','attack','xp'].map((name,i)=>'<label>'+['PV','Defesa','Ataque','XP'][i]+'<input type="number" name="'+name+'" min="'+(name==="attack"?-99:0)+'" max="9999"'+(name==="hp"?' required':'')+'></label>').join("")+
      '<label>Dano (ex.: 2d6+1)<input name="damage" maxlength="20"></label><label>Nível recomendado<input name="level" maxlength="30"></label>'+
      textArea("Habilidades e efeitos","special","")+textArea("Comportamento","behavior","")+
      '<button class="button gold">Criar e salvar</button></form></details>';
  }

  const monsters = () => [...book.monsters,...state.custom];
  const currentFight = target => target.encounters.find(encounter=>encounter.id===target.active);
  function newFight(target,name) {
    const fight={id:id(),name,round:1,turn:"",rows:[],ended:false};
    target.encounters.unshift(fight);
    target.active=fight.id;
    return fight;
  }
  function addCombatant(target,template,isPlayer=false) {
    let fight=currentFight(target);
    if (!fight||fight.ended) fight=newFight(target,"Encontro sem título");
    const base=template.name ?? template.display_name;
    const count=fight.rows.filter(row=>row.base===base).length;
    if (isPlayer && fight.rows.some(row=>row.character===template.id)) throw Error("Esse jogador já está no encontro.");
    const hp=isPlayer?(template.data?.hp_current??20):template.hp;
    const max=isPlayer?(template.data?.hp_max??20):template.hp;
    fight.rows.push({
      id:id(),base,name:count?base+" #"+(count+1):base,
      character:isPlayer?template.id:null, monster:isPlayer?null:template.id,
      initiative:0,hp,max,initialHp:hp,conditions:[],
    });
  }
  function combatantCard(row,fight) {
    const monster=monsters().find(x=>x.id===row.monster);
    return '<article class="gm-card gm-turn'+(row.id===fight.turn?' gm-turn-active':'')+'"><h3>'+esc(row.name)+(row.id===fight.turn?' · turno atual':'')+'</h3>'+
      '<form class="gm-formgrid" data-gm-form="combatant" data-id="'+esc(row.id)+'">'+
      '<label>Iniciativa<input name="initiative" type="number" required min="-99" max="999" value="'+esc(row.initiative)+'"></label>'+
      '<label>PV de '+field(row.max)+'<input name="hp" type="number" required min="0" max="'+esc(row.max)+'" value="'+esc(row.hp)+'"></label>'+
      '<fieldset class="gm-people"><legend>Condições</legend>'+conditions.map(condition=>'<label><input name="conditions" type="checkbox" value="'+condition+'"'+(row.conditions.includes(condition)?" checked":"")+'> '+condition+'</label>').join("")+'</fieldset>'+
      '<button class="button gold">Salvar combatente</button></form><div class="gm-actions">'+btn("−1 PV","hurt",row.id)+btn("+1 PV","heal",row.id)+
      (monster?btn("Duplicar","duplicate",row.id)+btn("Ataque","attack",row.id)+btn("Dano","damage",row.id)+btn("Dano crítico","critical",row.id):"")+
      btn("Remover","remove",row.id)+'</div>'+
      (monster?'<details><summary>Ficha rápida</summary><p>Defesa '+field(monster.defense)+' · Ataque '+field(monster.attack)+' · Dano '+field(monster.damage)+' · XP '+field(monster.xp)+'</p><p>'+field(monster.special)+'</p><p>'+field(monster.behavior)+'</p></details>':"")+'</article>';
  }

  function combat() {
    const fight=currentFight(state);
    const forms='<form data-gm-form="new-fight" class="gm-row"><label>Novo encontro<input name="name" required maxlength="120"></label><button class="button gold">Criar encontro</button></form>'+
      '<label>Encontro salvo<select data-gm-fight>'+opt("","Escolher encontro",state.active)+state.encounters.map(row=>opt(row.id,row.name+(row.ended?" · encerrado":""),state.active)).join("")+'</select></label>';
    if(!fight)return forms;
    return forms+'<header class="gm-card"><h3>'+esc(fight.name)+'</h3><p>Rodada '+fight.round+(fight.ended?' · Encerrado':'')+'</p><div class="gm-actions">'+
      btn("Próximo turno","next")+btn("Preparar XP por encontro","encounter-xp")+btn("Reiniciar","restart")+(fight.ended?btn("Reabrir","resume"):btn("Encerrar","end"))+'</div>'+
      '<output aria-live="polite" class="gm-roll">'+esc(roll)+'</output></header>'+
      (fight.ended?"":
      '<form data-gm-form="add-combatants" class="gm-formgrid"><label>Criatura<select name="monster">'+opt("","Selecionar…","")+monsters().map(row=>opt(row.id,row.name)).join("")+'</select></label>'+
      '<label>Quantidade<input type="number" name="quantity" value="1" min="1" max="20"></label><label>Jogador<select name="player">'+opt("","Selecionar…","")+getCharacters().map(row=>opt(row.id,row.display_name)).join("")+'</select></label>'+
      '<button class="button gold">Adicionar à ordem</button></form>')+
      '<div class="gm-grid">'+orderCombatants(fight.rows).map(row=>combatantCard(row,fight)).join("")+'</div>';
  }

  function people() {
    const {chosen:row,selector}=recordNav(book.npcs,"personagem");
    if(!row)return "";
    return selector+'<article class="gm-card"><h3>'+esc(row.name)+'</h3>'+pageMark(row)+
      '<h4>Informações públicas</h4><p>'+field(row.description)+'</p><p><strong>Interpretação e aparência</strong> '+field(row.roleplay)+'</p>'+
      '<h4>Informações do mestre</h4><p><strong>Papel</strong> '+field(row.role)+'</p><p><strong>Segredo</strong> '+field(row.secret)+'</p><p><strong>Capítulos relacionados</strong> '+field(row.chapters?.join(", "))+'</p>'+
      '<form data-gm-form="npc" data-id="'+esc(row.id)+'">'+textArea("Anotações privadas","note",state.npcs[row.id])+'<button class="button gold">Salvar anotações</button></form></article>'+
      '<details class="gm-card"><summary>Relações do elenco no livro</summary>'+bodyText(book.pages.find(x=>x.page===7)?.body.split("Relações em uma frase").at(-1))+'</details>';
  }

  function secrets() {
    return '<article class="gm-card">'+bodyText(book.pages.find(x=>x.page===6)?.body)+'</article>'+
      '<h3>Registro de revelações</h3>'+book.secrets.map(row=>'<label class="gm-card gm-check"><input type="checkbox" data-gm-reveal="'+esc(row.id)+'"'+(state.revealed[row.id]?" checked":"")+'><span><strong>'+esc(row.name)+'</strong><br>'+esc(row.body)+'</span></label>').join("");
  }

  function rewards() {
    const sources=[...book.chapters,...book.quests];
    const draft=rewardDraft;
    return '<div class="gm-grid">'+book.items.map(row=>'<article class="gm-card"><h3>'+esc(row.name)+'</h3>'+pageMark(row)+bodyText(row.body)+'</article>').join("")+'</div>'+
      '<details class="gm-card"><summary>Regras e ritual de relíquias</summary>'+bodyText(book.pages.find(row=>row.page===21)?.body)+'</details>'+
      '<form data-gm-form="award" class="gm-card"><h3>Registrar recompensa</h3><div class="gm-formgrid">'+
      '<label>Tipo<select name="kind">'+opt("xp","XP")+opt("item","Item ou recompensa")+opt("relic","Liberação de relíquia")+'</select></label>'+
      '<label>Origem<select name="source">'+opt("","Outra origem")+
      sources.map(row=>opt(row.id,row.name)).join("")+'</select></label>'+
      '<label>Referência para outra origem<input name="reference" maxlength="90" placeholder="Ex.: Sessão 5, desafio da ponte" value="'+esc(draft?.reference)+'"></label>'+
      '<label>XP por personagem<input name="amount" type="number" min="0" max="9999" value="'+esc(draft?.xp??0)+'"></label>'+
      '<label>Descrição<input name="detail" required maxlength="360" value="'+esc(draft?.name)+'"></label>'+
      '<label class="gm-check"><input name="ritual" type="checkbox"> Ritual individual concluído</label></div>'+
      characterChecks(draft?.players||[])+'<p>Para o mesmo objetivo, escolha XP por capítulo ou encontro. Use a mesma origem para bloquear a repetição; missões secundárias usam suas próprias origens.</p>'+
      '<button class="button gold">Registrar e aplicar</button></form>'+
      '<section class="gm-card"><h3>Recompensas registradas</h3>'+
      (awardLog.length?'<ul>'+awardLog.map(row=>'<li>'+esc(getCharacters().find(x=>x.id===row.character_id)?.display_name||"Semideus")+
      ' · '+esc(row.detail)+(row.kind==="xp"?" · "+esc(row.amount)+" XP":"")+' · '+esc(row.source)+'</li>').join("")+'</ul>':'<p>Sem recompensas registradas.</p>')+'</section>';
  }

  function journal() {
    return '<form data-gm-form="journal" class="gm-card"><label>Tipo<select name="type">'+["Sessão","Acontecimento","Escolha importante"].map(x=>opt(x,x)).join("")+'</select></label>'+
      '<label>Título<input name="title" maxlength="120" required></label>'+textArea("Registro privado","note","")+'<button class="button gold">Adicionar ao diário</button></form>'+
      state.journal.map(row=>'<article class="gm-card"><h3>'+esc(row.title)+'</h3><p>'+esc(row.type)+' · '+esc(new Date(row.at).toLocaleDateString("pt-BR"))+'</p>'+bodyText(row.note)+'</article>').join("");
  }

  function readings(all) {
    const numbers=all?book.pages.map(row=>row.page):[3,4,5,22,23,24];
    return (all?"":'<div class="gm-actions">'+btn("Rolar rumor","rumor")+btn("Rolar complicação","travel")+'</div><output class="gm-roll" aria-live="polite">'+esc(roll)+'</output>')+
      numbers.map(page=>'<details class="gm-card"><summary>Página '+page+'</summary>'+bodyText(book.pages.find(row=>row.page===page)?.body)+'</details>').join("");
  }

  function render() {
    if (!authorized()||!book) return;
    const routes={campanha:()=>chapterOrQuest(false),missoes:()=>chapterOrQuest(true),bestiario:bestiary,
      combate:combat,npcs:people,segredos:secrets,tesouros:rewards,diario:journal,consulta:()=>readings(false),livro:()=>readings(true)};
    root.innerHTML='<div class="gm-layout"><nav class="gm-menu" aria-label="Ferramentas privadas">'+Object.entries(sections).map(([key,label])=>
      '<button type="button" data-gm-section="'+key+'"'+(section===key?' aria-current="page"':'')+'>'+esc(label)+'</button>').join("")+
      '</nav><section class="gm-main" aria-label="'+esc(sections[section])+'"><header class="gm-heading"><h2>'+esc(sections[section])+'</h2>'+
      '<p class="gm-feedback" role="status"></p></header>'+routes[section]()+'</section></div>';
  }

  async function award(data) {
    const kind=data.get("kind");
    const recipients=data.getAll("characters");
    const source=data.get("source")||data.get("reference").trim();
    if(!recipients.length||(!source&&kind!=="relic")) return feedback("Informe a origem e os semideuses.",true);
    if(kind==="xp"&&Number(data.get("amount"))<1)return feedback("Informe pelo menos 1 XP.",true);
    if(kind==="relic"&&!data.has("ritual"))return feedback("Confirme o ritual individual para autorizar a relíquia.",true);
    const token=epoch;
    busy=true;feedback("Registrando…");
    try {
      const result=await supabase.rpc("rpg_master_grant",{
        p_source:source||"ritual",p_characters:recipients,p_kind:kind,p_detail:data.get("detail"),
        p_amount:kind==="xp"?Number(data.get("amount")):0,p_ritual_confirmed:data.has("ritual"),
      });
      if (token!==epoch||!authorized())return;
      if(result.error)throw result.error;
      const rows=await supabase.from("rpg_master_awards").select("source,character_id,kind,detail,amount,granted_at").order("granted_at",{ascending:false});
      if (token!==epoch||!authorized())return;
      if(rows.error) throw rows.error;
      awardLog=rows.data;rewardDraft=null;render();
      feedback(result.data?result.data+" registro(s) aplicado(s).":"Essa recompensa já foi registrada para os selecionados.");
      if(result.data&&kind!=="item") void onAward();
    } catch(error){if(token===epoch)feedback(error.message||"Falha ao registrar.",true);}
    finally {if(token===epoch)busy=false;}
  }

  root.addEventListener("submit",event=>{
    const form=event.target.closest("[data-gm-form]");
    if(!form)return;
    event.preventDefault();
    if(!authorized()||busy||!book)return;
    const data=new FormData(form);
    const key=form.dataset.id;
    const change={
      chapters:next=>{next.chapters[key]={status:data.get("status"),note:data.get("note")};},
      quests:next=>{next.quests[key]={status:data.get("status"),note:data.get("note"),players:data.getAll("characters")};},
      npc:next=>{next.npcs[key]=data.get("note");},
      journal:next=>next.journal.unshift({type:data.get("type"),title:data.get("title"),note:data.get("note"),at:new Date().toISOString()}),
      monster:next=>{
        const value=Object.fromEntries(data);
        for(const k of ["hp","defense","attack","xp"])value[k]=value[k]===""?null:Number(value[k]);
        if(value.damage&&!parseDice(value.damage))throw Error("Use uma fórmula de dano válida, como 2d6+1.");
        next.custom.push({...value,id:id()});
      },
      "new-fight":next=>newFight(next,data.get("name")),
      "add-combatants":next=>{
        const monster=monsters().find(row=>row.id===data.get("monster"));
        const player=getCharacters().find(row=>row.id===data.get("player"));
        if(!monster&&!player)throw Error("Selecione pelo menos um combatente.");
        if(monster)for(let i=0;i<Number(data.get("quantity"));i++)addCombatant(next,monster);
        if(player)addCombatant(next,player,true);
      },
      combatant:next=>{
        const row=currentFight(next).rows.find(item=>item.id===key);
        row.initiative=Number(data.get("initiative"));row.hp=Number(data.get("hp"));row.conditions=data.getAll("conditions");
      },
    };
    if(form.dataset.gmForm==="award")void award(data);
    else if(change[form.dataset.gmForm])void save(change[form.dataset.gmForm]);
  });

  root.addEventListener("input",event=>{
    if(!authorized()||!book||!event.target.matches("[data-gm-search]"))return;
    const text=event.target.value.trim().toLocaleLowerCase("pt-BR");
    const matches=monsters().filter(row=>(row.name+" "+(row.category||"")).toLocaleLowerCase("pt-BR").includes(text));
    root.querySelector("[data-gm-results]").innerHTML=matches.map(monsterCard).join("")||"<p>Nenhuma criatura encontrada.</p>";
  });

  root.addEventListener("change",event=>{
    if(!authorized()||!book)return;
    const element=event.target;
    if(element.matches("[data-gm-record]")){activeRecord=element.value;render();}
    if(element.matches("[data-gm-reveal]"))void save(next=>{next.revealed[element.dataset.gmReveal]=element.checked;});
    if(element.matches("[data-gm-fight]"))void save(next=>{next.active=element.value;});
  });

  root.addEventListener("click",event=>{
    if(!authorized())return;
    const menu=event.target.closest("[data-gm-section]");
    if(menu&&book){section=menu.dataset.gmSection;activeRecord="";roll="";render();root.querySelector('[aria-current="page"]')?.focus();return;}
    const element=event.target.closest("[data-gm-action]");
    if(!element||busy)return;
    const action=element.dataset.gmAction;
    if(action==="reload"){void open();return;}
    if(!book)return;
    const key=element.dataset.id;
    const encounter=currentFight(state);
    const row=encounter?.rows.find(x=>x.id===key);
    const monster=monsters().find(x=>x.id===row?.monster);
    if(["attack","damage","critical"].includes(action)&&monster) {
      if(action==="attack"&&monster.attack!=null) {
        const d20=die(20);
        roll=monster.name+" · "+d20+" + ("+monster.attack+") = "+(d20+monster.attack)+(d20===20?" · crítico natural":"");
      } else {
        const dice=action==="attack"?null:parseDice(monster.damage);
        if(!dice)roll="Valor não especificado no registro.";
        else {
          const rolls=Array.from({length:dice.count*(action==="critical"?2:1)},()=>die(dice.sides));
          roll=monster.name+" · "+rolls.join(" + ")+" + ("+dice.bonus+") = "+(rolls.reduce((a,b)=>a+b,0)+dice.bonus);
        }
      }
      root.querySelector(".gm-roll").textContent=roll;
      return;
    }
    if(action==="rumor"||action==="travel") {
      const body=book.pages.find(row=>row.page===22)?.body||"";
      const part=body.split("Complicações em viagem");
      const table=action==="rumor"?part[0]:part[1]||"";
      const n=die(6);
      const result=table.split(/\n\s*\n/).find(line=>new RegExp("^\\s*"+n+"\\s{2,}").test(line))?.replace(/\s+/g," ");
      roll="1d6 → "+n+" · "+(result?.trim()||"Consulte a página 22.");
      root.querySelector(".gm-roll").textContent=roll;
      return;
    }
    if(action==="visit-monster") {section="bestiario";activeRecord=key;render();return;}
    if(action==="encounter-xp"&&encounter) {
      const players=encounter.rows.map(entry=>entry.character).filter(Boolean);
      const total=encounter.rows.filter(entry=>entry.hp===0 && entry.monster)
        .reduce((sum,entry)=>sum+(monsters().find(creature=>creature.id===entry.monster)?.xp||0),0);
      if(!players.length||!total)return feedback("Inclua os jogadores e registre os inimigos derrotados antes de dividir o XP.",true);
      rewardDraft={name:encounter.name,reference:"encontro:"+encounter.id,players,xp:Math.floor(total/players.length)};
      section="tesouros";activeRecord="";render();
      feedback(total+" XP de criaturas derrotadas, dividido entre "+players.length+" participantes. Para o objetivo de um capítulo, selecione esse capítulo como origem.");
      return;
    }
    if(action==="add-enemy") {
      const template=monsters().find(x=>x.id===key);
      if(!template)return;
      section="combate";void save(next=>addCombatant(next,template));return;
    }
    if(!encounter)return;
    const updates={
      next:fight=>{if(!fight.ended)nextCombatTurn(fight);},
      restart:fight=>{fight.ended=false;fight.turn="";fight.round=1;for(const entry of fight.rows){entry.hp=entry.initialHp;entry.conditions=[];}},
      end:fight=>{fight.ended=true;},
      resume:fight=>{fight.ended=false;},
      remove:fight=>{fight.rows=fight.rows.filter(x=>x.id!==key);if(fight.turn===key)fight.turn="";},
      duplicate:(fight,next)=>{if(monster)addCombatant(next,monster);},
      hurt:fight=>{const target=fight.rows.find(x=>x.id===key);target.hp=Math.max(0,target.hp-1);},
      heal:fight=>{const target=fight.rows.find(x=>x.id===key);target.hp=Math.min(target.max,target.hp+1);},
    };
    if(action==="restart"&&!confirm("Reiniciar rodada, PV e condições deste encontro?"))return;
    if(updates[action])void save(next=>updates[action](currentFight(next),next));
  });
  return {open,close,refreshCharacters:()=>{if (!busy && !root.querySelector("form :focus")) render();}};
}
