// Free OpenStreetMap services: Nominatim for addresses, OSRM for drive times.
const USER_AGENT = 'DekaiahDash/1.0 (' + (process.env.DRIVER_EMAIL || 'self-hosted') + ')';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';

// Nominatim asks for at most 1 request per second, so requests wait their turn.
let lastNominatim = 0;
async function nominatim(path) {
  const wait = lastNominatim + 1000 - Date.now();
  lastNominatim = Date.now() + Math.max(wait, 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(NOMINATIM + path, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error('Address search failed');
  return res.json();
}

function shortAddress(place) {
  const a = place.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const town = a.city || a.town || a.village || a.suburb || a.county || '';
  const name = place.name && place.name !== a.road ? place.name : '';
  const parts = [name, street, town].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : place.display_name;
}

async function search(q, near) {
  let path = `/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;
  if (near) {
    const d = 0.5; // prefer results within about 50 km
    path += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
  }
  const results = await nominatim(path);
  return results.map((p) => ({ address: shortAddress(p), detail: p.display_name, lat: Number(p.lat), lng: Number(p.lon) }));
}

async function reverse(lat, lng) {
  const p = await nominatim(`/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`);
  if (!p || p.error) return { address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng };
  return { address: shortAddress(p), lat, lng };
}

// Drive time in seconds from one point to another, or null if it couldn't be worked out.
async function driveSeconds(from, to) {
  try {
    const res = await fetch(`${OSRM}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    const data = await res.json();
    return data.routes && data.routes[0] ? Math.round(data.routes[0].duration) : null;
  } catch {
    return null;
  }
}

// Straight-line distance in metres.
function metresBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { search, reverse, driveSeconds, metresBetween };
