// NIFIKISHE Application Orchestrator
let mapService;
let currentCity = {
  id: "dar-es-salaam",
  name: "Dar es Salaam",
  center: [-6.816064, 39.280358],
  zoom: 13
};

let userOrigin = {
  name: "Mbezi Mwisho",
  coordinates: [-6.7725, 39.1128]
};

let userDestination = {
  name: "Kariakoo Market",
  coordinates: [-6.8196, 39.2745]
};

let currentJourneys = [];
let activeJourney = null;
let activeSimulationTimer = null;
let savedTrips = [];

// Initialize PWA Service Worker & App State
// Wait for Leaflet (CDN or local fallback) before initialising the map.
function waitForLeaflet(triesLeft, done) {
  if (typeof L !== 'undefined') return done();
  if (triesLeft <= 0) return done();
  setTimeout(() => waitForLeaflet(triesLeft - 1, done), 100);
}

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW error:', err));
  }

  loadSavedTrips();

  // Initialize Map Service (after Leaflet is available)
  waitForLeaflet(50, () => {
    mapService = new MapService('map');
    mapService.init(currentCity.center, currentCity.zoom);

    // Set default origin marker
    mapService.updateUserLocation(userOrigin.coordinates, "Mbezi Mwisho (Wewe Upo Hapa)");

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'app' || urlParams.get('navigate') === 'true') {
      showAppView();
    }
  });

  // Setup search autocomplete
  setupAutocomplete('originInput', 'originDropdown', (item) => {
    userOrigin = { name: item.title, coordinates: item.coordinates };
    document.getElementById('originInput').value = item.title;
    mapService.updateUserLocation(item.coordinates, item.title);
    mapService.panToUser();
  });

  setupAutocomplete('destInput', 'destDropdown', (item) => {
    userDestination = { name: item.title, coordinates: item.coordinates };
    document.getElementById('destInput').value = item.title;
  });

  document.getElementById('originInput').value = userOrigin.name;
  document.getElementById('destInput').value = userDestination.name;

  const cityBtn = document.getElementById('citySelectorBtn');
  if (cityBtn) {
    cityBtn.addEventListener('click', openCitySelector);
  }
});

// ---------------------------------------------------------------------------
// View Routing: Consumer landing page <-> Full navigation workspace
// ---------------------------------------------------------------------------
function showLandingView() {
  document.getElementById('landingView').style.display = 'flex';
  document.getElementById('appWorkspaceView').style.display = 'none';
  if (document.getElementById('tabHomeBtn')) document.getElementById('tabHomeBtn').classList.add('active');
  if (document.getElementById('tabMapBtn')) document.getElementById('tabMapBtn').classList.remove('active');
  if (document.getElementById('tabKariakooBtn')) document.getElementById('tabKariakooBtn').classList.remove('active');
}

function showAppView() {
  document.getElementById('landingView').style.display = 'none';
  document.getElementById('appWorkspaceView').style.display = 'flex';
  if (document.getElementById('tabHomeBtn')) document.getElementById('tabHomeBtn').classList.remove('active');
  if (document.getElementById('tabMapBtn')) document.getElementById('tabMapBtn').classList.add('active');
  if (document.getElementById('tabKariakooBtn')) document.getElementById('tabKariakooBtn').classList.remove('active');

  // The map container had zero size while hidden — force Leaflet to re-measure.
  if (mapService) mapService.refresh();
}

function startSearchFromLanding() {
  const originVal = document.getElementById('heroOriginInput').value.trim();
  const destVal = document.getElementById('heroDestInput').value.trim();

  if (originVal) userOrigin.name = originVal;
  if (destVal) userDestination.name = destVal;

  document.getElementById('originInput').value = userOrigin.name;
  document.getElementById('destInput').value = userDestination.name;

  showAppView();
  performJourneySearch();
}

function triggerDemoFromLanding() {
  showAppView();
  triggerFullDemo();
}

function jumpToKariakooExplore() {
  showAppView();
  if (document.getElementById('tabKariakooBtn')) document.getElementById('tabKariakooBtn').classList.add('active');
  if (document.getElementById('tabMapBtn')) document.getElementById('tabMapBtn').classList.remove('active');
  userDestination = { name: "Kariakoo Market", coordinates: [-6.8196, 39.2745] };
  document.getElementById('destInput').value = "Kariakoo Market";
  showArrivalAndComplexArea();
}

