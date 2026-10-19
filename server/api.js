const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const db = require('./db');
const live = require('./live');
const notify = require('./notify');
const maps = require('./maps');
const { loadUser, approvedOnly, driverOnly, isDriverLogin } = require('./auth');

const router = express.Router();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');

const OPEN = ['requested', 'accepted', 'on_the_way', 'arrived', 'in_progress'];
const MOVING = ['on_the_way', 'arrived', 'in_progress'];
const PLACE_LABELS = ['Home', 'Work', 'School'];

// Wraps async route handlers so errors become a normal error reply.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

class Oops extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function when(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: process.env.TIMEZONE || undefined,
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function minutes(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  return m === 1 ? '1 min' : `${m} min`;
}

const getDriver = () => db.one("SELECT * FROM users WHERE role = 'driver' ORDER BY id LIMIT 1");
const firstName = (name) => String(name || '').split(' ')[0];

async function driverInfo() {
  const [driver, state] = await Promise.all([getDriver(), db.one('SELECT * FROM driver_state WHERE id = 1')]);
  return {
    name: driver ? driver.name : '',
    first_name: driver ? firstName(driver.name) : '',
    phone: driver ? driver.phone : '',
    photo: state.photo ? '/uploads/' + state.photo : null,
    car_model: state.car_model,
    car_colour: state.car_colour,
    car_plate: state.car_plate,
    online: state.online,
    away_note: state.away_note,
  };
}

async function loadRide(id) {
  return db.one(
    `SELECT r.*, u.phone AS rider_phone FROM rides r LEFT JOIN users u ON u.id = r.rider_id WHERE r.id = $1`,
    [id]
  );
}

// Passengers get their own rides; the car's position is added while the driver is coming or driving.
async function forViewer(ride, user) {
  if (user.role !== 'driver') delete ride.rider_phone;
  if (MOVING.includes(ride.status)) {
    const state = await db.one('SELECT lat, lng FROM driver_state WHERE id = 1');
    ride.car = state.lat != null ? { lat: state.lat, lng: state.lng } : null;
    if (liveRoute && liveRoute.rideId === ride.id && liveRoute.status === ride.status) ride.route = liveRoute.line;
  }
  return ride;
}

async function rideForUser(id, user) {
  const ride = await loadRide(id);
  if (!ride || (user.role !== 'driver' && ride.rider_id !== user.id)) throw new Oops(404, "That ride doesn't exist.");
  return ride;
}

// Sends the latest copy of a ride to the passenger and the driver.
async function broadcast(rideId) {
  const ride = await loadRide(rideId);
  const driver = await getDriver();
  if (driver) live.send(driver.id, { type: 'ride', ride: await forViewer({ ...ride }, driver) });
  if (ride.rider_id) live.send(ride.rider_id, { type: 'ride', ride: await forViewer({ ...ride }, { role: 'passenger', id: ride.rider_id }) });
  return ride;
}

// The driving line for the ride happening now, kept in memory: { rideId, status, line, at }.
let liveRoute = null;

// Works out the road from the car to the pickup (or to the drop-off once the ride has started).
// Returns the drive time to the pickup when the driver is on the way.
async function updateRoute(ride, car) {
  const to = ride.status === 'in_progress'
    ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
    : { lat: ride.pickup_lat, lng: ride.pickup_lng };
  const r = await maps.route(car, to);
  if (!r) return ride.eta_seconds;
  liveRoute = { rideId: ride.id, status: ride.status, line: r.line, at: Date.now() };
  if (ride.status !== 'on_the_way') return ride.eta_seconds;
  await db.query('UPDATE rides SET eta_seconds = $1, eta_at = now() WHERE id = $2', [r.seconds, ride.id]);
  return r.seconds;
}

// Called every time the driver's phone reports a new position.
async function onDriverLocation(lat, lng) {
  await db.query('UPDATE driver_state SET lat = $1, lng = $2, location_at = now() WHERE id = 1', [lat, lng]);
  const ride = await db.one(`SELECT * FROM rides WHERE status = ANY($1) ORDER BY updated_at DESC LIMIT 1`, [MOVING]);
  if (!ride) return;

  let eta = ride.eta_seconds;
  let route = null;
  if (ride.status === 'on_the_way' || ride.status === 'in_progress') {
    const fresh = liveRoute && liveRoute.rideId === ride.id && liveRoute.status === ride.status && Date.now() - liveRoute.at < 20000;
    if (!fresh) {
      eta = await updateRoute(ride, { lat, lng });
      if (liveRoute && liveRoute.rideId === ride.id) route = liveRoute.line;
    }
  }

  if (ride.status === 'on_the_way') {
    const metres = maps.metresBetween({ lat, lng }, { lat: ride.pickup_lat, lng: ride.pickup_lng });
    if (!ride.close_notified && (metres < 400 || (eta != null && eta <= 150))) {
      await db.query('UPDATE rides SET close_notified = true WHERE id = $1', [ride.id]);
      const [driver, rider] = await Promise.all([getDriver(), db.one('SELECT * FROM users WHERE id = $1', [ride.rider_id])]);
      notify.tell(rider, `${firstName(driver.name)} is almost there`, eta != null ? `About ${minutes(eta)} away.` : '', { withSms: true, tag: 'ride' });
    }
  }

  // The route line is only sent when it changed, to keep these updates small.
  const update = { type: 'car', ride_id: ride.id, lat, lng, eta_seconds: eta, ...(route ? { route } : {}) };
  if (ride.rider_id) live.send(ride.rider_id, update);
  if (route) {
    const driver = await getDriver();
    if (driver) live.send(driver.id, update);
  }
}

// ---------- Account ----------

router.get('/config', (req, res) => {
  res.json({
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      appId: process.env.FIREBASE_APP_ID,
    },
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  });
});

