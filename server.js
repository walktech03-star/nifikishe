const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Basic security + caching headers without extra dependencies.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

function loadData(filename) {
  const filePath = path.join(__dirname, 'data', filename);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return null;
}

function saveData(filename, data) {
  const filePath = path.join(__dirname, 'data', filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getDistanceMeters(coord1, coord2) {
  const R = 6371e3;
  const lat1 = coord1[0] * Math.PI / 180;
  const lat2 = coord2[0] * Math.PI / 180;
  const deltaLat = (coord2[0] - coord1[0]) * Math.PI / 180;
  const deltaLon = (coord2[1] - coord1[1]) * Math.PI / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// 1. GET /api/cities
app.get('/api/cities', (req, res) => {
  const data = loadData('cities.json');
  res.json({
    success: true,
    countries: data.countries,
    cities: data.cities
  });
});

// 2. GET /api/cities/:id
app.get('/api/cities/:id', (req, res) => {
  const data = loadData('cities.json');
  const city = data.cities.find(c => c.id === req.params.id);
  if (!city) {
    return res.status(404).json({ success: false, error: 'City not found' });
  }
  const cityAreas = data.areas.filter(a => a.cityId === city.id);
  res.json({ success: true, city, areas: cityAreas });
});

// 3. GET /api/stops
app.get('/api/stops', (req, res) => {
  const stops = loadData('stops.json') || [];
  const { city, lat, lng, maxDistance } = req.query;

  let filtered = stops;
  if (city) {
    filtered = filtered.filter(s => s.cityId === city);
  }

  if (lat && lng) {
    const userCoord = [parseFloat(lat), parseFloat(lng)];
    const radius = maxDistance ? parseFloat(maxDistance) : 3000;

    filtered = filtered.map(s => {
      const dist = getDistanceMeters(userCoord, s.coordinates);
      const walkTimeMinutes = Math.max(1, Math.round(dist / 80));
      return { ...s, distanceMeters: dist, walkTimeMinutes };
    })
    .filter(s => s.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  res.json({ success: true, count: filtered.length, stops: filtered });
});

// 4. GET /api/stops/:id
app.get('/api/stops/:id', (req, res) => {
  const stops = loadData('stops.json') || [];
  const stop = stops.find(s => s.id === req.params.id);
  if (!stop) return res.status(404).json({ success: false, error: 'Stop not found' });
  res.json({ success: true, stop });
});

// 5. GET /api/places
app.get('/api/places', (req, res) => {
  const places = loadData('places.json') || [];
  const { city, category, q } = req.query;

  let filtered = places;
  if (city) filtered = filtered.filter(p => p.cityId === city);
  if (category) filtered = filtered.filter(p => p.category === category);

  if (q) {
    const query = q.toLowerCase().trim();
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(query) ||
      (p.address && p.address.toLowerCase().includes(query)) ||
      (p.aliases && p.aliases.some(alias => alias.toLowerCase().includes(query))) ||
      (p.description && p.description.toLowerCase().includes(query))
    );
  }

  res.json({ success: true, count: filtered.length, places: filtered });
});

// 6. GET /api/routes
app.get('/api/routes', (req, res) => {
  const routes = loadData('routes.json') || [];
  const { city, transportType } = req.query;

  let filtered = routes;
  if (city) filtered = filtered.filter(r => r.cityId === city);
  if (transportType) filtered = filtered.filter(r => r.transportType === transportType);

  res.json({ success: true, count: filtered.length, routes: filtered });
});

// 7. GET /api/routes/:id
app.get('/api/routes/:id', (req, res) => {
  const routes = loadData('routes.json') || [];
  const route = routes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ success: false, error: 'Route not found' });
  res.json({ success: true, route });
});

// 8. POST /api/navigation/search - The heart of NIFIKISHE journey search
app.post('/api/navigation/search', (req, res) => {
  const { origin, destination, city = 'dar-es-salaam', sortBy = 'fastest' } = req.body;

  if (!origin || !destination) {
    return res.status(400).json({
      success: false,
      error: 'Weka eneo ulipo (origin) na unakokwenda (destination)'
    });
  }

  const allRoutes = loadData('routes.json') || [];
  const allStops = loadData('stops.json') || [];

  let cityRoutes = allRoutes.filter(r => r.cityId === city);

  const journeys = cityRoutes.map((route, index) => {
    const originCoord = origin.coordinates || [-6.7725, 39.1128];
    const destCoord = destination.coordinates || [-6.8196, 39.2745];

    const boardingStops = allStops
      .filter(s => s.routes && s.routes.includes(route.id))
      .map(s => {
        const dist = getDistanceMeters(originCoord, s.coordinates);
        return {
          ...s,
          distMeters: dist,
          walkMinutes: Math.max(1, Math.round(dist / 80))
        };
      })
      .sort((a, b) => a.distMeters - b.distMeters);

    const primaryBoarding = boardingStops[0] || {
      name: route.stops[0].name,
      distMeters: 350,
      walkMinutes: 5,
      coordinates: route.coordinates[0]
    };

    const lastStopCoord = route.coordinates[route.coordinates.length - 1];
    const finalWalkMeters = getDistanceMeters(lastStopCoord, destCoord);
    const finalWalkMinutes = Math.max(2, Math.round(finalWalkMeters / 80));

    const steps = [
      {
        stepNumber: 1,
        mode: 'walking',
        code: 'T',
        title: 'Tembea kuelekea kituo',
        instruction: `Tembea mita ${primaryBoarding.distMeters || 350} kuelekea kituo cha ${primaryBoarding.name}`,
        distanceMeters: primaryBoarding.distMeters || 350,
        timeMinutes: primaryBoarding.walkMinutes || 5,
        targetStop: primaryBoarding.name,
        targetCoordinates: primaryBoarding.coordinates
      },
      {
        stepNumber: 2,
        mode: route.transportType,
        code: route.transportType === 'brt' ? 'R' : 'B',
        title: 'Panda usafiri',
        instruction: `Panda ${route.transportType.toUpperCase()} (${route.name})`,
        routeId: route.id,
        routeNumber: route.routeNumber,
        routeSign: route.routeSign,
        routeSignColor: route.routeSignColor,
        lookFor: route.lookFor,
        conductorAsk: route.conductorAsk,
        vehicle: route.vehicle,
        boardingStop: primaryBoarding.name,
        dropOffStop: route.stops[route.stops.length - 1].name,
        intermediateStops: route.stops.map(s => s.name),
        estimatedFareTsh: route.fareEstimatedTsh
      },
      {
        stepNumber: 3,
        mode: 'stay_on_board',
        code: 'K',
        title: 'Kaa kwenye safari',
        instruction: `Endelea kwenye basi kupitia vituo ${route.stops.length} hadi shuka kituo cha ${route.stops[route.stops.length - 1].name}`
      },
      {
        stepNumber: 4,
        mode: 'alight',
        code: 'S',
        title: 'Shuka hapa',
        instruction: `Shuka kwenye kituo cha ${route.stops[route.stops.length - 1].name}`,
        targetStop: route.stops[route.stops.length - 1].name
      },
      {
        stepNumber: 5,
        mode: 'walking',
        code: 'T',
        title: 'Tembea hadi unakokwenda',
        instruction: `Tembea mita ${finalWalkMeters} kuelekea ${destination.name || 'eneo lako'}`,
        distanceMeters: finalWalkMeters,
        timeMinutes: finalWalkMinutes,
        targetName: destination.name || 'Destination',
        targetCoordinates: destCoord
      }
    ];

    return {
      id: `journey_${route.id}`,
      routeId: route.id,
      title: route.swName,
      englishTitle: route.name,
      transportType: route.transportType,
      isDirect: route.transfersCount === 0,
      transfersCount: route.transfersCount,
      estimatedTimeMinutes: route.estimatedTimeMinutes,
      walkingMinutesTotal: (primaryBoarding.walkMinutes || 5) + finalWalkMinutes,
      totalDistanceKm: route.distanceKm,
      fareEstimatedTsh: route.fareEstimatedTsh,
      fareReliability: route.fareReliability,
      operatingHours: route.operatingHours,
      routeSign: route.routeSign,
      routeSignColor: route.routeSignColor,
      conductorAsk: route.conductorAsk,
      vehicle: route.vehicle,
      lookFor: route.lookFor,
      steps,
      routeCoordinates: route.coordinates,
      boardingOptions: boardingStops.slice(0, 3)
    };
  });

  if (sortBy === 'fastest') {
    journeys.sort((a, b) => a.estimatedTimeMinutes - b.estimatedTimeMinutes);
  } else if (sortBy === 'transfers') {
    journeys.sort((a, b) => a.transfersCount - b.transfersCount);
  } else if (sortBy === 'cost') {
    journeys.sort((a, b) => a.fareEstimatedTsh - b.fareEstimatedTsh);
  } else if (sortBy === 'walking') {
    journeys.sort((a, b) => a.walkingMinutesTotal - b.walkingMinutesTotal);
  }

  res.json({
    success: true,
    origin,
    destination,
    journeysCount: journeys.length,
    journeys
  });
});

// 9. GET /api/complex-areas/:areaId - Complex commercial zone internal navigation
app.get('/api/complex-areas/:areaId', (req, res) => {
  const data = loadData('complex_areas.json');
  if (!data) return res.status(404).json({ success: false, error: 'Area data not found' });
  res.json({
    success: true,
    areaId: req.params.areaId,
    name: 'Kariakoo Commercial Hub',
    categories: data.categories
  });
});

// 10. GET /api/search - Unified smart search (places, stops, routes, Swahili queries)
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const city = req.query.city || 'dar-es-salaam';

  if (!q) {
    return res.json({ success: true, results: [] });
  }

  const places = loadData('places.json') || [];
  const stops = loadData('stops.json') || [];
  const routes = loadData('routes.json') || [];

  const results = [];

  places.filter(p => p.cityId === city).forEach(p => {
    let score = 0;
    if (p.name.toLowerCase().includes(q)) score += 10;
    if (p.aliases && p.aliases.some(a => a.toLowerCase().includes(q))) score += 8;
    if (p.description && p.description.toLowerCase().includes(q)) score += 4;
    if (p.address && p.address.toLowerCase().includes(q)) score += 5;

    if (score > 0) {
      results.push({
        type: 'place',
        id: p.id,
        title: p.name,
        subtitle: p.address || p.description,
        category: p.category,
        coordinates: p.coordinates,
        score
      });
    }
  });

  stops.filter(s => s.cityId === city).forEach(s => {
    let score = 0;
    if (s.name.toLowerCase().includes(q)) score += 12;
    if (s.landmarks && s.landmarks.some(l => l.toLowerCase().includes(q))) score += 7;

    if (score > 0) {
      results.push({
        type: 'stop',
        id: s.id,
        title: s.name,
        subtitle: `Kituo cha Usafiri (${s.transportTypes.join(', ').toUpperCase()})`,
        coordinates: s.coordinates,
        score
      });
    }
  });

  routes.filter(r => r.cityId === city).forEach(r => {
    let score = 0;
    if (r.name.toLowerCase().includes(q)) score += 9;
    if (r.routeSign.toLowerCase().includes(q)) score += 8;

    if (score > 0) {
      results.push({
        type: 'route',
        id: r.id,
        title: r.swName,
        subtitle: `Njia ya ${r.transportType.toUpperCase()} • Kibao: ${r.routeSign}`,
        coordinates: r.coordinates[0],
        score
      });
    }
  });

  results.sort((a, b) => b.score - a.score);
  res.json({ success: true, query: q, count: results.length, results: results.slice(0, 10) });
});