// Swahili-first spoken guidance using the Web Speech API
function speakInstruction(text) {
  const checkbox = document.getElementById('voiceGuidanceCheckbox');
  if (!checkbox || !checkbox.checked) return;
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'sw-TZ';
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

function setAppLanguage(lang) {
  window.i18n.setLanguage(lang);
  document.getElementById('btnLangSw').classList.toggle('active', lang === 'sw');
  document.getElementById('btnLangEn').classList.toggle('active', lang === 'en');

  // Re-render server-driven panels so labels follow the selected language.
  if (currentJourneys.length > 0) {
    renderRouteCards(currentJourneys);
  }
  if (activeJourney && document.getElementById('journeyDetailContainer').style.display !== 'none') {
    viewJourneyDetail(activeJourney.id);
  }
}

function useCurrentGpsLocation() {
  if (!mapService || !mapService.map) {
    alert("Ramani bado inapakiwa — subiri sekunde chache kisha jaribu tena.");
    if (mapService) mapService.refresh();
    return;
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latLng = [pos.coords.latitude, pos.coords.longitude];
        userOrigin = { name: "Eneo Langu la Sasa (GPS)", coordinates: latLng };
        document.getElementById('originInput').value = userOrigin.name;
        mapService.updateUserLocation(latLng, "Eneo Langu la Sasa");
        mapService.panToUser();
      },
      (err) => {
        alert("Hatukuweza kupata GPS yako moja kwa moja. Tutatumia eneo la mfano: Mbezi Mwisho.");
        mapService.updateUserLocation(userOrigin.coordinates, userOrigin.name);
      }
    );
  } else {
    mapService.updateUserLocation(userOrigin.coordinates, userOrigin.name);
  }
}

function resetMapView() {
  if (mapService && mapService.map && currentCity) {
    mapService.setCity(currentCity);
  } else if (mapService) {
    mapService.refresh();
  }
}

// Manual tile-provider switch (map style button 🔃 on the map).
function switchMapTiles() {
  if (!mapService || !mapService.map) {
    alert("Ramani bado inapakiwa — subiri sekunde chache kisha jaribu tena.");
    return;
  }
  const name = mapService.cycleTileProvider();
  console.log("Tile provider:", name);
}

function selectQuickDestination(name, coordinates) {
  userDestination = { name, coordinates };
  document.getElementById('destInput').value = name;
  performJourneySearch();
}

function setupAutocomplete(inputId, dropdownId, onSelect) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  let debounceTimer;
  input.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value.trim();
    if (q.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?city=${currentCity.id}&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          dropdown.innerHTML = data.results.map(item => `
            <div class="autocomplete-item" onclick='handleSelectAutocomplete("${inputId}", ${JSON.stringify(item)})'>
              <span>${item.type === 'stop' ? '🚏' : item.type === 'route' ? '🚌' : '📍'}</span>
              <div>
                <div class="item-title">${item.title}</div>
                <div class="item-sub">${item.subtitle || ''}</div>
              </div>
            </div>
          `).join('');
          dropdown.style.display = 'block';
        } else {
          dropdown.style.display = 'none';
        }
      } catch (err) {
        console.error(err);
      }
    }, 250);
  });

  window.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

window.handleSelectAutocomplete = function(inputId, item) {
  if (inputId === 'originInput') {
    userOrigin = { name: item.title, coordinates: item.coordinates };
    document.getElementById('originInput').value = item.title;
    mapService.updateUserLocation(item.coordinates, item.title);
    mapService.panToUser();
  } else {
    userDestination = { name: item.title, coordinates: item.coordinates };
    document.getElementById('destInput').value = item.title;
  }
  document.getElementById('originDropdown').style.display = 'none';
  document.getElementById('destDropdown').style.display = 'none';
};