// Public page for "Share my ride". Anyone with the link can follow the ride until it ends.
router.get('/track/:token', wrap(async (req, res) => {
  const ride = await db.one('SELECT * FROM rides WHERE share_token = $1', [text(req.params.token, 100)]);
  if (!ride) throw new Oops(404, "This link doesn't work. Ask for a new one.");
  if (!OPEN.includes(ride.status)) return res.json({ status: ride.status, over: true });
  const info = await driverInfo();
  const out = {
    status: ride.status,
    rider: firstName(ride.rider_name),
    driver: info.first_name,
    car: [info.car_colour, info.car_model].filter(Boolean).join(' '),
    plate: info.car_plate,
    pickup: { address: ride.pickup_address, lat: ride.pickup_lat, lng: ride.pickup_lng },
    dropoff: { address: ride.dropoff_address, lat: ride.dropoff_lat, lng: ride.dropoff_lng },
    scheduled_for: ride.scheduled_for,
    eta_seconds: ride.status === 'on_the_way' ? ride.eta_seconds : null,
  };
  const withCar = await forViewer({ ...ride }, { role: 'passenger' });
  out.car_position = withCar.car || null;
  out.route = withCar.route || null;
  res.json(out);
}));

router.use(wrap(loadUser));

router.get('/me', wrap(async (req, res) => {
  const driver = await getDriver();
  res.json({
    user: req.user,
    login: { email: req.login.email, name: req.login.name },
    isDriverLogin: isDriverLogin(req.login),
    driverName: driver ? firstName(driver.name) : 'Dekaiah',
  });
}));

router.post('/signup', wrap(async (req, res) => {
  if (req.user) return res.json({ user: req.user });
  const name = text(req.body.name, 60);
  const phone = text(req.body.phone, 30);
  if (!name) throw new Oops(400, 'Add your name.');
  if (phone.replace(/\D/g, '').length < 7) throw new Oops(400, 'Add a phone number.');

  const driverLogin = isDriverLogin(req.login);
  if (!driverLogin) {
    const state = await db.one('SELECT invite_code FROM driver_state WHERE id = 1');
    if (text(req.body.invite, 100) !== state.invite_code) {
      throw new Oops(403, 'You need an invite link to sign up. Ask Dekaiah for one.');
    }
  }

  const user = await db.one(
    `INSERT INTO users (firebase_uid, email, name, phone, role, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.login.uid, req.login.email, name, phone, driverLogin ? 'driver' : 'passenger', driverLogin ? 'approved' : 'pending']
  );

  if (!driverLogin) {
    const driver = await getDriver();
    if (driver) {
      notify.tell(driver, `${name} wants to join`, 'Open Friends to approve them.', { withSms: true, tag: 'friends' });
      live.send(driver.id, { type: 'friends' });
    }
  }
  res.json({ user });
}));

router.patch('/me', wrap(async (req, res) => {
  if (!req.user) throw new Oops(403, 'Finish signing up first.');
  const name = text(req.body.name, 60) || req.user.name;
  const phone = text(req.body.phone, 30) || req.user.phone;
  const user = await db.one('UPDATE users SET name = $1, phone = $2 WHERE id = $3 RETURNING *', [name, phone, req.user.id]);
  res.json({ user });
}));

router.post('/push', wrap(async (req, res) => {
  if (!req.user) throw new Oops(403, 'Finish signing up first.');
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint) throw new Oops(400, 'Missing subscription.');
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, subscription = $3`,
    [req.user.id, sub.endpoint, sub]
  );
  res.json({ ok: true });
}));

