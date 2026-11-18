import test from "node:test";
import assert from "node:assert/strict";
import { createMasterTools, parseDice, orderCombatants, nextCombatTurn } from "./master-tools.js";

test("keeps dice formulas separate from code and supports bonuses", () => {
  assert.deepEqual(parseDice("2d6+2"), {count:2,sides:6,bonus:2});
  assert.deepEqual(parseDice("1d20 - 4"), {count:1,sides:20,bonus:-4});
  for(const invalid of ["0d6","99d6","1d1","1d999","1d6; alert(1)",null]) assert.equal(parseDice(invalid),null);
});

test("orders initiatives, tracks the current combatant and advances the round", () => {
  const encounter={round:1,turn:"",rows:[{id:"a",initiative:6},{id:"b",initiative:16},{id:"c",initiative:16}]};
  assert.deepEqual(orderCombatants(encounter.rows).map(row=>row.id),["b","c","a"]);
  for(const [id,round] of [["b",1],["c",1],["a",1],["b",2]]) {
    nextCombatTurn(encounter);
    assert.equal(encounter.turn,id);
    assert.equal(encounter.round,round);
  }
});

function fixture(role,book) {
  const root={
    innerHTML:"",textContent:"",listeners:{},
    addEventListener(type,handler){this.listeners[type]=handler;},
    replaceChildren(){this.innerHTML="";this.textContent="";},
    querySelector(){return null;},
  };
  const dataRequests=[];
  const query={select(){return this;},eq(){return this;},
    async order(){return {data:[]};},
    async maybeSingle(){return {data:{body:book}};},
  };
  let currentRole=role;
  const tools=createMasterTools({root,currentUser:()=>({id:"viewer",app_metadata:{role:currentRole}}),
    getCharacters:()=>[],onAward(){},supabase:{from(table){dataRequests.push(table);return query;}}});
  return {root,dataRequests,tools,setRole(role){currentRole=role;}};
}

test("player sessions never request the private book, state or ledger", async () => {
  const {tools,dataRequests,root}=fixture("player");
  await tools.open();
  assert.deepEqual(dataRequests,[]);
  assert.equal(root.innerHTML,"");
});

test("master views the private book as escaped text; switching roles clears the DOM", async () => {
  const {tools,dataRequests,root,setRole}=fixture("master",{chapters:[{id:"chapter",number:1,name:"& Livro",body:"<img src=x onerror=alert(1)>",page:8}],monsters:[]});
  await tools.open();
  assert.deepEqual(dataRequests,["rpg_master_books","rpg_master_state","rpg_master_awards"]);
  assert.match(root.innerHTML,/&amp; Livro/);
  assert.match(root.innerHTML,/&lt;img/);
  assert.doesNotMatch(root.innerHTML,/<img/);
  setRole("player");
  await tools.open();
  assert.equal(root.innerHTML,"");
});
