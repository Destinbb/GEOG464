const map = L.map('map', { preferCanvas: true }).setView([45.51, -73.57], 11);
map.zoomControl.setPosition('bottomright');

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
map.attributionControl.addAttribution(
  'Routing: <a href="https://routing.openstreetmap.de/about.html">FOSSGIS OSRM</a>, ' +
  'addresses: <a href="https://nominatim.org">Nominatim</a>'
);

const isPhone = window.innerWidth <= 800;

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

// ---------- Locate me ----------
// A rough box around the island of Montreal, used to keep address results on the island
const ISLAND = { west: -73.98, south: 45.40, east: -73.47, north: 45.71 };
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

// The Locate me button sits in the tools row at the top of the page
const locateButton = document.getElementById('locate-button');
const locateMessage = document.querySelector('.locate-message');

locateButton.addEventListener('click', function () {
  locateButton.disabled = true;
  locateButton.textContent = 'Locating…';
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
      locateButton.textContent = 'Locate me';
    });
});

// ---------- Plan a route from A to B ----------
// Route line sits in its own pane, above the bike-lane layers, so toggling layers never hides it
map.createPane('routePane').style.zIndex = 450;
const routeLayer = L.layerGroup().addTo(map);

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
    '?overview=full&geometries=geojson';
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
      return result.routes[0];
    });
}