router.delete('/push', wrap(async (req, res) => {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [text(req.body.endpoint, 1000)]);
  res.json({ ok: true });
}));

// Everything below needs an approved account.
router.use(approvedOnly);

router.get('/driver', wrap(async (req, res) => {
  res.json(await driverInfo());
}));

// ---------- Addresses ----------

router.get('/search', wrap(async (req, res) => {
  const q = text(req.query.q, 200);
  if (!q) return res.json([]);
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const near = Number.isFinite(lat) && Number.isFinite(lng) && req.query.lat ? { lat, lng } : null;
  res.json(await maps.search(q, near));
}));

router.get('/reverse', wrap(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Oops(400, 'Missing location.');
  res.json(await maps.reverse(lat, lng));
}));

// The road between two points, for drawing on the map. ?from=lat,lng&to=lat,lng
router.get('/route', wrap(async (req, res) => {
  const point = (v) => {
    const [lat, lng] = String(v || '').split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Oops(400, 'Missing location.');
    return { lat, lng };
  };
  const r = await maps.route(point(req.query.from), point(req.query.to));
  res.json(r || { seconds: null, line: null });
}));

router.get('/places', wrap(async (req, res) => {
  const saved = await db.query('SELECT label, address, lat, lng FROM places WHERE user_id = $1', [req.user.id]);
  const recent = await db.query(
    `SELECT address, lat, lng FROM (
       SELECT DISTINCT ON (address) address, lat, lng, at FROM (
         SELECT dropoff_address AS address, dropoff_lat AS lat, dropoff_lng AS lng, created_at AS at FROM rides WHERE rider_id = $1
         UNION ALL
         SELECT pickup_address, pickup_lat, pickup_lng, created_at FROM rides WHERE rider_id = $1
       ) a ORDER BY address, at DESC
     ) b ORDER BY at DESC LIMIT 6`,
    [req.user.id]
  );
  res.json({ saved, recent });
}));

router.put('/places/:label', wrap(async (req, res) => {
  const label = req.params.label;
  if (!PLACE_LABELS.includes(label)) throw new Oops(400, 'Unknown place.');
  const address = text(req.body.address, 300);
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Oops(400, 'Pick an address.');
  await db.query(
    `INSERT INTO places (user_id, label, address, lat, lng) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, label) DO UPDATE SET address = $3, lat = $4, lng = $5`,
    [req.user.id, label, address, lat, lng]
  );
  res.json({ ok: true });
}));

router.delete('/places/:label', wrap(async (req, res) => {
  await db.query('DELETE FROM places WHERE user_id = $1 AND label = $2', [req.user.id, req.params.label]);
  res.json({ ok: true });
}));

// ---------- Rides ----------

// ?view=open (default) or ?view=history
router.get('/rides', wrap(async (req, res) => {
  const history = req.query.view === 'history';
  const isDriver = req.user.role === 'driver';
  const rows = await db.query(
    `SELECT r.*, u.phone AS rider_phone FROM rides r LEFT JOIN users u ON u.id = r.rider_id
     WHERE (r.status = ANY($1)) = $2 ${isDriver ? '' : 'AND r.rider_id = $3'}
     ORDER BY ${history ? 'r.updated_at DESC LIMIT 100' : 'COALESCE(r.scheduled_for, r.created_at)'}`,
    isDriver ? [OPEN, !history] : [OPEN, !history, req.user.id]
  );
  for (const ride of rows) await forViewer(ride, req.user);
  res.json(rows);
}));

