const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { db } = require('../../firebase/firebase');

const router = express.Router();

// PayU credentials - load from environment variables in production
const PAYU_KEY = process.env.PAYU_KEY || 'gSR07M';
const PAYU_SALT = process.env.PAYU_SALT || 'RZdd32itbMYSKM7Kwo4teRkhUKCsWbnj';
const PAYU_BASE_URL = 'https://secure.payu.in/_payment';

// Helper function to calculate PayU hash
function generatePayUHash(params) {
  const hashString = `${PAYU_KEY}|${params.txnid}|${params.amount}|${params.productinfo}|${params.firstname}|${params.email}|${params.udf1 || ''}|${params.udf2 || ''}|${params.udf3 || ''}|${params.udf4 || ''}|${params.udf5 || ''}|${params.udf6 || ''}|${params.udf7 || ''}|${params.udf8 || ''}|${params.udf9 || ''}|${params.udf10 || ''}|${PAYU_SALT}`;
  
  console.log('Hash String:', hashString); // For debugging
  const hash = crypto.createHash('sha512').update(hashString).digest('hex');
  console.log('Generated Hash:', hash); // For debugging
  
  return hash;
}

// Helper function to validate response hash
function validatePayUResponse(params) {
  const hashString = `${PAYU_SALT}|${params.status}|${params.udf1 || ''}|${params.udf2 || ''}|${params.udf3 || ''}|${params.udf4 || ''}|${params.udf5 || ''}|${params.udf6 || ''}|${params.udf7 || ''}|${params.udf8 || ''}|${params.udf9 || ''}|${params.udf10 || ''}|${params.email}|${params.firstname}|${params.productinfo}|${params.amount}|${params.txnid}|${PAYU_KEY}`;
  
  console.log('Validation Hash String:', hashString); // For debugging
  const calculatedHash = crypto.createHash('sha512').update(hashString).digest('hex');
  console.log('Calculated Hash:', calculatedHash);
  console.log('Received Hash:', params.hash);
  
  return calculatedHash === params.hash;
}

