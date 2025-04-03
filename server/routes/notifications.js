const express = require('express');
const router = express.Router();
const {admin, db} = require('../../firebase/firebase') 
const { Expo } = require('expo-server-sdk');
const schedule = require('node-schedule');

const analyticsCollection = db.collection('notificationAnalytics');
const notificationCollection = db.collection('notifications');

// Function to get all valid tokens
async function getAllValidTokens() {
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    if (snapshot.empty) {
      console.log('No users found when fetching valid tokens');
      return [];
    }
    
    const tokens = [];
    snapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.expoPushToken) {
        tokens.push(userData.expoPushToken);
      }
    });
    
    // Filter valid tokens
    const expo = new Expo();
    const validTokens = tokens.filter(token => 
      typeof token === 'string' && Expo.isExpoPushToken(token)
    );
    
    console.log(`Retrieved ${validTokens.length} valid tokens out of ${tokens.length} total tokens`);
    return validTokens;
  } catch (error) {
    console.error('Error fetching valid tokens:', error);
    return [];
  }
}

// Function to send water reminders to all users
async function sendWaterReminders() {
  console.log('Attempting to send water reminders at:', new Date().toISOString());
  try {
    const tokens = await getAllValidTokens();
    
    if (!tokens.length) {
      console.log('No valid tokens found for water reminders');
      return;
    }
    
    // Create Expo SDK client
    const expo = new Expo();
    
    // Create messages
    const messages = tokens.map(token => ({
      to: token,
      sound: 'default',
      title: 'Hydration Reminder',
      body: 'Time to drink water! Stay hydrated for better health.',
      data: { type: 'water_reminder' },
    }));
    
    // Chunk and send notifications
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending water reminder chunk:', error);
      }
    }
    
    // Count results
    const successful = tickets.filter(ticket => ticket.status === 'ok').length;
    const failed = tickets.length - successful;
    
    console.log(`Water reminders sent: ${successful} successful, ${failed} failed`);
    return { successful, failed, tickets };
  } catch (error) {
    console.error('Error sending water reminders:', error);
    return { successful: 0, failed: 0, error: error.message };
  }
}

// Function to store notification data when sent
async function storeNotificationData(title, body, data, tokens, tickets) {
  try {
    // Create a notification record
    const notificationRef = await notificationCollection.add({
      title,
      body,
      data,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      targetCount: tokens.length,
      sentCount: tickets.filter(ticket => ticket.status === 'ok').length,
      failedCount: tickets.filter(ticket => ticket.status !== 'ok').length,
      variant: data.variant || 'default',
      campaignId: data.campaignId || null
    });
    
    // Store individual delivery attempts for more granular analytics
    const batch = db.batch();
    tickets.forEach((ticket, index) => {
      const analyticsRef = analyticsCollection.doc();
      batch.set(analyticsRef, {
        notificationId: notificationRef.id,
        token: tokens[index],
        status: ticket.status,
        error: ticket.status === 'error' ? ticket.message : null,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        openedAt: null,
        interactedAt: null
      });
    });
    
    await batch.commit();
    console.log(`Analytics data stored for notification: ${notificationRef.id}`);
    return notificationRef.id;
  } catch (error) {
    console.error('Error storing analytics data:', error);
    return null;
  }
}

