'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const dayInManila = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
function visitor(record) {
  const keys = ['id','fullName','address','contact','visitDate','stay','validUntil','groups','amount','paymentMethod','paymentStatus','paymentSource','checkoutMode','createdAt','paidAt','status'];
  return { ...Object.fromEntries(keys.map(key => [key, record[key]])), hasDiscountId:Boolean(record.idFile) };
}
function cleanBooth(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Enter valid booth details.');
  const text = (key, length) => String(input[key] || '').trim().slice(0,length);
  const lat = Number(input.lat), lng = Number(input.lng);
  if (!text('name',80) || !text('address',180) || input.lat == null || input.lng == null || String(input.lat).trim() === '' || String(input.lng).trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw fail('Enter a booth name, address, and valid map coordinates.');
  const backgroundImage=String(input.backgroundImage||'');
  if(backgroundImage&&!/^\/uploads\/booth-image-[0-9]+-[a-f0-9]{8}\.(png|jpg|webp|gif)$/.test(backgroundImage))throw fail('Upload a valid booth background image.');
  return { name:text('name',80), address:text('address',180), lat, lng, hours:text('hours',100), contact:text('contact',60), notes:text('notes',300), backgroundImage, active:input.active !== false };
}
function passId(value) {
  let id = String(value || '').trim();
  if (/^https?:\/\//i.test(id)) { try { id = new URL(id).pathname.replace(/^\/verify\//,''); } catch { throw fail('Enter a valid EcoPass ID or QR link.'); } }
  if (!/^ECP-\d{8}-[A-F0-9]{8}$/.test(id)) throw fail('Enter a valid EcoPass ID or QR link.');
  return id;
}
function eligibility(record, today) {
  if (record.paymentStatus !== 'PAID' || record.status !== 'ACTIVE') return 'Payment must be confirmed before check-in.';
  if (record.checkoutMode === 'test' || (record.paymentSource === 'paymongo' && record.checkoutMode !== 'live')) return 'This is a test or unclassified online payment. It cannot be used for a real check-in.';
  if (!record.visitDate || !record.validUntil || record.visitDate > today || record.validUntil < today) return 'This pass is outside its valid visit dates.';
  return '';
}
function createOperations({ useBlob, dataDir, readBlob, putBlob, ConflictError, readRegistrations }) {
  const blobPath = 'data/operations.json', file = path.join(dataDir,'operations.json');
  let queue = Promise.resolve();
  async function stored() {
    if (useBlob) {
      let value = await readBlob(blobPath);
      if (!value) {
        try { await putBlob(blobPath, JSON.stringify({booths:[],scans:[]}), {access:'private',allowOverwrite:false,addRandomSuffix:false,contentType:'application/json'}); }
        catch (error) { if (!(await readBlob(blobPath))) throw error; }
        value = await readBlob(blobPath);
      }
      if (!value?.etag) throw new Error('Operations storage is unavailable');
      return {value:JSON.parse(value.buffer.toString('utf8')),etag:value.etag};
    }
    await fs.mkdir(dataDir,{recursive:true});
    try { await fs.writeFile(file,JSON.stringify({booths:[],scans:[]}),{flag:'wx'}); } catch(error) { if(error.code !== 'EEXIST') throw error; }
    return {value:JSON.parse(await fs.readFile(file,'utf8'))};
  }
  async function read() { const result = await stored(); if(!Array.isArray(result.value.booths)||!Array.isArray(result.value.scans)) throw new Error('Operations storage is invalid'); return result.value; }
  async function change(apply) {
    const execute = async () => {
      for(let attempt=0;attempt<8;attempt++) {
        const current=await stored();
        if(!Array.isArray(current.value.booths)||!Array.isArray(current.value.scans)) throw new Error('Operations storage is invalid');
        const result=apply(current.value);
        try {
          if(useBlob) await putBlob(blobPath,JSON.stringify(current.value),{access:'private',allowOverwrite:true,ifMatch:current.etag,contentType:'application/json'});
          else { const temporary=file+'.'+crypto.randomUUID()+'.tmp'; await fs.writeFile(temporary,JSON.stringify(current.value)); await fs.rename(temporary,file); }
          return result;
        } catch(error) { if(!useBlob || !(error instanceof ConflictError) || attempt===7) throw error; }
      }
    };
    queue=queue.catch(()=>{}).then(execute); return queue;
  }
  async function lookup(code) {
    const id=passId(code), record=(await readRegistrations()).find(item=>item.id===id);
    if(!record) throw fail('No registration matches this pass.',404);
    const today=dayInManila(), state=await read();
    return {visitor:visitor(record),reason:eligibility(record,today),today,checkIn:state.scans.find(scan=>scan.passId===id && scan.date===today)||null};
  }
  return {
    async publicBooths() {
      const state=await read();
      return state.booths.filter(booth=>booth.active===true).map(({id,name,address,lat,lng,hours,backgroundImage})=>({id,name,address,lat,lng,hours,...(backgroundImage?{backgroundImage}:{})}));
    },
    async snapshot() { const [records,state]=await Promise.all([readRegistrations(),read()]); return {visitors:records.map(visitor),...state,today:dayInManila(),updatedAt:new Date().toISOString()}; },
    lookup,
    async saveBooth(input) {
      const cleaned=cleanBooth(input);
      return change(state=>{
        const existing=input.id?state.booths.find(item=>item.id===input.id):null;
        if(input.id&&!existing) throw fail('Booth not found.',404);
        if(existing && input.version!==existing.version) throw fail('This booth was changed by another administrator. Refresh and try again.',409);
        if(!existing && state.booths.length>=100) throw fail('The booth limit has been reached.');
        const booth={...cleaned,id:existing?.id||crypto.randomUUID(),version:(existing?.version||0)+1,updatedAt:new Date().toISOString()};
        if(existing) Object.assign(existing,booth); else state.booths.push(booth);
        return booth;
      });
    },
    async checkIn(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Enter a pass and select an active booth.');
      const id=passId(input.passId), record=(await readRegistrations()).find(item=>item.id===id), today=dayInManila();
      if(!record) throw fail('Pass not found.',404);
      const reason=eligibility(record,today); if(reason) throw fail(reason,409);
      return change(state=>{
        const booth=state.booths.find(item=>item.id===input.boothId&&item.active); if(!booth) throw fail('Choose an active scanning booth.');
        const existing=state.scans.find(scan=>scan.passId===id&&scan.date===today); if(existing) return {scan:existing,duplicate:true};
        const scan={id:crypto.randomUUID(),passId:id,boothId:booth.id,boothName:booth.name,date:today,at:new Date().toISOString(),guests:Object.values(record.groups||{}).reduce((sum,n)=>sum+Number(n||0),0),actor:'Administrator'};
        state.scans.push(scan); return {scan,duplicate:false};
      });
    }
  };
}
module.exports={createOperations,eligibility,dayInManila};
