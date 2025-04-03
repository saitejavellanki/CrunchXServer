const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Get service account path
const serviceAccountPath = 'D:/NutriBox/Server/server/fitfuel-5abf9-firebase-adminsdk-fbsvc-b83ce3a302.json';
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Export the db instance
const db = admin.firestore();
module.exports = { admin, db };