// 11. POST /api/reports - User reporting
app.post('/api/reports', (req, res) => {
  const { cityId, routeId, type, title, description, reportedBy } = req.body;
  if (!title || !description) {
    return res.status(400).json({ success: false, error: 'Tafadhali jaza maelezo ya ripoti' });
  }

  const reportsData = loadData('reports_analytics.json') || { reports: [], analytics: {} };
  const newReport = {
    id: `rep_${Date.now()}`,
    cityId: cityId || 'dar-es-salaam',
    routeId: routeId || null,
    type: type || 'other',
    title,
    description,
    reportedBy: reportedBy || 'Mtumiaji wa Nifikishe',
    timestamp: new Date().toISOString(),
    status: 'pending_review'
  };

  reportsData.reports.unshift(newReport);
  saveData('reports_analytics.json', reportsData);

  res.json({
    success: true,
    message: 'Asante! Taarifa yako imepokelewa na itathibitishwa na timu ya NIFIKISHE.',
    report: newReport
  });
});

// 12. GET /api/admin/overview
app.get('/api/admin/overview', (req, res) => {
  const citiesData = loadData('cities.json') || { cities: [], areas: [] };
  const routesData = loadData('routes.json') || [];
  const stopsData = loadData('stops.json') || [];
  const placesData = loadData('places.json') || [];
  const repData = loadData('reports_analytics.json') || { reports: [], analytics: {} };

  res.json({
    success: true,
    stats: {
      citiesCount: citiesData.cities.length,
      areasCount: citiesData.areas.length,
      routesCount: routesData.length,
      stopsCount: stopsData.length,
      placesCount: placesData.length,
      reportsCount: repData.reports.length,
      activeUsersNow: repData.analytics.activeUsersNow || 140
    },
    analytics: repData.analytics,
    recentReports: repData.reports.slice(0, 5)
  });
});

