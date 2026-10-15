# Dekaiah Dash

Friends request rides, Dekaiah drives. No payments and no prices. There's one driver.

- **Passengers** sign up with an invite link and wait for approval. Then they can request rides now or for later, watch the car and its route on the map, message or call the driver (with one-tap quick replies), share a live link to the ride with someone, save places and see their ride history.
- **The driver** can go online or offline (with a note like "Back at 9pm") and gets an alert with a sound for each new request. The driver accepts or declines, opens directions in Google or Apple Maps, updates the ride status, and manages friends, scheduled rides, history, car info and a profile photo.
- **Automatic:** a reminder 30 minutes before scheduled rides, and requests that get no answer close on their own so nobody is left waiting.
- **Dark mode** follows the phone's setting.

## How it's built

| Part | What it uses |
|---|---|
| Server | Node.js, Express |
| Database | PostgreSQL |
| Login | Firebase Authentication (Google and email/password), free plan |
| Map | Leaflet and OpenStreetMap, free with no key. Dark mode uses CARTO's free dark map. |
| Address search | Nominatim (OpenStreetMap), free with no key |
| Drive times and route lines | OSRM public server, free with no key |
| Live updates | WebSockets |
| Phone notifications | Web Push, using keys you make yourself for free |
| Text messages | Twilio (optional, costs money: see below) |
| HTTPS | Caddy (gets a free certificate automatically) |

The front end is plain HTML, CSS and JavaScript in `public/`, with no build step. The server is in `server/`.

```
server/
  index.js     starts everything
  api.js       all the /api routes (rides, friends, messages, settings)
  auth.js      checks Firebase logins
  db.js        database connection; creates tables on start-up
  schema.sql   the tables
  live.js      WebSocket live updates and the driver's location
  notify.js    phone notifications and texts
  maps.js      address search and drive times
public/
  index.html, css/app.css, sw.js, manifest.webmanifest, icons/
  js/app.js     login, sign-up, menu
  js/rider.js   passenger screens
  js/driver.js  driver screens
  js/chat.js    messages
  js/track.js   the "Share my ride" page (track.html), no login needed
  js/map.js, js/ui.js, js/api.js, js/push.js
```

---

## Set it up on your Ubuntu server

These steps assume Ubuntu 22.04 or 24.04, a domain name (for example `dash.example.com`), and SSH access with `sudo`.

### 1. Point your domain at the server

At your domain registrar or DNS provider, add an **A record** for `dash.example.com` pointing to your server's public IP address. Wait until `ping dash.example.com` shows that IP.

Open the web ports if you use a firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### 2. Install Node.js, PostgreSQL, Caddy and git

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git postgresql

# Caddy (handles HTTPS for you)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 3. Create the database

Pick a password and use it in place of `CHANGE_ME`:

```bash
sudo -u postgres psql -c "CREATE USER dekaiah WITH PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "CREATE DATABASE dekaiah_dash OWNER dekaiah;"
```

The app creates its tables the first time it starts.

### 4. Get the code

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin dekaiah
sudo git clone https://github.com/DRHaupt/dekaiah-dash.git /opt/dekaiah-dash
cd /opt/dekaiah-dash
sudo npm install --omit=dev
sudo cp .env.example .env
sudo mkdir -p uploads
sudo chown -R dekaiah:dekaiah /opt/dekaiah-dash
```

### 5. Set up Firebase (login)

1. Go to https://console.firebase.google.com and click **Create a project**. Google Analytics isn't needed.
2. In the left menu, go to **Build → Authentication → Get started**.
3. Under **Sign-in method**, turn on **Google** and **Email/Password**.
4. Under **Settings → Authorized domains**, click **Add domain** and add `dash.example.com`.
5. Click the gear icon, then **Project settings**. Under **Your apps**, click the **</>** (web) icon and register an app. You don't need Firebase Hosting.
6. Firebase shows a `firebaseConfig`. Copy these values into `/opt/dekaiah-dash/.env`:
   - `apiKey` → `FIREBASE_API_KEY`
   - `projectId` → `FIREBASE_PROJECT_ID`
   - `appId` → `FIREBASE_APP_ID`
   - Set `FIREBASE_AUTH_DOMAIN` to **your own domain**, `dash.example.com`, not the `firebaseapp.com` one. This makes Google login work on iPhones (Caddy forwards the login pages, see step 8).
7. Google login on your own domain also needs this:
   - Open https://console.cloud.google.com/apis/credentials and select the same project.
   - Click the **OAuth 2.0 Client ID** called "Web client (auto created by Google Service)".
   - Under **Authorized redirect URIs**, add `https://dash.example.com/__/auth/handler`, then save.

Edit the file with `sudo nano /opt/dekaiah-dash/.env`.

