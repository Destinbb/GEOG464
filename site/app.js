const map = L.map('map', { preferCanvas: true }).setView([45.51, -73.57], 11);
map.zoomControl.setPosition('bottomright');

// Basemap: Esri World Topographic. Light, natural colours (green parks, blue water, white and grey streets)
// that do not clash with the lane, pavement and report colours, and it shows terrain.
// Free with no account for non-commercial use; Esri asks for the credit below. Its full source list is long,
// so (like Esri's own Leaflet plugin) the map shows a short credit and the full list appears on hover over "others".
// The full credit is also in the Data sources tab.
const ESRI_SOURCES = 'Sources: Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, FAO, NPS, NRCAN, GeoBase, IGN, ' +
  'Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), (c) OpenStreetMap contributors, and the GIS User Community';
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Sources: Esri, HERE, Garmin, USGS and ' +
    '<abbr title="' + ESRI_SOURCES + '">others</abbr>'
}).addTo(map);
// The routes, addresses and repair stations come from OpenStreetMap data
map.attributionControl.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
map.attributionControl.addAttribution(
  'Routing: <a href="https://routing.openstreetmap.de/about.html">FOSSGIS OSRM</a>, ' +
  'addresses: <a href="https://nominatim.org">Nominatim</a>'
);

const isPhone = window.innerWidth <= 800;

// ---------- Loading message ----------
// A box with a spinner in the middle of the map until the bike lanes arrive.
// The data-loading code further down removes it, whether the data loads or fails.
const loadingBox = L.DomUtil.create('div', 'map-loading', map.getContainer());
loadingBox.setAttribute('role', 'status');
loadingBox.innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading bike lanes…';

// ---------- Information tabs ----------
// Each tab opens its block of text; clicking the open tab again closes it. Only one is open at a time.
const tabs = document.querySelectorAll('.tab');
tabs.forEach(function (tab) {
  tab.addEventListener('click', function () {
    const opening = tab.getAttribute('aria-expanded') !== 'true';
    tabs.forEach(function (other) {
      other.setAttribute('aria-expanded', 'false');
      document.getElementById(other.getAttribute('aria-controls')).hidden = true;
    });
    if (opening) {
      tab.setAttribute('aria-expanded', 'true');
      document.getElementById(tab.getAttribute('aria-controls')).hidden = false;
    }
    // The map gets shorter or taller when a panel opens or closes, so tell Leaflet its new size
    map.invalidateSize();
  });
});

// Esc closes the open tab and puts the keyboard focus back on its button.
// An Esc already used elsewhere (e.g. to close a suggestion list) is left alone.
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const open = document.querySelector('.tab[aria-expanded="true"]');
  if (open) {
    open.click();   // clicking the open tab closes it
    open.focus();
  }
});

// ---------- Locate me ----------
// A rough box around the island of Montreal, used to keep address results on the island
const ISLAND = { west: -73.98, south: 45.40, east: -73.47, north: 45.71 };

// ---------- Comfort levels: how a lane is built, not the city's "protected" flag ----------
// The city's PROTEGE_4S field really means "protected and kept open all winter", so lanes are grouped
// by facility_type instead. Every part of the map (layers, search, route scores) asks comfortLevel().
const COMFORT = {
  separated: { label: 'Separated from cars', color: '#2166ac', weight: 5, dashArray: null },
  painted: { label: 'Painted lane', color: '#6baed6', weight: 3, dashArray: null },
  shared: { label: 'Shared with traffic', color: '#d01c8b', weight: 2.5, dashArray: '8, 6' }
};
const SEPARATED_TYPES = [
  'Piste cyclable en site propre',          // dedicated bike path
  'Piste cyclable sur rue',                 // on-street protected lane
  'Piste cyclable au niveau du trottoir',   // sidewalk-level path
  'Sentier polyvalent'                      // multi-use trail
];
const PAINTED_TYPES = ['Bande cyclable'];   // bike lane: paint only

// 'separated', 'painted' or 'shared' (designated roadway, bicycle street, shared bus-bike lane, anything else)
function comfortLevel(facilityType) {
  if (SEPARATED_TYPES.includes(facilityType)) return 'separated';
  if (PAINTED_TYPES.includes(facilityType)) return 'painted';
  return 'shared';
}
const myLocationLayer = L.layerGroup().addTo(map);
let myLocation = null;
let myLocationMarker = null;

function onIsland(latlng) {
  return latlng.lng > ISLAND.west && latlng.lng < ISLAND.east &&
    latlng.lat > ISLAND.south && latlng.lat < ISLAND.north;
}