// Function to handle notification receipts
const checkNotificationReceipts = async () => {
  try {
    // Get receipts IDs from your database
    const expo = new Expo();
    const receiptIds = ['RECEIPT_ID_1', 'RECEIPT_ID_2']; // Replace with actual receipt IDs
    
    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
    
    for (const chunk of receiptIdChunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
        
        // Handle receipts
        for (const receiptId in receipts) {
          const receipt = receipts[receiptId];
          if (receipt.status === 'ok') {
            console.log(`Notification ${receiptId} delivered successfully`);
          } else if (receipt.status === 'error') {
            console.error(`Error delivering notification ${receiptId}: ${receipt.message}`);
            // Handle specific error types
            if (receipt.details && receipt.details.error) {
              console.error(`Error details: ${receipt.details.error}`);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching receipts:', error);
      }
    }
  } catch (error) {
    console.error('Error in receipt handling:', error);
  }
};

// GET: Fetch all device tokens from Firestore
router.get('/tokens', async (req, res) => {
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    if (snapshot.empty) {
      console.log('No users found in Firestore');
      return res.json({ tokens: [] });
    }
    
    const tokens = [];
    snapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.expoPushToken) {
        tokens.push({
          userId: doc.id,
          token: userData.expoPushToken,
          platform: userData.deviceInfo?.platform || 'unknown',
          lastActive: userData.lastActive || userData.createdAt || 'unknown'
        });
      }
    });
    
    // Filter valid tokens
    const expo = new Expo();
    const validTokens = tokens.filter(item => 
      typeof item.token === 'string' && Expo.isExpoPushToken(item.token)
    );
    
    console.log(`Found ${validTokens.length} valid tokens out of ${tokens.length} total tokens`);
    
    res.json({ 
      tokens: validTokens,
      count: validTokens.length
    });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

// POST: Send push notifications
router.post('/send-notifications', async (req, res) => {
  try {
    const { tokens, title, body, data } = req.body;
    
    if (!tokens || !tokens.length || !title || !body) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Create Expo SDK client
    const expo = new Expo();
    
    // Create messages
    const messages = tokens.map(token => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: data || {},
    }));
    
    // Chunk and send notifications
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending chunk:', error);
      }
    }
    
    // Count results
    const successful = tickets.filter(ticket => ticket.status === 'ok').length;
    const failed = tickets.length - successful;
    
    console.log(`Notifications sent: ${successful} successful, ${failed} failed`);
    
    // Store notification data for analytics
    const notificationId = await storeNotificationData(title, body, data, tokens, tickets);
    
    res.json({
      success: true,
      sent: successful,
      failed,
      notificationId,
      tickets
    });
  } catch (error) {
    console.error('Error sending notifications:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// POST: Start water reminders
router.post('/start-water-reminders', (req, res) => {
  try {
    // Schedule water reminders every 2 hours from 8 AM to 8 PM
    const job = schedule.scheduleJob('0 8-20/2 * * *', sendWaterReminders);
    
    console.log('Water reminders scheduled successfully');
    console.log('Next water reminder will run at:', job.nextInvocation());
    
    // Trigger an immediate reminder
    sendWaterReminders();
    
    res.json({
      success: true,
      message: 'Water reminders scheduled successfully',
      schedule: '0 8-20/2 * * *', // Every 2 hours from 8 AM to 8 PM
      nextReminder: job.nextInvocation()
    });
  } catch (error) {
    console.error('Error scheduling water reminders:', error);
    res.status(500).json({ error: 'Failed to schedule water reminders' });
  }
});

// GET: Get water reminder status
router.get('/water-reminders/status', (req, res) => {
  try {
    // Get all scheduled jobs
    const jobs = schedule.scheduledJobs;
    const waterReminderJobs = Object.values(jobs).filter(job => 
      job.name && job.name.includes('water')
    );
    
    res.json({
      active: waterReminderJobs.length > 0,
      jobs: waterReminderJobs.map(job => ({
        name: job.name,
        nextInvocation: job.nextInvocation()
      }))
    });
  } catch (error) {
    console.error('Error getting water reminder status:', error);
    res.status(500).json({ error: 'Failed to get water reminder status' });
  }
});

// POST: Send immediate water reminder
router.post('/water-reminders/send-now', async (req, res) => {
  try {
    console.log('Sending immediate water reminder');
    const result = await sendWaterReminders();
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error sending immediate water reminder:', error);
    res.status(500).json({ error: 'Failed to send water reminder' });
  }
});

// Create a route to track when notifications are opened
router.post('/track-notification-open', async (req, res) => {
  try {
    const { notificationId, userId, token } = req.body;
    
    if (!notificationId || !token) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Find the analytics record for this notification and token
    const analyticsSnapshot = await analyticsCollection
      .where('notificationId', '==', notificationId)
      .where('token', '==', token)
      .limit(1)
      .get();
    
    if (analyticsSnapshot.empty) {
      return res.status(404).json({ error: 'Analytics record not found' });
    }
    
    // Update the record with opened timestamp
    const analyticsDoc = analyticsSnapshot.docs[0];
    await analyticsDoc.ref.update({
      openedAt: admin.firestore.FieldValue.serverTimestamp(),
      userId: userId || null
    });
    
    // Also update the notification document with an incremented open count
    const notificationRef = notificationCollection.doc(notificationId);
    await notificationRef.update({
      openCount: admin.firestore.FieldValue.increment(1)
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking notification open:', error);
    res.status(500).json({ error: 'Failed to track notification open' });
  }
});

// Create a route to track when users interact with notifications
router.post('/track-notification-interaction', async (req, res) => {
  try {
    const { notificationId, userId, token, action } = req.body;
    
    if (!notificationId || !token) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Find the analytics record
    const analyticsSnapshot = await analyticsCollection
      .where('notificationId', '==', notificationId)
      .where('token', '==', token)
      .limit(1)
      .get();
    
    if (analyticsSnapshot.empty) {
      return res.status(404).json({ error: 'Analytics record not found' });
    }
    
    // Update with interaction data
    const analyticsDoc = analyticsSnapshot.docs[0];
    await analyticsDoc.ref.update({
      interactedAt: admin.firestore.FieldValue.serverTimestamp(),
      action: action || 'clicked',
      userId: userId || null
    });
    
    // Update the notification with an incremented interaction count
    const notificationRef = notificationCollection.doc(notificationId);
    await notificationRef.update({
      interactionCount: admin.firestore.FieldValue.increment(1)
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking notification interaction:', error);
    res.status(500).json({ error: 'Failed to track notification interaction' });
  }
});

// GET: Fetch notification analytics
router.get('/notification-analytics', async (req, res) => {
  try {
    const { timeframe = 'week', limit = 20 } = req.query;
    
    // Calculate date range based on timeframe
    const now = admin.firestore.Timestamp.now();
    let startDate;
    
    switch (timeframe) {
      case 'day':
        startDate = new Date(now.toDate().getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.toDate().getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.toDate().getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.toDate().getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    
    // Query notifications within the timeframe
    const notificationsSnapshot = await notificationCollection
      .where('sentAt', '>=', startDate)
      .orderBy('sentAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const notificationsData = [];
    notificationsSnapshot.forEach(doc => {
      notificationsData.push({
        id: doc.id,
        ...doc.data(),
        sentAt: doc.data().sentAt ? doc.data().sentAt.toDate() : null
      });
    });
    
    // Calculate summary metrics
    const totalSent = notificationsData.reduce((sum, notification) => sum + notification.targetCount, 0);
    const totalDelivered = notificationsData.reduce((sum, notification) => sum + notification.sentCount, 0);
    const totalOpened = notificationsData.reduce((sum, notification) => sum + (notification.openCount || 0), 0);
    const totalInteractions = notificationsData.reduce((sum, notification) => sum + (notification.interactionCount || 0), 0);
    
    // Calculate delivery rate, open rate, and interaction rate
    const deliveryRate = totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0;
    const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
    const interactionRate = totalOpened > 0 ? (totalInteractions / totalOpened) * 100 : 0;
    
    res.json({
      notifications: notificationsData,
      summary: {
        totalSent,
        totalDelivered,
        totalOpened,
        totalInteractions,
        deliveryRate,
        openRate,
        interactionRate
      }
    });
  } catch (error) {
    console.error('Error fetching notification analytics:', error);
    res.status(500).json({ error: 'Failed to fetch notification analytics' });
  }
});

// GET: Fetch A/B test results
router.get('/ab-test-results/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    
    // Get all variants for this campaign
    const variantsSnapshot = await notificationCollection
      .where('campaignId', '==', campaignId)
      .get();
    
    if (variantsSnapshot.empty) {
      return res.status(404).json({ error: 'No variants found for this campaign' });
    }
    
    const variants = [];
    variantsSnapshot.forEach(doc => {
      const data = doc.data();
      variants.push({
        id: doc.id,
        variant: data.variant,
        title: data.title,
        body: data.body,
        targetCount: data.targetCount || 0,
        sentCount: data.sentCount || 0,
        openCount: data.openCount || 0,
        interactionCount: data.interactionCount || 0,
        openRate: data.sentCount > 0 ? (data.openCount || 0) / data.sentCount * 100 : 0,
        interactionRate: data.openCount > 0 ? (data.interactionCount || 0) / data.openCount * 100 : 0
      });
    });
    
    res.json({
      campaignId,
      variants,
      winner: variants.sort((a, b) => b.interactionRate - a.interactionRate)[0]
    });
  } catch (error) {
    console.error('Error fetching A/B test results:', error);
    res.status(500).json({ error: 'Failed to fetch A/B test results' });
  }
});

// POST: Create A/B test campaign
router.post('/create-ab-test', async (req, res) => {
  try {
    const { variants, targetTokens, campaignName } = req.body;
    
    if (!variants || !variants.length || !targetTokens || !targetTokens.length) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Create campaign
    const campaignRef = await db.collection('campaigns').add({
      name: campaignName || `A/B Test ${new Date().toISOString()}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'running',
      variantCount: variants.length,
      targetCount: targetTokens.length
    });
    
    // Split tokens evenly between variants
    const tokensPerVariant = Math.floor(targetTokens.length / variants.length);
    const variantResults = [];
    
    // Send each variant to its segment
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const startIdx = i * tokensPerVariant;
      const endIdx = i === variants.length - 1 ? targetTokens.length : (i + 1) * tokensPerVariant;
      const variantTokens = targetTokens.slice(startIdx, endIdx);
      
      // Create Expo messages
      const expo = new Expo();
      const messages = variantTokens.map(token => ({
        to: token,
        sound: 'default',
        title: variant.title,
        body: variant.body,
        data: { 
          ...variant.data,
          campaignId: campaignRef.id,
          variant: String.fromCharCode(65 + i), // A, B, C, etc.
          isAbTest: true
        },
      }));
      
      // Send notifications
      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];
      
      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error(`Error sending variant ${i} chunk:`, error);
        }
      }
      
      // Store notification data with variant info
      const notificationId = await storeNotificationData(
        variant.title,
        variant.body,
        { 
          ...variant.data,
          campaignId: campaignRef.id,
          variant: String.fromCharCode(65 + i),
          isAbTest: true
        },
        variantTokens,
        tickets
      );
      
      // Record results
      variantResults.push({
        variant: String.fromCharCode(65 + i),
        title: variant.title,
        body: variant.body,
        targetCount: variantTokens.length,
        sentCount: tickets.filter(t => t.status === 'ok').length,
        notificationId
      });
    }
    
    // Update campaign with variant results
    await campaignRef.update({
      variants: variantResults,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      campaignId: campaignRef.id,
      variants: variantResults
    });
  } catch (error) {
    console.error('Error creating A/B test:', error);
    res.status(500).json({ error: 'Failed to create A/B test' });
  }
});

module.exports = { router, sendWaterReminders, checkNotificationReceipts };