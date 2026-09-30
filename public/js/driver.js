// NIFIKISHE driver app: stream phone GPS to /api/live/ingest every 10s.
let drvWatchId = null;
let drvSharing = false;
let drvVehicleId = localStorage.getItem('nifikishe_driver_vehicle') || ('gari_' + Math.random().toString(36).slice(2, 8));
localStorage.setItem('nifikishe_driver_vehicle', drvVehicleId);
let drvSent = 0;
let drvTimer = null;
let drvLastPos = null;

document.addEventListener('DOMContentLoaded', async () => {
  const nameEl = document.getElementById('drvName');
  if (nameEl && localStorage.getItem('nifikishe_driver_name')) nameEl.value = localStorage.getItem('nifikishe_driver_name');
  try {
    const res = await fetch('/api/routes?city=dar-es-salaam');
    const data = await res.json();
    const sel = document.getElementById('drvRoute');
    sel.innerHTML = '<option value="">— Chagua njia —</option>' + ((data.routes || []).map(r =>
      '<option value="' + r.id + '">' + r.routeSign + ' (' + r.name + ')</option>').join(''));
    const saved = localStorage.getItem('nifikishe_driver_route');
    if (saved) sel.value = saved;
  } catch (e) {
    document.getElementById('drvRoute').innerHTML = '<option value="">Imeshindwa kupakia njia</option>';
  }
});

function drvLog(msg) {
  const el = document.getElementById('drvLog');
  if (el) el.innerHTML = new Date().toLocaleTimeString() + ' — ' + msg + '<br>' + el.innerHTML;
}

function driverToggle() {
  if (drvSharing) { driverStop(); return; }
  const routeId = document.getElementById('drvRoute').value;
  if (!routeId) { alert('Tafadhali chagua njia kwanza.'); return; }
  if (!('geolocation' in navigator)) { alert('Simu hii haiungi mkono GPS.'); return; }
  if (window.isSecureContext === false && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    alert('GPS inahitaji HTTPS. Fungua ukurasa huu kupitia https:// (Render) ukiwa na simu.');
    return;
  }
  localStorage.setItem('nifikishe_driver_route', routeId);
  localStorage.setItem('nifikishe_driver_name', document.getElementById('drvName').value || '');
  drvSharing = true;
  document.getElementById('drvDot').classList.add('live');
  document.getElementById('drvStatusText').innerText = '● LIVE — abiria wanakuona sasa';
  const btn = document.getElementById('drvToggleBtn');
  btn.classList.add('stop');
  btn.innerText = 'SIMAMISHA';
  drvLog('GPS imewashwa. Inasubiri fix ya kwanza…');
  drvWatchId = navigator.geolocation.watchPosition(
    p => { drvLastPos = p; driverPush(p); },
    err => { drvLog('GPS error: ' + err.message); alert('GPS imeshindwa: ruhusu location.'); driverStop(true); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
  drvTimer = setInterval(() => { if (drvLastPos) driverPush(drvLastPos); }, 10000);
  if ('wakeLock' in navigator) { navigator.wakeLock.request('screen').catch(() => {}); }
}

async function driverPush(pos) {
  const routeId = document.getElementById('drvRoute').value;
  const payload = {
    vehicleId: drvVehicleId,
    routeId,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    speedKph: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null,
    heading: document.getElementById('drvHeading').value,
    occupancy: document.getElementById('drvOccupancy').value,
    driverName: document.getElementById('drvName').value || ''
  };
  try {
    const headers = { 'Content-Type': 'application/json' };
    const dk = localStorage.getItem('nifikishe_driver_key');
    if (dk) headers['x-driver-key'] = dk;
    const res = await fetch('/api/live/ingest', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || ('HTTP ' + res.status));
    drvSent++;
    document.getElementById('drvSent').innerText = drvSent;
    document.getElementById('drvAcc').innerText = '±' + Math.round(pos.coords.accuracy || 0) + 'm';
    document.getElementById('drvSpeed').innerText = payload.speedKph != null ? payload.speedKph : '—';
    drvLog('Eneo limetumwa (' + drvSent + ') ±' + Math.round(pos.coords.accuracy || 0) + 'm');
  } catch (e) {
    drvLog('Imeshindwa kutuma: ' + e.message);
  }
}

async function driverStop(silent) {
  drvSharing = false;
  if (drvWatchId != null) { try { navigator.geolocation.clearWatch(drvWatchId); } catch (e) {} drvWatchId = null; }
  if (drvTimer) { clearInterval(drvTimer); drvTimer = null; }
  try {
    await fetch('/api/live/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: drvVehicleId }) });
  } catch (e) {}
  document.getElementById('drvDot').classList.remove('live');
  document.getElementById('drvStatusText').innerText = 'Uko offline — abiria hawakuoni';
  const btn = document.getElementById('drvToggleBtn');
  btn.classList.remove('stop');
  btn.innerText = 'ANZA KUSHIRIKI ENEO';
  if (!silent) drvLog('Umesimamisha. Eneo limefutwa.');
}
window.addEventListener('beforeunload', () => { if (drvSharing) { try { navigator.sendBeacon('/api/live/stop', JSON.stringify({ vehicleId: drvVehicleId })); } catch (e) {} } });
