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

    // Primary: CARTO Voyager (pretty). Fallback: standard OSM if CARTO is blocked.
    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    });
    carto.on('tileerror', () => {
      if (!this._osmFallbackAdded) {
        this._osmFallbackAdded = true;
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(this.map);
      }
    });
    carto.addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Keep tiles correct on window resize / orientation change.
    window.addEventListener('resize', () => this.refresh());

    return this.map;
  }

  // Call every time the map container becomes visible.
  refresh() {
    if (!this.map) return;
    // Multiple passes: CSS transition + flex layout need a beat to settle.
    [50, 200, 600].forEach(ms => setTimeout(() => {
      try { this.map.invalidateSize(); } catch (e) { /* ignore */ }
    }, ms));
  }

  setCity(cityObj) {
    if (!cityObj || !this.map) return;
    this.currentCity = cityObj.id;
    this.map.flyTo(cityObj.center, cityObj.zoom || 13, { duration: 1.2 });
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