// Ask the browser for the reader's position and draw it: a dot, plus a faint circle for its accuracy
function locateMe() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot share your location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(function (position) {
      myLocation = L.latLng(position.coords.latitude, position.coords.longitude);
      const accuracy = Math.round(position.coords.accuracy);
      myLocationLayer.clearLayers();
      L.circle(myLocation, {
        radius: accuracy, color: '#1f2d5a', weight: 1, fillOpacity: 0.1, interactive: false
      }).addTo(myLocationLayer);
      myLocationMarker = L.circleMarker(myLocation, {
        radius: 8, color: '#ffffff', weight: 3, fillColor: '#1f2d5a', fillOpacity: 1
      }).bindPopup(
        '<strong>You are here</strong><br>Accurate to about ' + accuracy + ' m.' +
        (onIsland(myLocation) ? '' : '<br>You seem to be off the island of Montreal; the bike network shown covers the island only.')
      ).addTo(myLocationLayer);
      resolve(myLocation);
    }, function (error) {
      reject(new Error(error.code === error.PERMISSION_DENIED
        ? 'Location is blocked. Allow location for this page in your browser settings, then try again.'
        : 'Your location could not be found. Try again, or type a starting address.'));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

// Locate me: a small crosshair button just above the + and − zoom buttons.
// A message (e.g. "Location is blocked") appears above the button when needed.
const LocateControl = L.Control.extend({
  onAdd: function () {
    const box = L.DomUtil.create('div', 'locate-map-control');
    box.innerHTML =
      '<p class="locate-message" role="status" hidden></p>' +
      '<div class="leaflet-bar">' +
        '<button id="locate-button" class="locate-icon" type="button" aria-label="Locate me" title="Locate me">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
            '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>' +
            '<circle cx="12" cy="12" r="2.5" fill="currentColor"/>' +
            '<path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/>' +
          '</svg>' +
        '</button>' +
      '</div>';
    L.DomEvent.disableClickPropagation(box);
    return box;
  }
});
new LocateControl({ position: 'bottomright' }).addTo(map);

const locateButton = document.getElementById('locate-button');
const locateMessage = document.querySelector('.locate-message');

locateButton.addEventListener('click', function () {
  locateButton.disabled = true;
  locateButton.setAttribute('aria-label', 'Locating…');
  locateButton.title = 'Locating…';
  locateMessage.hidden = true;
  locateMe()
    .then(function (latlng) {
      map.setView(latlng, Math.max(map.getZoom(), 16));
      myLocationMarker.openPopup();
    })
    .catch(function (err) {
      locateMessage.textContent = err.message;
      locateMessage.hidden = false;
    })
    .finally(function () {
      locateButton.disabled = false;
      locateButton.setAttribute('aria-label', 'Locate me');
      locateButton.title = 'Locate me';
    });
});

// ---------- Plan a route from A to B ----------
// Route line sits in its own pane, above the bike-lane layers, so toggling layers never hides it
map.createPane('routePane').style.zIndex = 450;
// The route is drawn on its own canvas that covers the whole map. Let clicks pass through it,
// so the bike-lane and pavement popups underneath still open while a route is shown.
map.getPane('routePane').style.pointerEvents = 'none';
const routeLayer = L.layerGroup().addTo(map);

// My data for scoring routes; filled in once the GeoJSON files have loaded
const routeData = { lanes: [], repairStations: [] };

// Nominatim reads French street words best, so expand common English forms: "Blvd W" -> "boulevard Ouest"
function tidyAddress(text) {
  return text.trim()
    .replace(/\b(blvd|boul|boulevard)\b\.?/gi, 'boulevard')
    .replace(/\bave?\b\.?/gi, 'avenue')
    .replace(/\s+(w|west)\.?$/i, ' Ouest')
    .replace(/\s+(e|east)\.?$/i, ' Est');
}

// Turn an address or place name into a point on the island
// Downtown Montreal (Place Ville Marie), used to break ties between places with the same name
const DOWNTOWN = L.latLng(45.5017, -73.5673);

function findPlace(text) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&bounded=1' +
    '&viewbox=' + [ISLAND.west, ISLAND.north, ISLAND.east, ISLAND.south].join(',') +
    '&q=' + encodeURIComponent(tidyAddress(text));
  return fetch(url)
    .then(function (response) {
      if (!response.ok) {
        throw new Error('The address search is not responding. Try again in a minute.');
      }
      return response.json();
    })
    .then(function (results) {
      if (results.length === 0) {
        throw new Error('Could not find "' + text + '" on the island of Montreal. Try a street address, e.g. 4500 rue Saint-Denis.');
      }
      // Some names match several places equally well, e.g. "McGill University" finds both the downtown
      // campus and the Macdonald campus in Sainte-Anne-de-Bellevue with the same score.
      // Among the matches that tie with the best one, take the one closest to downtown.
      const tied = results.filter(function (result) {
        return Math.abs(result.importance - results[0].importance) < 0.001;
      });
      const best = tied.reduce(function (closest, result) {
        const distance = DOWNTOWN.distanceTo([Number(result.lat), Number(result.lon)]);
        return distance < closest.distance ? { result: result, distance: distance } : closest;
      }, { result: results[0], distance: Infinity }).result;

      // Keep the first part of the long name (e.g. "Marché Atwater, Avenue Greene") so the reader can check the match
      const name = best.display_name.split(', ').slice(0, 3).join(', ');
      return { latlng: L.latLng(Number(best.lat), Number(best.lon)), name: name };
    });
}

// Ask the OpenStreetMap bike router for a route; it prefers bike paths and quiet streets
function findBikeRoute(start, end) {
  const url = 'https://routing.openstreetmap.de/routed-bike/route/v1/bike/' +
    start.lng + ',' + start.lat + ';' + end.lng + ',' + end.lat +
    '?overview=full&geometries=geojson&alternatives=true';
  return fetch(url)
    .then(function (response) {
      if (!response.ok) {
        throw new Error('The route planner is not responding. Try again in a minute.');
      }
      return response.json();
    })
    .then(function (result) {
      if (result.code !== 'Ok' || result.routes.length === 0) {
        throw new Error('No bike route was found between these two places.');
      }
      return result.routes;
    });
}

function routePin(label) {
  return L.divIcon({ className: 'route-pin', html: label, iconSize: [24, 24] });
}

// ---------- Score each route with my own data ----------
// Longitude/latitude to metres on a flat grid around Montreal (accurate to well under 1% across the city)
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos(45.5 * Math.PI / 180);
function toMetres(lng, lat) {
  return [lng * M_PER_DEG_LON, lat * M_PER_DEG_LAT];
}

// Shortest distance from point p to the straight piece a-b, all in metres
function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));   // stay between a and b
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Shortest distance from point p to a line made of many pieces
function distanceToLine(p, line) {
  let shortest = Infinity;
  for (let i = 1; i < line.length; i++) {
    shortest = Math.min(shortest, distanceToSegment(p, line[i - 1], line[i]));
  }
  return shortest;
}