// Search & Route Rendering
async function performJourneySearch() {
  const btn = document.getElementById('btnNifikishe');
  const loadingLabel = window.i18n.currentLang === 'sw' ? 'Inatafuta njia bora...' : 'Finding the best routes...';
  btn.innerHTML = `<span>⏳ ${loadingLabel}</span>`;
  const resetBtnLabel = () => {
    btn.innerHTML = '<span style="font-size: 18px;">🧭</span> <span>' + window.i18n.t('ctaNifikishe') + '</span>';
  };

  try {
    const res = await fetch('/api/navigation/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: userOrigin,
        destination: userDestination,
        city: currentCity.id
      })
    });

    const data = await res.json();
    resetBtnLabel();

    if (data.journeys && data.journeys.length > 0) {
      currentJourneys = data.journeys;
      renderRouteCards(data.journeys);
      // Auto-preview first route
      viewJourneyDetail(data.journeys[0].id);
    } else {
      alert("Hakuna njia iliyopatikana kwa safari hii.");
    }
  } catch (err) {
    resetBtnLabel();
    console.error(err);
    alert("Hitilafu ya mtandao wakati wa kuwasiliana na seva.");
  }
}

function renderRouteCards(journeys) {
  const container = document.getElementById('routeResultsContainer');
  const list = document.getElementById('routesList');
  container.style.display = 'flex';
  document.getElementById('complexAreaContainer').style.display = 'none';

  list.innerHTML = journeys.map(j => {
    const badgeColor = j.transportType === 'brt' ? '#2563eb' : '#059669';
    const badgeIcon = j.transportType === 'brt' ? '🚍 BRT Mwendokasi' : '🚌 Daladala';

    return `
      <div class="route-card" id="card_${j.id}" onclick="viewJourneyDetail('${j.id}')">
        <div class="route-card-header">
          <span class="route-badge" style="background:${badgeColor}">
            ${badgeIcon}
          </span>
          <div class="route-time-box">
            <span class="route-time-number">${j.estimatedTimeMinutes}</span>
            <span style="font-size: 12px; color: var(--text-muted); font-weight: 700;">${window.i18n.currentLang === 'sw' ? 'dakika' : 'min'}</span>
          </div>
        </div>

        <div class="route-card-body">
          <div class="route-title">${j.title}</div>
          <div class="route-metrics-row">
            <span class="route-metric-pill">🚶 ${j.walkingMinutesTotal} ${window.i18n.currentLang === 'sw' ? 'dakika tembea' : 'min walk'}</span>
            <span>•</span>
            <span class="route-metric-pill">🔄 ${j.transfersCount === 0 ? (window.i18n.currentLang === 'sw' ? 'Moja kwa Moja' : 'Direct') : j.transfersCount + (window.i18n.currentLang === 'sw' ? ' badilisha' : ' transfer')}</span>
            <span>•</span>
            <span class="route-metric-pill">💰 TSh ${j.fareEstimatedTsh.toLocaleString()}</span>
          </div>
        </div>

        <button class="btn-view-route">
          ${window.i18n.t('viewRouteDetail')}
        </button>
      </div>
    `;
  }).join('');
}

