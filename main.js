import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { ATTRS, GODS, ITEMS, DC, derived, xpFor, levelUp, validateCharacter, sheetList, sheetAttributes } from "./rules.js";
import { themeForDeity, themeForCharacter } from "./themes.js";
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let user=null,master=false,characters=[],profiles=[],selected=null,editId=null,portraitUrl=null,authMode="login",currentPage="fichas";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const notify=(s,bad=false)=>{const t=$("#toast");t.textContent=s;t.classList.toggle("error",bad);t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3200)};
const listFields = ["saves","skills","attacks","weapons","relics","inventory","companions","talents"];
$("#parent-deity").insertAdjacentHTML("beforeend",`<option value="" selected disabled>Escolha um progenitor</option>${GODS.map(g=>`<option value="${g.name}">${g.name}</option>`).join("")}`);
$("#filter-deity").insertAdjacentHTML("beforeend",GODS.map(g=>`<option>${g.name}</option>`).join(""));
$("#filter-item-type").insertAdjacentHTML("beforeend",[...new Set(ITEMS.map(x=>x.type))].map(x=>`<option>${x}</option>`).join(""));
function setAuth(mode){authMode=mode;const signup=mode==="signup";$("#display-name-wrap").classList.toggle("hidden",!signup);$("#auth-title").textContent=signup?"Criar conta":"Entrar na conta";$("#auth-submit").textContent=signup?"Criar conta":"Entrar";$("#auth-toggle").textContent=signup?"Já tenho uma conta":"Criar conta";$("#auth-password").autocomplete=signup?"new-password":"current-password";$("#auth-message").textContent="";}
$("#auth-toggle").onclick=()=>setAuth(authMode==="signup"?"login":"signup");
$("#forgot-password").onclick=async()=>{const email=$("#auth-email").value.trim();if(!email)return $("#auth-message").textContent="Digite seu e-mail primeiro.";const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});$("#auth-message").textContent=error?error.message:"Se a conta existir, enviaremos instruções para redefinir a senha.";};
$("#auth-form").onsubmit=async e=>{e.preventDefault();const msg=$("#auth-message"),email=$("#auth-email").value.trim(),password=$("#auth-password").value;$("#auth-submit").disabled=true;msg.textContent="Conectando ao acampamento…";let result;if(authMode==="signup")result=await supabase.auth.signUp({email,password,options:{data:{display_name:$("#auth-display-name").value.trim()},emailRedirectTo:location.origin}});else result=await supabase.auth.signInWithPassword({email,password});$("#auth-submit").disabled=false;if(result.error){msg.textContent=result.error.message;return;}if(authMode==="signup"&&!result.data.session){msg.textContent="Conta criada. Confirme o e-mail para entrar; o projeto exige confirmação no Auth.";return;}msg.textContent="";await openApp(result.data.user);};
$("#sign-out").onclick=()=>supabase.auth.signOut();
supabase.auth.onAuthStateChange((_event,session)=>{if(session?.user)openApp(session.user);else{user=null;master=false;characters=[];profiles=[];selected=null;editId=null;$("#character-dialog").close();$("#full-sheet").replaceChildren();$("#character-detail").replaceChildren();$("#character-list").replaceChildren();$("#progress-list").replaceChildren();refreshSheetPermissions();delete document.documentElement.dataset.theme;nav("fichas");$("#app-view").classList.add("hidden");$("#auth-view").classList.remove("hidden");}});
async function openApp(u){if(!u)return;const firstVisit=user?.id!==u.id;user=u;master=u.app_metadata?.role==="master";$("#auth-view").classList.add("hidden");$("#app-view").classList.remove("hidden");$("#account-email").textContent=u.email||"";$("#role-badge").classList.toggle("hidden",!master);$("#export-campaign").classList.toggle("hidden",!master);refreshSheetPermissions();nav(master&&firstVisit?"mestre":currentPage);await supabase.from("rpg_profiles").upsert({id:u.id,email:u.email,display_name:u.user_metadata?.display_name||u.email?.split("@")[0]},{onConflict:"id"});await loadData();}
async function loadData() {
  const account = user;
  const isMaster = master;
  if (!account) return;

  let query = supabase.from("rpg_characters").select("*").order("updated_at",{ascending:false});
  if (!isMaster) query = query.eq("owner_id",account.id);
  const [sheets, players] = await Promise.all([
    query,
    isMaster ? supabase.from("rpg_profiles").select("id,email,display_name").order("email") : Promise.resolve({data:[]}),
  ]);
  if (user?.id !== account.id || master !== isMaster) return;
  if (sheets.error) {
    notify("Não foi possível carregar as fichas: "+sheets.error.message,true);
    return;
  }
  if (players.error) notify("Erro ao carregar nomes dos jogadores: "+players.error.message,true);

  const rows = (sheets.data || []).filter(row => isMaster || row.owner_id === account.id);
  await Promise.all(rows.map(async row => {
    const data = dataOf(row);
    if (data.portrait_path) {
      const signed = await supabase.storage.from("character-portraits").createSignedUrl(data.portrait_path,3600);
      if (!signed.error) data.portrait_url = signed.data.signedUrl;
      row.portraitUrl = data.portrait_url;
    }
  }));
  if (user?.id !== account.id || master !== isMaster) return;
  characters = rows;
  profiles = isMaster ? players.data || [] : [];
  selected = characters.find(row => row.id === selected?.id) || (isMaster ? null : characters[0] || null);
  render();
}
function canEditSheet(row) {
  return Boolean(user && row && (master || row.owner_id === user.id));
}
function refreshSheetPermissions() {
  $("#master-nav").classList.toggle("hidden", !master);
  for (const id of ["campaign-metrics","campaign-filters","campaign-roster"]) {
    document.getElementById(id).classList.toggle("hidden",!master);
  }
  $("#content-grid").classList.toggle("personal-sheet",!master);
  $("#own-sheet-picker").classList.toggle("hidden",master || characters.length < 2);
  if (!master) {
    $("#own-sheet").innerHTML = characters.map(row => `<option value="${esc(row.id)}">${esc(row.display_name)}</option>`).join("");
    $("#own-sheet").value = selected?.id || "";
  } else {
    $("#own-sheet").replaceChildren();
  }
}
$("#own-sheet").onchange = event => {
  if (master) return;
  selected = characters.find(row => row.id === event.target.value && canEditSheet(row)) || null;
  render();
};
function dataOf(character) {
  const data = {...(character.data || {attrs:{},hp_max:20,hp_current:20})};
  delete data.mana;
  return {...data,theme:themeForCharacter(character).id};
}
function visible(){const term=$("#search-characters").value.toLocaleLowerCase("pt-BR"),deity=$("#filter-deity").value;return characters.filter(c=>(!deity||c.parent_deity===deity)&&(!term||[c.display_name,c.parent_deity,dataOf(c).player_name,...profiles.filter(profile=>profile.id===c.owner_id).flatMap(profile=>[profile.display_name,profile.email])].join(" ").toLocaleLowerCase("pt-BR").includes(term)));}
function render(){refreshSheetPermissions();renderMasterSummary();const rows=master?visible():characters,activeTheme=selected?themeForCharacter(selected):null;if(activeTheme)document.documentElement.dataset.theme=activeTheme.id;else delete document.documentElement.dataset.theme;$("#metric-count").textContent=characters.length;$("#visible-count").textContent=rows.length;$("#metric-level").textContent=characters.length?(characters.reduce((n,c)=>n+(+c.level||1),0)/characters.length).toFixed(1):"—";$("#character-list").innerHTML=!master?"":rows.length?rows.map(c=>{const theme=themeForCharacter(c);return `<button class="character-card ${selected?.id===c.id?"selected":""}" data-theme="${theme.id}" data-id="${esc(c.id)}"><span class="avatar">${esc(c.display_name?.slice(0,1)||"✦")}</span><span><b>${esc(c.display_name)}</b><small>${esc(c.parent_deity)} · Nível ${c.level}${master?` · ${esc(dataOf(c).player_name||profiles.find(p=>p.id===c.owner_id)?.email||"")}`:""}</small></span><span class="chevron">›</span></button>`}).join(""):"<p class='empty-state'>Nenhuma ficha ainda. Crie uma para começar sua jornada.</p>";$$(".character-card").forEach(b=>b.onclick=()=>{selected=characters.find(x=>x.id===b.dataset.id);render();});$("#character-detail").innerHTML=selected&&rows.some(x=>x.id===selected.id)?detail(selected):`<div class="detail-empty"><span>✧</span><h2>${master?"Escolha uma ficha":"Sua ficha ainda não foi criada"}</h2><p>${master?"Selecione um personagem na lista.":"Use Nova ficha para criar seu semideus."}</p></div>`;if(activeTheme)$("#character-detail").dataset.theme=activeTheme.id;else delete $("#character-detail").dataset.theme;renderFullSheet();$$("[data-open-sheet]").forEach(b=>b.onclick=openFullSheet);$$("[data-edit]").forEach(b=>b.onclick=()=>openEditor(selected));$("#progress-list").innerHTML=characters.map(c=>{const d=dataOf(c),need=xpFor(+c.level),theme=themeForCharacter(c);return `<article class="progress-card" data-theme="${theme.id}"><div><p class="kicker">${esc(c.parent_deity)}</p><h3>${esc(c.display_name)}</h3><p>Nível ${c.level} · ${+d.xp||0} XP ${need?`/ ${need} XP para evoluir`:"· nível máximo"}</p></div><button class="button secondary" data-progress="${c.id}" ${!master?"disabled":""}>Aplicar evolução</button></article>`}).join("")||"<p class='empty-state'>Crie uma ficha para acompanhar a progressão.</p>";$$("[data-progress]").forEach(b=>b.onclick=()=>progress(b.dataset.progress));renderItems();renderRules();}
function detail(c,full=false){const d=dataOf(c),a=sheetAttributes(d),stats=derived(a,d.armor_bonus||0),g=GODS.find(x=>x.name===c.parent_deity),theme=themeForCharacter(c);const photo=c.portraitUrl||d.portrait_url;const portrait=photo?`<img class="portrait" src="${esc(photo)}" alt="Retrato de ${esc(c.display_name)}">`:`<div class="portrait-placeholder">${esc(c.display_name?.slice(0,1)||"✦")}</div>`;return `<div class="theme-banner" data-theme="${theme.id}"><span class="theme-banner-symbol" aria-hidden="true">${theme.symbol}</span><div><p class="kicker">FICHA · FILHO(A) DE ${esc(theme.deity.toLocaleUpperCase("pt-BR"))}</p><h2>${esc(theme.epithet)}</h2></div><span class="theme-banner-level">NÍVEL ${c.level}</span></div><div class="hero-card" data-theme="${theme.id}">${portrait}<div class="hero-info"><p class="kicker">${esc(c.parent_deity)} · NÍVEL ${c.level}</p><h2${full?' id="full-sheet-title" tabindex="-1"':""}>${esc(c.display_name)}</h2><p>${esc(d.tagline||"Filho do Olimpo, herói da campanha.")}</p><div class="sheet-actions">${master&&!full?'<button type="button" class="button gold" data-open-sheet>Abrir ficha</button>':''}${canEditSheet(c)?'<button type="button" class="button secondary" data-edit>Editar ficha</button>':''}</div></div></div><div class="stat-strip" data-theme="${theme.id}"><div><small>PONTOS DE VIDA</small><b>${d.hp_current??20}<i> / ${d.hp_max??20}</i></b></div><div><small>DEFESA</small><b>${stats.defense}</b></div><div><small>XP</small><b>${d.xp||0}<i> / ${xpFor(+c.level)||"—"}</i></b></div></div><div class="detail-block" data-theme="${theme.id}"><h3>Atributos</h3><div class="attribute-bars">${Object.entries(ATTRS).map(([k,n])=>`<div><span>${n}</span><b>${a[k]||0}</b></div>`).join("")}</div></div><div class="detail-block" data-theme="${theme.id}"><h3>Poder de linhagem</h3><p><b>${esc(g?.power||"Não registrado")}</b>${g?' <span class="muted">· 1 uso por combate</span>':''}</p></div><div class="detail-block" data-theme="${theme.id}"><h3>Perícias & poderes</h3><p>${esc([...sheetList(d.skills),...sheetList(d.attacks)].join(" · ")||"Sem registros")}</p></div><div class="detail-block" data-theme="${theme.id}"><h3>História</h3><p>${esc(d.backstory||"Ainda não registrada.")}</p></div>${full?"":`<div class="detail-block"><h3>Inventário</h3><p class="sheet-inventory">${esc(sheetList(d.inventory).join("\n")||"Sem itens.")}</p></div>`}`;}
function renderItems(){const term=$("#search-items").value.trim().toLocaleLowerCase("pt-BR"),type=$("#filter-item-type").value;$("#item-grid").innerHTML=ITEMS.filter(x=>(!type||x.type===type)&&(!term||Object.values(x).join(" ").toLocaleLowerCase("pt-BR").includes(term))).map(x=>`<article class="item-card"><span>${esc(x.type)}</span><h3>${esc(x.name)}</h3><p>${esc(x.effect)}</p><small>${esc(x.price)}</small></article>`).join("")||'<p class="empty-state">Nenhum item encontrado.</p>';}
function renderRules(){$("#rules-content").innerHTML=`<article class="rule-card"><h3>Testes de perícia</h3><p role="math">1d20 + atributo contra a dificuldade do mestre.</p>${DC.map(([n,v])=>`<p><b>${n}: CD ${v}</b></p>`).join("")}<p>Vantagem: role 2d20 e use o maior. Desvantagem: use o menor.</p></article><article class="rule-card"><h3>Atributos e combate</h3><p>Na criação: distribua +3, +2, +2, +1, +1 e +0 entre os seis atributos; depois aplique o bônus divino.</p><p>Defesa 10 + Agilidade + equipamento. Iniciativa: 1d20 + Instinto. Ataque corpo a corpo: Força; à distância: Agilidade; poderes: Vontade ou Intelecto.</p><p>Turno: mover-se, 1 ação principal e 1 ação simples. Arma leve 1d6, média 2d6, pesada 3d6. 20 natural dobra os dados de dano.</p></article><article class="rule-card"><h3>Descanso e evolução</h3><p>Descanso curto: recupere 1d6 + Vontade em PV, uma vez por cena.</p><p>XP para subir: nível atual +1, multiplicado por 10. Ao subir, zera XP, ganha +5 PV máximo e escolhe +1 atributo ou poder aprovado; limite nível 20.</p><p>Relíquia divina: a partir do nível 4, com permissão do mestre; 1 uso por combate.</p></article><article class="rule-card"><h3>Equipamento inicial</h3><p>Arma simples, mochila, cantil, 3 rações, roupas e item pessoal. 100 moedas de ouro e 50 de prata (10 pratas = 1 ouro).</p><p>Armadura de Treinamento gratuita: +2 Defesa, -3 Furtividade e -1 Movimento.</p></article><article class="rule-card"><h3>Progenitores divinos</h3><div class="god-grid">${GODS.map(g=>`<p><b>${g.name}</b><br>+2 ${g.bonus}<br>${g.power}</p>`).join("")}</div></article>`;}
function renderMasterSummary() {
  if (!master) return;
  const playerCount = new Set(characters.map(row => row.owner_id).filter(id => id && id !== user?.id)).size;
  const average = characters.length
    ? new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(
        characters.reduce((total,row) => total + (Number(row.level) || 1),0) / characters.length,
      )
    : "—";
  $("#master-sheet-count").textContent = characters.length;
  $("#master-player-count").textContent = playerCount;
  $("#master-average-level").textContent = average;
}

