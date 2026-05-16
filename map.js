import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

const BLUEBIKES_STATIONS_JSON =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const BLUEBIKES_TRAFFIC_CSV =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
const CAMBRIDGE_BIKE_GEOJSON =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';

mapboxgl.accessToken =
  'pk.eyJ1IjoidmlwcmFiIiwiYSI6ImNtcDd3NmhtYTAyNzEydHB6Y3k2ODYwaHoifQ.ZgLf0aCtCJ0G7aFPrgQcTw';

const bikeLanePaint = {
  'line-color': '#32D400',
  'line-width': 5,
  'line-opacity': 0.6,
};

let timeFilter = -1;

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stations = [];

let svg;
let circles;
let radiusScale;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/viprab/cmp7ykiyt007801sh2ebm7sr0',
  center: [-71.09415, 42.36027],
  zoom: 11,
  minZoom: 5,
  maxZoom: 18,
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  }
  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function computeStationTraffic(stationsInput, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stationsInput.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function updatePositions() {
  circles?.attr('cx', (d) => getCoords(d).cx).attr('cy', (d) => getCoords(d).cy);
}

function updateScatterPlot(tf) {
  tf === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

  const filteredStations = computeStationTraffic(stations, tf);

  circles = svg
    .selectAll('circle')
    .data(filteredStations, (d) => d.short_name)
    .join('circle')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('fill-opacity', 0.6)
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5),
    )
    .each(function (d) {
      d3.select(this).selectAll('title').remove();
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  updatePositions();
}

map.on('load', async () => {
  svg = d3.select('#map').append('svg');

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: CAMBRIDGE_BIKE_GEOJSON,
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  let jsonData;
  try {
    jsonData = await d3.json(BLUEBIKES_STATIONS_JSON);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  stations = jsonData.data.stations;
  console.log('Stations Array:', stations);

  let trips;
  try {
    trips = await d3.csv(BLUEBIKES_TRAFFIC_CSV, (trip) => {
      trip.startedMinutes =
        +trip.started_at.slice(11, 13) * 60 + +trip.started_at.slice(14, 16);
      trip.endedMinutes =
        +trip.ended_at.slice(11, 13) * 60 + +trip.ended_at.slice(14, 16);
      return trip;
    });
  } catch (error) {
    console.error('Error loading trips CSV:', error);
    return;
  }

  departuresByMinute = Array.from({ length: 1440 }, () => []);
  arrivalsByMinute = Array.from({ length: 1440 }, () => []);

  for (const trip of trips) {
    departuresByMinute[trip.startedMinutes].push(trip);
    arrivalsByMinute[trip.endedMinutes].push(trip);
  }

  stations = computeStationTraffic(stations, -1);

  radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic) || 1])
    .range([0, 25]);

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.querySelector('#time-slider');
  const selectedTime = document.querySelector('#selected-time');
  const anyTimeLabel = document.querySelector('#any-time');

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
