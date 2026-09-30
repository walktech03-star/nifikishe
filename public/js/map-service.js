// Map Provider Abstraction
// Decouples application state & interactions from specific mapping libraries (Leaflet, Mapbox, Google Maps, etc.)

class MapService {
  constructor(mapContainerId) {
    this.containerId = mapContainerId;
    this.map = null;
    this.userMarker = null;
    this.routePolyline = null;
    this.stopMarkers = [];
    this.currentCity = 'dar-es-salaam';
    this.center = [-6.816064, 39.280358];
    this.zoom = 13;
    this.vehicleMarkers = [];
    this.accuracyCircle = null;
    // Tile providers — tried in order. OSM first because {s}.basemaps.cartocdn.com
    // is blocked on some Tanzanian ISPs/networks (grid with no streets = tiles blocked).
    // OSM tile usage policy: https://operations.osmfoundation.org/policies/tiles/
    this.tileProviders = [
      {
        name: 'osm',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: { attribution: '&copy; OpenStreetMap contributors', subdomains: 'abc', maxZoom: 19 }
      },
      {
        name: 'carto',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        options: { attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 19 }
      },
      {
        name: 'opentopo',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        options: { attribution: '&copy; OpenStreetMap contributors &copy; OpenTopoMap', subdomains: 'abc', maxZoom: 17 }
      }
    ];
    this.tileErrorCounts = {};
    this.activeTileLayer = null;
    this.activeProviderIndex = 0;
  }

  init(center = [-6.816064, 39.280358], zoom = 13) {
    if (typeof L === 'undefined') {
      console.error('Leaflet (L) failed to load — check internet / unpkg CDN.');
      const el = document.getElementById(this.containerId);
      if (el) el.innerHTML = '<div style="padding:24px;font-size:14px">Ramani haijapakiwa: ukurasa unahitaji intaneti kupakua Leaflet. Angalia muunganisho kisha refresh.</div>';
      return null;
    }
    this.center = center;
    this.zoom = zoom;

    // If the workspace is hidden (landing page visible), Leaflet measures 0x0.
    // Initialise anyway, then fix size when the workspace is shown (see refresh()).
    this.map = L.map(this.containerId, {
      zoomControl: false
    }).setView(this.center, this.zoom);

    // Auto-cycling tile providers: if one host is blocked (grid with no streets),
    // switch to the next after 4 failed tiles.
    this._applyTileProvider(0);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Keep tiles correct on window resize / orientation change.
    window.addEventListener('resize', () => this.refresh());

    return this.map;
  }

  _applyTileProvider(index) {
    const provider = this.tileProviders[index];
    if (!provider) {
      console.error('All tile providers failed. Check internet connection.');
      return;
    }
    this.activeProviderIndex = index;
    this.tileErrorCounts[provider.name] = 0;
    if (this.activeTileLayer && this.map) this.map.removeLayer(this.activeTileLayer);
    const layer = L.tileLayer(provider.url, provider.options);
    layer.on('tileerror', () => {
      this.tileErrorCounts[provider.name] = (this.tileErrorCounts[provider.name] || 0) + 1;
      console.warn(`Tiles failing on ${provider.name} (${this.tileErrorCounts[provider.name]} errors)`);
      if (this.tileErrorCounts[provider.name] >= 4 && this.activeProviderIndex === index) {
        console.warn(`Switching tiles from ${provider.name} to next provider…`);
        this._applyTileProvider(index + 1);
      }
    });
    layer.on('load', () => console.log(`Tiles OK via ${provider.name}`));
    this.activeTileLayer = layer;
    layer.addTo(this.map);
  }

  // Call every time the map container becomes visible.
  refresh() {
    if (!this.map) return;
    // Multiple passes: CSS transition + flex layout need a beat to settle.
    [50, 200, 600].forEach(ms => setTimeout(() => {
      try { this.map.invalidateSize(); } catch (e) { /* ignore */ }
    }, ms));
  }

  // Manual switch button can call this. Exposed globally via app.js.
  cycleTileProvider() {
    const next = (this.activeProviderIndex + 1) % this.tileProviders.length;
    console.log(`Manual tile switch → ${this.tileProviders[next].name}`);
    this._applyTileProvider(next);
    return this.tileProviders[next].name;
  }

  setCity(cityObj) {
    if (!cityObj || !this.map) return;
    this.currentCity = cityObj.id;
    this.map.flyTo(cityObj.center, cityObj.zoom || 13, { duration: 1.2 });
  }

