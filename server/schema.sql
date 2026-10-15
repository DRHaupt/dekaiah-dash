-- Runs every time the server starts. Everything uses IF NOT EXISTS so it's safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  firebase_uid TEXT UNIQUE NOT NULL,
  email        TEXT,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'passenger',  -- 'driver' or 'passenger'
  status       TEXT NOT NULL DEFAULT 'pending',    -- 'pending', 'approved' or 'blocked'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row only (id = 1): the driver's live state and car.
CREATE TABLE IF NOT EXISTS driver_state (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  online      BOOLEAN NOT NULL DEFAULT false,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  location_at TIMESTAMPTZ,
  car_model   TEXT NOT NULL DEFAULT 'BMW 550i',
  car_colour  TEXT NOT NULL DEFAULT '',
  car_plate   TEXT NOT NULL DEFAULT '',
  photo       TEXT,
  invite_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rides (
  id              SERIAL PRIMARY KEY,
  rider_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rider_name      TEXT NOT NULL,
  pickup_address  TEXT NOT NULL,
  pickup_lat      DOUBLE PRECISION NOT NULL,
  pickup_lng      DOUBLE PRECISION NOT NULL,
  dropoff_address TEXT NOT NULL,
  dropoff_lat     DOUBLE PRECISION NOT NULL,
  dropoff_lng     DOUBLE PRECISION NOT NULL,
  passengers      INTEGER NOT NULL DEFAULT 1,
  note            TEXT NOT NULL DEFAULT '',
  scheduled_for   TIMESTAMPTZ,
  -- requested, accepted, on_the_way, arrived, in_progress, done, cancelled, declined
  status          TEXT NOT NULL DEFAULT 'requested',
  cancelled_by    TEXT,
  eta_seconds     INTEGER,
  eta_at          TIMESTAMPTZ,
  close_notified  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rides_rider_idx ON rides (rider_id);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides (status);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  ride_id    INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_ride_idx ON messages (ride_id);

CREATE TABLE IF NOT EXISTS places (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label   TEXT NOT NULL,  -- 'Home', 'Work' or 'School'
  address TEXT NOT NULL,
  lat     DOUBLE PRECISION NOT NULL,
  lng     DOUBLE PRECISION NOT NULL,
  UNIQUE (user_id, label)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT UNIQUE NOT NULL,
  subscription JSONB NOT NULL
);

-- Added later. ALTER ... IF NOT EXISTS keeps older databases up to date.
ALTER TABLE rides ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
ALTER TABLE driver_state ADD COLUMN IF NOT EXISTS away_note TEXT NOT NULL DEFAULT '';
