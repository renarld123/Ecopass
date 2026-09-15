'use strict';
let activeBrandLogo='/ecopass-logo-v2.png';
const getPath=(object,path)=>{const normalized=path.replace(/^destinations\.(\d+)\./,'destinations.items.$1.');return normalized.split('.').reduce((value,key)=>value?.[Number.isInteger(Number(key))?Number(key):key],object)};
async function loadContent(){if(location.protocol==='file:')return;try{const response=await fetch('/api/content',{headers:{Accept:'application/json'}});if(!response.ok)throw new Error();const content=await response.json();activeBrandLogo=content.brand.logoImage||activeBrandLogo;document.querySelectorAll('[data-content]').forEach(element=>{const value=getPath(content,element.dataset.content);if(typeof value==='string')element.textContent=value});document.querySelectorAll('[data-image]').forEach(image=>{const value=getPath(content,image.dataset.image);if(typeof value==='string'&&value)image.src=value});document.querySelectorAll('[data-link]').forEach(element=>{const value=getPath(content,element.dataset.link);if(typeof value!=='string'||!value)return;const allowed=/^(?:https?:|mailto:|tel:|#|\/)/i.test(value);if(!allowed)return;if(element.tagName==='IFRAME'){if(/^https?:/i.test(value))element.src=value}else element.href=value});const favicon=document.querySelector('[data-favicon]');if(favicon&&content.brand.faviconImage){const joiner=content.brand.faviconImage.includes('?')?'&':'?';favicon.href=`${content.brand.faviconImage}${joiner}v=${encodeURIComponent(content.updatedAt||'default')}`}document.querySelectorAll('[data-contact]').forEach(contact=>contact.href=`mailto:${content.brand.contact}`);document.title=`${content.brand.name} — Sipalay City`}catch{const status=document.querySelector('.page-status');status.textContent='Live content is temporarily unavailable. Showing the latest built-in version.';status.hidden=false}}
const howModal=document.querySelector('#how-modal');
const howModalClose=howModal?.querySelector('.how-modal-close');
let howModalTrigger=null;
function closeHowModal(){if(!howModal)return;if(typeof howModal.close==='function'&&howModal.open)howModal.close();else howModal.removeAttribute('open')}
function openHowModal(trigger){if(!howModal)return;howModalTrigger=trigger||document.activeElement;if(typeof howModal.showModal==='function'){if(!howModal.open)howModal.showModal()}else howModal.setAttribute('open','');document.body.classList.add('modal-open')}
document.querySelectorAll('[data-how-modal-open]').forEach(trigger=>trigger.addEventListener('click',event=>{event.preventDefault();openHowModal(trigger)}));
howModalClose?.addEventListener('click',closeHowModal);
howModal?.addEventListener('click',event=>{if(event.target===howModal)closeHowModal()});
howModal?.addEventListener('close',()=>{document.body.classList.remove('modal-open');howModalTrigger?.focus();howModalTrigger=null});
howModal?.addEventListener('cancel',()=>document.body.classList.remove('modal-open'));
if(location.hash==='#how-modal')openHowModal();
const passModal=document.querySelector('#pass-modal');
const passModalClose=passModal?.querySelector('.pass-modal-close');
const passForm=document.querySelector('#passForm');
const visitDateInput=passForm?.elements.visitDate;
const discountIdInput=passForm?.elements.discountId;
const registrationCounts={adult:1,foreign:0,senior:0,child:0};
const registrationRates={adult:50,foreign:100,senior:25,child:0};
let currentPass=null;
let uploadedIdToken='';
let passModalTrigger=null;
function closePassModal(){if(!passModal)return;if(typeof passModal.close==='function'&&passModal.open)passModal.close();else passModal.removeAttribute('open')}
function showRegistrationStep(step){passModal?.querySelectorAll('[data-pass-step]').forEach(section=>section.hidden=Number(section.dataset.passStep)!==step);const progress=[...passModal.querySelectorAll('[data-pass-progress]')];progress.forEach(item=>{const value=Number(item.dataset.passProgress);item.classList.toggle('active',value===step);item.classList.toggle('complete',value<step)});passModal.querySelectorAll('.pass-progress i').forEach((line,index)=>line.classList.toggle('complete',index<step-1));passModal.querySelector('.pass-modal-card').scrollTop=0}
function openPassModal(trigger){if(!passModal)return;passModalTrigger=trigger||document.activeElement;showRegistrationStep(1);passModal.querySelectorAll('.pass-form-status').forEach(status=>{status.textContent='';status.classList.remove('success')});const today=new Date();visitDateInput.min=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);if(typeof passModal.showModal==='function'){if(!passModal.open)passModal.showModal()}else passModal.setAttribute('open','');document.body.classList.add('modal-open')}
document.querySelectorAll('[data-pass-modal-open]').forEach(trigger=>trigger.addEventListener('click',event=>{event.preventDefault();openPassModal(trigger)}));
function registrationTotal(){return Object.keys(registrationCounts).reduce((total,key)=>total+registrationCounts[key]*registrationRates[key],0)}
function groupLabel(key){return {adult:'Adults (Local)',foreign:'Foreign Visitors',senior:'Senior/PWD/Student',child:'Children below 8'}[key]}
function updateGroupRow(key){const row=passModal.querySelector(`[data-group="${key}"]`);row.querySelector('output').textContent=registrationCounts[key];row.querySelector('[data-count-action="minus"]').disabled=key==='adult'?registrationCounts[key]<=1:registrationCounts[key]<=0;passModal.querySelector('#idUploadField').classList.toggle('required',registrationCounts.senior>0)}
passModal?.querySelectorAll('[data-group]').forEach(row=>{const key=row.dataset.group;row.querySelectorAll('[data-count-action]').forEach(button=>button.addEventListener('click',()=>{const direction=button.dataset.countAction==='plus'?1:-1;const minimum=key==='adult'?1:0;registrationCounts[key]=Math.max(minimum,Math.min(50,registrationCounts[key]+direction));updateGroupRow(key)}));updateGroupRow(key)});
discountIdInput?.addEventListener('change',()=>{uploadedIdToken='';const status=passModal.querySelector('#idFileName');const file=discountIdInput.files[0];if(file&&file.size>5*1024*1024){discountIdInput.value='';status.textContent='File is larger than 5 MB';return}status.textContent=file?file.name:'No file selected'});
function renderPaymentSummary(){const summary=passModal.querySelector('#paymentSummary');const rows=Object.keys(registrationCounts).filter(key=>registrationCounts[key]>0).map(key=>`<div class="payment-summary-row"><span>${groupLabel(key)} × ${registrationCounts[key]} ${registrationRates[key]?`@ ₱${registrationRates[key]}`:'(exempted)'}</span><strong>${registrationRates[key]?`₱${(registrationCounts[key]*registrationRates[key]).toFixed(2)}`:'FREE'}</strong></div>`).join('');summary.innerHTML=`${rows}<div class="payment-summary-row total"><span>Total Amount</span><strong>₱${registrationTotal().toFixed(2)}</strong></div>`}
passForm?.addEventListener('submit',async event=>{event.preventDefault();const status=passModal.querySelector('[data-pass-status="1"]');const button=event.submitter;status.textContent='';if(registrationCounts.senior>0&&!discountIdInput.files.length){status.textContent='Please upload a valid ID for each senior, PWD, or student.';passModal.querySelector('#idUploadField').focus();return}button.disabled=true;try{if(registrationCounts.senior>0&&!uploadedIdToken){status.textContent='Securely uploading the discounted-visitor ID…';const file=discountIdInput.files[0];const response=await fetch('/api/registration-id',{method:'POST',headers:{'Content-Type':file.type},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'ID upload failed.');uploadedIdToken=result.token}status.textContent='';renderPaymentSummary();showRegistrationStep(2)}catch(error){status.textContent=error.message}finally{button.disabled=false}});
passModal?.querySelector('[data-registration-back]')?.addEventListener('click',()=>showRegistrationStep(1));
function formatPassDate(value){return new Intl.DateTimeFormat('en-PH',{year:'numeric',month:'short',day:'numeric'}).format(new Date(`${value}T00:00:00`))}
function buildRegistrationPayload(){const values=new FormData(passForm);return{fullName:String(values.get('fullName')),address:String(values.get('address')),contact:String(values.get('contact')),visitDate:String(values.get('visitDate')),stay:String(values.get('stay')),groups:{...registrationCounts},paymentMethod:String(values.get('paymentMethod')),idToken:uploadedIdToken}}
function paymentLabel(pass){return pass.paymentStatus==='PAID'?'Paid online':pass.paymentStatus==='PAY_AT_OFFICE'?'Pay at tourism office':pass.paymentStatus==='PENDING'?'Awaiting online payment':'Payment status to be confirmed'}
function renderPass(pass){const group=Object.keys(pass.groups).filter(key=>pass.groups[key]>0).map(key=>`${pass.groups[key]} ${groupLabel(key)}`).join(' · ');passModal.querySelector('#passQr').src=pass.qrDataUrl;passModal.querySelector('.pass-status-chip').textContent=pass.paymentStatus==='PAID'?'PAID':pass.paymentStatus==='PAY_AT_OFFICE'?'PAY AT OFFICE':'PAYMENT PENDING';passModal.querySelector('.success-heading h2').textContent=pass.paymentStatus==='PAID'?'Payment Successful!':'Registration Saved';passModal.querySelector('.success-heading p').textContent=pass.paymentStatus==='PAID'?'Your payment is confirmed and your EcoPass is ready.':'Your QR registration is saved. Present it with payment confirmation or pay at the tourism office.';passModal.querySelector('#passDetails').innerHTML=[['Pass ID',pass.id],['Name',pass.name],['Group',group],['Date of Visit',pass.visitDateLabel],['Length of Stay',pass.stay],['Valid Until',pass.validUntil],['Amount Due',`₱${pass.amount.toFixed(2)}`],['Payment',`${pass.paymentMethod} · ${paymentLabel(pass)}`]].map(([label,value])=>`<div><dt>${escapeDownload(label)}</dt><dd>${escapeDownload(value)}</dd></div>`).join('')}
let checkoutPopup=null,checkoutUrl='',checkoutPassId='',checkoutTimer=null;
const checkoutSupport=passModal?.querySelector('.checkout-support');
function openSecureCheckout(url){
  const mobile=window.matchMedia('(max-width: 700px)').matches;
  if(mobile)return null;
  const popup=window.open(url||'about:blank','ecopassSecureCheckout','popup=yes,width=640,height=780,scrollbars=yes,resizable=yes');
  if(popup)popup.focus();
  return popup;
}
async function refreshCheckoutPass(){
  if(!checkoutPassId)return false;
  const response=await fetch(`/api/passes/${encodeURIComponent(checkoutPassId)}`,{cache:'no-store'});
  if(!response.ok)throw new Error('Your saved pass could not be refreshed.');
  const pass=await response.json();
  currentPass={...pass,name:pass.fullName,visitDateLabel:formatPassDate(pass.visitDate),validUntil:formatPassDate(pass.validUntil)};
  renderPass(currentPass);
  if(pass.paymentStatus==='PAID'){
    checkoutSupport.hidden=true;
    const status=passModal.querySelector('[data-pass-status="3"]');
    status.textContent='PayMongo has confirmed your payment. Your EcoPass is ready.';
    status.classList.add('success');
    clearInterval(checkoutTimer);checkoutTimer=null;
    return true;
  }
  return false;
}
function watchSecureCheckout(){
  clearInterval(checkoutTimer);
  let busy=false;
  checkoutTimer=setInterval(async()=>{
    if(busy||!passModal.open)return;
    busy=true;
    try{await refreshCheckoutPass()}catch{}finally{busy=false}
  },3000);
}
passModal?.querySelector('[data-reopen-checkout]')?.addEventListener('click',()=>{
  if(!/^https:\/\/checkout\.paymongo\.com\//.test(checkoutUrl))return;
  checkoutPopup=openSecureCheckout(checkoutUrl);
  if(!checkoutPopup)location.href=checkoutUrl;
});
window.addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.data?.type!=='ecopass-checkout-return'||event.data?.passId!==checkoutPassId)return;
  if(event.data.result==='cancel'){
    checkoutSupport.hidden=true;
    passModal.querySelector('[data-pass-status="3"]').textContent='Payment was cancelled. Your registration remains saved; payment is still due.';
    clearInterval(checkoutTimer);checkoutTimer=null;
  }else try{await refreshCheckoutPass()}catch{}
});
passModal?.querySelector('[data-registration-complete]')?.addEventListener('click',async event=>{
  const button=event.currentTarget;
  const status=passModal.querySelector('[data-pass-status="2"]');
  const online=['GCash','Maya','Credit/Debit Card'].includes(passModal.querySelector('input[name="paymentMethod"]:checked')?.value);
  // Reserve a top-level window on the user gesture so browsers do not block the later checkout URL.
  const reservedPopup=online?openSecureCheckout():null;
  status.textContent='Saving your registration and preparing payment…';
  status.classList.add('preparing-payment');
  button.disabled=true;
  try{
    const response=await fetch('/api/registrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(buildRegistrationPayload())});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Registration could not be completed.');
    if(result.checkoutUrl){
      if(!/^https:\/\/checkout\.paymongo\.com\//.test(result.checkoutUrl))throw new Error('The secure checkout link was invalid.');
      checkoutPassId=result.pass.id;checkoutUrl=result.checkoutUrl;checkoutPopup=reservedPopup;
      localStorage.setItem('ecopassPendingPass',checkoutPassId);
      if(!reservedPopup){location.href=checkoutUrl;return}
      reservedPopup.location.href=checkoutUrl;
      checkoutSupport.hidden=false;
      showRegistrationStep(3);
      passModal.querySelector('[data-pass-status="3"]').textContent='Registration saved. Complete payment in the PayMongo window.';
      await refreshCheckoutPass();
      watchSecureCheckout();
      return;
    }
    if(reservedPopup)reservedPopup.close();
    currentPass={...result.pass,name:result.pass.fullName,visitDateLabel:formatPassDate(result.pass.visitDate),validUntil:formatPassDate(result.pass.validUntil),qrDataUrl:result.qrDataUrl,verifyUrl:result.verifyUrl};
    renderPass(currentPass);showRegistrationStep(3);
  }catch(error){if(reservedPopup)reservedPopup.close();status.textContent=error.message}
  finally{status.classList.remove('preparing-payment');button.disabled=false}
});
function escapeDownload(value){return String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))}
function loadCanvasImage(source){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Pass artwork could not be loaded.'));image.src=source})}
function roundedPath(context,x,y,width,height,radius){const r=Math.min(radius,width/2,height/2);context.beginPath();context.moveTo(x+r,y);context.arcTo(x+width,y,x+width,y+height,r);context.arcTo(x+width,y+height,x,y+height,r);context.arcTo(x,y+height,x,y,r);context.arcTo(x,y,x+width,y,r);context.closePath()}
function canvasText(context,text,x,y,maxWidth){const value=String(text);if(context.measureText(value).width<=maxWidth){context.fillText(value,x,y);return}let shortened=value;while(shortened.length>1&&context.measureText(`${shortened}…`).width>maxWidth)shortened=shortened.slice(0,-1);context.fillText(`${shortened}…`,x,y)}
async function downloadCurrentPass(){if(!currentPass)return;const status=passModal.querySelector('[data-pass-status="3"]');status.textContent='Preparing your EcoPass image…';status.classList.add('success');try{const [qrImage,logoImage]=await Promise.all([loadCanvasImage(currentPass.qrDataUrl),loadCanvasImage(activeBrandLogo)]);const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1440;const context=canvas.getContext('2d');context.fillStyle='#f7f1e7';context.fillRect(0,0,1080,1440);context.fillStyle='#075d34';roundedPath(context,44,44,992,660,42);context.fill();context.fillStyle='#ffffff';roundedPath(context,150,86,780,150,28);context.fill();const logoHeight=112,logoWidth=logoHeight*(logoImage.naturalWidth/logoImage.naturalHeight);context.drawImage(logoImage,(1080-logoWidth)/2,105,logoWidth,logoHeight);context.fillStyle='#ffb900';roundedPath(context,812,262,150,40,20);context.fill();context.fillStyle='#25442f';context.font='800 17px Arial';context.textAlign='center';context.fillText('REGISTERED',887,288);context.fillStyle='#ffffff';roundedPath(context,325,275,430,430,26);context.fill();context.drawImage(qrImage,360,310,360,360);context.fillStyle='#ffffff';context.font='700 31px Arial';context.fillText('EcoPass Visitor Pass',540,760);context.fillStyle='#075d34';context.font='800 42px Arial';context.fillText('Explore responsibly. Travel effortlessly.',540,845);context.fillStyle='#536a5d';context.font='24px Arial';context.fillText('Present this QR pass upon arrival in Sipalay City.',540,888);const group=Object.keys(currentPass.groups).filter(key=>currentPass.groups[key]>0).map(key=>`${currentPass.groups[key]} ${groupLabel(key)}`).join(' · ');const details=[['PASS ID',currentPass.id],['VISITOR',currentPass.name],['GROUP',group],['DATE OF VISIT',currentPass.visitDateLabel],['LENGTH OF STAY',currentPass.stay],['VALID UNTIL',currentPass.validUntil],['AMOUNT DUE',`₱${currentPass.amount.toFixed(2)}`],['PAYMENT',`${currentPass.paymentMethod} · DEMO`]];let y=960;context.textAlign='left';details.forEach(([label,value],index)=>{const column=index%2,row=Math.floor(index/2);const x=90+column*500,detailY=y+row*105;context.fillStyle='#7b8c82';context.font='700 17px Arial';context.fillText(label,x,detailY);context.fillStyle='#173b28';context.font='700 24px Arial';canvasText(context,value,x,detailY+36,410)});context.fillStyle='#fff4d5';roundedPath(context,80,1360,920,50,18);context.fill();context.fillStyle='#765b13';context.font='700 18px Arial';context.textAlign='center';context.fillText('Registration verified · payment demonstration only',540,1392);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));if(!blob)throw new Error('The pass image could not be created.');const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`EcoPass-${currentPass.id}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Your EcoPass PNG image has been downloaded.'}catch(error){status.textContent=error.message;status.classList.remove('success')}}
async function downloadVerifiedPass(){if(!currentPass)return;const status=passModal.querySelector('[data-pass-status="3"]');status.textContent='Preparing your EcoPass image…';try{const qrImage=await loadCanvasImage(currentPass.qrDataUrl);const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1440;const context=canvas.getContext('2d');context.fillStyle='#f7f1e7';context.fillRect(0,0,1080,1440);context.fillStyle='#075d34';roundedPath(context,44,44,992,690,42);context.fill();context.fillStyle='#ffb900';context.font='bold 70px Arial';context.textAlign='center';context.fillText('EcoPass',540,150);context.fillStyle='#fff';context.font='bold 36px Arial';context.fillText('Sipalay City Visitor Pass',540,210);roundedPath(context,315,265,450,450,30);context.fill();context.drawImage(qrImage,360,310,360,360);context.fillStyle='#173b28';context.font='bold 46px Arial';context.fillText(currentPass.paymentStatus==='PAID'?'PAYMENT CONFIRMED':'REGISTERED · PAYMENT DUE',540,820);context.font='28px Arial';context.fillText('Present this QR pass upon arrival.',540,875);const details=[['PASS ID',currentPass.id],['VISITOR',currentPass.name],['DATE OF VISIT',currentPass.visitDateLabel],['VALID UNTIL',currentPass.validUntil],['AMOUNT',`₱${currentPass.amount.toFixed(2)}`],['PAYMENT',paymentLabel(currentPass)]];context.textAlign='left';details.forEach(([label,value],index)=>{const x=90+(index%2)*500,y=970+Math.floor(index/2)*115;context.fillStyle='#64786b';context.font='bold 18px Arial';context.fillText(label,x,y);context.fillStyle='#173b28';context.font='bold 27px Arial';canvasText(context,value,x,y+39,420)});context.fillStyle='#fff4d5';roundedPath(context,80,1340,920,58,18);context.fill();context.fillStyle='#765b13';context.font='bold 21px Arial';context.textAlign='center';context.fillText(currentPass.paymentStatus==='PAID'?'Paid online · confirmed by PayMongo':'Payment due · settle at tourism office',540,1377);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));if(!blob)throw new Error('The pass image could not be created.');const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download=`EcoPass-${currentPass.id}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);status.textContent='Your EcoPass PNG image has been downloaded.';status.classList.add('success')}catch(error){status.textContent=error.message;status.classList.remove('success')}}
passModal?.querySelector('[data-download-pass]')?.addEventListener('click',downloadVerifiedPass);
passModal?.querySelector('[data-save-pass]')?.addEventListener('click',()=>{const status=passModal.querySelector('[data-pass-status="3"]');try{localStorage.setItem('ecopassSavedPass',JSON.stringify(currentPass));status.textContent='Pass saved on this device. You can also download a portable copy.';status.classList.add('success')}catch{status.textContent='This browser could not save the pass. Please download it instead.';status.classList.remove('success')}});
passModalClose?.addEventListener('click',closePassModal);
passModal?.addEventListener('click',event=>{if(event.target===passModal)closePassModal()});
passModal?.addEventListener('close',()=>{document.body.classList.remove('modal-open');passModalTrigger?.focus();passModalTrigger=null});
passModal?.addEventListener('cancel',()=>document.body.classList.remove('modal-open'));
async function configurePaymentChoices(){try{const response=await fetch('/api/payment-config');const config=await response.json();const online=passModal?.querySelectorAll('input[name="paymentMethod"]');online?.forEach(input=>{if(['GCash','Maya','Credit/Debit Card'].includes(input.value)){input.disabled=!config.paymongoAvailable;input.closest('label').classList.toggle('unavailable',!config.paymongoAvailable)}});if(!config.paymongoAvailable){const cash=passModal?.querySelector('input[value="Pay at Tourism Office (Cash)"]');if(cash)cash.checked=true}const note=passModal?.querySelector('.payment-notice');if(note)note.textContent=config.paymongoAvailable?`Online payment opens PayMongo's secure ${config.mode==='live'?'live':'test'} checkout. Card details are entered on PayMongo. Your pass is marked paid after payment is confirmed.`:'Online checkout is not connected yet. You may register and pay at the tourism office.'}catch{} }
async function showReturnedPayment(){const params=new URLSearchParams(location.search);const passId=params.get('pass');if(!passId||!['return','cancel'].includes(params.get('payment')))return;if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'ecopass-checkout-return',passId,result:params.get('payment')},location.origin);window.close();return}openPassModal();showRegistrationStep(3);const status=passModal.querySelector('[data-pass-status="3"]');const refresh=async()=>{const response=await fetch(`/api/passes/${encodeURIComponent(passId)}`);if(!response.ok)throw new Error('Your pass record could not be loaded.');const pass=await response.json();currentPass={...pass,name:pass.fullName,visitDateLabel:formatPassDate(pass.visitDate),validUntil:formatPassDate(pass.validUntil)};renderPass(currentPass);status.textContent=pass.paymentStatus==='PAID'?'PayMongo has confirmed your payment. Your EcoPass is ready.':params.get('payment')==='cancel'?'Payment was cancelled. Your registration remains saved, but payment is due.':'Your registration is saved. Waiting for PayMongo to confirm the payment. Please refresh this page shortly.';return pass.paymentStatus==='PAID'};try{if(!(await refresh())&&params.get('payment')==='return'){let tries=0;const timer=setInterval(async()=>{try{tries++;if(await refresh()||tries>=10)clearInterval(timer)}catch{clearInterval(timer)}},3000)}}catch(error){status.textContent=error.message}history.replaceState({},'',location.pathname)}
if(location.hash==='#pass-modal')openPassModal();
configurePaymentChoices();
showReturnedPayment();
const menu=document.querySelector('.menu-button');menu?.addEventListener('click',()=>{const expanded=menu.getAttribute('aria-expanded')==='true';menu.setAttribute('aria-expanded',String(!expanded));document.querySelector('.nav').classList.toggle('open',!expanded)});document.querySelectorAll('.nav a').forEach(link=>link.addEventListener('click',()=>{menu?.setAttribute('aria-expanded','false');document.querySelector('.nav').classList.remove('open')}));
// CMS copy may arrive after the payment result; keep the verified payment state visible.
loadContent().then(()=>{if(currentPass)renderPass(currentPass)});