router.post('/rides', wrap(async (req, res) => {
  if (req.user.role === 'driver') throw new Oops(400, "You can't request a ride from yourself.");
  const b = req.body;
  const point = (p) => p && text(p.address, 300) && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  if (!point(b.pickup)) throw new Oops(400, 'Set a pickup spot.');
  if (!point(b.dropoff)) throw new Oops(400, 'Set where you are going.');
  const passengers = Math.round(Number(b.passengers) || 1);
  if (passengers < 1 || passengers > 4) throw new Oops(400, 'The car fits up to 4 people.');
  const note = text(b.note, 300);

  let scheduledFor = null;
  if (b.scheduled_for) {
    scheduledFor = new Date(b.scheduled_for);
    if (isNaN(scheduledFor)) throw new Oops(400, 'Pick a time.');
    if (scheduledFor.getTime() < Date.now() + 10 * 60000) throw new Oops(400, 'Pick a time at least 10 minutes from now.');
  } else {
    const state = await db.one('SELECT online FROM driver_state WHERE id = 1');
    const driver = await getDriver();
    if (!state.online) throw new Oops(400, `${firstName(driver && driver.name) || 'The driver'} is offline right now. You can schedule a ride for later.`);
    const existing = await db.one(
      'SELECT id FROM rides WHERE rider_id = $1 AND scheduled_for IS NULL AND status = ANY($2)',
      [req.user.id, OPEN]
    );
    if (existing) throw new Oops(400, 'You already have a ride going.');
  }

  const ride = await db.one(
    `INSERT INTO rides (rider_id, rider_name, pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng, passengers, note, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [req.user.id, req.user.name, text(b.pickup.address, 300), Number(b.pickup.lat), Number(b.pickup.lng),
      text(b.dropoff.address, 300), Number(b.dropoff.lat), Number(b.dropoff.lng), passengers, note, scheduledFor]
  );
  const full = await broadcast(ride.id);

  const driver = await getDriver();
  const who = `${req.user.name}${passengers > 1 ? ` (${passengers} people)` : ''}`;
  const title = scheduledFor ? `${req.user.name} booked a ride for ${when(scheduledFor)}` : `${who} needs a ride`;
  const body = `From ${full.pickup_address} to ${full.dropoff_address}${note ? `\n"${note}"` : ''}`;
  notify.tell(driver, title, body, { withSms: true, tag: 'request' });

  res.json(await forViewer(full, req.user));
}));

router.get('/rides/:id', wrap(async (req, res) => {
  const ride = await rideForUser(req.params.id, req.user);
  res.json(await forViewer(ride, req.user));
}));

router.post('/rides/:id/cancel', wrap(async (req, res) => {
  const ride = await rideForUser(req.params.id, req.user);
  if (!OPEN.includes(ride.status) || ride.status === 'in_progress') throw new Oops(400, "This ride can't be cancelled now.");
  const by = req.user.role === 'driver' ? 'driver' : 'rider';
  await db.query("UPDATE rides SET status = 'cancelled', cancelled_by = $1, updated_at = now() WHERE id = $2", [by, ride.id]);
  const updated = await broadcast(ride.id);

  const driver = await getDriver();
  if (by === 'rider') {
    notify.tell(driver, `${ride.rider_name} cancelled their ride`, '', { withSms: ride.status !== 'requested', tag: 'request' });
  } else {
    const rider = await db.one('SELECT * FROM users WHERE id = $1', [ride.rider_id]);
    notify.tell(rider, `${firstName(driver.name)} cancelled your ride`, 'Message them if you need to sort something out.', { withSms: true, tag: 'ride' });
  }
  res.json(await forViewer(updated, req.user));
}));

// The driver moves a ride along: accepted, declined, on_the_way, arrived, in_progress, done.
const NEXT = {
  accepted: ['requested'],
  declined: ['requested'],
  on_the_way: ['accepted'],
  arrived: ['on_the_way'],
  in_progress: ['arrived'],
  done: ['in_progress'],
};

router.post('/rides/:id/status', driverOnly, wrap(async (req, res) => {
  const status = req.body.status;
  const ride = await rideForUser(req.params.id, req.user);
  if (!NEXT[status] || !NEXT[status].includes(ride.status)) throw new Oops(400, 'That ride has already moved on. Refresh and try again.');

  if (status === 'on_the_way') {
    const busy = await db.one('SELECT id, rider_name FROM rides WHERE status = ANY($1) AND id <> $2', [MOVING, ride.id]);
    if (busy) throw new Oops(400, `Finish ${busy.rider_name}'s ride first.`);
  }

  await db.query(
    'UPDATE rides SET status = $1, updated_at = now(), eta_seconds = NULL, eta_at = NULL WHERE id = $2',
    [status, ride.id]
  );

  const driver = req.user;
  const name = firstName(driver.name);
  const rider = ride.rider_id ? await db.one('SELECT * FROM users WHERE id = $1', [ride.rider_id]) : null;
  const state = await db.one('SELECT * FROM driver_state WHERE id = 1');
  const car = [state.car_colour, state.car_model].filter(Boolean).join(' ');

  if (status === 'accepted') {
    const body = ride.scheduled_for ? `See you ${when(ride.scheduled_for)}.` : `${name} will head your way soon.`;
    notify.tell(rider, `${name} accepted your ride`, body, { withSms: true, tag: 'ride' });
  } else if (status === 'declined') {
    notify.tell(rider, `${name} can't take this ride`, 'Sorry! Message or call if you need to.', { withSms: true, tag: 'ride' });
  } else if (status === 'on_the_way') {
    let eta = null;
    if (state.lat != null) eta = await updateRoute({ ...ride, status }, { lat: state.lat, lng: state.lng });
    notify.tell(rider, `${name} is on the way`, eta != null ? `About ${minutes(eta)} away.` : '', { tag: 'ride' });
  } else if (status === 'arrived') {
    const look = [car && `Look for the ${car}`, state.car_plate && `plate ${state.car_plate}`].filter(Boolean).join(', ');
    notify.tell(rider, `${name} is here`, look ? look + '.' : '', { withSms: true, tag: 'ride' });
  } else if (status === 'in_progress' && state.lat != null) {
    await updateRoute({ ...ride, status }, { lat: state.lat, lng: state.lng });
  }

  const updated = await broadcast(ride.id);
  res.json(await forViewer(updated, req.user));
}));