function nav(page) {
  if ((page === "mestre" && !master) || (page === "personagem" && (!master || !selected))) page = "fichas";
  $("#app-view").classList.toggle("master-home", page === "mestre");
  currentPage = page;
  const navPage = page === "personagem" ? "fichas" : page;
  $$(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === navPage));
  $$(".page-section").forEach(section => section.classList.toggle("hidden", section.id !== `page-${page}`));
  $("#welcome-strip").classList.toggle("hidden", page === "arsenal" || page === "personagem" || page === "mestre");
  const labels = {
    fichas: master ? ["Registro de semideuses", "Consulte e organize as fichas da campanha."] : ["Minha ficha", "Edite os atributos, a história e o equipamento do seu semideus."],
    progresso: ["Jornada dos heróis", "Acompanhe XP e evolução dos personagens."],
    regras: ["Regras da mesa", "Referência rápida do sistema Heróis do Olimpo."],
  };
  if (labels[page]) {
    $("#page-title").textContent = labels[page][0];
    $("#page-subtitle").textContent = labels[page][1];
  }
}

for (const button of $$("[data-master-go]")) {
  button.onclick = () => {
    if (!master) return;
    nav(button.dataset.masterGo);
    const title = button.dataset.masterGo === "arsenal" ? $("#page-arsenal h1") : $("#page-title");
    title.tabIndex = -1;
    title.focus();
    window.scrollTo(0,0);
  };
}

