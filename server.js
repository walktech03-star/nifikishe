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
        icon: '🚶',
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
        icon: route.transportType === 'brt' ? '🚍' : '🚌',
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
        icon: '🛑',
        title: 'Kaa kwenye safari',
        instruction: `Endelea kwenye basi kupitia vituo ${route.stops.length} hadi shuka kituo cha ${route.stops[route.stops.length - 1].name}`
      },
      {
        stepNumber: 4,
        mode: 'alight',
        icon: '🚏',
        title: 'Shuka hapa',
        instruction: `Shuka kwenye kituo cha ${route.stops[route.stops.length - 1].name}`,
        targetStop: route.stops[route.stops.length - 1].name
      },
      {
        stepNumber: 5,
        mode: 'walking',
        icon: '🚶',
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
app.post('/api/admin/routes', (req, res) => {
  const routes = loadData('routes.json') || [];
  const newRoute = { id: `route_${Date.now()}`, verificationStatus: 'verified', lastVerified: new Date().toISOString().split('T')[0], ...req.body };
  routes.push(newRoute);
  saveData('routes.json', routes);
  res.json({ success: true, message: 'Njia imeongezwa kikamilifu', route: newRoute });
});

app.post('/api/admin/stops', (req, res) => {
  const stops = loadData('stops.json') || [];
  const newStop = { id: `stop_${Date.now()}`, verificationStatus: 'verified', lastVerified: new Date().toISOString().split('T')[0], ...req.body };
  stops.push(newStop);
  saveData('stops.json', stops);
  res.json({ success: true, message: 'Kituo kimeongezwa kikamilifu', stop: newStop });
});

app.post('/api/admin/reports/:id/verify', (req, res) => {
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
    console.log(`🧭 NIFIKISHE Platform Engine Running on port ${PORT}`);
    console.log(`📍 Tagline: Kutoka ulipo, hadi unakokwenda.`);
  });
}

module.exports = app;