// Admin management APIs
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Simple shared-key guard for write endpoints. When ADMIN_KEY is unset (local
// dev), writes are allowed. In production set ADMIN_KEY and send it as
// x-admin-key header from the admin panel.
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next();
  if (req.headers['x-admin-key'] === ADMIN_KEY) return next();
  return res.status(401).json({ success: false, error: 'Huna ruhusa (admin key missing)' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function parseCoordPair(str) {
  // Accepts "-6.7725, 39.1128" → [-6.7725, 39.1128]
  if (!str) return null;
  const parts = String(str).split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some(n => Number.isNaN(n))) return null;
  if (parts[0] < -90 || parts[0] > 90 || parts[1] < -180 || parts[1] > 180) return null;
  return parts;
}

function parseCoordPath(text) {
  // One "lat,lng" per line → [[lat,lng], ...]
  if (!text) return null;
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  const coords = lines.map(parseCoordPair);
  if (coords.length < 2 || coords.some(c => !c)) return null;
  return coords;
}

app.post('/api/admin/routes', requireAdmin, (req, res) => {
  const { name, startArea, destinationArea, transportType, routeNumber, routeSign,
    conductorAsk, fareEstimatedTsh, estimatedTimeMinutes, distanceKm, cityId,
    operatingHours, description, coordPath } = req.body || {};
  if (!name || !startArea || !destinationArea) {
    return res.status(400).json({ success: false, error: 'Jina, eneo la kuanzia na eneo la mwisho vinahitajika' });
  }
  const coordinates = parseCoordPath(coordPath);
  if (!coordinates) {
    return res.status(400).json({ success: false, error: 'Weka njia (coordPath): angalau mistari 2 ya "lat,lng"' });
  }
  const routes = loadData('routes.json') || [];
  const newRoute = {
    id: `route_${Date.now()}`,
    name, startArea, destinationArea,
    swName: name,
    cityId: cityId || 'dar-es-salaam',
    transportType: transportType || 'daladala',
    routeNumber: routeNumber || '',
    direction: 'inbound',
    routeSign: routeSign || `${String(startArea).toUpperCase()} - ${String(destinationArea).toUpperCase()}`,
    routeSignColor: '#16a34a',
    routeSignTextColor: '#ffffff',
    conductorAsk: conductorAsk || `${destinationArea}?`,
    lookFor: `Basi lenye kibao cha '${routeSign || name}' au uliza kondakta: '${conductorAsk || (destinationArea + '?')}'`,
    vehicle: { type: transportType === 'brt' ? 'Blue Articulated BRT Bus (Mwendokasi)' : 'Toyota Coaster / Eicher Daladala', capacity: '', color: '', image: transportType === 'brt' ? '/images/brt.svg' : '/images/daladala.svg' },
    stops: [],
    coordinates,
    distanceKm: distanceKm ? parseFloat(distanceKm) : null,
    estimatedTimeMinutes: estimatedTimeMinutes ? parseInt(estimatedTimeMinutes, 10) : 30,
    walkingMinutesTotal: 5,
    transfersCount: 0,
    fareEstimatedTsh: fareEstimatedTsh ? parseInt(fareEstimatedTsh, 10) : 0,
    fareReliability: 'estimated',
    operatingHours: operatingHours || '05:00 - 23:00',
    verificationStatus: 'verified',
    lastVerified: todayStr(),
    description: description || ''
  };
  routes.push(newRoute);
  saveData('routes.json', routes);
  res.json({ success: true, message: 'Njia imeongezwa kikamilifu', route: newRoute });
});

app.put('/api/admin/routes/:id', requireAdmin, (req, res) => {
  const routes = loadData('routes.json') || [];
  const route = routes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ success: false, error: 'Njia haijapatikana' });
  const updatable = ['name', 'swName', 'startArea', 'destinationArea', 'transportType', 'routeNumber',
    'routeSign', 'conductorAsk', 'lookFor', 'fareEstimatedTsh', 'estimatedTimeMinutes',
    'distanceKm', 'operatingHours', 'description', 'verificationStatus', 'cityId'];
  updatable.forEach(k => { if (req.body[k] !== undefined && req.body[k] !== '') route[k] = req.body[k]; });
  if (req.body.coordPath) {
    const coordinates = parseCoordPath(req.body.coordPath);
    if (!coordinates) return res.status(400).json({ success: false, error: 'coordPath si sahihi (lat,lng kwa mstari)' });
    route.coordinates = coordinates;
  }
  route.lastVerified = todayStr();
  saveData('routes.json', routes);
  res.json({ success: true, message: 'Njia imesasishwa', route });
});

