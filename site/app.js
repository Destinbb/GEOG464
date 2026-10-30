const map = L.map('map', { preferCanvas: true }).setView([45.51, -73.57], 11);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const colours = {
  Yes: '#05045d',
  No: '#eb0d0d'
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
  loadGeoJSON('../data/bike_lanes_with_pavement.geojson')
])
  .then(function ([data, pavementData]) {
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

    L.control.layers(null, {
      '<span class="layer-swatch protected"></span>Protected lanes': protectedLayer,
      '<span class="layer-swatch other"></span>Not identified as protected': otherLayer,
      '<span class="layer-swatch pavement"></span>Pavement condition (matched streets)': pavementLayer
    }, { collapsed: false }).addTo(map);

    const legend = L.control({ position: 'bottomright' });
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
        '<strong>Pavement condition. Colours show pavement condition categories; click on a segment to see its PCI score.</strong><br>' +
        conditions.map(function ([value, label]) {
          return '<i style="background:' + colourForPavement(value) + '"></i>' + label;
        }).join('<br>');

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
        protectedCount + ' protected, ' + otherCount + ' other';
    }
  })
  .catch(function (err) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = 'Could not load bike-lane data. Open the console (F12) for details.';
    }
    console.error(err);
  });
