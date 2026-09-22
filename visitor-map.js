'use strict';
(() => {
  const section=document.querySelector('#explore-map');if(!section)return;
  const $=selector=>section.querySelector(selector), scene=window.EcoPassMapScene;
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const icon=name=>`<svg class="ui-icon" aria-hidden="true"><use href="/landing-icons.svg#${name}"></use></svg>`;
  const directions=b=>'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(b.lat+','+b.lng);
  let booths=[],map,markers=[],started=false,busy=false,mode='terrain',selected='',initializing;
  const status=message=>$('#explore-status').textContent=message;
  function popup(b,index){
    const node=document.createElement('div');node.className='visitor-booth-popup';
    node.innerHTML=`<div class="visitor-popup-cover"><img src="/booth-kiosk.svg" alt=""><span>ECOPASS CHECKPOINT ${index+1}</span></div><div class="visitor-popup-body"><span class="visitor-status">Published scanning booth</span><h3>${escape(b.name)}</h3><p>${icon('pin')}${escape(b.address)}</p><p>${icon('clock')}${escape(b.hours||'Hours not published — confirm before visiting')}</p><a href="${directions(b)}" target="_blank" rel="noopener">Get directions ${icon('external')}</a><small>Bring your confirmed EcoPass QR for check-in.</small></div>`;
    return node;
  }
  function highlight(id){selected=id;section.querySelectorAll('[data-visitor-booth]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.visitorBooth===id)));}
  function renderList(){
    const term=$('#explore-search').value.trim().toLowerCase(),filtered=booths.filter(b=>(b.name+' '+b.address).toLowerCase().includes(term));
    $('#explore-booths').innerHTML=filtered.map(b=>`<button type="button" class="visitor-booth-item" data-visitor-booth="${escape(b.id)}" aria-pressed="${b.id===selected}"><span class="visitor-booth-number">${booths.indexOf(b)+1}</span><span><strong>${escape(b.name)}</strong><small>${escape(b.address)}</small><em>${icon('clock')}${escape(b.hours||'Hours not published')}</em></span>${icon('arrow')}</button>`).join('')||`<p class="explore-empty">${booths.length?'No matching booths. Try another name or location.':'Booth locations have not been published yet. Please contact EcoPass support before your visit.'}</p>`;
  }
  function controls(){
    $('#explore-3d').setAttribute('aria-pressed',String(mode==='terrain'));$('#explore-2d').setAttribute('aria-pressed',String(mode==='street'));$('#explore-reset').hidden=mode!=='terrain';
    for(const id of ['#explore-3d','#explore-2d','#explore-fit','#explore-reset'])$(id).disabled=busy;
  }
  function loadScript(src,integrity){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.integrity=integrity;script.crossOrigin='anonymous';const timer=setTimeout(()=>reject(new Error('Street view timed out.')),12000);script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Street view could not load.'));};document.head.append(script);});}
  async function street(){
    if(!window.L){const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='anonymous';document.head.append(css);await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js','sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=');}
    $('#visitor-map-3d').hidden=true;$('#visitor-map-2d').hidden=false;
    if(!map){map=L.map('visitor-map-2d',{scrollWheelZoom:false,zoomControl:false}).setView([9.75,122.4],13);L.control.zoom({position:'topright'}).addTo(map);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map).on('tileerror',()=>status('Some map tiles are unavailable. Booth details and directions links are still available.'));markers=booths.map((b,i)=>L.marker([b.lat,b.lng],{title:b.name,icon:L.divIcon({className:'visitor-kiosk',html:`<img src="/booth-kiosk.svg" alt=""><span>${i+1}</span>`,iconSize:[62,72],iconAnchor:[31,69]})}).on('add',function(){this.getElement()?.setAttribute('aria-label',b.name);}).on('click',()=>highlight(b.id)).bindPopup(popup(b,i),{className:'visitor-leaflet-popup',maxWidth:280,minWidth:240,autoPanPadding:[20,20]}).addTo(map));}
    map.invalidateSize();mode='street';fit();
  }
  const fitPadding=()=>({top:90,bottom:90,left:matchMedia('(max-width:720px)').matches?70:370,right:70});
  function fit(){if(!booths.length)return;if(mode==='terrain')scene.fit();else if(map){const p=fitPadding();map.fitBounds(booths.map(b=>[b.lat,b.lng]),{paddingTopLeft:[p.left,p.top],paddingBottomRight:[p.right,p.bottom],maxZoom:15});}highlight('');}
  async function setMode(next){
    if(busy)return;busy=true;controls();$('#explore-loading').hidden=false;
    try{
      if(next==='terrain'){
        $('#visitor-map-2d').hidden=true;$('#visitor-map-3d').hidden=false;
        const center=booths.length?[booths[0].lng,booths[0].lat]:[122.4,9.75];scene.update(booths.map(b=>({...b,active:true})));
        await scene.show({container:'visitor-map-3d',center,zoom:13,popup,fitPadding,onBooth:highlight,onNotice:status});mode='terrain';fit();status('Drag to explore · right-drag to rotate · select a kiosk for details. Terrain view, not a building model.');
      }else{await street();status('Street view · choose a kiosk or a booth in the list for details and directions.');}
    }catch(error){
      if(next==='terrain'){try{await street();status('3D is unavailable on this device or network. Street view and booth directions are ready.');}catch{status('The map could not load. Choose a booth from the list for its directions.');}}
      else status('Street view could not load. Booth details and directions are still available.');
    }finally{busy=false;$('#explore-loading').hidden=true;controls();}
  }
  function choose(id){
    if(busy)return;const index=booths.findIndex(b=>b.id===id),b=booths[index];if(!b)return;highlight(id);
    if(mode==='terrain'){scene.focus(b.lat,b.lng);scene.open(index);}else if(map){map.setView([b.lat,b.lng],16);markers[index].openPopup();}
    // The details below remain usable even when external map providers fail.
    $('#explore-selected')?.remove();const details=popup(b,index);details.id='explore-selected';details.classList.add('visitor-selected');$('#explore-booths').after(details);
    status('Selected '+b.name+'. Check the published hours before travelling.');
  }
  async function init(){
    if(started)return initializing;started=true;
    initializing=(async()=>{
      try{const response=await fetch('/api/booths',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('Booths unavailable');const result=await response.json();if(!Array.isArray(result.booths))throw new Error('Invalid booth data');booths=result.booths.filter(b=>typeof b.id==='string'&&typeof b.name==='string'&&typeof b.address==='string'&&Number.isFinite(b.lat)&&Number.isFinite(b.lng));$('#explore-count').textContent=booths.length+' published '+(booths.length===1?'booth':'booths');renderList();await setMode('terrain');}
      catch{renderList();$('#explore-count').textContent='Booth locations unavailable';$('#explore-booths').innerHTML='<p class="explore-empty">We could not load the booth locations. Please refresh or contact EcoPass support.</p>';await setMode('terrain');status('Booth locations could not be loaded. The map shows Sipalay only; no booth locations are assumed.');}
    })();return initializing;
  }
  $('#explore-search').addEventListener('input',renderList);
  section.addEventListener('click',event=>{const button=event.target.closest('[data-visitor-booth]');if(button)choose(button.dataset.visitorBooth);});
  $('#explore-3d').addEventListener('click',async()=>{await init();setMode('terrain');});$('#explore-2d').addEventListener('click',async()=>{await init();setMode('street');});$('#explore-fit').addEventListener('click',fit);$('#explore-reset').addEventListener('click',()=>scene.reset());
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();init();}},{rootMargin:'300px'});observer.observe(section);}else init();
})();
