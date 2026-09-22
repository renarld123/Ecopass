'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('./visitor-routing');
const start=[122.4,9.75],end=[122.402,9.753];
const fixture=()=>({code:'Ok',waypoints:[{distance:5},{distance:10}],routes:[{distance:550,duration:410,geometry:{type:'LineString',coordinates:[start,end]},legs:[{steps:[{distance:500,name:'Alvarez Street',maneuver:{type:'depart',location:start}},{distance:50,name:'',maneuver:{type:'arrive',location:end}}]}]}]});
test('routing validates geometry, gives readable steps, and never substitutes a fake route',()=>{
  const result=R.parseRoute(fixture());assert.equal(result.steps[0].text,'Start on Alvarez Street');assert.equal(result.steps[1].text,'Arrive near your EcoPass booth');assert.equal(result.distance,550);
  for(const code of ['NoRoute','NoSegment'])assert.throws(()=>R.parseRoute({code}),/No connected route/);
  for(const invalid of [null,{}, {code:'Ok',routes:[]}, {...fixture(),routes:[{...fixture().routes[0],geometry:{type:'LineString',coordinates:[[999,0],end]}}]}])assert.throws(()=>R.parseRoute(invalid));
  assert.equal(R.meters(2300),'2.3 km');assert.equal(R.time(410),'7 min');assert.equal(R.time(3660),'1 hr 1 min');assert.equal(R.distance(start,start),0);assert.ok(R.distance(start,end)>300);
  assert.match(R.instruction({name:'Main Street',maneuver:{type:'roundabout',exit:2}}),/exit 2 onto Main Street/);
});
test('routing uses correct walk/car endpoints, omits credentials, and throttles repeat requests',async()=>{
  let now=1000,calls=[];const client=R.createClient(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>fixture()};},()=>now);
  await client(start,end,'walk');assert.match(calls[0].url,/routed-foot\/route\/v1\/driving\/122\.40000,9\.75000;122\.40200,9\.75300/);assert.equal(calls[0].options.credentials,'omit');
  await assert.rejects(client(start,end,'drive'),/wait a moment/);assert.equal(calls.length,1);now+=1600;await client(start,end,'drive');assert.match(calls[1].url,/routed-car/);
  await assert.rejects(client([181,0],end,'walk'),/valid starting/);await assert.rejects(client(start,end,'air'),/valid starting/);
});
test('routing handles provider failure, no-route, rate limits, and cancellation',async()=>{
  await assert.rejects(R.createClient(async()=>{throw new Error('offline');})(start,end,'walk'),/unavailable/);
  await assert.rejects(R.createClient(async()=>({status:429}))(start,end,'walk'),/busy/);
  await assert.rejects(R.createClient(async()=>({ok:false,json:async()=>({code:'NoRoute'})}))(start,end,'walk'),/No connected route/);
  const controller=new AbortController();controller.abort();await assert.rejects(R.createClient(async(_,options)=>{options.signal.throwIfAborted();})(start,end,'walk',controller.signal),{name:'AbortError'});
});
// Exercise browser orchestration with mocked DOM/GPS. Never access a person's location.
function harness(routeResponse){
  const nodes=new Map(),events={},geo={},calls={routes:0,clears:0,draws:0,clearWatches:0};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,classList:{add(){},remove(){}},listeners:{},addEventListener(name,cb){this.listeners[name]=cb;},focus(){},scrollIntoView(){},setAttribute(){}});return nodes.get(id);};
  const section={querySelector:node,querySelectorAll:()=>[],classList:{add(){},remove(){}},addEventListener(){}};
  const scene={clearRoute(){calls.clears++;},update(){},show:async()=>{},fit(){},reset(){},focus(){},route(){calls.draws++;},userPosition(){}};
  const context={document:{hidden:false,querySelector:()=>section,addEventListener:(name,cb)=>events[name]=cb},window:{EcoPassMapScene:scene,EcoPassRouting:{...R,createClient:()=>async()=>{calls.routes++;return routeResponse?routeResponse():R.parseRoute(fixture());}},addEventListener:(name,cb)=>events[name]=cb},navigator:{geolocation:{getCurrentPosition(success,error){geo.success=success;geo.error=error;},watchPosition(success,error){geo.watchSuccess=success;geo.watchError=error;return 1;},clearWatch(){calls.clearWatches++;}}},fetch:async()=>({ok:true,json:async()=>({booths:[{id:'test',name:'Test booth',address:'Public street',lat:end[1],lng:end[0],hours:'9–5'}]})}),AbortController,AbortSignal,setTimeout,clearTimeout,matchMedia:()=>({matches:false})};
  vm.runInNewContext(fs.readFileSync(require.resolve('./visitor-map'),'utf8'),context);
  return {node,geo,calls,events,context,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('GPS is opt-in, denied permission has recovery, and cancelled GPS cannot draw a stale route',async()=>{
  const h=harness();await h.flush();assert.equal(h.geo.success,undefined);h.node('#route-gps').listeners.click();h.geo.error({code:1});assert.match(h.node('#route-status').textContent,/permission was denied/);assert.equal(h.calls.routes,0);
  h.node('#route-gps').listeners.click();const stale=h.geo.success;h.node('#route-cancel').listeners.click();stale({coords:{longitude:start[0],latitude:start[1],accuracy:10}});await h.flush();assert.equal(h.calls.routes,0);assert.equal(h.node('#route-result').hidden,true);
});
test('GPS draws a route, tracks only while active, and cancel/tab-hide clean up the watch',async()=>{
  const h=harness();await h.flush();h.node('#route-gps').listeners.click();h.geo.success({coords:{longitude:start[0],latitude:start[1],accuracy:10}});await h.flush();assert.equal(h.calls.routes,1);assert.equal(h.calls.draws,1);assert.equal(h.node('#route-result').hidden,false);
  h.context.document.hidden=true;h.events.visibilitychange();assert.equal(h.calls.clearWatches,1);assert.match(h.node('#route-status').textContent,/paused/);
  h.node('#route-cancel').listeners.click();assert.equal(h.node('#route-result').hidden,true);assert.match(h.node('#route-status').textContent,/no longer/);
});
test('late route responses cannot restore navigation after cancellation',async()=>{
  let resolveRoute;const h=harness(()=>new Promise(resolve=>resolveRoute=resolve));await h.flush();h.node('#route-gps').listeners.click();h.geo.success({coords:{longitude:start[0],latitude:start[1],accuracy:10}});h.node('#route-cancel').listeners.click();resolveRoute(R.parseRoute(fixture()));await h.flush();assert.equal(h.calls.draws,0);assert.equal(h.node('#route-result').hidden,true);assert.equal(h.geo.watchSuccess,undefined);
});
test('inaccurate GPS is rejected with a manual starting-point alternative',async()=>{
  const h=harness();await h.flush();h.node('#route-gps').listeners.click();h.geo.success({coords:{longitude:start[0],latitude:start[1],accuracy:5000}});assert.equal(h.calls.routes,0);assert.match(h.node('#route-status').textContent,/too approximate/);assert.equal(h.node('#route-pin').disabled,false);
});
