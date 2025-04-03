const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const fetch = require('node-fetch');
const schedule = require('node-schedule');
const path = require('path');

// Import Firebase from the centralized location
const { admin, db } = require('../firebase/firebase.js');

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create a server object that can be passed to route modules
const server = { admin, db };

// Import routes
const paymentRoutes = require('./routes/payment.js');
const tokenRoutes = require('./routes/tokens.js');
const { router: notificationRouter } = require('./routes/notifications.js');

// Use routes
app.use('/api', paymentRoutes);
app.use('/api', tokenRoutes);
app.use('/api', notificationRouter);

// GET: Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start water reminders on server startup
const waterReminderJob = schedule.scheduleJob('0 8-20/2 * * *', async () => {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/water-reminders/send-now`, {
      method: 'POST'
    });
    console.log('Scheduled water reminder triggered');
  } catch (error) {
    console.error('Failed to trigger scheduled water reminder:', error);
  }
});

console.log('Water reminders scheduled to run every 2 hours from 8 AM to 8 PM');
console.log('Next water reminder will run at:', waterReminderJob.nextInvocation());

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export for testing
module.exports = app;
module.exports.admin = admin;
module.exports.db = db;