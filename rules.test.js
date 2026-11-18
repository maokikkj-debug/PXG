import test from "node:test";
import assert from "node:assert/strict";
import {ATTRS,GODS,ITEMS,derived,xpFor,levelUp,validateCharacter} from "./rules.js";
test("progression XP threshold and cap",()=>{assert.equal(xpFor(1),20);assert.equal(xpFor(19),200);assert.equal(xpFor(20),null);assert.deepEqual(levelUp(1,20),{level:2,xp:0,hpGain:5});assert.throws(()=>levelUp(1,19),/necessários 20/);});
test("derived combat values follow book attributes",()=>{assert.equal(derived({agilidade:2,instinto:1,forca:3,vontade:0,intelecto:2},2).defense,14);assert.equal(derived({instinto:1}).initiative,"1d20 + 1");});
test("PDF system content has ten gods and searchable catalog",()=>{assert.equal(GODS.length,10);assert.ok(ITEMS.length>=30);assert.equal(Object.keys(ATTRS).length,6);});
test("reject invalid sheet values and accept valid sheet",()=>{const c={display_name:"Davi",parent_deity:"Atena",level:1,hp_current:20,hp_max:20,attrs:{forca:3,agilidade:2,intelecto:2,presenca:1,instinto:1,vontade:0}};assert.equal(validateCharacter(c),true);assert.throws(()=>validateCharacter({...c,hp_current:21}),/PV atual/);assert.throws(()=>validateCharacter({...c,parent_deity:""}),/progenitor/);});