router.post('/rides/:id/share', wrap(async (req, res) => {
  const ride = await rideForUser(req.params.id, req.user);
  if (!OPEN.includes(ride.status)) throw new Oops(400, 'This ride is over.');
  let token = ride.share_token;
  if (!token) {
    token = crypto.randomBytes(12).toString('base64url');
    await db.query('UPDATE rides SET share_token = $1 WHERE id = $2', [token, ride.id]);
  }
  const site = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${site.replace(/\/$/, '')}/track/${token}` });
}));

// ---------- Messages ----------

router.get('/rides/:id/messages', wrap(async (req, res) => {
  const ride = await rideForUser(req.params.id, req.user);
  res.json(await db.query('SELECT * FROM messages WHERE ride_id = $1 ORDER BY id', [ride.id]));
}));

router.post('/rides/:id/messages', wrap(async (req, res) => {
  const ride = await rideForUser(req.params.id, req.user);
  if (!OPEN.includes(ride.status)) throw new Oops(400, 'This ride is over.');
  const body = text(req.body.body, 1000);
  if (!body) throw new Oops(400, 'Type a message.');
  const message = await db.one(
    'INSERT INTO messages (ride_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *',
    [ride.id, req.user.id, body]
  );

  const driver = await getDriver();
  const toId = req.user.role === 'driver' ? ride.rider_id : driver.id;
  live.send(toId, { type: 'message', message });
  live.send(req.user.id, { type: 'message', message });
  const to = await db.one('SELECT * FROM users WHERE id = $1', [toId]);
  notify.tell(to, firstName(req.user.name), body, { tag: 'message-' + ride.id });
  res.json(message);
}));

// ---------- Driver only ----------

// Lets every passenger with the app open see the change right away.
async function driverChanged() {
  const info = await driverInfo();
  live.sendAll({ type: 'driver', driver: info }, 'passenger');
  return info;
}

router.post('/driver/online', driverOnly, wrap(async (req, res) => {
  const online = !!req.body.online;
  // The "back at 9pm" note only makes sense while offline.
  await db.query(`UPDATE driver_state SET online = $1${online ? ", away_note = ''" : ''} WHERE id = 1`, [online]);
  res.json(await driverChanged());
}));

router.patch('/driver/note', driverOnly, wrap(async (req, res) => {
  await db.query('UPDATE driver_state SET away_note = $1 WHERE id = 1', [text(req.body.away_note, 80)]);
  res.json(await driverChanged());
}));

router.patch('/driver/car', driverOnly, wrap(async (req, res) => {
  await db.query(
    'UPDATE driver_state SET car_model = $1, car_colour = $2, car_plate = $3 WHERE id = 1',
    [text(req.body.car_model, 60), text(req.body.car_colour, 40), text(req.body.car_plate, 20).toUpperCase()]
  );
  res.json(await driverChanged());
}));

router.post('/driver/photo', driverOnly, wrap(async (req, res) => {
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(req.body.photo || '');
  if (!match) throw new Oops(400, 'That photo didn’t work. Try another one.');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const old = await db.one('SELECT photo FROM driver_state WHERE id = 1');
  const file = `driver-${Date.now()}.jpg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(match[1], 'base64'));
  await db.query('UPDATE driver_state SET photo = $1 WHERE id = 1', [file]);
  if (old.photo) fs.rm(path.join(UPLOAD_DIR, old.photo), () => {});
  res.json(await driverChanged());
}));

