'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="/landing-icons.svg#${name}"></use></svg>`;
  const currency = value => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(value)||0);
  const date = value => value ? new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila'}).format(new Date(value.length===10 ? value+'T00:00:00+08:00' : value)) : 'Not recorded';
  const timestamp = value => value ? new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}).format(new Date(value)) : 'Not recorded';
  const guests = record => Object.values(record.groups || {}).reduce((sum,n)=>sum+Number(n||0),0);
  const testPayment = record => record.checkoutMode==='test';
  const unknownOnline = record => record.paymentSource==='paymongo' && !['live','test'].includes(record.checkoutMode);
  const realPaid = record => record.paymentStatus==='PAID' && !testPayment(record) && !unknownOnline(record);
  const statusNames = {PAID:'Paid',PENDING:'Online pending',PAY_AT_OFFICE:'Due at office',CHECKOUT_FAILED:'Checkout failed'};
  const statusBadge = record => `<span class="badge ${record.paymentStatus==='PAID'?'paid':record.paymentStatus==='CHECKOUT_FAILED'?'failed':'pending'}">${escape(statusNames[record.paymentStatus]||record.paymentStatus)}</span>${testPayment(record)?'<span class="badge test">TEST</span>':unknownOnline(record)?'<span class="badge test">UNCLASSIFIED</span>':''}`;
  const initials = name => String(name||'?').trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  const empty = (message, type='leaf') => `<div class="empty">${icon(type)}<span>${escape(message)}</span></div>`;
  let data={visitors:[],booths:[],scans:[]}, page=1, view='overview', profileId='', confirmId='', verifiedId='', map, markers, draftMarker, mapMode='street', sceneLoading=false, stream, cameraTimer, detector, cameraBusy=false, loading=false;
  async function api(url, options={}) {
    const response=await fetch(url,{...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) { if(response.status===401){stopCamera(); $('#ops-shell').hidden=true; $('#signin').hidden=false;document.querySelectorAll('dialog[open]').forEach(d=>d.close());} throw new Error(result.error||'The request could not be completed.'); }
    return result;
  }
  function toast(message) { $('#ops-toast').textContent=message;$('#ops-toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#ops-toast').hidden=true,4200); }
  function report(error) { $('#ops-error').textContent=error.message;$('#ops-error').hidden=false; }
  function selectedVisits() {
    const from=$('#filter-from').value,to=$('#filter-to').value;
    return data.visitors.filter(record=>(!from||record.visitDate>=from)&&(!to||record.visitDate<=to));
  }
  function tableRecords() {
    const query=$('#visitor-search').value.trim().toLowerCase(), status=$('#payment-filter').value;
    return selectedVisits().filter(r=>(status==='all'||r.paymentStatus===status)&&(!query||[r.fullName,r.id,r.address,r.contact].some(value=>String(value||'').toLowerCase().includes(query)))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function showView(next) {
    if(!['overview','tourists','booths','scanner'].includes(next))return;
    view=next;if(view!=='scanner')stopCamera();
    document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==view);
    document.querySelectorAll('.nav-link[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
    const titles={overview:['A CLEAR VIEW OF EVERY VISIT','Welcome back, admin.','Your collections, travelers, and check-ins, together in one place.'],tourists:['PEOPLE BEHIND EVERY PASS','Know your visitors.','Find contact details, visit plans, group composition, and payment history.'],booths:['YOUR TEAM, ON THE MAP','A connected welcome.','Place your scanning booths, update their details, and plan arrivals.'],scanner:['A SMOOTH START TO EVERY VISIT','Scan. Verify. Welcome.','Confirm a valid pass and record the whole group at your booth.']};
    $('#page-kicker').textContent=titles[view][0];$('#page-title').textContent=titles[view][1];$('#page-description').textContent=titles[view][2];
    $('#visit-filters').hidden=['booths','scanner'].includes(view);$('#export-data').hidden=['booths','scanner'].includes(view);
    if(view==='booths')setTimeout(initMap,30);
    history.replaceState(null,'','#'+view);
  }
  async function refresh() {
    if(loading)return;loading=true;$('#refresh-data').disabled=true;$('#sync-status').textContent='Updating…';
    try {
      const next=await api('/api/admin/operations');
      data=next;if(!$('#ledger-day').value)$('#ledger-day').value=data.today;$('#ops-error').hidden=true;render();$('#sync-status').textContent='Up to date';$('#updated-at').textContent='Updated '+timestamp(data.updatedAt)+' · Manila time';
      if(profileId && $('#visitor-dialog').open)renderProfile(profileId);
    } catch(error){report(error);$('#sync-status').textContent='Refresh needed';}
    finally{loading=false;$('#refresh-data').disabled=false;}
  }
  function render() { renderOverview();renderTable();renderBooths();renderHistory();renderLedger(); }
  function ledgerRecords() {
    const day=$('#ledger-day').value;
    return data.visitors.filter(r=>realPaid(r)&&r.paidAt&&Number.isFinite(Date.parse(r.paidAt))&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.paidAt))===day).sort((a,b)=>String(b.paidAt).localeCompare(String(a.paidAt)));
  }
  function renderLedger() {
    const records=ledgerRecords();$('#ledger-total').textContent=currency(records.reduce((sum,r)=>sum+Number(r.amount||0),0))+' · '+records.length+' payments';
    $('#ledger-rows').innerHTML=records.map(r=>`<tr><td>${escape(timestamp(r.paidAt))}</td><td><button class="text-button" data-profile="${escape(r.id)}">${escape(r.fullName)}</button><small>${escape(r.id)}</small></td><td>${escape(r.paymentMethod)}</td><td><strong>${currency(r.amount)}</strong></td></tr>`).join('')||'<tr><td colspan="4">'+empty('No confirmed real payments for this receipt date.','receipt')+'</td></tr>';
  }
  $('#ledger-day').addEventListener('change',renderLedger);
  $('#ledger-today').addEventListener('click',()=>{$('#ledger-day').value=data.today;renderLedger();});
  $('#export-ledger').addEventListener('click',()=>{
    const records=ledgerRecords();if(!records.length)return toast('No collections for this receipt date.');
    const rows=[['Pass ID','Tourist','Method','Gross PHP','Received at UTC'],...records.map(r=>[r.id,r.fullName,r.paymentMethod,r.amount,r.paidAt])];
    const cell=value=>'"'+String(value??'').replace(/^(\s*[=+\-@])/ ,"'$1").replaceAll('"','""')+'"';
    const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='EcoPass-collections-'+$('#ledger-day').value+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Daily collection report exported.');
  });
  function renderOverview() {
    const records=selectedVisits(),paid=records.filter(realPaid),due=records.filter(r=>['PAY_AT_OFFICE','PENDING','CHECKOUT_FAILED'].includes(r.paymentStatus)&&!testPayment(r));
    $('#metric-collected').textContent=currency(paid.reduce((s,r)=>s+r.amount,0));$('#metric-pending').textContent=currency(due.reduce((s,r)=>s+r.amount,0));
    $('#metric-guests').textContent=records.reduce((s,r)=>s+guests(r),0).toLocaleString();$('#metric-registration-count').textContent=`${records.length} registrations · test records included`;
    $('#metric-scans').textContent=data.scans.filter(s=>s.date===data.today).reduce((n,s)=>n+s.guests,0).toLocaleString();
    const from=$('#filter-from').value,to=$('#filter-to').value;
    $('#filter-caption').textContent=from||to?`${from?date(from):'First visit'} — ${to?date(to):'Latest visit'}`:'All registered visits';
    const series=Array.from({length:7},(_,i)=>{const d=new Date(data.today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);const day=d.toISOString().slice(0,10);return {day,n:data.visitors.filter(r=>r.visitDate===day).reduce((s,r)=>s+guests(r),0)};});
    const peak=Math.max(1,...series.map(p=>p.n));
    $('#arrival-chart').innerHTML=series.map(p=>`<div class="chart-column" aria-label="${escape(date(p.day))}: ${p.n} travelers"><span>${p.n}</span><div class="chart-bar" style="height:${Math.max(2,p.n/peak*125)}px"></div><small>${escape(new Intl.DateTimeFormat('en-PH',{weekday:'short',timeZone:'UTC'}).format(new Date(p.day+'T00:00:00Z')))}</small></div>`).join('');
    const total=paid.reduce((n,r)=>n+r.amount,0),methods=[['Office / physical',r=>r.paymentSource==='tourism-office'],['GCash',r=>r.paymentMethod==='GCash'],['Maya',r=>r.paymentMethod==='Maya'],['Card',r=>r.paymentMethod==='Credit/Debit Card']];
    $('#payment-breakdown').innerHTML=methods.map(([name,filter])=>{const sum=paid.filter(filter).reduce((n,r)=>n+r.amount,0);return `<div class="breakdown-row"><div><span>${name}</span><strong>${currency(sum)}</strong></div><div class="meter"><i style="width:${total?sum/total*100:0}%"></i></div></div>`;}).join('');
    const testSum=records.filter(r=>r.paymentStatus==='PAID'&&testPayment(r)).reduce((n,r)=>n+r.amount,0),unknown=records.filter(r=>r.paymentStatus==='PAID'&&unknownOnline(r)).reduce((n,r)=>n+r.amount,0);
    $('#test-totals').textContent=`Excluded from collections: ${currency(testSum)} test payments${unknown?'; '+currency(unknown)+' unclassified online payments':''}.`;
    $('#recent-visitors').innerHTML=records.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5).map(r=>`<div class="visitor-mini"><span class="avatar">${escape(initials(r.fullName))}</span><div><button data-profile="${escape(r.id)}"><strong>${escape(r.fullName)}</strong><small>${escape(date(r.visitDate))} · ${guests(r)} travelers</small></button></div>${statusBadge(r)}</div>`).join('')||empty('Your first registered visitors will appear here.','users');
    const active=data.booths.filter(b=>b.active);$('#active-booths').textContent=`${active.length} active`;
    $('#booth-summary').innerHTML=active.slice(0,3).map(b=>`<div class="visitor-mini"><img class="mini-kiosk" src="/booth-kiosk.svg" alt=""><div><strong>${escape(b.name)}</strong><small>${escape(b.hours||'Hours not set')}</small></div><span class="badge paid">Active</span></div>`).join('')||empty('Add your first scanning booth to place it on the map.','pin');
  }
  function renderTable() {
    const records=tableRecords(),pages=Math.max(1,Math.ceil(records.length/15));page=Math.max(1,Math.min(page,pages));
    $('#record-count').textContent=`${records.length} records`;
    $('#visitor-rows').innerHTML=records.slice((page-1)*15,page*15).map(r=>`<tr><td><strong>${escape(r.fullName)}</strong><small>${escape(r.id)}</small></td><td>${escape(date(r.visitDate))}<small>${escape(r.stay)}</small></td><td>${guests(r)}</td><td><strong>${currency(r.amount)}</strong></td><td>${statusBadge(r)}<small>${escape(r.paymentMethod)}</small></td><td><button class="text-button" data-profile="${escape(r.id)}">View profile ${icon('external')}</button></td></tr>`).join('')||'<tr><td colspan="6">'+empty('No tourist records match these filters.','users')+'</td></tr>';
    $('#page-number').textContent=`Page ${page} of ${pages}`;$('#previous-page').disabled=page===1;$('#next-page').disabled=page===pages;
  }
  function renderProfile(id) {
    const r=data.visitors.find(v=>v.id===id);if(!r)return;profileId=id;
    const details=[['Phone',r.contact],['Address',r.address],['Date of visit',date(r.visitDate)],['Valid until',date(r.validUntil)],['Length of stay',r.stay],['Payment method',r.paymentMethod],['Amount',currency(r.amount)],['Payment received',timestamp(r.paidAt)],['Registered',timestamp(r.createdAt)],['Discount ID',r.hasDiscountId?'Uploaded':'No ID uploaded']];
    const scans=data.scans.filter(s=>s.passId===id);
    $('#visitor-profile').innerHTML=`<div class="profile-hero"><span class="avatar">${escape(initials(r.fullName))}</span><div><h2>${escape(r.fullName)}</h2><p>${escape(r.id)}</p></div></div>${statusBadge(r)}<dl class="profile-grid">${details.map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v||'Not provided')}</dd></div>`).join('')}</dl><div class="profile-section"><h3>Travel party · ${guests(r)} travelers</h3><div class="group-pills">${[['adult','Local adults'],['foreign','Foreign visitors'],['senior','Senior / PWD / student'],['child','Children below 8']].map(([k,label])=>`<span>${r.groups?.[k]||0} ${label}</span>`).join('')}</div></div><div class="profile-section"><h3>Check-in history</h3>${scans.length?scans.slice().reverse().map(s=>`<p class="muted">${escape(s.boothName)} · ${escape(timestamp(s.at))}</p>`).join(''):'<p class="muted">No check-ins recorded.</p>'}</div><div class="profile-actions">${r.paymentStatus==='PAY_AT_OFFICE'&&['Pay at Tourism Office (Cash)','Physical Payment'].includes(r.paymentMethod)?`<button class="primary" data-collect="${escape(id)}">Record office payment</button>`:''}<button class="ghost" data-use-pass="${escape(id)}">Verify for check-in</button></div>`;
  }
  function editBooth(id) {
    const b=data.booths.find(b=>b.id===id);if(!b)return;
    const form=$('#booth-form');for(const key of ['id','version','name','address','lat','lng','hours','contact','notes'])form.elements[key].value=b[key]??'';form.elements.active.checked=b.active;
    clearDraftPin();$('#booth-form-title').textContent='Edit scanning booth';$('#booth-error').textContent='';showView('booths');if(map)map.setView([b.lat,b.lng],16);window.EcoPassMapScene?.focus(b.lat,b.lng);$('#map-help').textContent='Editing '+b.name+'. Click another spot to move its pin, then save to apply.';
  }
  function clearDraftPin(){if(draftMarker&&map)map.removeLayer(draftMarker);draftMarker=null;window.EcoPassMapScene?.clear();$('#pick-location').textContent='Choose a spot on the map';}
  function selectBoothLocation(lat,lng){
    const form=$('#booth-form');form.elements.lat.value=lat.toFixed(6);form.elements.lng.value=lng.toFixed(6);clearDraftPin();
    draftMarker=L.circleMarker([lat,lng],{radius:11,color:'#8b641a',weight:3,fillColor:'#f5d686',fillOpacity:1}).addTo(map).bindTooltip('Selected location · not saved',{permanent:true,direction:'top',offset:[0,-12]});
    window.EcoPassMapScene?.select(lat,lng);
    $('#map-help').textContent='Pin selected. Enter the booth name and address, then choose Save booth location. Click elsewhere to reposition it.';
    $('#booth-error').textContent='';$('#pick-location').textContent='Return to selected pin';
  }
  function renderBooths() {
    $('#booth-count').textContent=`${data.booths.length} locations`;
    $('#booth-list').innerHTML=data.booths.map(b=>`<article class="booth-card"><div class="booth-card-top"><img src="/booth-kiosk.svg" alt="EcoPass scanning kiosk"><span class="badge ${b.active?'paid':'pending'}">${b.active?'Active':'Inactive'}</span></div><h3>${escape(b.name)}</h3><p>${escape(b.address)}<br>${escape(b.hours||'Hours not set')}<br>${escape(b.contact||'Contact not set')}</p><div class="actions"><button class="ghost" data-edit-booth="${escape(b.id)}">Edit booth</button><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.lat+','+b.lng)}" target="_blank" rel="noopener">Directions ${icon('external')}</a></div></article>`).join('')||empty('No booth locations yet. Add the first location using the map and form.','pin');
    const selected=$('#scan-booth').value;$('#scan-booth').innerHTML='<option value="">Choose an active booth</option>'+data.booths.filter(b=>b.active).map(b=>`<option value="${escape(b.id)}">${escape(b.name)}</option>`).join('');if(data.booths.some(b=>b.id===selected&&b.active))$('#scan-booth').value=selected;
    if(map)drawMarkers();
  }
  function initMap() {
    if(!window.L){$('#map-help').textContent='The map could not load. You can still enter latitude and longitude, save booths, and open their directions.';return;}
    if(map){map.invalidateSize();window.EcoPassMapScene?.resize();return;}
    installMapDesign();
    map=L.map('booth-map',{scrollWheelZoom:false}).setView([9.75,122.40],12);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    tiles.on('tileerror',()=>$('#map-help').textContent='Some map tiles could not load. Coordinates and saved booth details are still available.');
    markers=L.featureGroup().addTo(map);drawMarkers();
    $('#map-help').textContent='Click any spot on the map to pin a booth location. Nothing changes until you save.';$('#pick-location').textContent='Choose a spot on the map';
    map.on('click',event=>selectBoothLocation(event.latlng.lat,event.latlng.lng));
    if(data.booths.length)map.fitBounds(markers.getBounds(),{padding:[35,35],maxZoom:15});
  }
  function boothPopup(b,i){
    const content=document.createElement('div');content.className='booth-popup-card';
    content.innerHTML=`<div class="booth-popup-hero"><img src="/booth-kiosk.svg" alt="EcoPass scanning kiosk"><div><span class="eyebrow">ECOPASS CHECKPOINT ${i+1}</span><span class="badge ${b.active?'paid':'pending'}">${b.active?'Active booth':'Inactive booth'}</span></div></div><div class="booth-popup-body"><h3>${escape(b.name)}</h3><p class="popup-address">${icon('pin')}${escape(b.address)}</p><dl><div><dt>Operating hours</dt><dd>${escape(b.hours||'Not set')}</dd></div><div><dt>Contact</dt><dd>${escape(b.contact||'Not set')}</dd></div></dl>${b.notes?`<p class="popup-notes">${escape(b.notes)}</p>`:''}<div class="popup-actions"><button class="primary" data-edit-booth="${escape(b.id)}">Edit location</button><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.lat+','+b.lng)}">Directions ${icon('external')}</a></div></div>`;
    return content;
  }
  function drawMarkers(){markers.clearLayers();data.booths.forEach((b,i)=>{L.marker([b.lat,b.lng],{title:b.name,alt:b.name+' scanning booth',icon:L.divIcon({className:'booth-kiosk-marker'+(b.active?'':' inactive'),html:`<div class="kiosk-art"><img src="/booth-kiosk.svg" alt=""><span class="kiosk-number">${i+1}</span></div>`,iconSize:[62,72],iconAnchor:[31,69],popupAnchor:[0,-61]})}).on('add',function(){this.getElement()?.setAttribute('aria-label',b.name+' · '+(b.active?'Active booth':'Inactive booth'));}).bindPopup(boothPopup(b,i),{className:'eco-popup',minWidth:250,maxWidth:280}).addTo(markers);});window.EcoPassMapScene?.update(data.booths);if($('#map-booth-count'))$('#map-booth-count').textContent=data.booths.filter(b=>b.active).length+' active booths';}
  function installMapDesign(){
    const target=$('#booth-map'),stage=document.createElement('div');stage.className='map-stage';target.before(stage);stage.append(target);
    const scene=document.createElement('div');scene.id='booth-map-3d';scene.hidden=true;scene.setAttribute('aria-label','3D terrain and scanning booth locations');stage.append(scene);
    const toolbar=document.createElement('div');toolbar.className='map-toolbar';toolbar.innerHTML='<div class="map-view-switch" role="group" aria-label="Map view"><button type="button" id="map-street" class="selected" aria-pressed="true">'+icon('pin')+'Street view</button><button type="button" id="map-terrain" aria-pressed="false">'+icon('layers')+'3D terrain</button></div><span id="map-booth-count" class="map-count"></span><button type="button" class="map-reset" id="map-reset" hidden>'+icon('refresh')+'Reset angle</button>';stage.before(toolbar);
    const legend=document.createElement('div');legend.className='map-legend';legend.innerHTML='<span><i></i> Active booth</span><span><i class="inactive"></i> Inactive</span><span><i class="draft"></i> Unsaved pin</span><small>Click the map to place a booth</small>';stage.after(legend);
    $('#map-street').addEventListener('click',()=>switchMapView('street'));$('#map-terrain').addEventListener('click',()=>switchMapView('terrain'));$('#map-reset').addEventListener('click',()=>window.EcoPassMapScene?.reset());
    $('#fit-booths').addEventListener('click',()=>{if(mapMode==='terrain')window.EcoPassMapScene?.fit();});
  }
  async function switchMapView(next){
    if(sceneLoading||next===mapMode)return;
    if(next==='street'){
      const position=window.EcoPassMapScene?.center();$('#booth-map-3d').hidden=true;$('#booth-map').hidden=false;map.invalidateSize();if(position)map.setView([position.center.lat,position.center.lng],position.zoom);mapMode='street';$('#map-help').textContent='Street view · click to place a booth. Nothing changes until you save.';
    }else{
      sceneLoading=true;$('#map-terrain').disabled=true;$('#map-terrain').textContent='Loading 3D…';$('#booth-map-3d').hidden=false;$('#booth-map').hidden=true;
      try{const center=map.getCenter();await window.EcoPassMapScene.show({container:'booth-map-3d',center:[center.lng,center.lat],zoom:map.getZoom(),onSelect:selectBoothLocation,popup:boothPopup,onNotice:message=>$('#map-help').textContent=message});mapMode='terrain';if(draftMarker){const point=draftMarker.getLatLng();window.EcoPassMapScene.select(point.lat,point.lng);}$('#map-help').textContent='3D terrain · drag to explore, right-drag to rotate, or use two fingers on touch. Click to pin. Terrain is not a building model.';}
      catch{ $('#booth-map-3d').hidden=true;$('#booth-map').hidden=false;map.invalidateSize();$('#map-help').textContent='3D is unavailable on this device or network. You can still pin and save booths in Street view.'; }
      finally{sceneLoading=false;$('#map-terrain').disabled=false;$('#map-terrain').innerHTML=icon('layers')+'3D terrain';}
    }
    $('#map-street').classList.toggle('selected',mapMode==='street');$('#map-terrain').classList.toggle('selected',mapMode==='terrain');$('#map-street').setAttribute('aria-pressed',String(mapMode==='street'));$('#map-terrain').setAttribute('aria-pressed',String(mapMode==='terrain'));$('#map-reset').hidden=mapMode!=='terrain';
  }
  function renderHistory(){const scans=data.scans.filter(s=>s.date===data.today).slice().reverse().slice(0,12);$('#scan-history').innerHTML=scans.map(s=>{const r=data.visitors.find(r=>r.id===s.passId);return `<div class="visitor-mini"><span class="avatar">${escape(initials(r?.fullName))}</span><div><strong>${escape(r?.fullName||s.passId)}</strong><small>${escape(s.boothName)} · ${s.guests} travelers</small><small>${escape(timestamp(s.at))}</small></div><span class="badge paid">Checked in</span></div>`;}).join('')||empty('Your first check-in today will appear here.','check');}
  async function verifyPass(){
    verifiedId='';$('#scan-result').textContent='Verifying pass…';
    try{const result=await api('/api/admin/scan?code='+encodeURIComponent($('#scan-code').value));const r=result.visitor;verifiedId=result.reason||result.checkIn?'':r.id;
      $('#scan-result').innerHTML=`<div class="scan-verdict ${result.reason?'blocked':''}"><h3>${result.reason?'Pass cannot be checked in':result.checkIn?'Already checked in today':'Ready to welcome'}</h3><p><strong>${escape(r.fullName)}</strong><br>${escape(r.id)}<br>${guests(r)} travelers · ${escape(date(r.visitDate))} – ${escape(date(r.validUntil))}</p>${result.reason?`<p>${escape(result.reason)}</p>`:result.checkIn?`<p>Recorded at ${escape(result.checkIn.boothName)} · ${escape(timestamp(result.checkIn.at))}</p>`:'<button class="primary full" id="record-checkin">Confirm group check-in</button>'}</div>`;
    }catch(error){$('#scan-result').textContent=error.message;}
  }
  function stopCamera(){clearTimeout(cameraTimer);if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;$('#scan-video').srcObject=null;$('#camera-area').hidden=true;$('#camera-start').disabled=false;cameraBusy=false;}
  async function startCamera(){
    try{
      if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia)throw new Error('Camera QR scanning is unavailable in this browser. Use a USB scanner or enter the pass ID.');
      const formats=await BarcodeDetector.getSupportedFormats();if(!formats.includes('qr_code'))throw new Error('QR scanning is unavailable here. Enter the pass ID or use a USB scanner.');
      detector=new BarcodeDetector({formats:['qr_code']});$('#camera-start').disabled=true;stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});$('#scan-video').srcObject=stream;$('#camera-area').hidden=false;await $('#scan-video').play();$('#camera-note').textContent='Point the camera at the EcoPass QR. You will review the pass before check-in.';
      const detect=async()=>{if(!stream)return;try{if(!cameraBusy){cameraBusy=true;const codes=await detector.detect($('#scan-video'));cameraBusy=false;if(codes.length){$('#scan-code').value=codes[0].rawValue;stopCamera();await verifyPass();return;}}}catch{cameraBusy=false;}cameraTimer=setTimeout(detect,350);};detect();
    }catch(error){stopCamera();$('#camera-note').textContent=error.message;}
  }
  function exportCsv(){const records=view==='tourists'?tableRecords():selectedVisits();if(!records.length)return toast('No records to export for these filters.');const rows=[['Pass ID','Name','Address','Contact','Visit date','Valid until','Stay','Local adults','Foreign visitors','Discounted visitors','Children','Amount PHP','Payment method','Payment status','Mode','Paid at','Created at'],...records.map(r=>[r.id,r.fullName,r.address,r.contact,r.visitDate,r.validUntil,r.stay,r.groups?.adult,r.groups?.foreign,r.groups?.senior,r.groups?.child,r.amount,r.paymentMethod,r.paymentStatus,r.checkoutMode||(r.paymentSource==='tourism-office'?'office':'not recorded'),r.paidAt,r.createdAt])];const cell=value=>{let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='EcoPass-visitors-'+data.today+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${records.length} visitor records exported.`);}
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.view)showView(target.dataset.view);
    if(target.dataset.close)$('#'+target.dataset.close).close();
    if(target.dataset.profile){renderProfile(target.dataset.profile);$('#visitor-dialog').showModal();}
    if(target.dataset.editBooth)editBooth(target.dataset.editBooth);
    if(target.dataset.collect){confirmId=target.dataset.collect;const r=data.visitors.find(r=>r.id===confirmId);$('#confirm-description').textContent=`${currency(r.amount)} from ${r.fullName} · ${r.id}`;$('#confirm-error').textContent='';$('#payment-dialog').showModal();}
    if(target.dataset.usePass){$('#visitor-dialog').close();showView('scanner');$('#scan-code').value=target.dataset.usePass;verifyPass();}
  });
  $('#booth-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('#booth-error').textContent='';const form=event.target;const value=Object.fromEntries(new FormData(form));value.version=Number(value.version);value.active=form.elements.active.checked;try{const booth=await api('/api/admin/booths',{method:'POST',body:JSON.stringify(value)});await refresh();editBooth(booth.id);toast('Booth location saved.');}catch(error){$('#booth-error').textContent=error.message;}finally{button.disabled=false;}});
  $('#new-booth').addEventListener('click',()=>{$('#booth-form').reset();$('#booth-form').elements.id.value='';$('#booth-form').elements.version.value='';$('#booth-form-title').textContent='Add a scanning booth';$('#booth-error').textContent='';clearDraftPin();$('#pick-location').textContent='Choose a spot on the map';$('#map-help').textContent='Click any spot on the map to pin a new booth. Nothing changes until you save.';});
  $('#pick-location').addEventListener('click',()=>{initMap();if(!map)return;if(draftMarker){const p=draftMarker.getLatLng();map.panTo(p);window.EcoPassMapScene?.focus(p.lat,p.lng);}$('.map-stage').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});$('#map-help').textContent='Click the exact scanning-booth location on the map, then complete the form and save.';});
  $('#fit-booths').addEventListener('click',()=>{if(map&&data.booths.length)map.fitBounds(markers.getBounds(),{padding:[35,35],maxZoom:15});else if(map)map.setView([9.75,122.40],12);});
  $('#confirm-collection').addEventListener('click',async event=>{const button=event.target;button.disabled=true;try{await api('/api/admin/registrations/'+encodeURIComponent(confirmId)+'/confirm-payment',{method:'POST'});$('#payment-dialog').close();toast('Collection recorded. The visitor’s pass is active.');await refresh();}catch(error){$('#confirm-error').textContent=error.message;}finally{button.disabled=false;}});
  $('#scan-form').addEventListener('submit',async event=>{event.preventDefault();event.submitter.disabled=true;try{await verifyPass();}finally{event.submitter.disabled=false;}});
  $('#scan-code').addEventListener('input',()=>{verifiedId='';$('#scan-result').textContent='';});
  $('#scan-result').addEventListener('click',async event=>{const button=event.target.closest('#record-checkin');if(!button||!verifiedId)return;if(!$('#scan-booth').value)return toast('Choose the scanning booth first.');button.disabled=true;try{const result=await api('/api/admin/check-in',{method:'POST',body:JSON.stringify({passId:verifiedId,boothId:$('#scan-booth').value})});toast(result.duplicate?'This group was already checked in today.':'Group checked in. Welcome to Sipalay!');await refresh();await verifyPass();}catch(error){$('#scan-result').textContent=error.message;verifiedId='';}});
  $('#camera-start').addEventListener('click',startCamera);$('#camera-stop').addEventListener('click',stopCamera);window.addEventListener('pagehide',stopCamera);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
  $('#filter-today').addEventListener('click',()=>{$('#filter-from').value=data.today;$('#filter-to').value=data.today;page=1;renderOverview();renderTable();});
  $('#filter-all').addEventListener('click',()=>{$('#filter-from').value='';$('#filter-to').value='';page=1;renderOverview();renderTable();});
  for(const id of ['filter-from','filter-to'])$('#'+id).addEventListener('change',()=>{if($('#filter-from').value&&$('#filter-to').value&&$('#filter-from').value>$('#filter-to').value){$('#'+(id==='filter-from'?'filter-to':'filter-from')).value=$('#'+id).value;toast('Visit date range adjusted to the selected date.');}page=1;renderOverview();renderTable();});
  $('#visitor-search').addEventListener('input',()=>{page=1;renderTable();});$('#payment-filter').addEventListener('change',()=>{page=1;renderTable();});$('#previous-page').addEventListener('click',()=>{page--;renderTable();});$('#next-page').addEventListener('click',()=>{page++;renderTable();});$('#export-data').addEventListener('click',exportCsv);$('#refresh-data').addEventListener('click',refresh);
  async function open(){ $('#signin').hidden=true;$('#ops-shell').hidden=false;showView(location.hash.slice(1)||'overview');await refresh(); }
  $('#ops-login').addEventListener('submit',async event=>{event.preventDefault();event.submitter.disabled=true;$('#login-error').textContent='';try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#ops-password').value})});$('#ops-password').value='';await open();}catch(error){$('#login-error').textContent=error.message;}finally{event.submitter.disabled=false;}});
  $('#ops-logout').addEventListener('click',async()=>{stopCamera();try{await api('/api/admin/logout',{method:'POST'});location.reload();}catch(error){report(error);}});
  (async()=>{try{const session=await api('/api/admin/session');if(session.authenticated)await open();}catch(error){$('#login-error').textContent=error.message;}})();
})();