app.delete('/api/admin/routes/:id', requireAdmin, (req, res) => {
  const routes = loadData('routes.json') || [];
  const idx = routes.findIndex(r => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Njia haijapatikana' });
  const [removed] = routes.splice(idx, 1);
  saveData('routes.json', routes);
  res.json({ success: true, message: 'Njia imefutwa', route: removed });
});

app.post('/api/admin/stops', requireAdmin, (req, res) => {
  const { name, cityId, areaId, coordText, transportTypes, landmarks, notes } = req.body || {};
  if (!name) return res.status(400).json({ success: false, error: 'Jina la kituo linahitajika' });
  const coordinates = parseCoordPair(coordText);
  if (!coordinates) {
    return res.status(400).json({ success: false, error: 'Weka koordinati sahihi: "lat,lng" mfano -6.8125, 39.2730' });
  }
  const stops = loadData('stops.json') || [];
  const newStop = {
    id: `stop_${Date.now()}`,
    name,
    cityId: cityId || 'dar-es-salaam',
    areaId: areaId || '',
    coordinates,
    transportTypes: Array.isArray(transportTypes) ? transportTypes : String(transportTypes || 'daladala').split(',').map(s => s.trim()).filter(Boolean),
    routes: [],
    landmarks: Array.isArray(landmarks) ? landmarks : String(landmarks || '').split('\n').map(s => s.trim()).filter(Boolean),
    verificationStatus: 'verified',
    lastVerified: todayStr(),
    notes: notes || ''
  };
  stops.push(newStop);
  saveData('stops.json', stops);
  res.json({ success: true, message: 'Kituo kimeongezwa kikamilifu', stop: newStop });
});

app.put('/api/admin/stops/:id', requireAdmin, (req, res) => {
  const stops = loadData('stops.json') || [];
  const stop = stops.find(s => s.id === req.params.id);
  if (!stop) return res.status(404).json({ success: false, error: 'Kituo hakijapatikana' });
  ['name', 'cityId', 'areaId', 'notes', 'verificationStatus'].forEach(k => {
    if (req.body[k] !== undefined && req.body[k] !== '') stop[k] = req.body[k];
  });
  if (req.body.coordText) {
    const coordinates = parseCoordPair(req.body.coordText);
    if (!coordinates) return res.status(400).json({ success: false, error: 'Koordinati si sahihi (lat,lng)' });
    stop.coordinates = coordinates;
  }
  if (req.body.transportTypes !== undefined) {
    stop.transportTypes = Array.isArray(req.body.transportTypes)
      ? req.body.transportTypes
      : String(req.body.transportTypes).split(',').map(s => s.trim()).filter(Boolean);
  }
  stop.lastVerified = todayStr();
  saveData('stops.json', stops);
  res.json({ success: true, message: 'Kituo kimesasishwa', stop });
});

app.delete('/api/admin/stops/:id', requireAdmin, (req, res) => {
  const stops = loadData('stops.json') || [];
  const idx = stops.findIndex(s => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, error: 'Kituo hakijapatikana' });
  const [removed] = stops.splice(idx, 1);
  saveData('stops.json', stops);
  res.json({ success: true, message: 'Kituo kimefutwa', stop: removed });
});

