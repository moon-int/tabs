// production entry for hosting panels (plesk / passenger, pm2, …) that start a file instead of `npm start`:
// tabs needs its own server — the rest api, the /ws sync and the example shows live there, not in next.js
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
require('./server/index.js');
