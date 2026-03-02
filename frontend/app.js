// Frontend animation logic (vanilla JS)
// ANIMATION_SPEED controls baseline speed multiplier
const ANIMATION_SPEED = 1.0;

let map;
let itinerary;
let routeGeo = [];
let progressCoords = [];
let vehicleMarker;
let animationRequest;
let playing = false;
let speedMultiplier = ANIMATION_SPEED;
let currentIconUrl = null;
// stop markers and visited tracking
let stopMarkers = [];
let visitedStopIds = new Set();
let followVehicle = false;

const API = {
  itinerary: '/itinerary',
  route: '/route'
};

async function fetchItinerary(){
  const res = await fetch(API.itinerary);
  return res.json();
}

async function fetchRoute(a,b){
  const from = `${a.lat},${a.lng}`
  const to = `${b.lat},${b.lng}`
  const res = await fetch(`${API.route}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  return res.json();
}

function initMap(){
  // Use Mapbox GL JS but a custom OSM raster style so no token required
  const style = {
    version: 8,
    sources: {
      'raster-tiles': { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 }
    },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'raster-tiles' }]
  };

  mapboxgl.accessToken = undefined;
  map = new mapboxgl.Map({
    container: 'map',
    style: style,
    center: [80.7, 7.5],
    zoom: 7
  });

  map.on('load', async ()=>{
    itinerary = await fetchItinerary();
    await setupStops(itinerary.stops);
    await buildFullRoute(itinerary.stops);
    addRouteLayers();
    addVehicleMarker();
    fitMapToStops(itinerary.stops);
    // initialize icon selector
    initIconSelector();
  })
}

function fitMapToStops(stops){
  const bounds = new mapboxgl.LngLatBounds();
  stops.forEach(s => bounds.extend([s.lng, s.lat]));
  map.fitBounds(bounds, {padding:60, maxZoom:9, duration:1500});
}

async function setupStops(stops){
  stops.forEach(s => {
    const el = document.createElement('div');
    el.className = 'stop-pin';
    el.innerHTML = `<div class="pin"><div class="bg"><img src="${s.photoUrl}"/></div></div>`;
    const marker = new mapboxgl.Marker(el).setLngLat([s.lng, s.lat]).addTo(map);
    // store marker for visited tracking
    stopMarkers.push({ id: s.id, stop: s, marker: marker });
    // ensure initial unvisited state
    el.classList.remove('visited');
  })
}

async function buildFullRoute(stops){
  routeGeo = [];
  for(let i=0;i<stops.length-1;i++){
    const a = stops[i], b = stops[i+1];
    const seg = await fetchRoute(a,b);
    // append coordinates
    if(seg.geometry && seg.geometry.coordinates){
      // avoid duplicating connecting point
      if(routeGeo.length && routeGeo[routeGeo.length-1][0] === seg.geometry.coordinates[0][0] && routeGeo[routeGeo.length-1][1] === seg.geometry.coordinates[0][1]){
        routeGeo = routeGeo.concat(seg.geometry.coordinates.slice(1));
      } else {
        routeGeo = routeGeo.concat(seg.geometry.coordinates);
      }
    }
  }
}

function addRouteLayers(){
  if(map.getSource('route-full')) map.removeLayer('route-full') || map.removeSource('route-full');
  map.addSource('route-full', { type:'geojson', data: {type:'Feature', geometry:{type:'LineString', coordinates: routeGeo}} });
  map.addLayer({ id:'route-full', type:'line', source:'route-full', paint:{ 'line-width': 8, 'line-color':'#f44336', 'line-opacity':0.25 } });

  map.addSource('route-progress', { type:'geojson', data: {type:'Feature', geometry:{type:'LineString', coordinates: []}} });
  map.addLayer({ id:'route-progress', type:'line', source:'route-progress', paint:{ 'line-width':10, 'line-color':'#c0392b' } });

  // waypoint dots
  const waypoints = routeGeo.filter((p,i)=> i%15===0).map(c=>({type:'Feature', geometry:{type:'Point', coordinates:c}}));
  map.addSource('wps', { type:'geojson', data: {type:'FeatureCollection', features: waypoints} });
  map.addLayer({ id:'wps', type:'circle', source:'wps', paint:{'circle-radius':4,'circle-color':'#8b5e3c'} });
}

function addVehicleMarker(){
  const el = document.createElement('div');
  el.className = 'vehicle';
  // inner rotator preserves Mapbox's positioning transform on the outer element
  const inner = document.createElement('div');
  inner.className = 'vehicle-rot';
  // prefer a currentIconUrl if user already selected one, otherwise use itinerary's default
  currentIconUrl = currentIconUrl || itinerary.vehicleIconUrl;
  inner.innerHTML = `<img src="${currentIconUrl}" alt="vehicle"/>`;
  el.appendChild(inner);
  vehicleMarker = new mapboxgl.Marker(el).setLngLat(routeGeo[0]).addTo(map);
}

function initIconSelector(){
  const container = document.getElementById('iconSelect');
  if(!container) return;
  container.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', ()=>{
      container.querySelectorAll('img').forEach(i=>i.classList.remove('selected'));
      img.classList.add('selected');
      setVehicleIcon(img.dataset.url);
    })
  })
}

function setVehicleIcon(url){
  currentIconUrl = url;
  // update vehicle marker image if already created
  if(vehicleMarker){
    const imgEl = vehicleMarker.getElement().querySelector('.vehicle-rot img');
    if(imgEl) imgEl.src = url;
  }
}

function bearing(a,b){
  const lon1 = a[0]*Math.PI/180, lat1=a[1]*Math.PI/180;
  const lon2 = b[0]*Math.PI/180, lat2=b[1]*Math.PI/180;
  const y = Math.sin(lon2-lon1)*Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1);
  const brng = Math.atan2(y,x) * 180/Math.PI;
  return (brng+360)%360;
}

let startTime, durationMs = 30000; // base duration for whole trip
let traveledKm = 0;

function startAnimation(){
  if(playing) return;
  playing = true;
  startTime = performance.now();
  // derive duration based on speed
  const speedSlider = document.getElementById('speed');
  speedMultiplier = parseFloat(speedSlider.value);
  durationMs = 30000 / speedMultiplier;
  animate();
}

function stopAnimation(){
  playing = false;
  if(animationRequest) cancelAnimationFrame(animationRequest);
}

function restart(){
  stopAnimation();
  // reset
  if(map.getSource('route-progress')) map.getSource('route-progress').setData({type:'Feature', geometry:{type:'LineString', coordinates:[]}});
  if(routeGeo && routeGeo.length) vehicleMarker.setLngLat(routeGeo[0]);
  traveledKm = 0; updateDistance(0);
}

function updateDistance(km){
  const el = document.getElementById('distance');
  el.innerText = `${Math.round(km)} KM`;
}

function interpolateCoords(coords, t){
  // t in [0,1], interpolate along coords array by length
  const total = coords.length;
  const raw = t*(total-1);
  const i = Math.floor(raw);
  const f = raw - i;
  if(i >= total-1) return coords[total-1];
  const a = coords[i], b = coords[i+1];
  return [ a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f ];
}

function animate(){
  const now = performance.now();
  const elapsed = now - startTime;
  const t = Math.min(1, elapsed / durationMs);
  const pos = interpolateCoords(routeGeo, t);
  // update progress line
  const totalPoints = Math.floor(t * (routeGeo.length-1)) + 1;
  const partial = routeGeo.slice(0, totalPoints);
  // add last interpolated point for smoothness
  partial.push(pos);
  if(map.getSource('route-progress')) map.getSource('route-progress').setData({type:'Feature', geometry:{type:'LineString', coordinates: partial}});
  // move vehicle
  vehicleMarker.setLngLat(pos);
  // optionally follow vehicle with the map
  if(followVehicle && map){
    try{
      map.easeTo({center: pos, duration: 300});
    }catch(e){}
  }
  // mark stops visited when vehicle is close
  try{
    // pos is [lng, lat]
    const vlat = pos[1], vlng = pos[0];
    const ARRIVAL_KM = 0.15; // 150 meters threshold
    stopMarkers.forEach(({id, stop, marker}) => {
      if(visitedStopIds.has(id)) return;
      const d = haversine(vlat, vlng, stop.lat, stop.lng);
      if(d <= ARRIVAL_KM){
        // mark visited
        visitedStopIds.add(id);
        try{
          const el = marker.getElement();
          if(el) el.classList.add('visited');
        }catch(e){}
      }
    })
  }catch(e){}
  // compute bearing for rotation
  const nextIndex = Math.min(routeGeo.length-1, Math.floor(t*(routeGeo.length-1))+1);
  const br = bearing(pos, routeGeo[nextIndex]);
  const rotEl = vehicleMarker.getElement().querySelector('.vehicle-rot');
  if(rotEl) rotEl.style.transform = `rotate(${br}deg)`;
  // distance traveled (approx by sampling)
  const traveledRatio = t;
  // compute total route length (estimate by haversine sums)
  const totalKm = estimateTotalKm(routeGeo);
  const km = totalKm * traveledRatio;
  updateDistance(km);

  if(t<1 && playing){
    animationRequest = requestAnimationFrame(animate);
  } else {
    playing = false;
  }
}

function estimateTotalKm(coords){
  let km=0; for(let i=0;i<coords.length-1;i++){ km += haversine(coords[i][1],coords[i][0], coords[i+1][1],coords[i+1][0]); } return km;
}

function haversine(lat1,lon1,lat2,lon2){
  const R=6371; const dLat=(lat2-lat1)*Math.PI/180; const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); return R*c;
}

// UI wiring
// UI wiring
document.addEventListener('DOMContentLoaded', ()=>{
  initMap();
  document.getElementById('playBtn').addEventListener('click', ()=>startAnimation());
  document.getElementById('restartBtn').addEventListener('click', ()=>restart());
  const fbtn = document.getElementById('followBtn');
  if(fbtn) fbtn.addEventListener('click', ()=>{ followVehicle = !followVehicle; fbtn.classList.toggle('active'); });
  document.getElementById('speed').addEventListener('input', (e)=>{
    speedMultiplier = parseFloat(e.target.value);
    if(playing){
      // adjust duration proportionally
      const elapsed = performance.now() - startTime;
      const progress = elapsed / durationMs;
      durationMs = 30000 / speedMultiplier;
      startTime = performance.now() - progress * durationMs;
    }
  })
})
