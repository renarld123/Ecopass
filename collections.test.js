'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function dashboard(){
  const nodes=new Map(),events={};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#payment-filter'?'all':'',textContent:'',innerHTML:'',hidden:false,dataset:{},attributes:{},listeners:{},classList:{toggle(){}},addEventListener(name,callback){this.listeners[name]=callback;},setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused=true;}});return nodes.get(id);};
  const fixture={today:'2026-09-24',updatedAt:'2026-09-24T08:00:00Z',booths:[{id:'booth',name:'Test booth',active:true}],scans:[],visitors:[
    {id:'OFFICE',fullName:'Office Visitor',visitDate:'2026-09-24',createdAt:'2026-09-23',amount:50,paymentStatus:'PAY_AT_OFFICE',paymentMethod:'Physical Payment',groups:{adult:1}},
    {id:'PENDING',fullName:'Online Visitor',visitDate:'2026-09-24',createdAt:'2026-09-23',amount:100,paymentStatus:'PENDING',paymentMethod:'GCash',groups:{adult:2}},
    {id:'PAID',fullName:'Paid Visitor',visitDate:'2026-09-24',createdAt:'2026-09-23',paidAt:'2026-09-24T08:00:00Z',amount:50,paymentStatus:'PAID',paymentMethod:'Physical Payment',paymentSource:'tourism-office',groups:{adult:1}},
    {id:'OLDER',fullName:'Earlier Visitor',visitDate:'2026-09-23',createdAt:'2026-09-22',amount:50,paymentStatus:'CHECKOUT_FAILED',groups:{adult:1}}
  ]};
  let fail=false;
  const context={document:{querySelector:node,querySelectorAll:()=>[],addEventListener:(event,callback)=>events[event]=callback},window:{addEventListener(){}},location:{hash:'#overview'},history:{replaceState(){}},fetch:async url=>({ok:!fail,status:fail?503:200,json:async()=>url.endsWith('/session')?{authenticated:true}:fail?{error:'Connection unavailable'}:fixture}),Intl,Date,setTimeout:()=>0,clearTimeout(){},console};
  vm.runInNewContext(fs.readFileSync(require.resolve('./collections.js'),'utf8'),context);
  return {node,fail:()=>fail=true,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('dashboard shortcuts use real records and retain the selected visit-date range',async()=>{
  const h=dashboard();await h.flush();
  assert.equal(h.node('#metric-collected').textContent,'₱50.00');
  assert.match(h.node('#unpaid-shortcut-count').textContent,/3 unpaid/);
  assert.match(h.node('#booth-shortcut-count').textContent,/1 active checkpoint/);
  h.node('#filter-today').listeners.click();
  assert.match(h.node('#unpaid-shortcut-count').textContent,/2 unpaid/);
  h.node('#review-unpaid').listeners.click();
  assert.equal(h.node('#payment-filter').value,'unpaid');
  assert.equal(h.node('#filter-from').value,'2026-09-24');
  assert.match(h.node('#visitor-rows').innerHTML,/Office Visitor/);
  assert.match(h.node('#visitor-rows').innerHTML,/Online Visitor/);
  assert.doesNotMatch(h.node('#visitor-rows').innerHTML,/Paid Visitor|Earlier Visitor/);
  assert.equal(h.node('#workspace-view').textContent,'Tourist records');
  assert.equal(h.node('#visitor-search').focused,true);
});

test('dashboard refresh reports connection errors instead of a false synced state',async()=>{
  const h=dashboard();await h.flush();assert.equal(h.node('#sync-status').dataset.state,'ready');
  h.fail();await h.node('#refresh-data').listeners.click();
  assert.equal(h.node('#sync-status').dataset.state,'error');
  assert.equal(h.node('#ops-error').textContent,'Connection unavailable');
  assert.equal(h.node('#refresh-data').disabled,false);
});

test('admin controls reference actual SVG symbols and production operations code',()=>{
  const html=fs.readFileSync(require.resolve('./collections.html'),'utf8'),js=fs.readFileSync(require.resolve('./collections.js'),'utf8'),svg=fs.readFileSync(require.resolve('./landing-icons.svg'),'utf8');
  const symbols=new Set([...svg.matchAll(/<symbol id="([^"]+)"/g)].map(m=>m[1]));
  for(const match of html.matchAll(/landing-icons\.svg#([a-z-]+)/g))assert.ok(symbols.has(match[1]),'Missing icon: '+match[1]);
  for(const match of js.matchAll(/icon\('([a-z-]+)'\)/g))assert.ok(symbols.has(match[1]),'Missing dynamic icon: '+match[1]);
  assert.match(html,/admin-workspace\.css/);assert.match(html,/id="review-unpaid"/);assert.doesNotMatch(html,/mock-data|mock-services/);
});