$(".brand").onclick = event => {
  event.preventDefault();
  nav(master ? "mestre" : "fichas");
  window.scrollTo(0,0);
};

function openFullSheet() {
  if (!master || !selected) return;
  nav("personagem");
  render();
  $("#full-sheet-title")?.focus();
  window.scrollTo(0, 0);
}

$("#back-to-roster").onclick = () => {
  nav("fichas");
  $("[data-open-sheet]")?.focus();
};

function renderFullSheet() {
  const panel = $("#full-sheet");
  if (!master || !selected || currentPage !== "personagem") {
    panel.replaceChildren();
    if (currentPage === "personagem" && (!master || !selected)) nav("fichas");
    return;
  }

  const row = selected;
  const data = dataOf(row);
  const hpMax = Number(data.hp_max ?? 20);
  const player = profiles.find(profile => profile.id === row.owner_id);
  const fields = {
    "Jogador": player?.display_name || data.player_name || player?.email,
    "Idade": data.age,
    "Cabana": data.cabin,
    "Origem": data.origin,
    "Linhagem": data.lineage,
    "Caminho": data.path,
    "Favor divino": data.favor,
    "Dracmas": data.dracmas,
    "Ouro": data.gold,
    "Prata": data.silver,
  };
  const sections = {
    "Testes de resistência": data.saves, "Perícias treinadas": data.skills,
    "Poderes e ataques": data.attacks, "Talentos e dons": data.talents,
    "Armas e proteções": data.weapons, "Relíquias": data.relics,
    "Inventário": data.inventory, "Companheiros": data.companions,
    "Personalidade": data.personality, "Notas de campanha": data.campaign_notes,
  };
  panel.innerHTML = `${detail(row,true)}
    <section class="sheet-session detail-block">
      <h3>Durante a sessão</h3>
      <form class="sheet-resources">
        <label>PV atual <input name="hp_current" type="number" required min="0" max="${esc(hpMax)}" value="${esc(data.hp_current ?? hpMax)}"></label>
        <label>XP <input name="xp" type="number" required min="0" max="9999" value="${esc(data.xp ?? 0)}"></label>
        <button class="button gold" type="submit">Salvar recursos</button>
      </form>
      <div class="sheet-roll">
        <label>Teste de atributo <select>${Object.entries(ATTRS).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join("")}</select></label>
        <button class="button secondary" type="button">Rolar 1d20</button>
        <output aria-live="polite"></output>
      </div>
    </section>
    <section class="detail-block"><h3>Dados do semideus</h3>
      <dl class="sheet-facts">${Object.entries(fields).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value ?? "—") || "—"}</dd></div>`).join("")}</dl>
    </section>
    <div class="sheet-sections">${Object.entries(sections).map(([label,value])=>`
      <section class="detail-block"><h3>${esc(label)}</h3>
        <p>${esc(Array.isArray(value)?value.join(" · "):value)||"Sem registro."}</p>
      </section>`).join("")}</div>`;

  panel.querySelector(".sheet-resources").onsubmit = event => saveSheetResources(event,row);
  const roll = panel.querySelector(".sheet-roll");
  roll.querySelector("button").onclick = () => {
    const attribute = roll.querySelector("select").value;
    const bonus = sheetAttributes(data)[attribute];
    const die = Math.floor(Math.random()*20)+1;
    roll.querySelector("output").textContent = `${ATTRS[attribute]}: ${die} + ${bonus} = ${die + bonus}`;
  };
}

async function saveSheetResources(event,row) {
  event.preventDefault();
  if (!master || selected?.id !== row.id || currentPage !== "personagem") return;
  const form = event.currentTarget;
  const fields = new FormData(form);
  const data = dataOf(row);
  delete data.portrait_url;
  for (const key of ["hp_current","xp"]) data[key] = Number(fields.get(key));
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const update = supabase.from("rpg_characters")
      .update({data,updated_at:new Date().toISOString()}).eq("id",row.id);
    if (row.updated_at) update.eq("updated_at",row.updated_at);
    else update.is("updated_at",null);
    const {data:saved,error} = await update.select("id").maybeSingle();
    if (error) throw error;
    if (!saved) {
      await loadData();
      notify("A ficha mudou. Revise os valores antes de salvar de novo.",true);
      return;
    }
    await loadData();
    notify("Recursos da ficha salvos.");
  } catch (error) {
    notify(error.message || "Não foi possível salvar os recursos.",true);
  } finally {
    button.disabled = false;
  }
}
$$(".nav-link").forEach(b=>b.onclick=()=>nav(b.dataset.page));$("#search-characters").oninput=render;$("#filter-deity").onchange=render;$("#search-items").oninput=renderItems;$("#filter-item-type").onchange=renderItems;
function applyEditorTheme(deity){const theme=themeForDeity(deity),preview=$("#theme-preview");preview.dataset.theme=theme.id;$("#theme-preview-symbol").textContent=deity?theme.symbol:"✦";$("#theme-preview-title").textContent=deity?`${theme.deity} · ${theme.epithet}`:"Escolha seu progenitor";$("#theme-preview-copy").textContent=deity?"Esse visual será salvo e acompanhará sua ficha.":"O visual da ficha acompanhará essa escolha.";$("#character-dialog").dataset.theme=deity?theme.id:"olympus";}
const editor = $("#character-dialog");
const characterForm = $("#character-form");
const saveCharacterButton = $("#save-character");

function showEditorError(message) {
  const error = $("#editor-error");
  error.textContent = message;
  error.classList.remove("hidden");
  error.scrollIntoView({block:"nearest"});
}

function updateDerivedPreview() {
  const attrs = Object.fromEntries(Object.keys(ATTRS).map(key => [
    key, Number(characterForm.elements.namedItem(`attr_${key}`).value),
  ]));
  const stats = derived(attrs, Number(characterForm.elements.namedItem("armor_bonus").value));
  $("#derived-preview").textContent = `Defesa ${stats.defense} · Iniciativa ${stats.initiative}`;
}

function openEditor(character) {
  if (!user || (character && !canEditSheet(character))) return;
  editId = character?.id || null;
  characterForm.reset();
  $("#editor-error").classList.add("hidden");
  $("#dialog-title").textContent = character ? "Editar ficha" : "Nova ficha";
  $("#delete-character").classList.toggle("hidden",!character);
  $("#master-owner-wrap").classList.toggle("hidden",!master);

  const ownerId = character?.owner_id || user.id;
  const ownerOptions = [...profiles];
  if (!ownerOptions.some(profile => profile.id === ownerId)) {
    ownerOptions.push({id:ownerId, display_name:character ? "Jogador atual" : "Minha conta"});
  }
  $("#character-owner").replaceChildren(...ownerOptions.map(profile =>
    new Option(profile.display_name || profile.email,profile.id),
  ));
  $("#character-owner").value = ownerId;

  const data = character ? dataOf(character) : {
    attrs: {forca:3,agilidade:2,intelecto:2,presenca:1,instinto:1,vontade:0},
    hp_max:20,hp_current:20,armor_bonus:2,gold:100,silver:50,xp:0,
  };
  const storedFields = {
    ...data,
    ...(character && {display_name:character.display_name,parent_deity:character.parent_deity,level:character.level}),
  };
  for (const [key,value] of Object.entries(storedFields)) {
    const input = characterForm.elements.namedItem(key);
    if (input && value != null && ["string","number"].includes(typeof value)) input.value = value;
  }
  for (const [key,value] of Object.entries(sheetAttributes(data))) {
    characterForm.elements.namedItem(`attr_${key}`).value = value;
  }
  for (const key of listFields) {
    characterForm.elements.namedItem(key).value = sheetList(data[key]).join("\n");
  }
  updateDerivedPreview();
  applyEditorTheme($("#parent-deity").value);
  editor.showModal();
}

$("#new-character").onclick = () => openEditor(null);
$("#close-editor").onclick = $("#cancel-editor").onclick = () => editor.close();
characterForm.oninput = event => {
  if (event.target.matches("input[name^='attr_'],input[name='armor_bonus']")) updateDerivedPreview();
};
$("#parent-deity").onchange = event => applyEditorTheme(event.target.value);

characterForm.onsubmit = async event => {
  event.preventDefault();
  if (!user || saveCharacterButton.disabled) return;
  const accountId = user.id;
  const isMaster = master;
  const target = editId ? characters.find(character => character.id === editId) : null;
  if (editId && !canEditSheet(target)) {
    showEditorError("Você só pode salvar fichas que pode editar.");
    return;
  }

  const fields = new FormData(characterForm);
  const number = (key,fallback=0) => fields.get(key) === "" ? fallback : Number(fields.get(key));
  const ownerId = isMaster ? fields.get("owner_id") : accountId;
  const deity = String(fields.get("parent_deity") || "");
  const attrs = Object.fromEntries(Object.keys(ATTRS).map(key => [key,number(`attr_${key}`)]));
  const previous = target ? dataOf(target) : {};
  const data = {
    ...previous,
    theme:themeForDeity(deity).id, attrs, age:number("age") || null,
    hp_max:number("hp_max",20), hp_current:number("hp_current",20),
  };
  if (previous.attributes && typeof previous.attributes === "object") {
    data.attributes = {...previous.attributes, ...attrs};
  }
  for (const key of ["xp","armor_bonus","favor","dracmas","gold","silver"]) data[key] = number(key);
  for (const key of ["player_name","cabin","origin","tagline","lineage","path","personality","backstory","campaign_notes"]) {
    data[key] = fields.get(key);
  }
  for (const key of listFields) data[key] = sheetList(fields.get(key));

  const row = {
    display_name: String(fields.get("display_name")).trim(),
    parent_deity: deity,
    level: number("level",1),
    data,
  };
  if (!target || (isMaster && ownerId !== target.owner_id)) row.owner_id = ownerId;

  $("#editor-error").classList.add("hidden");
  saveCharacterButton.disabled = true;
  saveCharacterButton.textContent = "Salvando…";
  try {
    validateCharacter({...row,attrs,hp_max:data.hp_max,hp_current:data.hp_current});
    const photo = $("#portrait-file").files[0];
    if (photo) {
      if (photo.size > 5*1024*1024) throw Error("A imagem deve ter até 5 MB.");
      if (!["image/jpeg","image/png","image/webp"].includes(photo.type)) throw Error("Formato de imagem inválido.");
      const path = `${ownerId}/${crypto.randomUUID()}.${photo.type.split("/")[1]}`;
      const upload = await supabase.storage.from("character-portraits").upload(path,photo,{upsert:false,contentType:photo.type});
      if (upload.error) throw upload.error;
      data.portrait_path = path;
      delete data.portrait_url;
    }
    if (user?.id !== accountId || master !== isMaster) return;
    let query = target
      ? supabase.from("rpg_characters").update(row).eq("id",target.id).eq("revision",target.revision)
      : supabase.from("rpg_characters").insert(row);
    if (target && !isMaster) query = query.eq("owner_id",accountId);
    const {data:saved,error} = await query.select().maybeSingle();
    if (error) throw error;
    if (user?.id !== accountId || master !== isMaster) return;
    if (!saved) {
      await loadData();
      throw Error("A ficha foi atualizada em outra sessão. Suas alterações estão no formulário. Revise e tente salvar de novo.");
    }
    editor.close();
    selected = saved;
    await loadData();
    notify("Ficha salva no arquivo.");
  } catch (error) {
    if (user?.id === accountId && editor.open) showEditorError(error.message || "Não foi possível salvar a ficha.");
  } finally {
    saveCharacterButton.disabled = false;
    saveCharacterButton.textContent = "Salvar ficha";
  }
};
$("#delete-character").onclick=async()=>{if(!canEditSheet(selected)||!confirm(`Excluir a ficha de ${selected.display_name}?`))return;const {error}=await supabase.from("rpg_characters").delete().eq("id",selected.id);if(error)return notify(error.message,true);selected=null;$("#character-dialog").close();await loadData();notify("Ficha excluída.");};
async function progress(id){const c=characters.find(x=>x.id===id);if(!c||!master)return;try{const result=levelUp(c.level,dataOf(c).xp||0),d=dataOf(c);const {data,error}=await supabase.from("rpg_characters").update({level:result.level,data:{...d,xp:0,hp_max:(+d.hp_max||20)+5,hp_current:(+d.hp_current||20)+5}}).eq("id",id).select().single();if(error)throw error;selected=data;await loadData();notify(`Subiu para o nível ${result.level}: +5 PV máximo.`);}catch(e){notify(e.message,true);}}
$("#export-campaign").onclick=()=>{if(!master)return;const blob=new Blob([JSON.stringify(characters.map(({portraitUrl,...row})=>({...row,data:dataOf(row)})),null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="campanha-herois-do-olimpo.json";a.click();URL.revokeObjectURL(a.href);};
const {data:{session}}=await supabase.auth.getSession();if(session?.user)await openApp(session.user);
