// The "Share my ride" page. Anyone with the link can watch the ride; no account needed.
import { esc, sheet, minutes, formatWhen, statusBar, STATUS_LABEL } from './ui.js';
import { initMap, setMarker, setRoute, fit } from './map.js';

const token = location.pathname.split('/').pop();
let fitted = '';

function headline(t) {
  const d = esc(t.driver), r = esc(t.rider);
  switch (t.status) {
    case 'requested': return `Waiting for ${d} to accept ${r}'s ride`;
    case 'accepted': return `${d} accepted ${r}'s ride`;
    case 'on_the_way': return `${d} is on the way to pick up ${r}`;
    case 'arrived': return `${d} is at the pickup`;
    case 'in_progress': return `${r} is on the way`;
    default: return STATUS_LABEL[t.status] || '';
  }
}

function show(t) {
  if (t.over) {
    setMarker('car', null); setMarker('pickup', null); setMarker('dropoff', null); setRoute(null);
    sheet(`<div class="stack"><h2>${t.status === 'done' ? 'This ride is over' : 'This ride was cancelled'}</h2>
      <p class="muted">${t.status === 'done' ? 'They made it.' : 'Nothing more to see here.'}</p></div>`);
    return false;
  }

  setMarker('pickup', t.pickup);
  setMarker('dropoff', t.dropoff);
  setMarker('car', t.car_position);
  setRoute(t.route);

  sheet(`<div>
    ${statusBar(t.status)}
    <div class="small muted" style="margin-bottom:4px">${esc(STATUS_LABEL[t.status])}</div>
    <div class="row"><h2 class="grow">${headline(t)}</h2>${t.eta_seconds != null ? `<div class="eta">${minutes(t.eta_seconds)}</div>` : ''}</div>
    ${t.scheduled_for && ['requested', 'accepted'].includes(t.status) ? `<p class="muted" style="margin-top:4px">Pickup ${esc(formatWhen(t.scheduled_for))}</p>` : ''}
    ${t.car ? `<p style="margin-top:12px">${esc(t.car)} ${t.plate ? `<span class="plate">${esc(t.plate)}</span>` : ''}</p>` : ''}
    <div class="route" style="margin-top:16px">
      <div><div class="small muted">Pickup</div><div>${esc(t.pickup.address)}</div></div>
      <div class="drop"><div class="small muted">Drop-off</div><div>${esc(t.dropoff.address)}</div></div>
    </div>
    <p class="small muted" style="margin-top:12px">${esc(t.rider)} shared this with you. It updates by itself.</p>
  </div>`);

  // Zoom to the right area once per stage of the ride, so people can still move the map around.
  if (fitted !== t.status) {
    fitted = t.status;
    const target = t.status === 'in_progress' ? t.dropoff : t.pickup;
    fit(t.car_position && t.status !== 'arrived' ? [t.car_position, target] : [t.pickup, t.dropoff]);
  }
  return true;
}

async function poll() {
  let keepGoing = true;
  try {
    const res = await fetch('/api/track/' + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok) {
      sheet(`<div class="stack"><h2>Link not working</h2><p class="muted">${esc(data.error || '')}</p></div>`);
      keepGoing = false;
    } else {
      keepGoing = show(data);
    }
  } catch {
    // Lost connection for a moment; try again next time.
  }
  if (keepGoing) setTimeout(poll, document.hidden ? 15000 : 5000);
}

initMap();
poll();