// Prepare every bike lane once: its points in metres, a box around it, its comfort level, whether it is
// open year-round, and its pavement condition (looked up by ID_TRC; null when the survey has no record)
function buildLaneIndex(laneFeatures, pavementFeatures) {
  const pavementById = {};
  pavementFeatures.forEach(function (feature) {
    pavementById[feature.properties.ID_TRC] = feature.properties.pavement_condition;
  });
  const lanes = [];
  laneFeatures.forEach(function (feature) {
    const geometry = feature.geometry;
    const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    parts.forEach(function (coordinates) {
      const line = coordinates.map(function (c) { return toMetres(c[0], c[1]); });
      const xs = line.map(function (p) { return p[0]; });
      const ys = line.map(function (p) { return p[1]; });
      lanes.push({
        line: line,
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
        comfort: comfortLevel(feature.properties.facility_type),
        yearRound: feature.properties.year_round === 'Oui',
        pavement: pavementById[feature.properties.ID_TRC] || null
      });
    });
  });
  return lanes;
}

const CHECK_EVERY = 20;   // metres between check points along a route
const ON_LANE = 15;       // a check point this close to a bike lane counts as on it

// Points every 20 m along a line (in metres), starting at its first point
function checkPoints(line) {
  const points = [];
  let untilNext = 0;   // metres still to go before the next check point
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let along = untilNext;
    while (along <= length) {
      const t = length === 0 ? 0 : along / length;
      points.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      along += CHECK_EVERY;
    }
    untilNext = along - length;
  }
  return points;
}

// What my data says about one route
function scoreRoute(route) {
  const line = route.geometry.coordinates.map(function (c) { return toMetres(c[0], c[1]); });
  const points = checkPoints(line);
  let onSeparated = 0;
  let onPainted = 0;
  let onYearRound = 0;
  let onPoorPavement = 0;
  points.forEach(function (p) {
    let nearest = null;
    let nearestDistance = ON_LANE;
    routeData.lanes.forEach(function (lane) {
      // Quick test first: skip lanes whose box is more than 15 m away
      if (p[0] < lane.minX - ON_LANE || p[0] > lane.maxX + ON_LANE ||
          p[1] < lane.minY - ON_LANE || p[1] > lane.maxY + ON_LANE) {
        return;
      }
      const distance = distanceToLine(p, lane.line);
      if (distance <= nearestDistance) {
        nearest = lane;
        nearestDistance = distance;
      }
    });
    if (nearest && nearest.comfort === 'separated') onSeparated += 1;
    if (nearest && nearest.comfort === 'painted') onPainted += 1;
    if (nearest && nearest.yearRound) onYearRound += 1;
    if (nearest && (nearest.pavement === 'Mauvais' || nearest.pavement === 'Très mauvais')) onPoorPavement += 1;
  });

  const repairStations = routeData.repairStations.filter(function (feature) {
    const c = feature.geometry.coordinates;
    return distanceToLine(toMetres(c[0], c[1]), line) <= 200;
  }).length;

  // Points readers added with memory.js: only problems and construction reports, within 50 m
  const readerPoints = (window.memory && window.memory.points) || [];
  const problems = readerPoints.filter(function (point) {
    return (point.cat === 'problem' || point.cat === 'observation') &&
      distanceToLine(toMetres(point.lng, point.lat), line) <= 50;
  });

  return {
    separatedShare: points.length ? onSeparated / points.length : 0,
    paintedShare: points.length ? onPainted / points.length : 0,
    yearRoundShare: points.length ? onYearRound / points.length : 0,
    poorPavementKm: onPoorPavement * CHECK_EVERY / 1000,
    repairStations: repairStations,
    problems: problems
  };
}

