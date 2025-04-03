// firebase.js
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

try {
  // Get service account path
  const serviceAccountPath = 'D:/NutriBox/Server/server/fitfuel-5abf9-firebase-adminsdk-fbsvc-b83ce3a302.json';
  
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Service account file not found at: ${serviceAccountPath}`);
  }
  
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  // Initialize Firebase Admin SDK
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

// Export the db instance and admin
const db = admin.firestore();
module.exports = { admin, db };