const http = require('http');
const path = require('path');
const express = require('express');
const db = require('./db');
const live = require('./live');
const api = require('./api');

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '4mb' })); // big enough for a profile photo

app.use('/api', api.router);
app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || 'uploads'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 }));

// "Share my ride" links open a simple page that doesn't need an account.
app.get('/track/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'track.html')));

// Any other address loads the app (it reads the invite code from the link itself).
app.get('/{*any}', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const server = http.createServer(app);
live.start(server, { onDriverLocation: api.onDriverLocation });

const port = Number(process.env.PORT || 3000);
db.setup()
  .then(() => {
    setInterval(() => api.checkRides().catch(console.error), 30000);
    return server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Dekaiah Dash is running on port ${port}`));
  })
  .catch((err) => {
    console.error('Could not connect to the database:', err.message);
    process.exit(1);
  });