// Draw every route the router found, scored with my data, and let the reader pick one
function showRoutes(start, end, routes) {
  const scored = routeData.lanes.length > 0;   // false if the bike lanes have not loaded yet
  const scores = routes.map(function (route) { return scored ? scoreRoute(route) : null; });
  let fastest = 0;
  let mostSeparated = 0;
  routes.forEach(function (route, i) {
    if (route.duration < routes[fastest].duration) fastest = i;
    if (scored && scores[i].separatedShare > scores[mostSeparated].separatedShare) mostSeparated = i;
  });

  function draw(selected) {
    routeLayer.clearLayers();
    // The other routes: grey and dashed, underneath
    routes.forEach(function (route, i) {
      if (i === selected) return;
      L.geoJSON(route.geometry, {
        pane: 'routePane', interactive: false, style: { color: '#6b7280', weight: 4, opacity: 0.8, dashArray: '6, 6' }
      }).addTo(routeLayer);
    });
    // The chosen route: white casing under a dark line so it stands out from the blue and pink lanes
    L.geoJSON(routes[selected].geometry, {
      pane: 'routePane', interactive: false, style: { color: '#ffffff', weight: 9, opacity: 0.9 }
    }).addTo(routeLayer);
    L.geoJSON(routes[selected].geometry, {
      pane: 'routePane', interactive: false, style: { color: '#111827', weight: 5, opacity: 0.9 }
    }).addTo(routeLayer);
    L.marker(start.latlng, { icon: routePin('A'), title: 'Start: ' + start.name }).addTo(routeLayer);
    L.marker(end.latlng, { icon: routePin('B'), title: 'End: ' + end.name }).addTo(routeLayer);
    showResult(selected);
  }

  function showResult(selected) {
    routeResult.textContent = '';
    const heading = document.createElement('p');
    heading.textContent = 'A: ' + start.name + '. B: ' + end.name + '.';
    routeResult.append(heading);

    routes.forEach(function (route, i) {
      const labels = [];
      if (routes.length > 1 && i === fastest) labels.push('fastest');
      if (routes.length > 1 && scored && i === mostSeparated) labels.push('most separated');
      let text = 'Route ' + (i + 1) + (labels.length ? ' (' + labels.join(', ') + ')' : '') + ': ' +
        (route.distance / 1000).toFixed(1) + ' km, about ' + Math.max(1, Math.round(route.duration / 60)) + ' min';
      if (scored) {
        const s = scores[i];
        text += ', ' + Math.round(100 * s.separatedShare) + '% separated from cars, ' +
          Math.round(100 * s.paintedShare) + '% on painted lanes, ' +
          Math.round(100 * s.yearRoundShare) + '% on lanes open year-round, ' +
          s.poorPavementKm.toFixed(1) + ' km on poor pavement, ' +
          s.repairStations + ' repair station' + (s.repairStations === 1 ? '' : 's') + ' within 200 m';
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-choice';
      button.setAttribute('aria-pressed', String(i === selected));
      button.textContent = text;
      button.addEventListener('click', function () { draw(i); });
      routeResult.append(button);
    });

    const note = document.createElement('p');
    if (!scored) {
      note.textContent = 'The bike-lane data has not loaded yet, so these routes are not scored. Try again in a moment.';
    } else {
      const problems = scores[selected].problems;
      // Notes are typed by readers: show them as text (textContent), never as HTML
      note.textContent = problems.length === 0
        ? 'No problems reported by readers within 50 m of this route.'
        : 'Reported by readers within 50 m of this route: ' +
          problems.map(function (p) { return p.note || '(no note)'; }).join('; ') + '.';
    }
    routeResult.append(note);

    const caveat = document.createElement('p');
    caveat.textContent = (routes.length === 1 ? 'The router found only one route for this trip. ' : '') +
      'The router suggests the routes; my map scores them. Pavement is only known where a bike lane matched the city survey.';
    routeResult.append(caveat);

    // Clear route: removes the lines, pins and results, but keeps the addresses so the reader can change one
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'route-clear';
    clear.textContent = 'Clear route';
    clear.addEventListener('click', function () {
      routeLayer.clearLayers();
      routeResult.textContent = '';
      routeFrom.focus();
    });
    routeResult.append(clear);
  }

  draw(scored ? mostSeparated : fastest);
  map.fitBounds(L.geoJSON(routes.map(function (r) { return r.geometry; })).getBounds().pad(0.1));
}

const routeForm = document.getElementById('route-form');
const routeFrom = document.getElementById('route-from');
const routeTo = document.getElementById('route-to');
const routeResult = document.getElementById('route-result');
const MY_LOCATION = 'My location';

// × buttons in the From and To boxes: show one only when its box has text.
// Pressing it empties the box and removes the planned route, since the route no longer matches.
document.querySelectorAll('.clear-button').forEach(function (button) {
  const input = document.getElementById(button.dataset.clears);
  function showButton() {
    button.hidden = input.value === '';
  }
  input.addEventListener('input', showButton);
  button.addEventListener('click', function () {
    input.value = '';
    showButton();
    routeLayer.clearLayers();
    routeResult.textContent = '';
    input.focus();
  });
});

// On phones the route form is folded up; the "Plan a route" button opens and closes it.
// (On a computer the button is hidden by CSS and the form is always open.)
const routeToggle = document.getElementById('route-toggle');
routeToggle.addEventListener('click', function () {
  const opening = routeToggle.getAttribute('aria-expanded') !== 'true';
  routeToggle.setAttribute('aria-expanded', String(opening));
  routeForm.closest('.tools').classList.toggle('route-open', opening);
  if (opening) {
    routeFrom.focus();
  }
  map.invalidateSize();
});

// Use the reader's location as the start (chosen from the From suggestions)
function useMyLocation() {
  routeFrom.value = MY_LOCATION;
  // Setting the value from code fires no input event, so send one to show (or hide) the × button
  routeFrom.dispatchEvent(new Event('input'));
  routeResult.textContent = 'Finding your location…';
  locateMe()
    .then(function () {
      routeResult.textContent = 'Start set to your location. Now type where you want to go.';
      routeTo.focus();
    })
    .catch(function (err) {
      routeFrom.value = '';
      routeFrom.dispatchEvent(new Event('input'));
      routeResult.textContent = err.message;
    });
}

// ---------- Address suggestions under the From and To boxes ----------
// Suggestions come from Photon, an OpenStreetMap search made for search-as-you-type
// (Nominatim's rules do not allow it). Each suggestion already has its point, so a chosen
// suggestion does not need to be looked up again when the reader presses Plan route.
const chosenPlaces = {};   // the suggestion picked in each box: { text, place }

// The place picked for a box, but only if the box still shows exactly that text
function chosenPlace(input) {
  const chosen = chosenPlaces[input.id];
  return chosen && chosen.text === input.value.trim() ? chosen.place : null;
}

// A readable line from Photon's fields, e.g. "Marché Atwater, Avenue Atwater, Le Sud-Ouest, Montréal"
function photonLabel(p) {
  const street = p.street ? (p.housenumber ? p.housenumber + ' ' + p.street : p.street) : null;
  const parts = [p.name, street, p.district || p.locality, p.city];
  return parts.filter(function (part, i) { return part && parts.indexOf(part) === i; }).join(', ');
}

function searchPhoton(text) {
  // lang=fr: Photon otherwise answers in the browser's language, and the island check below needs the French name
  const url = 'https://photon.komoot.io/api/?limit=5&lang=fr' +
    '&bbox=' + [ISLAND.west, ISLAND.south, ISLAND.east, ISLAND.north].join(',') +
    '&q=' + encodeURIComponent(text);
  return fetch(url)
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Photon answered ' + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      const seen = {};
      return data.features.filter(function (feature) {
        // The search box also reaches Laval and Longueuil: keep places on the island, like the bike network
        return feature.properties.county === 'Agglomération de Montréal';
      }).map(function (feature) {
        const c = feature.geometry.coordinates;
        return { label: photonLabel(feature.properties), latlng: L.latLng(c[1], c[0]) };
      }).filter(function (item) {
        if (!item.label || seen[item.label]) return false;   // skip blank and repeated lines
        seen[item.label] = true;
        return true;
      });
    });
}