function viewJourneyDetail(journeyId) {
  const journey = currentJourneys.find(j => j.id === journeyId);
  if (!journey) return;
  activeJourney = journey;

  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`card_${journeyId}`);
  if (card) card.classList.add('selected');

  const routeColor = journey.transportType === 'brt' ? '#2563eb' : '#059669';
  mapService.renderRoute(journey.routeCoordinates, routeColor, journey.steps[1].intermediateStops.map(name => ({ name })));

  const detailContainer = document.getElementById('journeyDetailContainer');
  detailContainer.style.display = 'flex';

  detailContainer.innerHTML = `
    <div class="journey-detail-card">
      <div class="journey-detail-header">
        <div>
          <h3>${journey.title}</h3>
          <div style="font-size: 11px; color: #94a3b8;">${journey.englishTitle}</div>
        </div>
        <button class="btn-nifikishe" style="width:auto; padding:8px 16px; font-size:13px;" onclick="startLiveJourneyMode('${journey.id}')">
          ▶️ ${window.i18n.t('startJourney')}
        </button>
      </div>

      <div class="vehicle-identity-box">
        <div class="vehicle-identity-title">🔍 ${window.i18n.t('lookForVehicle')}</div>
        ${journey.vehicle && journey.vehicle.image ? '<img src="' + journey.vehicle.image + '" alt="Gari la Usafiri" class="vehicle-preview-img">' : ''}
        <div style="font-size: 13px; font-weight: 600; color: #78350f;">
          Basi: <strong>${journey.vehicle.type}</strong> (${journey.vehicle.color})
        </div>
        <div>
          <span style="font-size: 11px; color: #92400e; font-weight: 700; text-transform: uppercase;">Kibao Kilichoandikwa Juu:</span>
          <div class="route-sign-plate" style="background:${journey.routeSignColor}; color:white;">
            ${journey.routeSign}
          </div>
        </div>
        <div class="ask-conductor-pill">
          <span>🗣️ ${window.i18n.t('askConductor')} </span>
          <strong>"${journey.conductorAsk}"</strong>
        </div>
      </div>

      <div class="journey-steps-timeline">
        ${journey.steps.map(step => `
          <div class="step-node">
            <div class="step-icon-wrap" style="background:#f1f5f9; border: 1.5px solid #cbd5e1;">
              ${step.icon}
            </div>
            <div class="step-content">
              <span class="step-tag">${step.title}</span>
              <div class="step-instruction">${step.instruction}</div>
              ${step.mode === 'walking' ? `<div style="font-size: 11px; color: var(--text-muted); font-weight: 600;">⏱️ Dakika ${step.timeMinutes} (${step.distanceMeters}m)</div>` : ''}
              ${step.intermediateStops ? `
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; background: #f8fafc; padding: 6px 10px; border-radius: 6px;">
                  🚏 <strong>Vituo ${step.intermediateStops.length}:</strong> ${step.intermediateStops.slice(0, 4).join(' ➔ ')} ... ➔ ${step.dropOffStop}
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Live Journey Mode & Simulation Experience
function startLiveJourneyMode(journeyId) {
  const journey = currentJourneys.find(j => j.id === journeyId) || activeJourney;
  if (!journey) return;

  const simContainer = document.getElementById('liveSimulationCard');
  simContainer.style.display = 'block';

  const coords = journey.routeCoordinates;
  let currIndex = 0;

  if (activeSimulationTimer) clearInterval(activeSimulationTimer);

  speakInstruction(`Safari imeanza. Panda gari lenye kibao cha ${journey.routeSign}.`);

  function updateSimStep() {
    if (currIndex >= coords.length) {
      clearInterval(activeSimulationTimer);
      speakInstruction("Umefika kituo cha Kariakoo Msimbazi. Karibu kwenye soko kuu.");
      showArrivalAndComplexArea();
      return;
    }

    const currentCoord = coords[currIndex];
    mapService.updateUserLocation(currentCoord, "Wewe Upo Hapa (Mwendo wa Moja kwa Moja)");
    mapService.map.panTo(currentCoord);

    const isStarting = currIndex === 0;
    const isMidway = currIndex > 2 && currIndex < coords.length - 2;
    const isApproaching = currIndex >= coords.length - 2 && currIndex < coords.length - 1;
    const isDropOff = currIndex === coords.length - 1;

    let bannerStatus = `🚌 ${window.i18n.t('onBoard')}`;
    let subStatus = `Kituo kinachofuata: Ubungo Interchange`;

    if (isStarting) {
      bannerStatus = `🚶 Tembea kuelekea kituo cha Mbezi Mwisho`;
      subStatus = `Mita 350 zimebaki kabla ya kupanda`;
    } else if (isMidway) {
      bannerStatus = `🚌 Safari inaendelea vizuri kwenye Morogoro Rd`;
      subStatus = `Vituo 4 vimebaki kuelekea Kariakoo`;
    } else if (isApproaching) {
      bannerStatus = `🔔 ${window.i18n.t('approachingDest')}`;
      subStatus = `Jiandae kusimama, kituo kinachofuata ni Kariakoo!`;
      speakInstruction("Tahadhari. Karibu kufika Kariakoo. Jiandae kushuka.");
    } else if (isDropOff) {
      bannerStatus = `🛑 ${window.i18n.t('alightHere')}`;
      subStatus = `Shuka kwenye kituo cha Kariakoo Msimbazi!`;
    }

    simContainer.innerHTML = `
      <div style="background: #0f172a; color: white; border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-floating);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; font-weight: 800; color: #34d399; text-transform: uppercase;">● ${window.i18n.t('liveJourneyActive')}</span>
          <button onclick="stopLiveSimulation()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 3px 8px; border-radius: 6px; font-size: 11px; cursor: pointer;">Acha</button>
        </div>
        <div style="font-size: 15px; font-weight: 700;">${bannerStatus}</div>
        <div style="font-size: 12px; color: #cbd5e1;">${subStatus}</div>
        <div style="background: rgba(255,255,255,0.1); height: 6px; border-radius: 4px; overflow: hidden; margin-top: 4px;">
          <div style="background: #10b981; height: 100%; width: ${((currIndex + 1) / coords.length) * 100}%; transition: width 0.8s ease;"></div>
        </div>
      </div>
    `;

    currIndex++;
  }

  updateSimStep();
  activeSimulationTimer = setInterval(updateSimStep, 1800);
}

function stopLiveSimulation() {
  if (activeSimulationTimer) clearInterval(activeSimulationTimer);
  document.getElementById('liveSimulationCard').style.display = 'none';
}

// Complex Area (Kariakoo) Micro-Navigation
async function showArrivalAndComplexArea() {
  stopLiveSimulation();

  const container = document.getElementById('complexAreaContainer');
  container.style.display = 'flex';

  try {
    const res = await fetch('/api/complex-areas/kariakoo');
    const data = await res.json();

    container.innerHTML = `
      <div class="complex-area-card">
        <div class="complex-area-title">
          <span>🏪</span>
          <span>${window.i18n.t('complexAreaTitle')}</span>
        </div>
        <p style="font-size: 12px; color: #94a3b8; line-height: 1.4;">
          Umeshuka Kariakoo salama. Chagua bidhaa au eneo unaloelekea kwa ajili ya maelekezo ya kutembea mitaani:
        </p>

        <div class="complex-categories-grid">
          ${data.categories.map(cat => `
            <button class="complex-category-btn" onclick='navigateInsideComplexArea(${JSON.stringify(cat)})'>
              <span>${cat.icon}</span>
              <span>${cat.swName.split(' ')[0]}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    mapService.updateUserLocation([-6.8188, 39.2755], "Kariakoo (Shuka Hapa)");
    mapService.map.flyTo([-6.8188, 39.2755], 16, { duration: 1 });
  } catch (err) {
    console.error(err);
  }
}

window.navigateInsideComplexArea = function(category) {
  const container = document.getElementById('complexAreaContainer');
  const startCoord = [-6.8188, 39.2755];
  mapService.showWalkingSection(startCoord, category.coordinates, category.swName);

  container.innerHTML = `
    <div class="complex-area-card" style="background:#064e3b;">
      <div class="complex-area-title">
        <span>${category.icon}</span>
        <span>${category.swName}</span>
      </div>
      <div style="font-size: 12px; color: #a7f3d0; font-weight: 600;">
        📍 Eneo: ${category.street} (Kutembea ~${Math.round(category.walkingSecondsFromMsimbazi / 60)} min)
      </div>

      <div style="background: rgba(0,0,0,0.25); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
        <span style="font-size: 11px; font-weight: 800; color: #34d399; text-transform: uppercase;">Maelekezo ya Kutembea:</span>
        ${category.directions.map((d, i) => `
          <div style="font-size: 12px; display: flex; gap: 8px;">
            <span>${i + 1}.</span>
            <span>${d}</span>
          </div>
        `).join('')}
      </div>

      <button class="btn-nifikishe" style="margin-top: 10px; background: #ffffff; color: #064e3b;" onclick="showArrivalCelebration()">
        🎉 UMEFIKA KWENYE DUKA
      </button>
    </div>
  `;
};

function showArrivalCelebration() {
  const container = document.getElementById('complexAreaContainer');
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 24px; border-radius: var(--radius-lg); text-align: center; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-floating);">
      <div style="font-size: 40px;">🎉</div>
      <h2 style="font-size: 22px; font-weight: 800;">${window.i18n.t('arrived')}</h2>
      <p style="font-size: 13px; color: #d1fae5;">
        Umefika salama unakokwenda kwa usaidizi wa NIFIKISHE!
      </p>
      <button class="btn-view-route" style="background: white; color: #047857; margin-top: 8px;" onclick="showAppView(); performJourneySearch();">
        🧭 Anzisha Safari Nyingine
      </button>
    </div>
  `;
}

function triggerFullDemo() {
  showAppView();
  document.getElementById('originInput').value = "Mbezi Mwisho Bus Stand";
  document.getElementById('destInput').value = "Kariakoo Market";
  userOrigin = { name: "Mbezi Mwisho Bus Stand", coordinates: [-6.7725, 39.1128] };
  userDestination = { name: "Kariakoo Market", coordinates: [-6.8196, 39.2745] };

  performJourneySearch().then(() => {
    setTimeout(() => {
      startLiveJourneyMode('journey_route_daladala_mbezi_kariakoo');
    }, 1200);
  });
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

async function openCitySelector() {
  const modal = document.getElementById('cityModal');
  const container = document.getElementById('citiesListContainer');
  modal.style.display = 'flex';

  try {
    const res = await fetch('/api/cities');
    const data = await res.json();

    container.innerHTML = data.cities.map(c => `
      <div style="padding: 12px; border: 1.5px solid ${c.id === currentCity.id ? '#059669' : '#e2e8f0'}; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: ${c.id === currentCity.id ? '#ecfdf5' : '#ffffff'}; margin-bottom: 8px;" onclick='selectCity(${JSON.stringify(c)})'>
        <div>
          <div style="font-weight: 700; font-size: 14px;">${c.name}</div>
          <div style="font-size: 12px; color: #64748b;">Usafiri: ${c.transportTypes.join(', ')}</div>
        </div>
        ${c.id === currentCity.id ? '<span style="color:#059669; font-weight:bold;">✓ Sasa</span>' : '<span style="font-size:12px; color:#94a3b8;">Chagua</span>'}
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

function selectCity(cityObj) {
  currentCity = cityObj;
  document.getElementById('currentCityName').innerText = cityObj.name;
  if (mapService && mapService.map) {
    mapService.setCity(cityObj);
  }
  closeModal('cityModal');
}

async function quickSelectCity(cityId) {
  try {
    const res = await fetch('/api/cities/' + cityId);
    const data = await res.json();
    if (data.city) {
      selectCity(data.city);
      showAppView();
    }
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Sorting available journeys
// ---------------------------------------------------------------------------
function sortRoutes(type) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));

  if (type === 'fastest') {
    if (document.getElementById('filterFastest')) document.getElementById('filterFastest').classList.add('active');
    currentJourneys.sort((a, b) => a.estimatedTimeMinutes - b.estimatedTimeMinutes);
  } else if (type === 'transfers') {
    if (document.getElementById('filterTransfers')) document.getElementById('filterTransfers').classList.add('active');
    currentJourneys.sort((a, b) => a.transfersCount - b.transfersCount);
  } else if (type === 'cost') {
    if (document.getElementById('filterCost')) document.getElementById('filterCost').classList.add('active');
    currentJourneys.sort((a, b) => a.fareEstimatedTsh - b.fareEstimatedTsh);
  }

  renderRouteCards(currentJourneys);
}

// ---------------------------------------------------------------------------
// Saved trips (persisted locally so it works offline on the phone)
// ---------------------------------------------------------------------------
function loadSavedTrips() {
  try {
    const raw = localStorage.getItem('nifikishe_saved_trips');
    savedTrips = raw ? JSON.parse(raw) : [];
  } catch (err) {
    savedTrips = [];
  }
}

function persistSavedTrips() {
  try {
    localStorage.setItem('nifikishe_saved_trips', JSON.stringify(savedTrips));
  } catch (err) {
    console.error(err);
  }
}

function toggleSavedActiveRoute() {
  if (!activeJourney) {
    alert("Tafadhali chagua safari kwanza ili uweze kuihifadhi.");
    return;
  }

  const index = savedTrips.findIndex(t => t.id === activeJourney.id);

  if (index >= 0) {
    savedTrips.splice(index, 1);
    alert("Safari imeondolewa kwenye zilizohifadhiwa.");
  } else {
    savedTrips.push({
      id: activeJourney.id,
      title: activeJourney.title,
      origin: userOrigin.name,
      dest: userDestination.name,
      fare: activeJourney.fareEstimatedTsh
    });
    alert("Safari imehifadhiwa! ⭐");
  }

  persistSavedTrips();
}

function openSavedRoutesModal() {
  const modal = document.getElementById('savedModal');
  const container = document.getElementById('savedRoutesContainer');
  modal.style.display = 'flex';

  if (savedTrips.length === 0) {
    container.innerHTML = "<p style=\"font-size: 13px; color: var(--text-muted);\">Bado hujaziweka njia zako unazozitumia mara kwa mara. Tumia kitufe cha ⭐ kwenye ramani kuhifadhi safari.</p>";
    return;
  }

  container.innerHTML = savedTrips.map(t => `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:12px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
      <div>
        <div style="font-weight:700; font-size:14px;">${t.origin} ➔ ${t.dest}</div>
        <div style="font-size:12px; color:#64748b;">${t.title} • TSh ${t.fare}</div>
      </div>
      <button class="btn-subtle" onclick="loadSavedJourney('${t.origin}', '${t.dest}')">🧭 Enda</button>
    </div>
  `).join('');
}

function loadSavedJourney(originName, destName) {
  closeModal('savedModal');
  showAppView();
  document.getElementById('originInput').value = originName;
  document.getElementById('destInput').value = destName;
  userOrigin.name = originName;
  userDestination.name = destName;
  performJourneySearch();
}

function openReportModal() {
  document.getElementById('reportModal').style.display = 'flex';
}

async function submitUserReport() {
  const type = document.getElementById('reportTypeSelect').value;
  const title = document.getElementById('reportTitleInput').value.trim();
  const description = document.getElementById('reportDescInput').value.trim();

  if (!title || !description) {
    alert("Tafadhali jaza kichwa na maelezo ya ripoti.");
    return;
  }

  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cityId: currentCity.id,
        type,
        title,
        description
      })
    });
    const data = await res.json();
    alert(data.message);
    closeModal('reportModal');
  } catch (err) {
    console.error(err);
  }
}

async function openAdminModal() {
  const modal = document.getElementById('adminModal');
  const body = document.getElementById('adminDataBody');
  modal.style.display = 'flex';

  try {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();

    body.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
        <div style="background:#f8fafc; padding:12px; border-radius:10px; border:1px solid #e2e8f0; text-align:center;">
          <div style="font-size:20px; font-weight:800; color:#059669;">${data.stats.citiesCount}</div>
          <div style="font-size:11px; color:#64748b;">Miji Inayoungwa</div>
        </div>
        <div style="background:#f8fafc; padding:12px; border-radius:10px; border:1px solid #e2e8f0; text-align:center;">
          <div style="font-size:20px; font-weight:800; color:#2563eb;">${data.stats.routesCount}</div>
          <div style="font-size:11px; color:#64748b;">Njia za Usafiri</div>
        </div>
        <div style="background:#f8fafc; padding:12px; border-radius:10px; border:1px solid #e2e8f0; text-align:center;">
          <div style="font-size:20px; font-weight:800; color:#d97706;">${data.stats.stopsCount}</div>
          <div style="font-size:11px; color:#64748b;">Vituo vya Mabasi</div>
        </div>
        <div style="background:#f8fafc; padding:12px; border-radius:10px; border:1px solid #e2e8f0; text-align:center;">
          <div style="font-size:20px; font-weight:800; color:#ef4444;">${data.stats.reportsCount}</div>
          <div style="font-size:11px; color:#64748b;">Ripoti za Watumiaji</div>
        </div>
      </div>

      <div style="margin-top: 14px;">
        <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">Utafutaji Maarufu (Popular Destinations):</h4>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${data.analytics.topDestinations.map(d => `
            <span style="background:#f1f5f9; padding:6px 10px; border-radius:20px; font-size:12px; font-weight:600;">
              ${d.name}: <strong>${d.count.toLocaleString()}</strong> searches
            </span>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
  }
}