// ---------------------------------------------------------------------------
// LIVE VEHICLES (simulated real-time fleet)
// Simulates buses moving along each route's coordinates so users can see
// nearby cars and time their walk to the stop. Deterministic: position is a
// function of time, so all clients see the same fleet without a database.
// Upgrade path: replace simulateFleet() with real GPS ingested from
// driver phones / vehicle trackers.
// ---------------------------------------------------------------------------
function lerpCoord(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function routeLengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += getDistanceMeters(coords[i - 1], coords[i]);
  return total;
}

function pointAlongRoute(coords, frac) {
  if (!coords || coords.length < 2) return coords ? coords[0] : null;
  const clamped = Math.min(0.9999, Math.max(0, frac));
  const segFloat = clamped * (coords.length - 1);
  const seg = Math.floor(segFloat);
  const t = segFloat - seg;
  return lerpCoord(coords[seg], coords[Math.min(seg + 1, coords.length - 1)], t);
}

function simulateFleet(cityId) {
  const routes = (loadData('routes.json') || []).filter(r => !cityId || r.cityId === cityId);
  const nowSec = Date.now() / 1000;
  const vehicles = [];
  routes.forEach((route, ri) => {
    if (!route.coordinates || route.coordinates.length < 2) return;
    // 2-3 vehicles per route, staggered. Speed ~ route length per estimatedTime.
    const count = route.transportType === 'brt' ? 3 : 2;
    const cycleSec = Math.max(600, (route.estimatedTimeMinutes || 40) * 60 * 2); // round trip
    for (let v = 0; v < count; v++) {
      const phase = (ri * 0.37 + v / count) % 1;
      const progress = (nowSec / cycleSec + phase) % 1;
      // bounce: 0→1→0 so vehicles go back and forth like real buses
      const frac = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      const pos = pointAlongRoute(route.coordinates, frac);
      const headingOut = progress < 0.5;
      const end = headingOut ? route.coordinates[route.coordinates.length - 1] : route.coordinates[0];
      const distToEndM = getDistanceMeters(pos, end);
      const avgSpeedMpm = routeLengthMeters(route.coordinates) / Math.max(1, (route.estimatedTimeMinutes || 40));
      vehicles.push({
        id: `veh_${route.id}_${v}`,
        routeId: route.id,
        routeName: route.name,
        transportType: route.transportType || 'daladala',
        routeSign: route.routeSign || route.name,
        coordinates: [Math.round(pos[0] * 1e6) / 1e6, Math.round(pos[1] * 1e6) / 1e6],
        heading: headingOut ? 'outbound' : 'inbound',
        destination: headingOut ? route.destinationArea : route.startArea,
        etaToTerminusMin: Math.max(1, Math.round(distToEndM / Math.max(60, avgSpeedMpm))),
        speedKph: Math.round(avgSpeedMpm * 0.06 * 10) / 10,
        occupancy: ['empty', 'seats', 'full'][Math.floor((nowSec / 300 + ri + v) % 3)],
        updatedAt: new Date().toISOString()
      });
    }
  });
  return vehicles;
}