// Turn a box into a combobox: a list of suggestions that works with the mouse, touch and keyboard
function addSuggestions(input, offerMyLocation) {
  const list = document.getElementById(input.getAttribute('aria-controls'));
  const extras = offerMyLocation ? [{ label: MY_LOCATION, myLocation: true }] : [];
  let items = [];
  let active = -1;        // which suggestion the arrow keys are on; -1 means none
  let timer = null;
  let requestNumber = 0;  // so a slow, older answer never replaces a newer one

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function show(newItems) {
    items = newItems;
    list.textContent = '';
    items.forEach(function (item, i) {
      const li = document.createElement('li');
      li.id = list.id + '-' + i;
      li.className = 'suggestion' + (item.myLocation ? ' suggestion-location' : '') + (item.note ? ' suggestion-note' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      if (item.note) li.setAttribute('aria-disabled', 'true');
      li.textContent = item.label;   // shown as text, never as HTML
      // mousedown, not click: it runs before the box loses focus, so the list is still there
      li.addEventListener('mousedown', function (event) {
        event.preventDefault();
        if (!item.note) choose(item);
      });
      list.append(li);
    });
    active = -1;
    input.removeAttribute('aria-activedescendant');
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
  }

  function highlight(index) {
    list.querySelectorAll('.suggestion').forEach(function (li, i) {
      li.classList.toggle('active', i === index);
      li.setAttribute('aria-selected', String(i === index));
    });
    active = index;
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', list.id + '-' + index);
      document.getElementById(list.id + '-' + index).scrollIntoView({ block: 'nearest' });
    }
  }

  // Move the highlight up or down, skipping notes that cannot be chosen
  function move(step) {
    let next = active;
    for (let tries = 0; tries < items.length; tries++) {
      next = (next + step + items.length) % items.length;
      if (!items[next].note) {
        highlight(next);
        return;
      }
    }
  }

  function choose(item) {
    close();
    if (item.myLocation) {
      useMyLocation();
      return;
    }
    input.value = item.label;
    chosenPlaces[input.id] = { text: item.label, place: { latlng: item.latlng, name: item.label } };
    input.dispatchEvent(new Event('input'));   // shows the × button (this event is ignored below)
    if (input === routeFrom) routeTo.focus();
  }

  function update() {
    const text = input.value.trim();
    clearTimeout(timer);
    if (text.length < 3) {
      show(extras);   // too short to search: only "My location" (From box), or nothing
      return;
    }
    // Wait until the reader pauses typing for 0.3 s, so Photon gets one request per pause
    timer = setTimeout(function () {
      const mine = ++requestNumber;
      searchPhoton(text)
        .then(function (results) {
          if (mine !== requestNumber || document.activeElement !== input) return;
          show(extras.concat(results));
        })
        .catch(function () {
          if (mine !== requestNumber || document.activeElement !== input) return;
          show(extras.concat([{
            label: 'Suggestions are not available right now. You can still type the full address and press Plan route.',
            note: true
          }]));
        });
    }, 300);
  }

  input.addEventListener('input', function (event) {
    if (!event.isTrusted) return;   // the page changed the text itself (e.g. after a choice): do not search again
    update();
  });
  input.addEventListener('focus', update);
  input.addEventListener('blur', close);

  input.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) {
        update();
      } else {
        move(event.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();   // choose the suggestion instead of planning the route
      choose(items[active]);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
  });
}

addSuggestions(routeFrom, true);
addSuggestions(routeTo, false);

// ⇅ Swap: From and To change places, together with the suggestions picked in them,
// so nothing has to be looked up again. The reader then presses Plan route as usual.
document.getElementById('route-swap').addEventListener('click', function () {
  const fromText = routeFrom.value;
  routeFrom.value = routeTo.value;
  routeTo.value = fromText;
  const fromChosen = chosenPlaces[routeFrom.id];
  chosenPlaces[routeFrom.id] = chosenPlaces[routeTo.id];
  chosenPlaces[routeTo.id] = fromChosen;
  // Setting the text from code fires no input event, so send one to show or hide each × button
  routeFrom.dispatchEvent(new Event('input'));
  routeTo.dispatchEvent(new Event('input'));
});

