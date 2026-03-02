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
  // Initialize Google Maps (map-only 3D via tilt/heading)
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 7.5, lng: 80.7 },
    zoom: 7,
    tilt: 45,
    heading: 0,
    mapId: undefined // allow default style; user can enable premium mapId if desired
  });

  // wait for idle which indicates initial tiles loaded
  google.maps.event.addListenerOnce(map, 'idle', async ()=>{
    itinerary = await fetchItinerary();
    await setupStops(itinerary.stops);
    await buildFullRoute(itinerary.stops);
    addRouteLayers();
    addVehicleMarker();
    fitMapToStops(itinerary.stops);
    initIconSelector();
  });
}

function fitMapToStops(stops){
  const bounds = new google.maps.LatLngBounds();
  stops.forEach(s => bounds.extend(new google.maps.LatLng(s.lat, s.lng)));
  map.fitBounds(bounds, 60);
}

async function setupStops(stops){
  // Create a custom OverlayView for each stop so we can use the existing HTML/CSS
  class StopOverlay extends google.maps.OverlayView {
    constructor(stop){
      super();
      this.stop = stop;
      this.div = null;
    }
    onAdd(){
      this.div = document.createElement('div');
      this.div.className = 'stop-pin';
      this.div.innerHTML = `<div class="pin"><div class="bg"><img src="${this.stop.photoUrl}"/></div></div>`;
      this.getPanes().overlayMouseTarget.appendChild(this.div);
    }
    draw(){
      const proj = this.getProjection && this.getProjection();
      if(!proj || !this.div) return;
      const pos = proj.fromLatLngToDivPixel(new google.maps.LatLng(this.stop.lat, this.stop.lng));
      if(pos){
        this.div.style.left = pos.x + 'px';
        this.div.style.top = pos.y + 'px';
      }
    }
    onRemove(){
      if(this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      this.div = null;
    }
    getElement(){ return this.div; }
  }

  stops.forEach(s => {
    // prefer AdvancedMarkerView when available
    const el = document.createElement('div');
    el.className = 'stop-pin';
    el.innerHTML = `<div class="pin"><div class="bg"><img src="${s.photoUrl}"/></div></div>`;

    let marker;
    if(window.google && google.maps && google.maps.marker && google.maps.marker.AdvancedMarkerView){
      marker = new google.maps.marker.AdvancedMarkerView({ map, position: { lat: s.lat, lng: s.lng }, content: el });
    } else {
      const overlay = new StopOverlay(s);
      overlay.setMap(map);
      marker = overlay;
    }

    stopMarkers.push({ id: s.id, stop: s, marker: marker });
    // ensure initial unvisited state
    const domEl = (marker.getElement && marker.getElement()) || marker.content || null;
    if(domEl) domEl.classList.remove('visited');
  });
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
  // Convert routeGeo ([lng,lat]) to google maps LatLngLiteral
  const fullPath = routeGeo.map(p => ({ lat: p[1], lng: p[0] }));
  // full polyline
  if(window.fullPolyline) window.fullPolyline.setMap(null);
  window.fullPolyline = new google.maps.Polyline({ path: fullPath, strokeColor: '#f44336', strokeOpacity: 0.25, strokeWeight: 8, map });
  // progress polyline
  if(window.progressPolyline) window.progressPolyline.setMap(null);
  window.progressPolyline = new google.maps.Polyline({ path: [], strokeColor: '#c0392b', strokeOpacity: 1, strokeWeight: 10, map });
  // waypoints as small markers (optional)
  if(window.waypointMarkers){ window.waypointMarkers.forEach(m=>m.setMap(null)); }
  window.waypointMarkers = routeGeo.filter((p,i)=> i%15===0).map(c=> new google.maps.Marker({ position: {lat: c[1], lng: c[0]}, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4, fillColor:'#8b5e3c', fillOpacity:1, strokeWeight:0 }, map }));
}