// ---------------------------------------------------------------------------
// REAL DRIVER INGEST — phones of drivers/conductors stream GPS here.
// A driver opens /driver.html, picks their route, hits Start. The phone POSTs
// every ~10s. Passengers see real buses via /api/live/vehicles (real first,
// simulated fill-in for routes with no driver online).
// In-memory store: fine for prototype. Migrate to Redis/Postgres for scale.
// ---------------------------------------------------------------------------
const liveFleet = new Map(); // vehicleId -> { vehicleId, routeId, coordinates, ... }
const DRIVER_KEY = process.env.DRIVER_KEY || '';

function requireDriver(req, res, next) {
  if (!DRIVER_KEY) return next();
  if (req.headers['x-driver-key'] === DRIVER_KEY) return next();
  return res.status(401).json({ success: false, error: 'Huna ruhusa (driver key)' });
}

function fleetFreshnessMs() {
  return 120000; // positions older than 2 min are stale
}

function getFreshFleet() {
  const cutoff = Date.now() - fleetFreshnessMs();
  const fresh = [];
  for (const [id, v] of liveFleet) {
    if (v.updatedAtMs >= cutoff) fresh.push(v);
    else liveFleet.delete(id);
  }
  return fresh;
}

function enrichVehicle(v, routeById) {
  const route = routeById[v.routeId];
  const transportType = v.transportType || (route && route.transportType) || 'daladala';
  return {
    id: v.vehicleId,
    routeId: v.routeId,
    routeName: (route && route.name) || v.routeName || v.routeId,
    transportType,
    routeSign: (route && route.routeSign) || v.routeSign || v.routeId,
    coordinates: v.coordinates,
    heading: v.heading || 'outbound',
    destination: v.destination || (route && route.destinationArea) || '',
    speedKph: v.speedKph ?? null,
    occupancy: v.occupancy || 'unknown',
    driverName: v.driverName || '',
    updatedAt: new Date(v.updatedAtMs).toISOString(),
    updatedSecondsAgo: Math.round((Date.now() - v.updatedAtMs) / 1000),
    real: true
  };
}