// Debug Endpoint - Force Update Premium Status
router.post('/debug/update-premium/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { subscriptionType = 'Monthly', txnid = 'DEBUG_TXN' } = req.body;
    
    console.log(`DEBUG: Forcing premium update for user ${userId}`);
    
    // Force update the user document
    await db.collection('users').doc(userId).set({
      isPremium: true,
      subscriptionType: subscriptionType,
      subscriptionDate: admin.firestore.Timestamp.now(),
      paymentId: 'DEBUG_PAYMENT',
      subscriptionId: txnid,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`DEBUG: User ${userId} premium status updated to TRUE`);
    
    // Verify the update was successful
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      console.log(`DEBUG: Verification - User is now premium: ${userData.isPremium}`);
      
      res.status(200).json({
        success: true,
        user: {
          id: userId,
          isPremium: userData.isPremium,
          subscriptionType: userData.subscriptionType,
          subscriptionDate: userData.subscriptionDate
        }
      });
    } else {
      console.error(`DEBUG: User verification failed - user not found`);
      res.status(404).json({ error: 'User not found after update' });
    }
  } catch (error) {
    console.error('DEBUG: Error forcing premium update:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Endpoint to initiate payment
router.post('/payment/initiate', async (req, res) => {
  try {
    const { 
      userId, 
      amount, 
      subscriptionType, 
      email, 
      firstname, 
      phone
    } = req.body;
    
    // Validate required fields
    if (!userId || !amount || !subscriptionType || !email || !firstname) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Generate unique transaction ID
    const txnid = `TXN_${Date.now()}_${userId.substring(0, 5)}`;
    
    // Create payment data object
    const paymentData = {
      key: PAYU_KEY,
      txnid: txnid,
      amount: amount,
      productinfo: `Fitness App ${subscriptionType} Subscription`,
      firstname: firstname,
      email: email,
      phone: phone || '',
      surl: `https://7989-49-206-60-211.ngrok-free.app/api/payment/success`,
      furl: `${req.protocol}://${req.get('host')}/api/payment/failure`,
      udf1: userId,
      udf2: subscriptionType,
      udf5: 'PayUFitnessApp'
    };
    
    // Generate hash
    paymentData.hash = generatePayUHash(paymentData);
    
    // Store transaction data in Firestore for future reference
    await db.collection('transactions').doc(txnid).set({
      userId: userId,
      amount: amount,
      subscriptionType: subscriptionType,
      status: 'initiated',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`Payment initiated: Transaction ID ${txnid} for user ${userId}, amount ${amount}`);
    
    // Return payment data to client
    res.status(200).json({
      paymentUrl: PAYU_BASE_URL,
      paymentData: paymentData
    });
    
  } catch (error) {
    console.error('Error initiating payment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Success callback endpoint
router.post('/payment/success', async (req, res) => {
  try {
    console.log('SUCCESS CALLBACK RECEIVED');
    console.log('Request body:', JSON.stringify(req.body));
    
    const paymentResponse = req.body;
    const userId = paymentResponse.udf1;
    const subscriptionType = paymentResponse.udf2;
    const txnid = paymentResponse.txnid;
    const mihpayid = paymentResponse.mihpayid || 'UNKNOWN_PAYMENT_ID';
    
    console.log(`Processing success callback for user ${userId}, txn ${txnid}`);
    
    // Skip hash validation temporarily for debugging
    // const isValid = validatePayUResponse(paymentResponse);
    // if (!isValid) {
    //   console.error(`Invalid hash in payment response for transaction ${txnid}`);
    //   return res.status(400).json({ error: 'Invalid payment response' });
    // }
    
    // Update transaction record first
    try {
      await db.collection('transactions').doc(txnid).update({
        status: 'completed',
        paymentId: mihpayid,
        bankRef: paymentResponse.bank_ref_num || 'UNKNOWN',
        paymentResponse: paymentResponse,
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`Transaction ${txnid} marked as completed`);
    } catch (txnError) {
      console.error(`Error updating transaction: ${txnError.message}`);
      // Continue despite transaction update error
    }
    
    // Now try to update user premium status - do this unconditionally for now
    try {
      console.log(`Attempting to update user ${userId} to premium status`);
      
      // Check if user exists first
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.error(`User ${userId} not found in database. Creating new user.`);
        // Create user if doesn't exist
        await userRef.set({
          id: userId,
          isPremium: true,
          subscriptionType: subscriptionType,
          subscriptionDate: admin.firestore.Timestamp.now(),
          paymentId: mihpayid,
          subscriptionId: txnid,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Update existing user
        await userRef.update({
          isPremium: true,
          subscriptionType: subscriptionType,
          subscriptionDate: admin.firestore.Timestamp.now(),
          paymentId: mihpayid,
          subscriptionId: txnid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      
      // Verify the update was successful
      const updatedUser = await userRef.get();
      const userData = updatedUser.data();
      console.log(`Verification - User is now premium: ${userData.isPremium}`);
      
    } catch (userError) {
      console.error(`CRITICAL ERROR updating user premium status: ${userError.message}`);
      console.error(userError);
    }
    
    // Redirect to app with success status
    console.log('Redirecting to app success URL');
    res.redirect(`https://7989-49-206-60-211.ngrok-free.app/api/payment/success?txnid=${txnid}`);
    
  } catch (error) {
    console.error('Error in success callback:', error);
    res.redirect('yourfitnessapp://payment/error');
  }
});

// Failure callback endpoint
router.post('/payment/failure', async (req, res) => {
  try {
    const paymentResponse = req.body;
    const txnid = paymentResponse.txnid;
    
    console.log(`Payment failed for transaction ${txnid}:`, JSON.stringify(paymentResponse));
    
    // Update transaction record
    if (txnid) {
      await db.collection('transactions').doc(txnid).update({
        status: 'failed',
        failureReason: paymentResponse.error_Message || 'Payment failed',
        paymentResponse: paymentResponse,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`Transaction ${txnid} marked as failed in database`);
    }
    
    // Redirect to app with failure status
    res.redirect(`yourfitnessapp://payment/failure?message=${encodeURIComponent(paymentResponse.error_Message || 'Payment failed')}`);
    
  } catch (error) {
    console.error('Error processing payment failure:', error);
    res.redirect('yourfitnessapp://payment/error');
  }
});

// Webhook endpoint for PayU to notify about payment status
router.post('/payment/webhook', async (req, res) => {
  try {
    console.log('WEBHOOK RECEIVED');
    console.log('Webhook data:', JSON.stringify(req.body));
    
    const paymentData = req.body;
    const txnid = paymentData.txnid;
    const userId = paymentData.udf1;
    const subscriptionType = paymentData.udf2;
    const mihpayid = paymentData.mihpayid || 'WEBHOOK_PAYMENT_ID';
    
    // Always acknowledge receipt of webhook
    console.log(`Processing webhook notification for txn ${txnid}, user ${userId}`);
    
    // Skip validation for debugging
    // Update transaction regardless of status
    if (txnid) {
      try {
        await db.collection('transactions').doc(txnid).update({
          webhookResponse: paymentData,
          webhookReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: paymentData.status || 'webhook_received'
        });
        console.log(`Transaction ${txnid} updated with webhook data`);
      } catch (txnError) {
        console.error(`Error updating transaction: ${txnError.message}`);
      }
    }
    
    // For debugging, ALWAYS update the user premium status in webhook
    if (userId) {
      try {
        console.log(`Attempting to update user ${userId} to premium status via webhook`);
        
        // Check if user exists first
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
          console.error(`User ${userId} not found in database. Creating new user.`);
          // Create user if doesn't exist
          await userRef.set({
            id: userId,
            isPremium: true,
            subscriptionType: subscriptionType || 'Unknown',
            subscriptionDate: admin.firestore.Timestamp.now(),
            paymentId: mihpayid,
            subscriptionId: txnid,
            createdVia: 'webhook',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          // Update existing user
          await userRef.update({
            isPremium: true,
            subscriptionType: subscriptionType || userDoc.data().subscriptionType || 'Unknown',
            subscriptionDate: admin.firestore.Timestamp.now(),
            paymentId: mihpayid,
            subscriptionId: txnid,
            updatedVia: 'webhook',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        
        // Verify the update was successful
        const updatedUser = await userRef.get();
        const userData = updatedUser.data();
        console.log(`Webhook verification - User is now premium: ${userData.isPremium}`);
        
      } catch (userError) {
        console.error(`CRITICAL ERROR updating user premium status via webhook: ${userError.message}`);
        console.error(userError);
      }
    } else {
      console.error('No userId found in webhook data');
    }
    
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Error in webhook processing:', error);
    res.status(200).send('OK'); // Still acknowledge receipt even if error
  }
});

// Endpoint to check subscription status
router.get('/subscription/status/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`Checking subscription status for user ${userId}`);
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log(`User ${userId} not found in database`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    console.log(`User ${userId} subscription status: Premium=${userData.isPremium || false}, Type=${userData.subscriptionType || 'none'}`);
    
    res.status(200).json({
      isPremium: userData.isPremium || false,
      subscriptionType: userData.subscriptionType || null,
      subscriptionDate: userData.subscriptionDate || null
    });
    
  } catch (error) {
    console.error('Error checking subscription status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;