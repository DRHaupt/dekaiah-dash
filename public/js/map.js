// The big map behind everything. Uses free OpenStreetMap tiles through Leaflet.
import { icons } from './ui.js';

let map;
const markers = {}; // pickup, dropoff, car, me

const ICONS = {
  pickup: () => L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  dropoff: () => L.divIcon({ className: '', html: '<div class="pin drop"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  me: () => L.divIcon({ className: '', html: '<div class="pin me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  car: () => L.divIcon({ className: '', html: `<div class="car-pin">${icons.car}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
};

let routeLine;

export function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([20, 0], 2);
  map.attributionControl.setPrefix(false);
  // Free OpenStreetMap tiles, no key needed. Dark mode darkens these same tiles with CSS (see app.css).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

// Draws the driving route as a line. line is a list of [lat, lng], or null to remove it.
export function setRoute(line) {
  if (routeLine) { routeLine.remove(); routeLine = null; }
  if (line && line.length > 1) {
    routeLine = L.polyline(line, { className: 'route-line', weight: 5, opacity: 0.85, interactive: false }).addTo(map);
  }
}

// Gets the road between two points from the server (null if it can't). Remembers recent answers.
const routeCache = new Map();
export async function fetchRoute(api, from, to) {
  const key = `${from.lat},${from.lng};${to.lat},${to.lng}`;
  if (!routeCache.has(key)) {
    try {
      const r = await api('GET', `/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`);
      routeCache.set(key, r.line);
    } catch {
      return null;
    }
  }
  return routeCache.get(key);
}

// Puts a marker at {lat, lng}, or removes it when point is null.
export function setMarker(name, point) {
  if (!point || point.lat == null) {
    if (markers[name]) { markers[name].remove(); delete markers[name]; }
    return;
  }
  const latlng = [point.lat, point.lng];
  if (markers[name]) markers[name].setLatLng(latlng);
  else markers[name] = L.marker(latlng, { icon: ICONS[name](), keyboard: false, zIndexOffset: name === 'car' ? 1000 : 0 }).addTo(map);
}

export function clearMarkers(except = []) {
  for (const name of Object.keys(markers)) if (!except.includes(name)) setMarker(name, null);
  if (!except.includes('route')) setRoute(null);
}

// Zooms the map to show every point given, leaving room for the bottom sheet.
export function fit(points) {
  const valid = points.filter((p) => p && p.lat != null);
  if (!valid.length) return;
  const sheetH = Math.min(document.getElementById('sheet').offsetHeight || 0, window.innerHeight * 0.62);
  const wide = window.innerWidth >= 700;
  const padding = {
    paddingTopLeft: [wide ? 440 : 40, 80],
    paddingBottomRight: [40, wide ? 40 : sheetH + 40],
    maxZoom: 16,
  };
  if (valid.length === 1) {
    map.setView([valid[0].lat, valid[0].lng], 15);
    if (!wide && sheetH) map.panBy([0, sheetH / 2], { animate: false });
  } else {
    map.fitBounds(L.latLngBounds(valid.map((p) => [p.lat, p.lng])), padding);
  }
}

// Gets the phone's current location once. Resolves to {lat, lng} or rejects with a friendly message.
export function currentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === 1
        ? 'Location is turned off for this app. Turn it on in your phone settings.'
        : "Couldn't find your location. Try again.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

export function directionsLinks(dest) {
  const ll = `${dest.lat},${dest.lng}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
  };
}
