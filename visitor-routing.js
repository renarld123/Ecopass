'use strict';
// Coordinates stay in memory. Only an explicit route request sends them to FOSSGIS.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EcoPassRouting=api;})(globalThis,()=>{
  const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
  function distance(a,b){const rad=Math.PI/180,dLat=(b[1]-a[1])*rad,dLng=(b[0]-a[0])*rad;const h=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
  const meters=n=>n<1000?Math.round(n)+' m':(n/1000).toFixed(1)+' km';
  function time(seconds){const minutes=Math.max(1,Math.round(seconds/60));return minutes<60?minutes+' min':Math.floor(minutes/60)+' hr'+(minutes%60?' '+minutes%60+' min':'');}
  function instruction(step){
    const m=step.maneuver||{},road=step.name?' onto '+step.name:'',turn=m.modifier||'straight';
    if(m.type==='depart')return 'Start'+(step.name?' on '+step.name:' along the mapped route');
    if(m.type==='arrive')return 'Arrive near your EcoPass booth';
    if(['roundabout','rotary','roundabout turn'].includes(m.type))return 'At the roundabout, '+(m.exit?'take exit '+m.exit:'continue')+road;
    if(m.type==='merge')return 'Merge '+turn+road;
    if(m.type==='fork')return 'Keep '+turn+road;
    if(m.type==='off ramp')return 'Take the exit'+road;
    if(m.type==='on ramp')return 'Take the ramp'+road;
    if(m.type==='end of road')return 'At the end of the road, turn '+turn+road;
    if(turn==='uturn')return 'Make a U-turn'+road;
    return (turn==='straight'?'Continue straight':'Turn '+turn)+road;
  }
  function parseRoute(data){
    if(data?.code==='NoRoute'||data?.code==='NoSegment')throw new Error('No connected route was found. Try a starting point on a nearby road; an island crossing may not have a mapped route.');
    const route=data?.routes?.[0],coords=route?.geometry?.coordinates;
    if(data?.code!=='Ok'||route?.geometry?.type!=='LineString'||!Array.isArray(coords)||coords.length<2||coords.length>100000||!coords.every(validPoint)||!Number.isFinite(route.distance)||route.distance<0||!Number.isFinite(route.duration)||route.duration<0)throw new Error('The route service returned an incomplete route. Please try again.');
    const steps=(route.legs||[]).flatMap(leg=>leg.steps||[]).filter(s=>Number.isFinite(s.distance)&&s.distance>=0&&validPoint(s.maneuver?.location));
    return {geometry:route.geometry,distance:route.distance,duration:route.duration,steps:steps.map(s=>({text:instruction(s),distance:s.distance,location:s.maneuver.location})),startGap:data.waypoints?.[0]?.distance||0,endGap:data.waypoints?.[1]?.distance||0};
  }
  function createClient(fetcher=fetch,now=Date.now){
    let lastRequest=-Infinity;
    return async function request(origin,destination,mode,signal){
      if(!validPoint(origin)||!validPoint(destination)||!['walk','drive'].includes(mode))throw new Error('Choose a valid starting point and travel mode.');
      if(now()-lastRequest<1500)throw new Error('Please wait a moment before requesting another route.');
      lastRequest=now();
      const point=p=>p.map(n=>n.toFixed(5)).join(','),profile=mode==='walk'?'foot':'car';
      const url='https://routing.openstreetmap.de/routed-'+profile+'/route/v1/driving/'+point(origin)+';'+point(destination)+'?overview=full&geometries=geojson&steps=true&alternatives=false';
      let response;
      try{response=await fetcher(url,{signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});}catch(error){if(signal?.aborted)throw error;throw new Error('The route service is unavailable. Check your connection and try again.');}
      if(response.status===429)throw new Error('The route service is busy. Please wait and try again.');
      let data;try{data=await response.json();}catch{throw new Error('The route service returned an unreadable response. Please try again later.');}
      if(!response.ok&&!['NoRoute','NoSegment'].includes(data?.code))throw new Error('The route service is unavailable. Please try again later.');
      return parseRoute(data);
    };
  }
  return {validPoint,distance,meters,time,instruction,parseRoute,createClient};
});
