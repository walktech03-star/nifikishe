// NIFIKISHE Admin Panel part 1: helpers
function adminHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const key = (localStorage.getItem('nifikishe_admin_key') || '').trim();
  if (key) h['x-admin-key'] = key;
  return h;
}
function adminEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function adminApi(path, method, payload) {
  const res = await fetch(path, { method, headers: adminHeaders(), body: payload ? JSON.stringify(payload) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function adminSaveKey() {
  const el = document.getElementById('adminKeyInput');
  localStorage.setItem('nifikishe_admin_key', ((el || {}).value || '').trim());
  alert('Admin key imehifadhiwa.');
}
function adminShowTab(id) {
  ['overview', 'routes', 'stops', 'reports', 'add'].forEach(t => {
    const pane = document.getElementById('adminTabPane_' + t);
    if (pane) pane.style.display = t === id ? 'block' : 'none';
    const btn = document.getElementById('adminTab_' + t);
    if (btn) btn.classList.toggle('active', t === id);
  });
}
function adminFilterList(rowClass, q) {
  const query = (q || '').toLowerCase().trim();
  document.querySelectorAll('.' + rowClass).forEach(row => {
    row.style.display = !query || (row.dataset.search || '').includes(query) ? 'block' : 'none';
  });
}
async function openAdminModal() {
  const modal = document.getElementById('adminModal');
  const body = document.getElementById('adminDataBody');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="font-size:13px;">Inapakia...</div>';
  try {
    const oR = await fetch('/api/admin/overview');
    const rR = await fetch('/api/routes?city=dar-es-salaam');
    const sR = await fetch('/api/stops?city=dar-es-salaam');
    const data = await oR.json();
    const routes = ((await rR.json()).routes) || [];
    const stops = ((await sR.json()).stops) || [];
    const reports = data.recentReports || [];
    let html = '';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;">';
    html += '<button class="filter-btn active" id="adminTab_overview" onclick="adminShowTab(\'overview\')">Muhtasari</button>';
    html += '<button class="filter-btn" id="adminTab_routes" onclick="adminShowTab(\'routes\')">Njia (' + routes.length + ')</button>';
    html += '<button class="filter-btn" id="adminTab_stops" onclick="adminShowTab(\'stops\')">Vituo (' + stops.length + ')</button>';
    html += '<button class="filter-btn" id="adminTab_reports" onclick="adminShowTab(\'reports\')">Ripoti (' + reports.length + ')</button>';
    html += '<button class="filter-btn" id="adminTab_add" onclick="adminShowTab(\'add\')">Ingiza Data</button>';
    html += '<span style="margin-left:auto;display:flex;gap:6px;"><input type="password" id="adminKeyInput" class="form-control" style="width:130px;" placeholder="Admin key"></span></div>';
    html += '<div id="adminTabPane_overview"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';
    html += '<div style="background:#f8fafc;padding:12px;border-radius:10px;text-align:center;"><b>' + data.stats.citiesCount + '</b><div>Miji</div></div>';
    html += '<div style="background:#f8fafc;padding:12px;border-radius:10px;text-align:center;"><b>' + data.stats.routesCount + '</b><div>Njia</div></div>';
    html += '<div style="background:#f8fafc;padding:12px;border-radius:10px;text-align:center;"><b>' + data.stats.stopsCount + '</b><div>Vituo</div></div>';
    html += '<div style="background:#f8fafc;padding:12px;border-radius:10px;text-align:center;"><b>' + data.stats.reportsCount + '</b><div>Ripoti</div></div>';
    html += '</div></div>';
    html += '<div id="adminTabPane_routes" style="display:none;"><div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">';
    html += routes.map(r => '<div class="adminRouteRow"><div style="display:flex;justify-content:space-between;gap:8px;"><div><b>' + adminEsc(r.name) + '</b><div style="font-size:11px;">' + adminEsc(r.startArea || '') + ' - ' + adminEsc(r.destinationArea || '') + '</div></div><div style="display:flex;gap:6px;"><button class="btn-subtle" onclick="adminEditRoute(\'' + r.id + '\')">Hariri</button><button class="btn-subtle" onclick="adminDeleteRoute(\'' + r.id + '\')">Futa</button></div></div><div id="adminEditRoute_' + r.id + '" style="display:none;margin-top:8px;"></div></div>').join('');
    html += '</div></div>';
    html += '<div id="adminTabPane_stops" style="display:none;"><div style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto;">';
    html += stops.map(s => '<div class="adminStopRow"><div style="display:flex;justify-content:space-between;gap:8px;"><div><b>' + adminEsc(s.name) + '</b><div style="font-size:11px;">' + adminEsc((s.coordinates || []).join(', ')) + '</div></div><div style="display:flex;gap:6px;"><button class="btn-subtle" onclick="adminEditStop(\'' + s.id + '\')">Hariri</button><button class="btn-subtle" onclick="adminDeleteStop(\'' + s.id + '\')">Futa</button></div></div><div id="adminEditStop_' + s.id + '" style="display:none;margin-top:8px;"></div></div>').join('');
    html += '</div></div>';
    html += '<div id="adminTabPane_reports" style="display:none;">';
    html += reports.length ? reports.map(rp => '<div style="background:#fffbeb;border:1px solid #fde68a;padding:10px;border-radius:10px;margin-bottom:8px;"><b>' + adminEsc(rp.title) + '</b><div style="font-size:12px;">' + adminEsc(rp.description) + '</div><div style="font-size:11px;">' + adminEsc(rp.status || '') + '</div>' + (rp.status !== 'verified' ? '<button class="btn-subtle" onclick="adminVerifyReport(\'' + rp.id + '\')">Thibitisha</button>' : '<span>Imethibitishwa</span>') + '</div>').join('') : '<p>Hakuna ripoti.</p>';
    html += '</div>';
    body.innerHTML = html;
    adminAddForms(body);
  } catch (err) { console.error(err); body.innerHTML = '<p style="color:#ef4444;">Imeshindwa.</p>'; }
}
function adminAddForms(body) {
  const d = document.createElement('div');
  d.id = 'adminTabPane_add';
  d.style.display = 'none';
  d.innerHTML = '<h4>Njia Mpya</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><input id="admRouteName" class="form-control" placeholder="Jina *"><input id="admRouteNumber" class="form-control" placeholder="Namba"><input id="admRouteStart" class="form-control" placeholder="Kuanzia *"><input id="admRouteDest" class="form-control" placeholder="Mwisho *"><select id="admRouteType" class="form-control"><option value="daladala">Daladala</option><option value="brt">BRT</option><option value="bajaji">Bajaji</option></select><input id="admRouteFare" class="form-control" type="number" placeholder="Nauli"><input id="admRouteTime" class="form-control" type="number" placeholder="Dakika"><input id="admRouteKm" class="form-control" type="number" step="0.1" placeholder="Km"></div><textarea id="admRoutePath" class="form-control" rows="4" placeholder="-6.7725, 39.1128"></textarea><button class="btn-nifikishe" style="margin-top:8px;" onclick="adminCreateRoute()">Hifadhi Njia</button><h4 style="margin-top:14px;">Kituo Kipya</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><input id="admStopName" class="form-control" placeholder="Jina *"><input id="admStopCoord" class="form-control" placeholder="lat,lng *"><input id="admStopArea" class="form-control" placeholder="areaId"><input id="admStopTypes" class="form-control" placeholder="daladala, brt"></div><button class="btn-nifikishe" style="margin-top:8px;" onclick="adminCreateStop()">Hifadhi Kituo</button>';
  body.appendChild(d);
}
async function adminCreateRoute() {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  try {
    const d = await adminApi('/api/admin/routes', 'POST', { name: v('admRouteName'), routeNumber: v('admRouteNumber'), startArea: v('admRouteStart'), destinationArea: v('admRouteDest'), transportType: v('admRouteType'), fareEstimatedTsh: v('admRouteFare'), estimatedTimeMinutes: v('admRouteTime'), distanceKm: v('admRouteKm'), cityId: 'dar-es-salaam', coordPath: v('admRoutePath') });
    alert(d.message); openAdminModal();
  } catch (e) { alert('Imeshindwa: ' + e.message); }
}
async function adminCreateStop() {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  try {
    const d = await adminApi('/api/admin/stops', 'POST', { name: v('admStopName'), coordText: v('admStopCoord'), areaId: v('admStopArea'), transportTypes: v('admStopTypes'), cityId: 'dar-es-salaam' });
    alert(d.message); openAdminModal();
  } catch (e) { alert('Imeshindwa: ' + e.message); }
}
async function adminEditRoute(id) {
  const box = document.getElementById('adminEditRoute_' + id);
  if (!box) return;
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  const all = await (await fetch('/api/routes?city=dar-es-salaam')).json();
  const r = ((all.routes) || []).find(x => x.id === id);
  if (!r) return alert('Njia haijapatikana');
  box.innerHTML = '<input id="edit_' + id + '_fare" class="form-control" type="number" value="' + (r.fareEstimatedTsh ?? '') + '"><input id="edit_' + id + '_sign" class="form-control" value="' + adminEsc(r.routeSign || '') + '"><button class="btn-subtle" onclick="adminSaveRoute(\'' + id + '\')">Hifadhi</button>';
  box.style.display = 'block';
}
async function adminSaveRoute(id) {
  try {
    const d = await adminApi('/api/admin/routes/' + id, 'PUT', { fareEstimatedTsh: document.getElementById('edit_' + id + '_fare').value, routeSign: document.getElementById('edit_' + id + '_sign').value });
    alert(d.message); openAdminModal();
  } catch (e) { alert('Imeshindwa: ' + e.message); }
}
async function adminDeleteRoute(id) {
  if (!confirm('Futa njia hii?')) return;
  try { const d = await adminApi('/api/admin/routes/' + id, 'DELETE'); alert(d.message); openAdminModal(); }
  catch (e) { alert('Imeshindwa: ' + e.message); }
}
async function adminEditStop(id) {
  const box = document.getElementById('adminEditStop_' + id);
  if (!box) return;
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  const all = await (await fetch('/api/stops?city=dar-es-salaam')).json();
  const s = ((all.stops) || []).find(x => x.id === id);
  if (!s) return alert('Kituo hakijapatikana');
  box.innerHTML = '<input id="edits_' + id + '_name" class="form-control" value="' + adminEsc(s.name || '') + '"><input id="edits_' + id + '_coord" class="form-control" value="' + adminEsc((s.coordinates || []).join(', ')) + '"><button class="btn-subtle" onclick="adminSaveStop(\'' + id + '\')">Hifadhi</button>';
  box.style.display = 'block';
}
async function adminSaveStop(id) {
  try {
    const d = await adminApi('/api/admin/stops/' + id, 'PUT', { name: document.getElementById('edits_' + id + '_name').value, coordText: document.getElementById('edits_' + id + '_coord').value });
    alert(d.message); openAdminModal();
  } catch (e) { alert('Imeshindwa: ' + e.message); }
}
async function adminDeleteStop(id) {
  if (!confirm('Futa kituo hiki?')) return;
  try { const d = await adminApi('/api/admin/stops/' + id, 'DELETE'); alert(d.message); openAdminModal(); }
  catch (e) { alert('Imeshindwa: ' + e.message); }
}
async function adminVerifyReport(id) {
  try { const d = await adminApi('/api/admin/reports/' + id + '/verify', 'POST'); alert(d.message); openAdminModal(); }
  catch (e) { alert('Imeshindwa: ' + e.message); }
}
