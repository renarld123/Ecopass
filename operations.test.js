'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createOperations,dayInManila}=require('./operations');
test('booths persist, reject stale edits, and accept each valid paid group only once per day',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ecopass-operations-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const today=dayInManila(),records=[{id:'ECP-20990101-ABCDEF12',fullName:'Test Traveler',address:'Test address',contact:'09000000000',groups:{adult:2,child:1},paymentStatus:'PAID',paymentSource:'tourism-office',status:'ACTIVE',visitDate:today,validUntil:today,idFile:'private-id.pdf',idToken:'must-not-leak',amount:100}];
  const ops=createOperations({useBlob:false,dataDir:dir,readRegistrations:async()=>records});
  assert.deepEqual((await ops.snapshot()).booths,[]);
  await assert.rejects(ops.saveBooth({name:'Bad booth',address:'Test',lat:'',lng:122}),/coordinates/);
  const booth=await ops.saveBooth({name:'Test booth',address:'Test location',lat:9.75,lng:122.4});
  assert.equal(booth.version,1);
  const saved=await ops.saveBooth({...booth,hours:'8 AM – 5 PM'});
  assert.equal(saved.version,2);
  await assert.rejects(ops.saveBooth({...booth,name:'Stale overwrite'}),error=>error.status===409);
  const fresh=createOperations({useBlob:false,dataDir:dir,readRegistrations:async()=>records});
  assert.equal((await fresh.snapshot()).booths[0].hours,'8 AM – 5 PM');
  const info=await ops.lookup('https://ecopass-rose.vercel.app/verify/'+records[0].id);
  assert.equal(info.reason,'');assert.equal(info.visitor.hasDiscountId,true);assert.equal(info.visitor.idFile,undefined);assert.equal(info.visitor.idToken,undefined);
  const results=await Promise.all([ops.checkIn({passId:records[0].id,boothId:booth.id}),ops.checkIn({passId:records[0].id,boothId:booth.id})]);
  assert.equal(results.filter(r=>r.duplicate).length,1);assert.equal((await ops.snapshot()).scans.length,1);assert.equal(results[0].scan.guests,3);
  assert.ok((await ops.lookup(records[0].id)).checkIn);
  records[0].paymentStatus='PENDING';await assert.rejects(ops.checkIn({passId:records[0].id,boothId:booth.id}),/Payment must be confirmed/);
  records[0].paymentStatus='PAID';records[0].checkoutMode='test';await assert.rejects(ops.checkIn({passId:records[0].id,boothId:booth.id}),/test/);
  delete records[0].checkoutMode;records[0].validUntil='2000-01-01';await assert.rejects(ops.checkIn({passId:records[0].id,boothId:booth.id}),/valid visit dates/);
  records[0].validUntil=today;await ops.saveBooth({...saved,active:false});await assert.rejects(ops.checkIn({passId:records[0].id,boothId:booth.id}),/active scanning booth/);
  await assert.rejects(ops.lookup('<script>alert(1)</script>'),/valid EcoPass/);
});
test('booth storage retries conditional conflicts without losing concurrent locations',async()=>{
  class Conflict extends Error{}
  let value={booths:[],scans:[]},version=1,conflict=true;
  const ops=createOperations({useBlob:true,dataDir:'unused',ConflictError:Conflict,readRegistrations:async()=>[],readBlob:async()=>({buffer:Buffer.from(JSON.stringify(value)),etag:String(version)}),putBlob:async(name,text,options)=>{
    if(conflict){conflict=false;value.booths.push({id:'concurrent',name:'Other booth'});version++;throw new Conflict();}
    assert.equal(options.ifMatch,String(version));value=JSON.parse(text);version++;
  }});
  await ops.saveBooth({name:'New booth',address:'New location',lat:9.7,lng:122.4});
  assert.equal(value.booths.length,2);assert.equal(value.booths[0].id,'concurrent');
});
test('public map only exposes active booth locations and never reads tourist records',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ecopass-public-booth-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ops=createOperations({useBlob:false,dataDir:dir,readRegistrations:async()=>{throw new Error('Public map must not read tourist records');}});
  assert.deepEqual(await ops.publicBooths(),[]);
  const first=await ops.saveBooth({name:'Public booth',address:'Public address',lat:9.75,lng:122.4,hours:'9 AM – 5 PM',contact:'private staff number',notes:'private staff instructions',active:true});
  await ops.saveBooth({name:'Inactive booth',address:'Do not show',lat:9.76,lng:122.42,active:false});
  const records=await ops.publicBooths();
  assert.deepEqual(records,[{id:first.id,name:'Public booth',address:'Public address',lat:9.75,lng:122.4,hours:'9 AM – 5 PM'}]);
  await ops.saveBooth({...first,name:'Renamed published booth'});
  assert.equal((await ops.publicBooths())[0].name,'Renamed published booth');
});
test('booth background persists, can be removed, and rejects external or unsafe image paths',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ecopass-booth-image-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ops=createOperations({useBlob:false,dataDir:dir,readRegistrations:async()=>[]}),image='/uploads/booth-image-12345678-abcdef12.png';
  const booth=await ops.saveBooth({name:'Test booth',address:'Public address',lat:9.75,lng:122.4,backgroundImage:image});assert.equal((await ops.publicBooths())[0].backgroundImage,image);
  const fresh=createOperations({useBlob:false,dataDir:dir,readRegistrations:async()=>[]});assert.equal((await fresh.snapshot()).booths[0].backgroundImage,image);
  for(const url of ['javascript:alert(1)','https://example.com/image.png','/uploads/../data/operations.json','/uploads/private-id.png'])await assert.rejects(ops.saveBooth({...booth,backgroundImage:url}),/valid booth background/);
  await ops.saveBooth({...booth,backgroundImage:''});assert.equal((await ops.publicBooths())[0].backgroundImage,undefined);
});