// POST /api/live/ingest — driver phone streams position
app.post('/api/live/ingest', requireDriver, (req, res) => {
  const { vehicleId, routeId, lat, lng, speedKph, heading, occupancy, driverName } = req.body || {};
  if (!vehicleId || !routeId) {
    return res.status(400).json({ success: false, error: 'vehicleId na routeId vinahitajika' });
  }
  const latN = parseFloat(lat);
  const lngN = parseFloat(lng);
  if (Number.isNaN(latN) || Number.isNaN(lngN) || latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
    return res.status(400).json({ success: false, error: 'lat/lng si sahihi' });
  }
  const routes = loadData('routes.json') || [];
  if (!routes.some(r => r.id === routeId)) {
    return res.status(404).json({ success: false, error: 'routeId haijapatikana' });
  }
  liveFleet.set(String(vehicleId), {
    vehicleId: String(vehicleId),
    routeId: String(routeId),
    coordinates: [latN, lngN],
    speedKph: speedKph != null ? parseFloat(speedKph) : null,
    heading: heading === 'inbound' ? 'inbound' : 'outbound',
    occupancy: ['empty', 'seats', 'full'].includes(occupancy) ? occupancy : 'unknown',
    driverName: String(driverName || '').slice(0, 40),
    destination: '',
    updatedAtMs: Date.now()
  });
  res.json({ success: true, message: 'Eneo limepokelewa', vehicleId: String(vehicleId) });
});