function addVehicleMarker(){
  // create overlay for vehicle so we can rotate HTML easily
  class VehicleOverlay extends google.maps.OverlayView {
    constructor(){ super(); this.pos = null; this.div = null; }
    onAdd(){
      this.div = document.createElement('div');
      this.div.className = 'vehicle';
      const inner = document.createElement('div');
      inner.className = 'vehicle-rot';
      currentIconUrl = currentIconUrl || (itinerary && itinerary.vehicleIconUrl);
      inner.innerHTML = `<img src="${currentIconUrl}" alt="vehicle"/>`;
      this.div.appendChild(inner);
      this.getPanes().overlayMouseTarget.appendChild(this.div);
    }
    draw(){
      if(!this.pos || !this.div) return;
      const proj = this.getProjection && this.getProjection();
      if(!proj) return;
      const p = proj.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
      if(p){ this.div.style.left = p.x + 'px'; this.div.style.top = p.y + 'px'; }
    }
    onRemove(){ if(this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div); this.div = null; }
    setPosition(latlng){ this.pos = latlng; this.draw(); }
    getElement(){ return this.div; }
  }

  // prefer AdvancedMarkerView
  const vEl = document.createElement('div');
  vEl.className = 'vehicle';
  const inner = document.createElement('div'); inner.className = 'vehicle-rot';
  currentIconUrl = currentIconUrl || (itinerary && itinerary.vehicleIconUrl);
  inner.innerHTML = `<img src="${currentIconUrl}" alt="vehicle"/>`;
  vEl.appendChild(inner);

  if(window.google && google.maps && google.maps.marker && google.maps.marker.AdvancedMarkerView){
    vehicleMarker = new google.maps.marker.AdvancedMarkerView({ map, position: routeGeo && routeGeo.length ? { lat: routeGeo[0][1], lng: routeGeo[0][0] } : null, content: vEl });
  } else {
    vehicleMarker = new VehicleOverlay();
    vehicleMarker.setMap(map);
    if(routeGeo && routeGeo.length) vehicleMarker.setPosition({ lat: routeGeo[0][1], lng: routeGeo[0][0] });
  }
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
    const dom = (vehicleMarker.getElement && vehicleMarker.getElement()) || vehicleMarker.content || null;
    if(dom){
      const imgEl = dom.querySelector('.vehicle-rot img');
      if(imgEl) imgEl.src = url;
    }
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
  if(window.progressPolyline) window.progressPolyline.setPath([]);
  if(routeGeo && routeGeo.length && vehicleMarker){
    if(typeof vehicleMarker.setPosition === 'function') vehicleMarker.setPosition({ lat: routeGeo[0][1], lng: routeGeo[0][0] });
    else if('position' in vehicleMarker) try{ vehicleMarker.position = { lat: routeGeo[0][1], lng: routeGeo[0][0] }; }catch(e){}
    else if(vehicleMarker.setPosition) vehicleMarker.setPosition({ lat: routeGeo[0][1], lng: routeGeo[0][0] });
  }
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
  // update progress polyline
  const partialPath = partial.map(p => ({ lat: p[1], lng: p[0] }));
  if(window.progressPolyline) window.progressPolyline.setPath(partialPath);
  // move vehicle (support OverlayView fallback and AdvancedMarkerView)
  if(vehicleMarker){
    if(typeof vehicleMarker.setPosition === 'function'){
      vehicleMarker.setPosition({ lat: pos[1], lng: pos[0] });
    } else if('position' in vehicleMarker){
      try{ vehicleMarker.position = { lat: pos[1], lng: pos[0] }; }catch(e){ /* ignore */ }
    } else if(typeof vehicleMarker.setPosition === 'function'){
      vehicleMarker.setPosition({ lat: pos[1], lng: pos[0] });
    }
  }
  // optionally follow vehicle with the map
  if(followVehicle && map){
    try{ map.panTo({ lat: pos[1], lng: pos[0] }); }catch(e){}
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
          const el = (marker.getElement && marker.getElement()) || marker.content || null;
          if(el) {
            // add visited flag class
            el.classList.add('visited');
            // show the teardrop visited-pin and place the stop avatar inside it
            // Requires `/static/visited-pin.png` to exist; if missing, fall back to a plain red bg
            const avatar = stop.photoUrl || '';
            el.innerHTML = `
              <div class="visited-pin">
                <img class="visited-avatar" src="${avatar}" alt="stop" />
              </div>
            `;
          }
        }catch(e){}
      }
    })
  }catch(e){}
  // compute bearing for rotation
  const nextIndex = Math.min(routeGeo.length-1, Math.floor(t*(routeGeo.length-1))+1);
  const br = bearing(pos, routeGeo[nextIndex]);
  let vehDom = null;
  if(vehicleMarker){
    vehDom = (vehicleMarker.getElement && vehicleMarker.getElement()) || vehicleMarker.content || null;
  }
  const rotEl = vehDom && vehDom.querySelector('.vehicle-rot');
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