router.get('/friends', driverOnly, wrap(async (req, res) => {
  const friends = await db.query(
    "SELECT id, name, email, phone, status, created_at FROM users WHERE role = 'passenger' ORDER BY name"
  );
  const state = await db.one('SELECT invite_code FROM driver_state WHERE id = 1');
  res.json({ friends, invite_code: state.invite_code });
}));

router.post('/friends/:id', driverOnly, wrap(async (req, res) => {
  const friend = await db.one("SELECT * FROM users WHERE id = $1 AND role = 'passenger'", [req.params.id]);
  if (!friend) throw new Oops(404, "That person isn't here anymore.");
  const action = req.body.action;

  if (action === 'approve' || action === 'unblock') {
    await db.query("UPDATE users SET status = 'approved' WHERE id = $1", [friend.id]);
    if (action === 'approve' && friend.status === 'pending') {
      notify.tell(friend, "You're in", `${firstName(req.user.name)} approved you. You can request rides now.`, { withSms: true });
    }
  } else if (action === 'block') {
    await db.query("UPDATE users SET status = 'blocked' WHERE id = $1", [friend.id]);
    await db.query("UPDATE rides SET status = 'cancelled', cancelled_by = 'driver', updated_at = now() WHERE rider_id = $1 AND status = ANY($2)", [friend.id, OPEN]);
  } else if (action === 'remove') {
    await db.query("UPDATE rides SET status = 'cancelled', cancelled_by = 'driver', updated_at = now() WHERE rider_id = $1 AND status = ANY($2)", [friend.id, OPEN]);
    await db.query('DELETE FROM users WHERE id = $1', [friend.id]);
  } else {
    throw new Oops(400, 'Unknown action.');
  }
  live.send(friend.id, { type: 'me' });
  res.json({ ok: true });
}));

// ---------- Every 30 seconds: expire old requests, send reminders ----------

async function checkRides() {
  const driver = await getDriver();
  if (!driver) return;
  const name = firstName(driver.name);

  // A "now" request nobody answered in 10 minutes, or a scheduled one whose time passed.
  const expired = await db.query(
    `UPDATE rides SET status = 'cancelled', cancelled_by = 'timeout', updated_at = now()
     WHERE status = 'requested'
       AND ((scheduled_for IS NULL AND created_at < now() - interval '10 minutes') OR scheduled_for < now())
     RETURNING *`
  );
  for (const ride of expired) {
    await broadcast(ride.id);
    const rider = await db.one('SELECT * FROM users WHERE id = $1', [ride.rider_id]);
    notify.tell(rider, `${name} didn't get to your request in time`, `Try again, or give ${name} a call.`, { withSms: true, tag: 'ride' });
  }

  // 30 minutes before a scheduled ride.
  const soon = await db.query(
    `UPDATE rides SET reminder_sent = true
     WHERE scheduled_for IS NOT NULL AND NOT reminder_sent AND status IN ('requested', 'accepted')
       AND scheduled_for <= now() + interval '30 minutes'
       AND created_at < scheduled_for - interval '30 minutes'  -- skip rides booked less than 30 minutes ahead
     RETURNING *`
  );
  for (const ride of soon) {
    const time = when(ride.scheduled_for).split(', ').pop();
    if (ride.status === 'requested') {
      notify.tell(driver, `${ride.rider_name}'s ride at ${time} still needs an answer`, `From ${ride.pickup_address}`, { withSms: true, tag: 'request' });
      continue;
    }
    const rider = await db.one('SELECT * FROM users WHERE id = $1', [ride.rider_id]);
    notify.tell(rider, `Your ride with ${name} is at ${time}`, `You'll get a heads-up when ${name} is on the way.`, { withSms: true, tag: 'ride' });
    notify.tell(driver, `Pick up ${ride.rider_name} at ${time}`, `From ${ride.pickup_address}`, { withSms: true, tag: 'reminder' });
  }
}

// ---------- Errors ----------

router.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

module.exports = { router, onDriverLocation, checkRides };
