'use strict';
(() => {
  const section=document.querySelector('#explore-map');if(!section)return;
  const $=s=>section.querySelector(s),scene=window.EcoPassMapScene,R=window.EcoPassRouting,requestRoute=R.createClient();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const icon=name=>'<svg class="ui-icon" aria-hidden="true"><use href="/landing-icons.svg#'+name+'"></use></svg>';
  let booths=[],map,markers=[],mapMode='terrain',ready=false,started=false,mapBusy=false,selected=null;
  let mode='walk',modeChosen=false,origin=null,route=null,routeLayer,locationMarker,picking=false,watch=null,sequence=0,controller=null,routeBusy=false,fromGPS=false;
  const status=message=>$('#explore-status').textContent=message;
  const routeStatus=message=>$('#route-status').textContent=message;
  function stopWatch(){if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}$('#route-live').hidden=true;}
  function clearDrawing(){scene.clearRoute();routeLayer?.remove();routeLayer=null;locationMarker?.remove();locationMarker=null;}
  function cancelRoute(message=''){
    sequence++;controller?.abort();controller=null;stopWatch();clearDrawing();route=null;origin=null;fromGPS=false;picking=false;routeBusy=false;
    $('#route-result').hidden=true;$('#map-route-summary').hidden=true;$('#route-pin-hint').hidden=true;$('#route-cancel').hidden=true;$('#route-gps').disabled=!ready;$('#route-pin').disabled=!ready;
    $('#map-distance-status').hidden=true;
    $('#explore-flat').disabled=mapBusy;section.classList.remove('is-picking');routeStatus(message);
  }
  function renderList(){
    const term=$('#explore-search').value.trim().toLowerCase(),filtered=booths.filter(b=>(b.name+' '+b.address).toLowerCase().includes(term));
    $('#explore-booths').innerHTML=filtered.map(b=>'<button type="button" class="visitor-booth-item" data-visitor-booth="'+escape(b.id)+'"><img src="/booth-kiosk.svg" alt=""><span><strong>'+escape(b.name)+'</strong><small>'+escape(b.address)+'</small></span>'+icon('arrow')+'</button>').join('')||'<p class="explore-empty">'+(booths.length?'No matching booths. Try another name or location.':'No booth locations are published yet. Please contact EcoPass support before your visit.')+'</p>';
  }
  function choose(id,focus=true){
    const b=booths.find(b=>b.id===id);if(!b)return;cancelRoute();selected=b;$('#explore-list-panel').hidden=true;$('#explore-detail').hidden=false;
    $('#booth-name').textContent=b.name;$('#booth-address').textContent=b.address;$('#booth-hours').textContent=b.hours||'Confirm opening hours before visiting';$('#booth-number').textContent=String(booths.indexOf(b)+1).padStart(2,'0');
    const photo=$('#booth-background');photo.hidden=!b.backgroundImage;if(b.backgroundImage)photo.src=b.backgroundImage;else photo.removeAttribute('src');
    if(ready&&focus){if(mapMode==='terrain')scene.focus(b.lat,b.lng);else map.setView([b.lat,b.lng],16);}
    status('Your checkpoint is '+b.name+'. Get directions without leaving EcoPass.');
  }
  function fit(){
    if(!ready)return;
    if(route){if(mapMode==='terrain')scene.fitRoute([...route.geometry.coordinates,origin]);else map.fitBounds([...route.geometry.coordinates,origin].map(c=>[c[1],c[0]]),{padding:[45,60],maxZoom:17});return;}
    if(!booths.length)return;if(mapMode==='terrain'){scene.fit();scene.reset();}else map.fitBounds(booths.map(b=>[b.lat,b.lng]),{padding:[70,70],maxZoom:15});
  }
  function loadScript(src,integrity){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.integrity=integrity;script.crossOrigin='anonymous';const timer=setTimeout(()=>reject(new Error('Map loading timed out.')),12000);script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Map unavailable.'));};document.head.append(script);});}
  async function street(){
    if(!window.L){const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='anonymous';document.head.append(css);await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js','sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=');}
    $('#visitor-map-3d').hidden=true;$('#visitor-map-2d').hidden=false;
    if(!map){
      map=L.map('visitor-map-2d',{scrollWheelZoom:false,zoomControl:false}).setView([9.75,122.4],13);L.control.zoom({position:'topright'}).addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map).on('tileerror',()=>status('Some map tiles are unavailable. Check your connection.'));
      map.on('click',e=>pick(e.latlng.lat,e.latlng.lng));
      markers=booths.map((b,i)=>L.marker([b.lat,b.lng],{title:b.name,icon:L.divIcon({className:'visitor-kiosk',html:'<img src="/booth-kiosk.svg" alt=""><span>'+(i+1)+'</span>',iconSize:[62,72],iconAnchor:[31,69]})}).on('add',function(){this.getElement()?.setAttribute('aria-label',b.name);}).on('click',()=>{if(!picking)choose(b.id);}).addTo(map));
    }
    map.invalidateSize();mapMode='street';
  }
  async function setMapMode(next){
    if(mapBusy||routeBusy)return;mapBusy=true;$('#explore-loading').hidden=false;$('#explore-flat').disabled=true;$('#explore-retry').disabled=true;ready=false;
    try{
      if(next==='terrain'){
        $('#visitor-map-2d').hidden=true;$('#visitor-map-3d').hidden=false;scene.update(booths.map(b=>({...b,active:true})));
        await scene.show({container:'visitor-map-3d',center:booths.length?[booths[0].lng,booths[0].lat]:[122.4,9.75],zoom:14,fitPadding:()=>({top:90,right:65,bottom:65,left:65}),onBooth:id=>{if(!picking)choose(id);},onSelect:pick,onNotice:status});mapMode='terrain';
      }else await street();ready=true;
    }catch{
      if(next==='terrain'){try{await street();ready=true;status('Using a lighter 2D map on this device. Directions work here too.');}catch{status('The map could not load. Please retry or check your connection.');}}
      else status('The map could not load. Please retry or check your connection.');
    }finally{
      mapBusy=false;$('#explore-loading').hidden=true;$('#explore-flat').disabled=false;$('#explore-retry').disabled=false;$('#explore-flat').textContent=ready?(mapMode==='terrain'?'2D view':'3D view'):'Retry map';
      $('#explore-recenter').disabled=!ready;$('#route-gps').disabled=!ready||routeBusy;$('#route-pin').disabled=!ready||routeBusy;
    }
    if(ready){if(route)drawRoute();else fit();}
  }
  function updatePosition(point){
    if(mapMode==='terrain')scene.userPosition(point[0],point[1]);
    else if(map){if(locationMarker)locationMarker.setLatLng([point[1],point[0]]);else locationMarker=L.marker([point[1],point[0]],{icon:L.divIcon({className:'visitor-location-dot',iconSize:[20,20]}),title:'Your starting point or current location',interactive:false}).addTo(map);}
  }
  function updateDistance(point,accuracy=0){
    if(!selected)return;const direct=R.distance(point,[selected.lng,selected.lat]),travel=route?R.progress(point,route):null;
    const nearby=accuracy<=50&&direct<40;
    $('#map-distance-status').hidden=false;
    $('#map-distance-status').textContent=nearby?'You are near the booth':travel&&!travel.offRoute?R.meters(travel.remaining)+' to booth · route estimate':R.meters(direct)+' to booth · straight-line distance';
    if(travel)$('#route-distance').textContent=travel.offRoute?'Off route':R.meters(travel.remaining);
    if(nearby)routeStatus('You are near the booth. Look for the EcoPass team and present your confirmed QR.');
    else if(travel?.offRoute)routeStatus('You are away from the mapped route. Tap Get directions to update it from your current location.');
  }
  function drawRoute(){
    clearDrawing();if(mapMode==='terrain')scene.route(route.geometry,origin);
    else{const points=route.geometry.coordinates.map(c=>[c[1],c[0]]);routeLayer=L.layerGroup([L.polyline(points,{color:'#fff',weight:10}),L.polyline(points,{color:'#1478e8',weight:6})]).addTo(map);updatePosition(origin);fit();}
  }
  function beginWatch(token){
    if(!fromGPS||document.hidden)return;stopWatch();
    watch=navigator.geolocation.watchPosition(position=>{
      if(token!==sequence)return;const point=[position.coords.longitude,position.coords.latitude];if(!R.validPoint(point)||!Number.isFinite(position.coords.accuracy)||position.coords.accuracy>1000)return;origin=point;updatePosition(point);updateDistance(point,position.coords.accuracy);
      $('#route-live').hidden=false;$('#route-live').textContent='Live location · accuracy ±'+Math.round(position.coords.accuracy)+' m';
      if(position.coords.accuracy<50&&R.distance(point,[selected.lng,selected.lat])<40)routeStatus('You are near the booth. Look for the EcoPass team and present your confirmed QR.');
    },()=>{if(token!==sequence)return;stopWatch();routeStatus('Location updates stopped. Your route remains visible; tap Get directions to locate again.');},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
  }
  async function calculate(point,gps,token){
    if(token!==sequence||!selected)return;
    if(!R.validPoint(point)){routeBusy=false;$('#route-gps').disabled=!ready;$('#route-pin').disabled=!ready;$('#explore-flat').disabled=mapBusy;routeStatus('Your location could not be read. Choose a starting point on the map.');return;}
    if(selected&&!modeChosen){mode=R.distance(point,[selected.lng,selected.lat])>5000?'drive':'walk';section.querySelectorAll('[data-route-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.routeMode===mode)));}
    origin=point;fromGPS=gps;routeBusy=true;$('#route-gps').disabled=true;$('#route-pin').disabled=true;$('#explore-flat').disabled=true;$('#route-cancel').hidden=false;routeStatus('Finding your '+(mode==='walk'?'walking':'driving')+' route…');
    updateDistance(point);controller=new AbortController();const currentController=controller,timeout=setTimeout(()=>currentController.abort(),30000);
    try{
      const result=await requestRoute(point,[selected.lng,selected.lat],mode,currentController.signal);if(token!==sequence)return;route=result;drawRoute();
      if(gps&&matchMedia('(max-width:720px)').matches)$('#visitor-map-frame').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
      $('#route-result').hidden=false;$('#route-time').textContent=R.time(result.duration);$('#route-distance').textContent=R.meters(result.distance);$('#route-travel-label').textContent=mode==='walk'?'Walking estimate':'Driving estimate';
      updateDistance(point);
      $('#map-route-summary').hidden=false;$('#map-route-summary').textContent=(mode==='walk'?'Walking':'Driving')+' route · '+R.time(result.duration)+' · '+R.meters(result.distance);
      $('#route-steps').innerHTML=result.steps.map((s,i)=>'<li><span>'+(i+1)+'</span><div>'+escape(s.text)+'<small>'+R.meters(s.distance)+'</small></div></li>').join('');
      const gaps=result.startGap>60||result.endGap>60?' The mapped route starts or ends on the nearest reachable road, not exactly at the pin.':'';
      routeStatus((gps?'Route ready. Your blue dot updates while this page is open.':'Route ready from your chosen starting point.')+gaps);beginWatch(token);
    }catch(error){if(token!==sequence)return;route=null;clearDrawing();$('#route-result').hidden=true;routeStatus(currentController.signal.aborted?'Route request timed out. Please try again.':error.message);}
    finally{clearTimeout(timeout);if(token===sequence){routeBusy=false;$('#route-gps').disabled=!ready;$('#route-pin').disabled=!ready;$('#explore-flat').disabled=mapBusy;}}
  }
  function locate(){
    if(!ready||!selected)return;cancelRoute();const token=sequence;$('#route-cancel').hidden=false;
    if(!navigator.geolocation){routeStatus('Location is not supported here. Choose a starting point on the map instead.');return;}
    routeBusy=true;$('#route-gps').disabled=true;$('#route-pin').disabled=true;$('#explore-flat').disabled=true;routeStatus('Allow location access in your browser to find your route.');
    navigator.geolocation.getCurrentPosition(position=>{
      if(token!==sequence)return;
      if(!Number.isFinite(position.coords.accuracy)||position.coords.accuracy>1000){routeBusy=false;$('#route-gps').disabled=false;$('#route-pin').disabled=false;$('#explore-flat').disabled=false;routeStatus('Your location is too approximate. Choose a starting point on the map for a more useful route.');return;}
      calculate([position.coords.longitude,position.coords.latitude],true,token);
    },error=>{if(token!==sequence)return;routeBusy=false;$('#route-gps').disabled=false;$('#route-pin').disabled=false;$('#explore-flat').disabled=false;routeStatus(error.code===1?'Location permission was denied. Allow it in browser settings, or choose a starting point on the map.':'Your location could not be found. Try again outdoors, or choose a starting point on the map.');},{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
  }
  function startPick(){
    if(!ready||!selected)return;cancelRoute();picking=true;section.classList.add('is-picking');$('#route-pin-hint').hidden=false;$('#route-cancel').hidden=false;
    routeStatus('Tap a road on the map to choose where your journey starts.');
    $('#visitor-map-frame').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
  }
  function pick(lat,lng){if(!picking||!selected)return;picking=false;section.classList.remove('is-picking');$('#route-pin-hint').hidden=true;calculate([lng,lat],false,sequence);}
  async function init(retry=false){
    if(started&&!retry)return;started=true;$('#explore-retry').hidden=true;$('#explore-count').textContent='Loading published checkpoints…';
    if(retry)$('#explore-booths').innerHTML='<p class="explore-empty">Reconnecting to EcoPass…</p>';
    try{
      const response=await fetch('/api/booths',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(18000)});if(!response.ok)throw new Error();const result=await response.json();if(!Array.isArray(result.booths))throw new Error();
      booths=result.booths.filter(b=>typeof b.id==='string'&&typeof b.name==='string'&&typeof b.address==='string'&&R.validPoint([b.lng,b.lat]));$('#explore-count').textContent=booths.length+' published '+(booths.length===1?'checkpoint':'checkpoints');renderList();if(booths.length)choose(booths[0].id,false);
      if(retry&&map){map.remove();map=null;markers=[];}
    }catch{$('#explore-count').textContent='Connection interrupted';$('#explore-retry').hidden=false;$('#explore-booths').innerHTML='<p class="explore-empty">Booth locations could not load. Retry below or contact EcoPass support.</p>';status('Booth locations unavailable; no booth positions are assumed.');}
    await setMapMode('terrain');
  }
  $('#explore-retry').addEventListener('click',()=>init(true));
  $('#explore-search').addEventListener('input',renderList);
  section.addEventListener('click',event=>{const b=event.target.closest('[data-visitor-booth]');if(b)choose(b.dataset.visitorBooth);});
  $('#explore-back').addEventListener('click',()=>{cancelRoute();$('#explore-detail').hidden=true;$('#explore-list-panel').hidden=false;$('#explore-search').focus();});
  $('#route-gps').addEventListener('click',locate);$('#route-pin').addEventListener('click',startPick);$('#route-cancel').addEventListener('click',()=>cancelRoute('Navigation stopped. Your location is no longer being followed.'));
  $('#route-mode').addEventListener('click',event=>{const button=event.target.closest('[data-route-mode]');if(!button)return;modeChosen=true;if(button.dataset.routeMode===mode)return;mode=button.dataset.routeMode;cancelRoute('Travel mode changed. Get directions again or choose a starting point.');section.querySelectorAll('[data-route-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.routeMode===mode)));});
  $('#explore-flat').addEventListener('click',()=>setMapMode(ready&&mapMode==='terrain'?'street':'terrain'));$('#explore-recenter').addEventListener('click',fit);$('#route-fit').addEventListener('click',fit);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&watch!==null){stopWatch();routeStatus('Location updates paused while away. Tap Get directions to resume when ready.');}});
  window.addEventListener('pagehide',()=>cancelRoute());
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();init();}},{rootMargin:'300px'});observer.observe(section);}else init();
})();
