import {ITEMS, sheetList} from "./rules.js";

const SILVER_PER_GOLD = 10;
const coins = new Intl.NumberFormat("pt-BR");
const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const amount = value => Number.isSafeInteger(Number(value)) && Number(value)>=0 ? Number(value) : 0;
const itemId = name => name.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/-$/,"");
const fallbackCatalog = ITEMS.map(item=>({
  id:itemId(item.name), category:item.type, name:item.name,
  effect:item.type==="Serviço"?"Ajuste de equipamento":item.effect,
  reference_price:item.type==="Serviço"?item.effect:item.price, price_silver:null,
}));

function costLabel(silver) {
  if (silver===0) return "Grátis";
  const gold=Math.floor(silver/SILVER_PER_GOLD), remainder=silver%SILVER_PER_GOLD;
  return [gold?coins.format(gold)+" ouro":"", remainder?coins.format(remainder)+" prata":""].filter(Boolean).join(" e ");
}

export function createEconomy({supabase,getUser,getCharacter,getCharacters,canEdit,reload,notify}) {
  const find = selector => document.querySelector(selector);
  const wallet = find("#character-wallet");
  const dialog = find("#economy-dialog");
  const form = find("#economy-form");
  const submit = find("#economy-submit");
  const message = find("#economy-message");
  const currentUserIsMaster = () => getUser()?.app_metadata?.role==="master";
  const rowFor = id => getCharacters().find(row=>row.id===id);
  let catalog = fallbackCatalog;
  let shopReady = false;
  let owner = null;
  let epoch = 0;
  let pending = null;
  const retries = new Map();
  let masterCharacter = "";
  let adminBusy = false;

  function clear() {
    epoch++;
    owner=null;shopReady=false;catalog=fallbackCatalog;pending=null;retries.clear();masterCharacter="";adminBusy=false;
    wallet.hidden=true;
    dialog.close();
    find("#economy-history-list").replaceChildren();
    find("#master-economy").classList.add("hidden");
  }

  async function loadCatalog(force=false) {
    if (!getUser()) return;
    const actor=getUser().id;
    if (owner!==actor) {
      clear();
      owner=actor;
    }
    if (shopReady&&!force) return;
    const run=epoch;
    const {data,error}=await supabase.from("rpg_arsenal").select("*").order("display_order");
    if (run!==epoch||getUser()?.id!==actor) return;
    if (error || !data?.length) {
      shopReady=false;
      find("#arsenal-notice").textContent="Compras temporariamente indisponíveis. O catálogo abaixo é apenas para consulta.";
    } else {
      catalog=data;
      shopReady=true;
      find("#arsenal-notice").textContent="10 pratas = 1 ouro. Selecione a quantidade antes de confirmar.";
    }
    render();
  }

  function renderWallet() {
    const row=getCharacter();
    wallet.hidden=!canEdit(row);
    if (wallet.hidden) return;
    find("#wallet-gold").textContent=coins.format(amount(row.data?.gold));
    find("#wallet-silver").textContent=coins.format(amount(row.data?.silver));
    wallet.setAttribute("aria-label",`Carteira de ${row.display_name}: ${amount(row.data?.gold)} ouro e ${amount(row.data?.silver)} prata. Abrir histórico.`);
  }

  function renderArsenal() {
    const search=find("#search-items").value.trim().toLocaleLowerCase("pt-BR");
    const category=find("#filter-item-type").value;
    const enabled=shopReady && canEdit(getCharacter());
    find("#arsenal-character").textContent=getCharacter()
      ? "Compras na ficha de " + getCharacter().display_name
      : "Selecione uma ficha para comprar.";
    find("#item-grid").innerHTML=catalog
      .filter(item=>(!category||category===item.category)&&[item.category,item.name,item.effect].join(" ").toLocaleLowerCase("pt-BR").includes(search))
      .map(item=>`<article class="item-card"><span>${escapeText(item.category)}</span><h3>${escapeText(item.name)}</h3>
        <p>${escapeText(item.effect)}</p><small>${escapeText(item.price_silver==null?item.reference_price:costLabel(item.price_silver))}</small>
        ${item.price_silver!=null? `<button class="button secondary economy-buy" type="button" data-buy-item="${escapeText(item.id)}" ${enabled?"":"disabled"}>Comprar</button>`:""}
      </article>`).join("")||'<p class="empty-state">Nenhum item encontrado.</p>';
  }

  async function request(action,row,payload) {
    const user=getUser();
    if (!shopReady || !user) throw Error("A carteira está indisponível.");
    const fingerprint=JSON.stringify([user.id,row?.id,action,payload]);
    if (action!=="quote" && !retries.has(fingerprint)) {
      if (retries.size>=100) retries.delete(retries.keys().next().value);
      retries.set(fingerprint,crypto.randomUUID());
    }
    const {data,error}=await supabase.rpc("rpg_economy_action",{
      p_character:row?.id??null, p_action:action, p_request:action==="quote"?null:retries.get(fingerprint), p_payload:payload,
    });
    if (error) throw error;
    if (user.id!==getUser()?.id) throw Error("A sessão mudou. Faça login para continuar.");
    retries.delete(fingerprint);
    return data;
  }

  async function saveInventory(row,value) {
    const draft={revision:row.revision,inventory:sheetList(value)};
    const quote=await request("quote",row,draft);
    if (!quote.affordable) throw Error("Saldo insuficiente. Total: "+costLabel(quote.cost_silver)+".");
    if (quote.cost_silver>0 && !window.confirm("Novos itens: "+quote.items.map(item=>item.quantity+" × "+item.name).join(", ")+"\nTotal: "+costLabel(quote.cost_silver)+". Confirmar?")) return false;
    await request("inventory",row,{...draft,expected_silver:quote.cost_silver});
    return true;
  }

  function openDialog(title) {
    find("#economy-title").textContent=title;
    message.textContent="";
    if (!dialog.open) dialog.showModal();
  }

  function purchaseTotal() {
    if (pending?.action!=="buy") return;
    const input=find("#buy-quantity");
    const quantity=Number(input.value);
    const total=pending.item.price_silver*quantity;
    find("#purchase-total").textContent=input.validity.valid && quantity>0?"Total: "+costLabel(total):"Selecione de 1 a 99 unidades.";
  }

  function openPurchase(item) {
    const row=getCharacter();
    if (!shopReady||!canEdit(row)||item?.price_silver==null) return;
    pending={action:"buy",row,item};
    find("#economy-history-list").replaceChildren();
    form.hidden=false;
    find("#economy-fields").innerHTML=`<p>Ficha: <strong>${escapeText(row.display_name)}</strong></p>
      <p>Preço unitário: ${escapeText(costLabel(item.price_silver))}</p>
      <label>Quantidade <input type="number" min="1" max="99" value="1" id="buy-quantity" required></label>
      <p id="purchase-total" aria-live="polite"></p>`;
    submit.textContent="Confirmar compra";
    openDialog(item.name);
    purchaseTotal();
    find("#buy-quantity").addEventListener("input",purchaseTotal);
    find("#buy-quantity").focus();
  }

  async function history(row) {
    if (!canEdit(row)) return;
    pending={action:"history",row};
    form.hidden=true;
    const list=find("#economy-history-list");
    list.textContent="Carregando…";
    openDialog("Histórico de "+row.display_name);
    const {data,error}=await supabase.from("rpg_economy_history")
      .select("id,operation,items,gold_delta,silver_delta,note,refund_for,created_at")
      .eq("character_id",row.id).order("created_at",{ascending:false}).limit(100);
    if (!dialog.open||pending?.action!=="history"||pending.row.id!==row.id) return;
    if (error) {list.textContent="Não foi possível carregar o histórico.";return;}
    const refunds=new Set(data.map(entry=>entry.refund_for).filter(Boolean));
    const labels={buy:"Compra",inventory:"Edição de inventário",grant:"Equipamento concedido",adjust:"Ajuste de saldo",refund:"Reembolso"};
    list.innerHTML=data.map(entry=>{
      const charged=entry.gold_delta*SILVER_PER_GOLD+entry.silver_delta<0;
      const refundable=currentUserIsMaster() && ["buy","inventory"].includes(entry.operation) && charged && !refunds.has(entry.id);
      const items=entry.items.map(item=>`${item.quantity} × ${item.name}`).join(", ");
      const movement=[["ouro",entry.gold_delta],["prata",entry.silver_delta]].filter(([,value])=>value)
        .map(([name,value])=>(value>0?"+":"")+coins.format(value)+" "+name).join(" · ");
      return `<div class="economy-entry"><strong>${escapeText(labels[entry.operation])}</strong>
        <small>${escapeText(new Date(entry.created_at).toLocaleString("pt-BR"))}</small>
        ${items?`<p>${escapeText(items)}</p>`:""}${movement?`<p>${escapeText(movement)}</p>`:""}${entry.note?`<p>${escapeText(entry.note)}</p>`:""}
        ${refunds.has(entry.id)?"<p>Reembolsada</p>":""}
        ${refundable?`<button type="button" class="button secondary" data-refund="${escapeText(entry.id)}">Autorizar reembolso</button>`:""}
      </div>`;
    }).join("")||"<p>Nenhuma movimentação registrada ainda.</p>";
  }

  function renderMaster() {
    const root=find("#master-economy");
    root.classList.toggle("hidden",!currentUserIsMaster());
    if(!currentUserIsMaster())return;
    const roster=find("#economy-master-character");
    const items=getCharacters();
    if(!items.some(row=>row.id===masterCharacter))masterCharacter=items[0]?.id||"";
    const signature=items.map(row=>row.id+":"+row.display_name).join("|");
    if(roster.dataset.signature!==signature){
      roster.replaceChildren(...items.map(row=>new Option(row.display_name,row.id)));
      roster.dataset.signature=signature;
    }
    roster.value=masterCharacter;
    const row=rowFor(masterCharacter);
    find("#economy-master-balance").textContent=row
      ? `${coins.format(amount(row.data?.gold))} ouro · ${coins.format(amount(row.data?.silver))} prata`
      : "Nenhuma ficha encontrada.";
    const options=catalog.map(item=>`<option value="${escapeText(item.id)}">${escapeText(item.name)}</option>`).join("");
    for(const selector of ["#economy-grant-item","#economy-price-item"]){
      const input=find(selector);
      const old=input.value;
      if(input.dataset.catalog!==options){input.innerHTML=options;input.dataset.catalog=options;if(catalog.some(item=>item.id===old))input.value=old;if(input.id==="economy-price-item")showPrice();}
    }
    root.querySelectorAll("button[type=submit]").forEach(button=>{button.disabled=adminBusy||!shopReady||(!row&&button.form.dataset.action!=="price");});
    find("#economy-master-history").disabled=!row||!shopReady;
  }

  function render() {renderWallet();renderArsenal();renderMaster();}

  find("#item-grid").addEventListener("click",event=>{
    const button=event.target.closest("[data-buy-item]");
    if (button) openPurchase(catalog.find(item=>item.id===button.dataset.buyItem));
  });
  wallet.onclick=()=>void history(getCharacter());
  find("#economy-close").onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>{if(!dialog.open)pending=null;});
  find("#economy-history-list").addEventListener("click",event=>{
    const button=event.target.closest("[data-refund]");
    if(!button||!currentUserIsMaster()||pending?.action!=="history")return;
    pending={action:"refund",row:pending.row,purchase:button.dataset.refund};
    find("#economy-history-list").replaceChildren();
    form.hidden=false;
    find("#economy-fields").innerHTML='<p>O reembolso devolve as moedas pagas e retira os itens devolvidos do inventário.</p><label>Motivo <input name="note" required maxlength="240"></label>';
    submit.textContent="Confirmar reembolso";
    openDialog("Autorizar reembolso");
  });

  form.onsubmit=async event=>{
    event.preventDefault();
    if(!pending||submit.disabled)return;
    const operation=pending;
    if(!canEdit(operation.row))return;
    const action=operation.action;
    const quantity=action==="buy"?Number(find("#buy-quantity").value):null;
    const payload=action==="buy"
      ? {item:operation.item.id,quantity,expected_silver:operation.item.price_silver*quantity}
      : {purchase:operation.purchase,note:new FormData(form).get("note")};
    submit.disabled=true;
    message.textContent="";
    try{
      await request(action,operation.row,payload);
      await reload();
      if(action==="refund" && dialog.open)await history(rowFor(operation.row.id));
      else if(dialog.open)dialog.close();
      notify(action==="buy"?"Compra salva no inventário.":"Reembolso autorizado.");
    }catch(error){
      if(dialog.open)message.textContent=error.message||"A operação não foi concluída.";
      if(action==="buy"&&error.message?.includes("O total mudou")) await loadCatalog(true);
    }
    finally{submit.disabled=false;}
  };

  find("#economy-master-character").onchange=event=>{masterCharacter=event.target.value;renderMaster();};
  find("#economy-master-history").onclick=()=>void history(rowFor(masterCharacter));
  const pricePicker=find("#economy-price-item");
  function showPrice(){
    const value=catalog.find(item=>item.id===pricePicker.value)?.price_silver;
    const priceForm=pricePicker.form;
    priceForm.elements.gold.value=value==null?"":Math.floor(value/SILVER_PER_GOLD);
    priceForm.elements.silver.value=value==null?"":value%SILVER_PER_GOLD;
  }
  pricePicker.onchange=showPrice;
  find("#master-economy").addEventListener("submit",async event=>{
    const target=event.target;
    if(!target.matches("form[data-action]")) return;
    event.preventDefault();
    if(!currentUserIsMaster()||adminBusy)return;
    const action=target.dataset.action;
    const row=rowFor(masterCharacter);
    const values=new FormData(target);
    const output=find("#economy-master-status");
    const payload=action==="price"
      ? {item:values.get("item"),price_silver:Number(values.get("gold"))*SILVER_PER_GOLD+Number(values.get("silver"))}
      : action==="adjust"
      ? {gold_delta:Number(values.get("gold")),silver_delta:Number(values.get("silver")),note:values.get("note")}
      : {item:values.get("item"),custom:values.get("custom").trim(),quantity:Number(values.get("quantity")),note:values.get("note")};
    if(action!=="price"&&!row)return;
    adminBusy=true;renderMaster();output.textContent="Salvando…";
    try{
      await request(action,action==="price"?null:row,payload);
      if(action==="price"){await loadCatalog(true);showPrice();} else await reload();
      output.textContent={price:"Preço atualizado.",adjust:"Saldo atualizado.",grant:"Equipamento concedido."}[action];
      if(action!=="price")target.reset();
    }catch(error){output.textContent=error.message||"A operação não foi concluída.";}
    finally{adminBusy=false;renderMaster();}
  });
  return {render,renderArsenal,saveInventory,loadCatalog,clear,history};
}
