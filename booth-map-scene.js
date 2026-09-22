'use strict';
// Optional, lazy-loaded WebGL terrain. Leaflet remains the low-power fallback.
window.EcoPassMapScene = (() => {
  let gl, scene, loading, pins=[], draft, latest=[], options, available=false;
  async function show(config) {
    options=config;
    if(scene&&available){scene.resize();scene.jumpTo({center:config.center,zoom:Math.min(config.zoom,17)});return;}
    if(loading)return loading;
    loading=(async()=>{
      if(!gl){
        const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.css';document.head.append(css);
        let importTimer;
        try{gl=await Promise.race([import('https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs'),new Promise((_,reject)=>{importTimer=setTimeout(()=>reject(new Error('3D library could not load.')),15000);})]);}finally{clearTimeout(importTimer);}
      }
      scene=new gl.Map({container:config.container,center:config.center,zoom:Math.min(config.zoom,15),pitch:55,bearing:-22,maxPitch:70,maxZoom:18,attributionControl:true,
        style:{version:8,sources:{street:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'},terrain:{type:'raster-dem',url:'https://tiles.mapterhorn.com/tilejson.json',attribution:'Terrain © <a href="https://mapterhorn.com/attribution">Mapterhorn</a>'}},layers:[{id:'street',type:'raster',source:'street',paint:{'raster-saturation':-.25}}],terrain:{source:'terrain',exaggeration:1},sky:{}}});
      scene.scrollZoom.disable();scene.addControl(new gl.NavigationControl({visualizePitch:true}),'top-right');scene.addControl(new gl.ScaleControl({unit:'metric'}),'bottom-left');
      scene.on('click',event=>{if(!event.originalEvent.target.closest('.scene-kiosk,.maplibregl-popup'))options.onSelect(event.lngLat.lat,event.lngLat.lng);});
      scene.on('error',()=>options.onNotice('Some 3D map data could not load. Switch to Street view if the map is incomplete.'));
      scene.getCanvas().addEventListener('webglcontextlost',()=>options.onNotice('3D graphics were interrupted. Street view is still available.'));
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('3D map took too long to load.')),20000);scene.once('load',()=>{clearTimeout(timer);resolve();});});
      available=true;update(latest);
    })().catch(error=>{if(scene)scene.remove();scene=null;available=false;throw error;}).finally(()=>{loading=null;});
    return loading;
  }
  function update(booths){latest=booths;if(!scene||!available)return;pins.forEach(p=>p.remove());pins=booths.map((b,i)=>{
    const el=document.createElement('button');el.type='button';el.className='scene-kiosk'+(b.active?'':' inactive');el.setAttribute('aria-label',b.name+' · '+(b.active?'Active':'Inactive'));
    el.innerHTML='<img src="/booth-kiosk.svg" alt=""><span class="kiosk-number">'+(i+1)+'</span>';
    const popup=new gl.Popup({offset:65,className:'eco-popup'}).setDOMContent(options.popup(b,i));
    return new gl.Marker({element:el,anchor:'bottom'}).setLngLat([b.lng,b.lat]).setPopup(popup).addTo(scene);
  });}
  function select(lat,lng){if(draft)draft.remove();draft=null;if(!scene||!available)return;const el=document.createElement('div');el.className='scene-draft';el.textContent='New pin · save to apply';draft=new gl.Marker({element:el,anchor:'bottom'}).setLngLat([lng,lat]).addTo(scene);}
  return {show,update,select,clear(){if(draft)draft.remove();draft=null;},resize(){if(scene)scene.resize();},center(){return scene?{center:scene.getCenter(),zoom:scene.getZoom()}:null;},focus(lat,lng){if(scene)scene.jumpTo({center:[lng,lat],zoom:16});},fit(){if(!scene)return;if(latest.length){const bounds=new gl.LngLatBounds();latest.forEach(b=>bounds.extend([b.lng,b.lat]));scene.fitBounds(bounds,{padding:70,maxZoom:15,duration:0});}},reset(){if(scene)scene.easeTo({pitch:55,bearing:-22,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:500});}};
})();