// POST /api/live/stop — driver goes offline
app.post('/api/live/stop', requireDriver, (req, res) => {
  const { vehicleId } = req.body || {};
  if (vehicleId && liveFleet.has(String(vehicleId))) liveFleet.delete(String(vehicleId));
  res.json({ success: true, message: 'Umeacha kushiriki eneo' });
});
// GET /api/live/vehicles — REAL driver positions first, simulated fill-in
// for routes with no driver online (so the map never looks empty).
app.get('/api/live/vehicles', (req, res) => {
  const { city, routeId, lat, lng, maxDistance } = req.query;
  const routes = loadData('routes.json') || [];
  const routeById = {};
  routes.forEach(r => { routeById[r.id] = r; });

  const fresh = getFreshFleet().filter(v => {
    const r = routeById[v.routeId];
    return (!city || (r && r.cityId === city)) && (!routeId || v.routeId === routeId);
  });
  const realVehicles = fresh.map(v => enrichVehicle(v, routeById));

  const coveredRoutes = new Set(realVehicles.map(v => v.routeId));
  let simVehicles = simulateFleet(city || undefined)
    .filter(v => !coveredRoutes.has(v.routeId))
    .filter(v => !routeId || v.routeId === routeId);

  let vehicles = [...realVehicles, ...simVehicles];
  if (lat && lng) {
    const user = [parseFloat(lat), parseFloat(lng)];
    const radius = maxDistance ? parseFloat(maxDistance) : 5000;
    vehicles = vehicles.map(v => {
      const d = getDistanceMeters(user, v.coordinates);
      return { ...v, distanceMeters: d, walkTimeMinutes: Math.max(1, Math.round(d / 80)) };
    }).filter(v => v.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
  res.json({
    success: true,
    count: vehicles.length,
    vehicles,
    realCount: realVehicles.length,
    simulated: simVehicles.length > 0
  });
});

// GET /api/live/nearby — one call for the "should I leave now?" panel:
// nearest stops + nearest vehicles + which vehicle serves which stop.
app.get('/api/live/nearby', (req, res) => {
  const { lat, lng, city, maxDistance } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ success: false, error: 'lat & lng zinahitajika (GPS)' });
  }
  const user = [parseFloat(lat), parseFloat(lng)];
  const radius = maxDistance ? parseFloat(maxDistance) : 2500;
  const stops = loadData('stops.json') || [];
  const routes = loadData('routes.json') || [];
  const routeById = {};
  routes.forEach(r => { routeById[r.id] = r; });
  const realByRoute = {};
  getFreshFleet().forEach(v => {
    if (city && routeById[v.routeId] && routeById[v.routeId].cityId !== city) return;
    const ev = enrichVehicle(v, routeById);
    realByRoute[v.routeId] = realByRoute[v.routeId] || [];
    realByRoute[v.routeId].push(ev);
  });
  const simVehicles = simulateFleet(city || undefined);

  const nearStops = stops
    .filter(s => !city || s.cityId === city)
    .map(s => {
      const d = getDistanceMeters(user, s.coordinates);
      return { ...s, distanceMeters: d, walkTimeMinutes: Math.max(1, Math.round(d / 80)) };
    })
    .filter(s => s.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);

  // For each near stop, find vehicles on routes serving that stop area.
  const stopRoutes = {};
  routes.forEach(r => {
    (r.stops || []).forEach(rs => { stopRoutes[rs.stopId] = stopRoutes[rs.stopId] || []; stopRoutes[rs.stopId].push(r.id); });
  });

  const enriched = nearStops.map(stop => {
    const servingRouteIds = new Set(stopRoutes[stop.id] || stop.routes || []);
    // REAL vehicles serving this stop first…
    const realServing = [];
    servingRouteIds.forEach(rid => {
      (realByRoute[rid] || []).forEach(v => {
        const d = getDistanceMeters(stop.coordinates, v.coordinates);
        realServing.push({ ...v, distanceToStopMeters: d, etaToStopMin: Math.max(1, Math.round(d / 350)) });
      });
    });
    // …then simulated fill-in on routes with no driver online.
    const covered = new Set(realServing.map(v => v.routeId));
    const simServing = simVehicles
      .filter(v => servingRouteIds.has(v.routeId) && !covered.has(v.routeId))
      .map(v => {
        const d = getDistanceMeters(stop.coordinates, v.coordinates);
        // ETA ≈ vehicle distance to stop / avg speed (simplified: proportional)
        const etaMin = Math.max(1, Math.round(d / 350));
        return { ...v, distanceToStopMeters: d, etaToStopMin: etaMin };
      });
    const serving = [...realServing, ...simServing]
      .sort((a, b) => a.etaToStopMin - b.etaToStopMin)
      .slice(0, 3);
    return { ...stop, nextVehicles: serving };
  });

  res.json({
    success: true,
    stops: enriched,
    realCount: Object.values(realByRoute).reduce((n, a) => n + a.length, 0),
    simulated: true
  });
});

app.post('/api/admin/reports/:id/verify', requireAdmin, (req, res) => {
  const repData = loadData('reports_analytics.json') || { reports: [] };
  const report = repData.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ success: false, error: 'Ripoti haijapatikana' });
  report.status = 'verified';
  report.verifiedAt = new Date().toISOString();
  saveData('reports_analytics.json', repData);
  res.json({ success: true, message: 'Ripoti imethibitishwa', report });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint haijapatikana' });
});

app.get('/healthz', (req, res) => {
  res.json({ success: true, service: 'nifikishe', time: new Date().toISOString() });
});

// SPA fallback — compatible with Express 4 and Express 5 (no '*' wildcard).
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`NIFIKISHE Platform Engine Running on port ${PORT}`);
    console.log(`Tagline: Kutoka ulipo, hadi unakokwenda.`);
  });
}

module.exports = app;

