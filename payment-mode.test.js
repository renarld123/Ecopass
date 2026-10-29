'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');

test('payment selector disables test QR Ph and fails closed on config errors',async()=>{
  const source=await fs.readFile(path.join(__dirname,'landing.js'),'utf8');
  const functionSource=source.slice(source.indexOf('async function configurePaymentChoices()'),source.indexOf('async function showReturnedPayment()'));
  for(const scenario of ['test','live','offline']){
    const inputs=['GCash','Maya','Credit/Debit Card','QR Ph','Pay at Tourism Office (Cash)'].map(value=>({value,disabled:false,checked:value==='QR Ph',hint:{},closest(){return {classList:{toggle(){}},querySelector:()=>this.hint}}}));
    const note={};
    const passModal={querySelectorAll:()=>inputs,querySelector:selector=>selector.includes(':checked')?inputs.find(input=>input.checked):inputs.at(-1)};
    const context={passModal,fetch:async()=>{
      if(scenario==='offline')throw new Error('Offline');
      return {ok:true,json:async()=>({paymongoAvailable:true,mode:scenario,qrphAvailable:scenario==='live'})};
    }};
    passModal.querySelector=selector=>selector==='.payment-notice'?note:selector.includes(':checked')?inputs.find(input=>input.checked):inputs.at(-1);
    await vm.runInNewContext(functionSource+';configurePaymentChoices()',context);
    assert.equal(inputs[3].disabled,scenario!=='live');
    if(scenario==='test')assert.match(note.textContent,/Do not scan a test QR Ph code/);
    if(scenario==='offline')assert.ok(inputs.slice(0,4).every(input=>input.disabled));
  }
});

test('test mode blocks real-wallet QR Ph before storage or provider checkout',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ecopass-qrph-safety-'));
  process.env.STORAGE_ROOT=directory;
  process.env.BLOB_READ_WRITE_TOKEN='';
  process.env.PAYMONGO_SECRET_KEY='sk_test_local_fixture';
  process.env.PAYMONGO_WEBHOOK_SECRET='local-webhook-fixture';
  const originalFetch=global.fetch;
  let providerCalls=0;
  global.fetch=async(url,options)=>{
    if(String(url).startsWith('https://api.paymongo.com/')){
      providerCalls++;
      throw new Error('No test QR may be generated for a visitor');
    }
    return originalFetch(url,options);
  };
  const server=await require('./server').start(0);
  t.after(async()=>{
    global.fetch=originalFetch;
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(directory,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  const config=await (await fetch(base+'/api/payment-config')).json();
  assert.equal(config.mode,'test');
  assert.equal(config.paymongoAvailable,true);
  assert.equal(config.qrphAvailable,false);
  const response=await fetch(base+'/api/registrations',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fullName:'Local Safety Test',address:'Local test address',contact:'09000000000',visitDate:'2099-12-15',stay:'1D / 0N',groups:{adult:1},paymentMethod:'QR Ph'})
  });
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/Do not scan/);
  assert.equal(providerCalls,0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'data/registrations.json'),'utf8')),[]);
});
