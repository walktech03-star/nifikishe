// NIFIKISHE live GPS + nearby vehicles (phone/computer geolocation + fleet tracking).
// Uses watchPosition for continuous blue-dot follow, polls /api/live/nearby for cars.
let gpsWatchId = null;
let gpsActive = false;
let gpsLastFix = null;
let liveRefreshTimer = null;
let liveVehiclesCache = [];
function gpsStatusEl() { return document.getElementById('gpsStatusBar'); }
function setGpsStatus(msg, live) {
  const el = gpsStatusEl();
  if (!el) return;
  el.style.display = 'flex';
  el.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + (live ? '#059669' : '#d97706') + ';display:inline-block;"></span><span>' + msg + '</span>';
}
function useCurrentGpsLocation() {
  toggleLiveGps();
}
function toggleLiveGps() {
  if (!mapService || !mapService.map) {
    alert('Ramani bado inapakiwa — subiri sekunde chache kisha jaribu tena.');
    if (mapService) mapService.refresh();
    return;
  }
  if (gpsActive) { stopLiveGps(); return; }
  if (!('geolocation' in navigator)) {
    alert('Kifaa chako hakiungi mkono GPS. Tumia eneo la mfano: Mbezi Mwisho.');
    return;
  }
  if (window.isSecureContext === false && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    alert('GPS inahitaji HTTPS. Tafadhali tumia https:// au localhost.');
    return;
  }
  setGpsStatus('Inatafuta GPS…', false);
  gpsWatchId = navigator.geolocation.watchPosition(onGpsFix, onGpsError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
  });
  gpsActive = true;
  const btn = document.getElementById('btnGpsToggle');
  if (btn) { btn.classList.add('gps-on'); btn.innerHTML = '⏹'; btn.title = 'Zima GPS'; }
}
function stopLiveGps() {
  if (gpsWatchId != null) { try { navigator.geolocation.clearWatch(gpsWatchId); } catch (e) {} }
  gpsWatchId = null; gpsActive = false;
  if (liveRefreshTimer) { clearInterval(liveRefreshTimer); liveRefreshTimer = null; }
  const btn = document.getElementById('btnGpsToggle');
  if (btn) { btn.classList.remove('gps-on'); btn.innerHTML = '📍'; btn.title = 'Eneo Langu (GPS live)'; }
  setGpsStatus('GPS imezimwa.', false);
}
function onGpsFix(pos) {
  const latLng = [pos.coords.latitude, pos.coords.longitude];
  gpsLastFix = { latLng, accuracy: pos.coords.accuracy || 60, at: Date.now() };
  userOrigin = { name: 'Eneo Langu la Sasa (GPS)', coordinates: latLng };
  const oi = document.getElementById('originInput');
  if (oi) oi.value = userOrigin.name;
  mapService.updateUserLocation(latLng, 'Wewe Upo Hapa 📍');
  mapService.showAccuracyCircle(latLng, pos.coords.accuracy || 60);
  mapService.panToUser();
  setGpsStatus('GPS live ±' + Math.round(pos.coords.accuracy || 60) + 'm — magari ya karibu yanafuatiliwa', true);
  refreshNearbyVehicles();
  if (!liveRefreshTimer) liveRefreshTimer = setInterval(refreshNearbyVehicles, 15000);
}
function onGpsError(err) {
  console.warn('GPS error', err);
  const msgs = { 1: 'Ruhusa ya GPS imekataliwa. Ruhusu location kwenye browser.', 2: 'GPS haipatikani. Angalia kama location imewashwa.', 3: 'GPS imechelewa. Jaribu tena.' };
  alert((msgs[err.code] || 'GPS imeshindwa.') + ' Tutatumia Mbezi Mwisho.');
  stopLiveGps();
  mapService.updateUserLocation(userOrigin.coordinates, userOrigin.name);
}
async function refreshNearbyVehicles() {
  if (!gpsLastFix) return;
  try {
    const [lat, lng] = gpsLastFix.latLng;
    const res = await fetch('/api/live/nearby?lat=' + lat + '&lng=' + lng + '&city=' + currentCity.id);
    const data = await res.json();
    if (!data.success) return;
    const allVehicles = [];
    (data.stops || []).forEach(s => (s.nextVehicles || []).forEach(v => allVehicles.push(v)));
    const seen = new Set();
    liveVehiclesCache = allVehicles.filter(v => !seen.has(v.id) && seen.add(v.id));
    if (mapService && mapService.map) mapService.renderVehicles(liveVehiclesCache);
    renderNearbyPanel(data.stops || []);
  } catch (e) { console.warn('nearby refresh failed', e); }
}
function renderNearbyPanel(stops) {
  const panel = document.getElementById('nearbyVehiclesPanel');
  if (!panel) return;
  if (!stops.length) {
    panel.style.display = 'block';
    panel.innerHTML = '<div style="font-size:12px;color:#64748b;">Hakuna vituo ndani ya 2.5km. Tembea au chagua eneo lingine.</div>';
    return;
  }
  panel.style.display = 'block';
  panel.innerHTML = '<div style="font-size:12px;font-weight:800;margin-bottom:8px;">🚌 Magari ya Karibu — toka sasa ili usisubiri</div>' + stops.slice(0, 3).map(s => {
    const v = (s.nextVehicles || [])[0];
    let advice, color;
    if (!v) { advice = 'Hakuna gari linalokuja — subiri au chagua njia nyingine'; color = '#64748b'; }
    else if (v.etaToStopMin <= (s.walkTimeMinutes || 5)) { advice = '🏃 HARAKA! Gari linakaribia — nenda kituoni sasa'; color = '#dc2626'; }
    else if (v.etaToStopMin - (s.walkTimeMinutes || 5) <= 5) { advice = '🚶 Toka sasa — utafika kabla ya gari'; color = '#059669'; }
    else { advice = '☕ Una dakika ' + (v.etaToStopMin - (s.walkTimeMinutes || 5)) + ' — usikimbie'; color = '#2563eb'; }
    return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:8px;">'
      + '<div style="font-weight:700;font-size:13px;">📍 ' + String(s.name).replace(/</g, '&lt;') + '</div>'
      + '<div style="font-size:11px;color:#64748b;">🚶 dakika ' + (s.walkTimeMinutes || '?') + ' kwa miguu (' + Math.round(s.distanceMeters) + 'm)</div>'
      + (v ? '<div style="font-size:12px;margin-top:4px;">🚌 <b>' + String(v.routeSign).replace(/</g, '&lt;') + '</b> → ' + String(v.destination || '').replace(/</g, '&lt;') + ' — <b>' + v.etaToStopMin + '′</b></div>' : '<div style="font-size:12px;margin-top:4px;">Hakuna gari linalofuatiliwa kwenye njia hii</div>')
      + '<div style="font-size:12px;font-weight:700;color:' + color + ';margin-top:4px;">' + advice + '</div></div>';
  }).join('');
}