routeForm.addEventListener('submit', function (event) {
  event.preventDefault();
  const fromText = routeFrom.value.trim();
  const toText = routeTo.value.trim();
  if (fromText === '' || toText === '') {
    routeResult.textContent = 'Type a start and an end address, or choose "My location" in the From box for the start.';
    return;
  }

  const submitButton = routeForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  routeResult.textContent = 'Planning your route…';

  // Each end is "My location" (it can be in either box after a Swap), a picked suggestion
  // (which already has its point), or text that still has to be looked up with Nominatim
  function isMyLocation(text) {
    return text.toLowerCase() === MY_LOCATION.toLowerCase();
  }
  function needsLookup(input, text) {
    return !isMyLocation(text) && !chosenPlace(input);
  }
  function placeFor(input, text) {
    if (isMyLocation(text)) {
      return (myLocation ? Promise.resolve(myLocation) : locateMe()).then(function (latlng) {
        return { latlng: latlng, name: 'your location' };
      });
    }
    return chosenPlace(input) ? Promise.resolve(chosenPlace(input)) : findPlace(text);
  }

  // Nominatim asks for no more than one request per second: wait only if both ends are looked up there
  const wait = needsLookup(routeFrom, fromText) && needsLookup(routeTo, toText) ? 1000 : 0;
  placeFor(routeFrom, fromText)
    .then(function (start) {
      return new Promise(function (resolve) { setTimeout(resolve, wait); })
        .then(function () { return placeFor(routeTo, toText); })
        .then(function (end) { return [start, end]; });
    })
    .then(function ([start, end]) {
      return findBikeRoute(start.latlng, end.latlng).then(function (routes) {
        return [start, end, routes];
      });
    })
    .then(function ([start, end, routes]) {
      showRoutes(start, end, routes);
    })
    .catch(function (err) {
      routeResult.textContent = err.message;
    })
    .finally(function () {
      submitButton.disabled = false;
    });
});

const pavementColours = {
  'Excellent': '#ffffd4',
  'Bon': '#fed98e',
  'Moyen': '#fe9929',
  'Mauvais': '#d95f0e',
  'Très mauvais': '#993404'
};
const pavementConditionNames = {
  'Excellent': 'Excellent',
  'Bon': 'Good',
  'Moyen': 'Fair',
  'Mauvais': 'Poor',
  'Très mauvais': 'Very poor'
};

function colourForPavement(condition) {
  return pavementColours[condition] || '#888888';
}

// Lengths in plain words: "326 m" under 1 km, "2.4 km" from 1 km up
function formatLength(metres) {
  if (!metres) return 'not recorded';
  return metres < 1000 ? Math.round(metres) + ' m' : (metres / 1000).toFixed(1) + ' km';
}

// A white wrench (the "tool" icon from Feather Icons, MIT licence), for repair stations and their legend
const WRENCH_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" ' +
  'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91' +
  'a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
function loadGeoJSON(path) {
  return fetch(path).then(function (response) {
    if (!response.ok) {
      throw new Error('Could not load ' + path + ': HTTP ' + response.status);
    }
    return response.json();
  });
}