### 6. Fill in the rest of `.env`

- `DATABASE_URL`: put in the password from step 3.
- `DRIVER_EMAIL`: your Gmail address. When you log in **with Google** using this email, you become the driver. Google login is needed because it proves the email is yours. Nobody else can become the driver.
- `TIMEZONE`: for example `America/Toronto` or `America/New_York`.
- Phone notification keys: run this and paste the two keys into `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`:

  ```bash
  cd /opt/dekaiah-dash && npx web-push generate-vapid-keys
  ```

  Keep these keys the same from now on. If you change them, everyone has to turn notifications on again.

### 7. Text messages with Twilio (optional, costs money)

Texts go out when someone requests a ride, when you accept, when you're close, when you arrive, if a ride is declined or cancelled, when a new friend signs up, and when you approve them. Phone notifications work without this.

Twilio isn't free. Expect about US$1–2 a month for the phone number, plus about 1 cent per text in the US and Canada.

1. Sign up at https://www.twilio.com and buy a phone number with SMS.
2. Copy the **Account SID** and **Auth Token** from the Twilio console into `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`. Put your Twilio number in `TWILIO_FROM`, like `+15551234567`.
3. **US numbers:** carriers require you to register before texts get delivered. This is called "A2P 10DLC", and Twilio walks you through it under Messaging → Regulatory Compliance. A toll-free number with "toll-free verification" is the other option. Canadian numbers don't need this.

Leave the Twilio lines blank to turn texts off.

### 8. Set up HTTPS with Caddy

```bash
sudo cp /opt/dekaiah-dash/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace `dash.example.com` with your domain and `YOUR-PROJECT-ID` with your Firebase project ID. Then run:

```bash
sudo systemctl reload caddy
```

Caddy gets a free Let's Encrypt certificate and renews it on its own. HTTPS is required for location and notifications.

### 9. Start the app (and keep it running)

```bash
sudo cp /opt/dekaiah-dash/deploy/dekaiah-dash.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dekaiah-dash
sudo systemctl status dekaiah-dash     # should say "active (running)"
```

It now starts automatically when the server reboots. To see the logs:

```bash
sudo journalctl -u dekaiah-dash -f
```

### 10. First time you open it

1. On your phone, go to `https://dash.example.com`.
2. Tap **Continue with Google** and use your `DRIVER_EMAIL` account. Enter your name and phone number.
3. Open the menu, then **Settings**. Add your car colour and plate and a profile photo.
4. Open the menu, then **Friends**. Tap **Share link** to send your invite link to friends.
5. When a friend signs up, you get a notification (and a text, if Twilio is set up). Approve them under **Friends**.

**Add it to the home screen:**
- **iPhone (Safari):** tap Share, then **Add to Home Screen**. On iPhone, notifications only work when the app is opened from the home screen (iOS 16.4 or newer).
- **Android (Chrome):** tap ⋮, then **Add to Home screen** or **Install app**.

After opening it from the home screen, tap **Turn on notifications**.

---

## Things to know

- **Your location only shares while the app is open on your screen.** Browsers don't allow background location, so keep Dekaiah Dash open while driving to a pickup. The screen stays on during a ride.
- **The request sound** plays when the app is open. When it's closed, you get a normal notification with your phone's sound (and a text if Twilio is on).
- **"Dekaiah is almost there"** is sent when you're about 2½ minutes away or 400 m from the pickup.
- **Removing a friend** deletes their account here. They'd need your invite link again to come back. **Blocking** keeps them out for good.
- **Forgot password** on the email login sends a reset email from Firebase.
- **Unanswered requests:** a "now" request with no answer after 10 minutes closes and your friend gets a text. A scheduled request you haven't answered by its pickup time closes the same way. You get a reminder 30 minutes before for those still waiting.
- **Reminders:** 30 minutes before an accepted scheduled ride, you and your friend both get a notification and text. Rides booked less than 30 minutes ahead skip the reminder.
- **Share my ride** links show the car, the route and the status. They show no phone numbers and stop working when the ride ends.
- **Your offline note** ("Back at 9pm") clears itself when you go online.
- The free OpenStreetMap services (map tiles, address search, drive times) have fair-use limits. A group of friends won't come close to them.

## Updating

```bash
cd /opt/dekaiah-dash
sudo -u dekaiah git pull
sudo -u dekaiah npm install --omit=dev
sudo systemctl restart dekaiah-dash
```

## Backups

Everything is in the PostgreSQL database, plus your profile photo in `uploads/`.

```bash
sudo -u postgres pg_dump dekaiah_dash > ~/dekaiah-dash-backup.sql
```

To restore it:

```bash
sudo -u postgres psql dekaiah_dash < ~/dekaiah-dash-backup.sql
```