  // Vehicle markers (live fleet)
  renderVehicles(vehicles) {
    if (!this.map || typeof L === 'undefined') return;
    this.clearVehicles();
    vehicles.forEach(v => {
      const isBrt = v.transportType === 'brt';
      const bg = isBrt ? '#2563eb' : '#059669';
      const icon = isBrt ? 'R' : 'B';
      const markerIcon = L.divIcon({
        className: 'live-vehicle-marker',
        html: `<div title="${v.routeSign}" style="background:${bg};color:#fff;min-width:30px;height:30px;padding:0 6px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap;">${icon}<span style="font-size:10px;font-weight:800;margin-left:3px;">${v.etaToStopMin != null ? v.etaToStopMin + '′' : ''}</span></div>`,
        iconSize: [34, 30],
        iconAnchor: [17, 15]
      });
      const occ = v.occupancy === 'full' ? 'Imejaa' : v.occupancy === 'seats' ? 'Viti vipo' : v.occupancy === 'empty' ? 'Tupu' : 'Hali haijulikani';
      const live = v.real ? ' <span style="background:#059669;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px;">LIVE</span>' : '';
      const m = L.marker(v.coordinates, { icon: markerIcon, zIndexOffset: 500 })
        .addTo(this.map)
        .bindPopup(`<b>${icon} ${v.routeSign}</b>${live}<br><small>→ ${v.destination || ''}</small><br><small>${v.etaToStopMin != null ? 'Dakika ' + v.etaToStopMin + ' hadi kituo' : 'Dakika ' + v.etaToTerminusMin + ' hadi mwisho'}</small><br><small>${occ}</small>${v.real && v.updatedSecondsAgo != null ? `<br><small style="color:#059669;">sekunde ${v.updatedSecondsAgo} zilizopita</small>` : ''}`);
      this.vehicleMarkers.push(m);
    });
  }

  clearVehicles() {
    if (!this.map) return;
    (this.vehicleMarkers || []).forEach(m => { try { this.map.removeLayer(m); } catch (e) {} });
    this.vehicleMarkers = [];
  }

  updateUserLocation(latLng, title = "Upo Hapa") {
    if (!this.map || typeof L === 'undefined') return;

    const userIcon = L.divIcon({
      className: 'user-gps-marker-container',
      html: '<div class="user-gps-marker"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    if (this.userMarker) {
      this.userMarker.setLatLng(latLng);
    } else {
      this.userMarker = L.marker(latLng, { icon: userIcon, zIndexOffset: 1000 })
        .addTo(this.map)
        .bindPopup(`<b>${title}</b>`);
    }
    return this.userMarker;
  }

  // Blue accuracy circle like Google Maps (GPS precision indicator).
  showAccuracyCircle(latLng, accuracyMeters) {
    if (!this.map || typeof L === 'undefined') return;
    if (this.accuracyCircle) {
      this.accuracyCircle.setLatLng(latLng);
      this.accuracyCircle.setRadius(Math.min(500, accuracyMeters || 50));
    } else {
      this.accuracyCircle = L.circle(latLng, {
        radius: Math.min(500, accuracyMeters || 50),
        color: '#2563eb', weight: 1, opacity: 0.4,
        fillColor: '#2563eb', fillOpacity: 0.12
      }).addTo(this.map);
    }
  }

  panToUser() {
    if (this.userMarker) {
      this.map.flyTo(this.userMarker.getLatLng(), 15, { duration: 0.8 });
    }
  }

  clearRouteAndStops() {
    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
      this.routePolyline = null;
    }
    this.stopMarkers.forEach(marker => this.map.removeLayer(marker));
    this.stopMarkers = [];
  }

  renderRoute(coordinates, color = '#059669', stops = []) {
    this.clearRouteAndStops();

    // Draw smooth route line
    this.routePolyline = L.polyline(coordinates, {
      color: color,
      weight: 6,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Fit map bounds to show complete journey
    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [50, 50] });

    // Render stops
    stops.forEach((stop, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === stops.length - 1;
      const markerHtml = isStart 
        ? `<div style="background:#059669;color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)">A</div>`
        : isEnd 
        ? `<div style="background:#ef4444;color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)">B</div>`
        : `<div style="background:white;color:#0f172a;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;border:2px solid #64748b;box-shadow:0 1px 4px rgba(0,0,0,0.2)"></div>`;

      const markerIcon = L.divIcon({
        className: 'custom-stop-point',
        html: markerHtml,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker(stop.coordinates || coordinates[idx] || coordinates[0], { icon: markerIcon })
        .addTo(this.map)
        .bindPopup(`<b>${stop.name || `Kituo #${idx + 1}`}</b><br><small>Shuka/Panda hapa</small>`);

      this.stopMarkers.push(marker);
    });
  }

  showWalkingSection(fromCoord, toCoord, stepText) {
    const walkingLine = L.polyline([fromCoord, toCoord], {
      color: '#3b82f6',
      weight: 5,
      dashArray: '8, 8',
      opacity: 0.9
    }).addTo(this.map);

    this.stopMarkers.push(walkingLine);
    this.map.flyTo(toCoord, 16, { duration: 1.0 });
  }
}

window.MapService = MapService;