Promise.all([
  loadGeoJSON('../data/bike_lanes_clean_english.geojson'),
  loadGeoJSON('../data/bike_lanes_with_pavement.geojson'),
  // Repair stations are optional: if they fail, return null so the bike lanes still load
  loadGeoJSON('../data/repair_stations.geojson').catch(function (err) {
    console.error(err);
    return null;
  })
])
  .then(function ([data, pavementData, repairData]) {
    loadingBox.remove();   // the data is here: take the loading message off the map

    // Give the route planner my bike lanes, pavement and repair stations for scoring
    routeData.lanes = buildLaneIndex(data.features, pavementData.features);
    routeData.repairStations = repairData ? repairData.features : [];

    const facilityTypeNames = {
      'Bande cyclable': 'Bike lane',
      'Chaussée désignée': 'Designated roadway',
      'Piste cyclable au niveau du trottoir': 'Sidewalk-level bike path',
      'Piste cyclable en site propre': 'Dedicated bike path',
      'Piste cyclable sur rue': 'On-street bike lane',
      'Sentier polyvalent': 'Multi-use trail',
      'Vélorue': 'Bicycle street',
      'Voie partagée Bus-Vélo': 'Shared bus-bike lane'
    };

    function addLanePopup(feature, layer) {
      const p = feature.properties;
      const yesNoNames = {
        'Oui': 'Yes',
        'Non': 'No'
      };
      layer.bindPopup(
        '<strong>' + (facilityTypeNames[p.facility_type] || p.facility_type || 'Bike lane') + '</strong><br>' +
        'Area: ' + (p.area || 'not recorded') + '<br>' +
        'Comfort: ' + COMFORT[comfortLevel(p.facility_type)].label +
        (p.facility_type === 'Sentier polyvalent' ? ' (shared with people walking)' : '') + '<br>' +
        'Year-round: ' + (yesNoNames[p.year_round] || p.year_round || 'unknown') + '<br>' +
        'Length: ' + formatLength(p.length_m)
      );

      // Thicken the line on hover, then put it back to its normal width
      const normalWeight = layer.options.weight;
      layer.on('mouseover', function () {
        layer.setStyle({ weight: normalWeight + 8 });
      });
      layer.on('mouseout', function () {
        layer.setStyle({ weight: normalWeight });
      });
    }

    // One layer per comfort level. Its filter also hides seasonal lanes while "Year-round routes only" is ticked.
    let yearRoundOnly = false;
    function showsLane(feature, level) {
      return comfortLevel(feature.properties.facility_type) === level &&
        (!yearRoundOnly || feature.properties.year_round === 'Oui');
    }
    function makeLaneLayer(level) {
      const c = COMFORT[level];
      return L.geoJSON(data, {
        filter: function (feature) { return showsLane(feature, level); },
        style: { color: c.color, weight: c.weight, opacity: 0.9, dashArray: c.dashArray },
        onEachFeature: addLanePopup
      });
    }
    // Separated and painted lanes show at the start; shared streets are off to keep the map calm
    const laneLayers = {
      separated: makeLaneLayer('separated').addTo(map),
      painted: makeLaneLayer('painted').addTo(map),
      shared: makeLaneLayer('shared')
    };
    const pavementLayer = L.geoJSON(pavementData, {
      style: function (feature) {
        return {
          color: colourForPavement(feature.properties.pavement_condition),
          weight: 5,
          opacity: 0.9
        };
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;
        layer.bindPopup(
          '<strong>Street pavement condition: ' + (pavementConditionNames[p.pavement_condition] || p.pavement_condition || 'not recorded') + '</strong><br>' +
          'Pavement score: ' + (p.pavement_pci != null ? Math.round(p.pavement_pci) + ' out of 100 (higher is better)' : 'not recorded') + '<br>' +
          'Surveyed: ' + (p.survey_date || 'not recorded')
        );
      }
    });

    // OpenStreetMap tags use 'yes'/'no'; missing tags mean nobody recorded it
    function yesNo(value) {
      return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'not recorded';
    }

    // Most stations have no name in OpenStreetMap, so number them for the popup and the saved list
    let stationNumber = 0;
    const repairLayer = L.geoJSON(repairData, {
      // Each station is a white wrench on a green circle (an HTML icon), so it reads as "repair" without the legend
      pointToLayer: function (feature, latlng) {
        return L.marker(latlng, {
          icon: L.divIcon({ className: 'repair-icon', html: WRENCH_SVG, iconSize: [24, 24] }),
          title: 'Bike repair station'
        });
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;
        stationNumber += 1;
        p.label = 'Repair station ' + stationNumber + (p.operator ? ' (' + p.operator + ')' : '');
        layer.bindPopup(
          '<strong>' + p.label + '</strong><br>' +
          'Air pump: ' + yesNo(p['service:bicycle:pump']) + '<br>' +
          'Tools: ' + yesNo(p['service:bicycle:tools']) + '<br>' +
          'Hours: ' + (p.opening_hours || 'not recorded') + '<br>' +
          'Operator: ' + (p.operator || 'not recorded')
        );
      }
    });

    // Readers can save repair stations; the list stays in their own browser (remember.js)
    if (repairData) {
      rememberMarks(map, repairLayer, { idField: '@id', nameField: 'label', title: 'My repair stations' });
    }

    const overlays = {
      '<span class="layer-swatch separated"></span>Separated from cars': laneLayers.separated,
      '<span class="layer-swatch painted"></span>Painted lanes': laneLayers.painted,
      '<span class="layer-swatch shared"></span>Shared with traffic': laneLayers.shared,
      '<span class="layer-swatch pavement"></span>Pavement condition (matched streets)': pavementLayer
    };
    if (repairData) {
      overlays['<span class="layer-swatch repair">' + WRENCH_SVG + '</span>Bike repair stations'] = repairLayer;
    }
    // Collapse the layer list into an icon on phones so it doesn't cover the map
    const layerControl = L.control.layers(null, overlays, { collapsed: isPhone }).addTo(map);

    // "Year-round routes only" sits at the bottom of the layer box, so it adds no new box to the map
    const layerList = layerControl.getContainer().querySelector('.leaflet-control-layers-list');
    L.DomUtil.create('div', 'leaflet-control-layers-separator', layerList);
    const yearRoundLabel = L.DomUtil.create('label', 'year-round-filter', layerList);
    const yearRoundInput = L.DomUtil.create('input', '', yearRoundLabel);
    yearRoundInput.type = 'checkbox';
    yearRoundLabel.append(' Year-round routes only');

    yearRoundInput.addEventListener('change', function () {
      yearRoundOnly = yearRoundInput.checked;
      // Empty each layer and fill it again: addData runs the filter, which now reads yearRoundOnly
      Object.values(laneLayers).forEach(function (layer) {
        layer.clearLayers();
        layer.addData(data);
      });
      showStatus();
      // An open neighbourhood search follows the checkbox too
      if (document.getElementById('search-input').value.trim() !== '') {
        document.getElementById('search-form').requestSubmit();
      }
    });

    // On phones the legend goes bottom-left so it doesn't stack on top of the zoom buttons
    const legend = L.control({ position: isPhone ? 'bottomleft' : 'bottomright' });
    legend.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend');
      const conditions = [
        ['Excellent', 'Excellent'],
        ['Bon', 'Good'],
        ['Moyen', 'Fair'],
        ['Mauvais', 'Poor'],
        ['Très mauvais', 'Very poor']
      ];

      div.innerHTML =
        '<strong>Pavement condition</strong>' +
        '<span class="legend-note"><br>Colours show pavement condition categories; click on a segment to see its pavement score out of 100.</span>' +
        conditions.map(function ([value, label]) {
          return '<span class="legend-item"><i style="background:' + colourForPavement(value) + '"></i>' + label + '</span>';
        }).join('');

      return div;
    };
    map.on('overlayadd', function (event) {
      if (event.layer === pavementLayer) {
        legend.addTo(map);
      }
    });

    map.on('overlayremove', function (event) {
      if (event.layer === pavementLayer) {
        map.removeControl(legend);
      }
    });

    // If you want to fit the map to the bounds of all bike lanes!!!:
    //const allBikeLanes = L.featureGroup(Object.values(laneLayers));
    //const bounds = allBikeLanes.getBounds();
    //if (bounds.isValid()) {
      //#map.fitBounds(bounds.pad(0.05)); 
   // }

    // Status line (Data sources tab): how many segments each comfort layer holds right now
    function showStatus() {
      const status = document.getElementById('status');
      if (!status) return;
      function count(level) { return laneLayers[level].getLayers().length; }
      const total = count('separated') + count('painted') + count('shared');
      status.textContent =
        total.toLocaleString('en-CA') + ' bike-lane segments' + (yearRoundOnly ? ' open year-round' : '') + ': ' +
        count('separated').toLocaleString('en-CA') + ' separated from cars, ' +
        count('painted').toLocaleString('en-CA') + ' painted lanes, ' +
        count('shared').toLocaleString('en-CA') + ' shared with traffic.' +
        (repairData ? '' : ' Bike repair stations could not be loaded.');
    }
    showStatus();

    // Search: lower-case, drop accents and apostrophes, and treat hyphens, dashes and spaces the same,
    // so "montreal nord", "montreal-nord" and "Montréal–Nord" all match
    function normalise(text) {
      return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '')
        .replace(/[-–—\s]+/g, ' ').toLowerCase().trim();
    }

    // "Show pavement": a button under Reset view that turns the pavement layer on and off.
    // Adding or removing the layer from code also makes the layer box fire overlayadd / overlayremove,
    // so the layer box checkbox, the pavement legend and this button always agree.
    const PavementButton = L.Control.extend({
      onAdd: function () {
        const button = L.DomUtil.create('button', 'pavement-toggle');
        button.type = 'button';
        L.DomEvent.disableClickPropagation(button);
        button.addEventListener('click', function () {
          if (map.hasLayer(pavementLayer)) {
            map.removeLayer(pavementLayer);
          } else {
            pavementLayer.addTo(map);
          }
        });
        return button;
      }
    });
    const pavementButton = new PavementButton({ position: 'topleft' }).addTo(map).getContainer();
    function showPavementButton() {
      const on = map.hasLayer(pavementLayer);
      pavementButton.textContent = on ? 'Hide pavement' : 'Show pavement';
      pavementButton.setAttribute('aria-pressed', String(on));   // tells screen readers whether it is on
    }
    showPavementButton();
    map.on('overlayadd overlayremove', function (event) {
      if (event.layer === pavementLayer) showPavementButton();
    });

    // Move the search form from the page onto the map, in the top-left corner.
    // On phones there's no room on the map, so put it just above the map instead.
    if (isPhone) {
      const mapElement = document.getElementById('map');
      mapElement.parentNode.insertBefore(document.getElementById('search-form'), mapElement);
    } else {
      const searchControl = L.control({ position: 'topleft' });
      searchControl.onAdd = function () {
        const form = document.getElementById('search-form');
        L.DomEvent.disableClickPropagation(form);
        L.DomEvent.disableScrollPropagation(form);
        return form;
      };
      searchControl.addTo(map);
    }

    const searchResult = document.getElementById('search-result');

    document.getElementById('search-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const typed = document.getElementById('search-input').value;
      const query = normalise(typed);
      const matches = laneLayers.separated.getLayers().filter(function (layer) {
        return query && normalise(layer.feature.properties.area).includes(query);
      });

      if (query === '') {
        searchResult.textContent = 'Type a neighbourhood name, e.g. Verdun.';
        return;
      }

      // A partial name like "la" can match several boroughs: list them instead of a mixed count
      const areas = [...new Set(matches.map(function (layer) {
        return layer.feature.properties.area;
      }))];
      if (areas.length > 1) {
        searchResult.textContent = '"' + typed + '" matches ' + areas.length +
          ' neighbourhoods: ' + areas.join(', ') + '. Type more of the name.';
        return;
      }

      if (matches.length === 0) {
        searchResult.textContent = 'No routes separated from cars' + (yearRoundOnly ? ' and open year-round' : '') +
          ' found for "' + typed + '".';
        return;
      }
      if (!map.hasLayer(laneLayers.separated)) {
        laneLayers.separated.addTo(map);
      }
      map.fitBounds(L.featureGroup(matches).getBounds().pad(0.05));

      // Pavement summary: of this neighbourhood's separated segments that have a survey record,
      // how many are in good or excellent condition. Segments with no record are left out, not counted as bad.
      const area = matches[0].feature.properties.area;
      const surveyed = pavementData.features.filter(function (feature) {
        return showsLane(feature, 'separated') && feature.properties.area === area;
      });
      const good = surveyed.filter(function (feature) {
        const condition = feature.properties.pavement_condition;
        return condition === 'Excellent' || condition === 'Bon';
      }).length;

      let summary = matches.length + ' segments separated from cars' + (yearRoundOnly ? ' and open year-round' : '') +
        ' in ' + area + '. ';
      if (surveyed.length === 0) {
        summary += 'None have a pavement survey record.';
      } else {
        summary += surveyed.length + ' have a pavement survey record; ' + good + ' of those (' +
          Math.round(100 * good / surveyed.length) + '%) are in good or excellent condition.';
      }
      searchResult.textContent = summary;
    });
    document.getElementById('search-input').addEventListener('input', function (event) {
      if (event.target.value === '') {
        map.setView([45.51, -73.57], 11);
        searchResult.textContent = '';
      }
    });
  })
  .catch(function (err) {
    loadingBox.remove();   // loading failed: the error message below takes its place
    const message = 'The bike-lane data could not be loaded. Check your internet connection and reload the page.';
    const status = document.getElementById('status');
    if (status) {
      status.textContent = message;
    }

    // Show the same message on the map, where the reader is looking
    const errorBox = L.control({ position: 'topleft' });
    errorBox.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend map-error');
      div.setAttribute('role', 'alert');
      div.textContent = message;
      return div;
    };
    errorBox.addTo(map);

    // The search cannot work without the data, so hide it
    document.getElementById('search-form').hidden = true;
    console.error(err);
  });