function routePin(label) {
  return L.divIcon({ className: 'route-pin', html: label, iconSize: [24, 24] });
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

document.getElementById('route-use-location').addEventListener('click', function () {
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
});

routeForm.addEventListener('submit', function (event) {
  event.preventDefault();
  const fromText = routeFrom.value.trim();
  const toText = routeTo.value.trim();
  if (fromText === '' || toText === '') {
    routeResult.textContent = 'Type a start and an end address, or press "My location" for the start.';
    return;
  }

  const submitButton = routeForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  routeResult.textContent = 'Planning your route…';

  const startPlace = fromText.toLowerCase() === MY_LOCATION.toLowerCase()
    ? (myLocation ? Promise.resolve(myLocation) : locateMe()).then(function (latlng) {
      return { latlng: latlng, name: 'your location' };
    })
    : findPlace(fromText);

  // Nominatim asks for no more than one request per second, so look up the end after the start
  startPlace
    .then(function (start) {
      return new Promise(function (resolve) { setTimeout(resolve, 1000); })
        .then(function () { return findPlace(toText); })
        .then(function (end) { return [start, end]; });
    })
    .then(function ([start, end]) {
      return findBikeRoute(start.latlng, end.latlng).then(function (route) {
        return [start, end, route];
      });
    })
    .then(function ([start, end, route]) {
      routeLayer.clearLayers();
      // White casing under a dark line so the route stands out from the blue and pink lanes
      L.geoJSON(route.geometry, {
        pane: 'routePane', interactive: false, style: { color: '#ffffff', weight: 9, opacity: 0.9 }
      }).addTo(routeLayer);
      const line = L.geoJSON(route.geometry, {
        pane: 'routePane', interactive: false, style: { color: '#111827', weight: 5, opacity: 0.9 }
      }).addTo(routeLayer);
      L.marker(start.latlng, { icon: routePin('A'), title: 'Start: ' + start.name }).addTo(routeLayer);
      L.marker(end.latlng, { icon: routePin('B'), title: 'End: ' + end.name }).addTo(routeLayer);
      map.fitBounds(line.getBounds().pad(0.1));

      const km = (route.distance / 1000).toFixed(1);
      const minutes = Math.max(1, Math.round(route.duration / 60));
      routeResult.textContent =
        'A: ' + start.name + '. B: ' + end.name + '. ' +
        km + ' km, about ' + minutes + ' min by bike (black line). ' +
        'The route prefers bike paths but does not pick protected lanes on purpose: blue lines along it are protected.';
    })
    .catch(function (err) {
      routeResult.textContent = err.message;
    })
    .finally(function () {
      submitButton.disabled = false;
    });
});

const colours = {
  Yes: '#2166ac',
  No: '#d01c8b',
  Repair: '#1b7837'
};
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
    const protectedCount = data.features.filter(function (feature) {
      return feature.properties.protected === 'Oui';
    }).length;

    const otherCount = data.features.length - protectedCount;
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
        'Protected: ' + (yesNoNames[p.protected] || p.protected || 'unknown') + '<br>' +
        'Year-round: ' + (yesNoNames[p.year_round] || p.year_round || 'unknown') + '<br>' +
        'Length: ' + (p.length_m || 0) + ' m'
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

    const protectedLayer = L.geoJSON(data, {
      filter: function (feature) {
        return feature.properties.protected === 'Oui';
      },
      style: {
        color: colours.Yes,
        weight: 4,
        opacity: 0.9
        

      },
      onEachFeature: addLanePopup
    }).addTo(map);

    const otherLayer = L.geoJSON(data, {
      filter: function (feature) {
        return feature.properties.protected !== 'Oui';
      },
      style: {
        color: colours.No,
        weight: 3,
        opacity: 0.7,
        dashArray: '8, 6'
      },
      onEachFeature: addLanePopup
    });
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
          'PCI score: ' + (p.pavement_pci ?? 'not recorded') + '<br>' +
          'Survey date: ' + (p.survey_date || 'not recorded')
        );
      }
    });

    // OpenStreetMap tags use 'yes'/'no'; missing tags mean nobody recorded it
    function yesNo(value) {
      return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'not recorded';
    }

    const repairLayer = L.geoJSON(repairData, {
      pointToLayer: function (feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 6,
          color: '#ffffff',
          weight: 2,
          fillColor: colours.Repair,
          fillOpacity: 1
        });
      },
      onEachFeature: function (feature, layer) {
        const p = feature.properties;
        layer.bindPopup(
          '<strong>Bike repair station</strong><br>' +
          'Air pump: ' + yesNo(p['service:bicycle:pump']) + '<br>' +
          'Tools: ' + yesNo(p['service:bicycle:tools']) + '<br>' +
          'Hours: ' + (p.opening_hours || 'not recorded') + '<br>' +
          'Operator: ' + (p.operator || 'not recorded')
        );
      }
    });

    const overlays = {
      '<span class="layer-swatch protected"></span>Protected lanes': protectedLayer,
      '<span class="layer-swatch other"></span>Not identified as protected': otherLayer,
      '<span class="layer-swatch pavement"></span>Pavement condition (matched streets)': pavementLayer
    };
    if (repairData) {
      overlays['<span class="layer-swatch repair"></span>Bike repair stations'] = repairLayer;
    }
    // Collapse the layer list into an icon on phones so it doesn't cover the map
    L.control.layers(null, overlays, { collapsed: isPhone }).addTo(map);

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
        '<span class="legend-note"><br>Colours show pavement condition categories; click on a segment to see its PCI score.</span>' +
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
    //const allBikeLanes = L.featureGroup([protectedLayer, otherLayer]);
    //const bounds = allBikeLanes.getBounds();
    //if (bounds.isValid()) {
      //#map.fitBounds(bounds.pad(0.05)); 
   // }

    const status = document.getElementById('status');
    if (status) {
      status.textContent =
        data.features.length + ' bike-lane segments shown: ' +
        protectedCount + ' protected, ' + otherCount + ' other.' +
        (repairData ? '' : ' Bike repair stations could not be loaded.');
    }

    // Search: lower-case, drop accents and apostrophes, and treat hyphens, dashes and spaces the same,
    // so "montreal nord", "montreal-nord" and "Montréal–Nord" all match
    function normalise(text) {
      return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '')
        .replace(/[-–—\s]+/g, ' ').toLowerCase().trim();
    }

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
      const matches = protectedLayer.getLayers().filter(function (layer) {
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
        searchResult.textContent = 'No protected routes found for "' + typed + '".';
        return;
      }
      if (!map.hasLayer(protectedLayer)) {
        protectedLayer.addTo(map);
      }
      map.fitBounds(L.featureGroup(matches).getBounds().pad(0.05));

      // Pavement summary: of this neighbourhood's protected segments that have a survey record,
      // how many are in good or excellent condition. Segments with no record are left out, not counted as bad.
      const area = matches[0].feature.properties.area;
      const surveyed = pavementData.features.filter(function (feature) {
        return feature.properties.protected === 'Oui' && feature.properties.area === area;
      });
      const good = surveyed.filter(function (feature) {
        const condition = feature.properties.pavement_condition;
        return condition === 'Excellent' || condition === 'Bon';
      }).length;

      let summary = matches.length + ' protected segments in ' + area + '. ';
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
