// routes/fitfuel.js
const express = require('express');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

// Constants
const FREE_TIER_PLAN_TOKENS = 10000; // Free tier tokens for plan generation
const FREE_TIER_IMAGE_TOKENS = 10000; // Free tier tokens for image analysis
// Updated Gemini API URL - this is the correct endpoint format for Gemini
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAucRYgtPspGpF9vuHh_8VzrRwzIfNqv0M';

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB file size limit
});

// Initialize Firebase Admin if not already initialized
try {
  if (!admin.apps.length) {
    // Get the path to service account key file
    const serviceAccountPath = path.join(__dirname, '../fitfuel-5abf9-firebase-adminsdk-fbsvc-b83ce3a302.json');
    console.log('Service account path:', serviceAccountPath);
    console.log('File exists:', fs.existsSync(serviceAccountPath));
    
    // Read and parse the service account file
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    console.log('Service account loaded successfully');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized successfully');
  }
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
}

// Get Firestore instance with error handling
let db;
try {
  db = admin.firestore();
  console.log('Firestore initialized successfully');
} catch (error) {
  console.error('Error initializing Firestore:', error);
}

// Track plan generation token usage for a user
async function trackPlanTokenUsagePlan(userId, tokensUsed) {
  try {
    if (!db) {
      console.error('Firestore not initialized');
      return { error: 'Database not available' };
    }
    
    const userRef = db.collection('users').doc(userId);
    console.log(`Tracking plan generation tokens for user: ${userId}`);
    
    const userDoc = await userRef.get();
    
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const usagePeriod = `${currentYear}-${currentMonth}`;
    
    if (!userDoc.exists) {
      console.log(`User ${userId} not found, creating new document`);
      const newUserData = {
        tokenUsagePlan: {
          period: usagePeriod,
          planGenerationTokens: tokensUsed
        }
      };
      
      await userRef.set(newUserData);
      
      return {
        period: usagePeriod,
        tokensUsed: tokensUsed,
        featureType: 'planGeneration'
      };
    }
    
    const userData = userDoc.data();
    
    if (!userData.tokenUsagePlan) {
      await userRef.update({
        tokenUsagePlan: {
          period: usagePeriod,
          planGenerationTokens: tokensUsed
        }
      });
      
      return {
        period: usagePeriod,
        tokensUsed: tokensUsed,
        featureType: 'planGeneration'
      };
    }
    
    if (userData.tokenUsagePlan.period !== usagePeriod) {
      await userRef.update({
        'tokenUsagePlan.period': usagePeriod,
        'tokenUsagePlan.planGenerationTokens': tokensUsed
      });
      
      return {
        period: usagePeriod,
        tokensUsed: tokensUsed,
        featureType: 'planGeneration'
      };
    } else {
      const currentTokens = userData.tokenUsagePlan.planGenerationTokens || 0;
      const newTokensTotal = currentTokens + tokensUsed;
      
      await userRef.update({
        'tokenUsagePlan.planGenerationTokens': newTokensTotal
      });
      
      return {
        period: usagePeriod,
        tokensUsed: newTokensTotal,
        featureType: 'planGeneration'
      };
    }
  } catch (error) {
    console.error('Error tracking plan generation token usage:', error);
    return { error: 'Failed to track plan generation token usage' };
  }
}

// Track image analysis token usage for a user
async function trackImageTokenUsageImage(userId, tokensUsed) {
  try {
    if (!db) {
      console.error('Firestore not initialized');
      return { error: 'Database not available' };
    }
    
    const userRef = db.collection('users').doc(userId);
    console.log(`Tracking image analysis tokens for user: ${userId}`);
    
    const userDoc = await userRef.get();
    
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const usagePeriod = `${currentYear}-${currentMonth}`;
    
    if (!userDoc.exists) {
      console.log(`User ${userId} not found, creating new document`);
      const newUserData = {
        tokenUsageImage: {
          period: usagePeriod,
          imageAnalysisTokens: tokensUsed
        }
      };
      
      await userRef.set(newUserData);
      
      return {
        period: usagePeriod,
        tokensUsed: tokensUsed,
        featureType: 'imageAnalysis'
      };
    }
    
    const userData = userDoc.data();
    
    if (!userData.tokenUsageImage) {
      await userRef.update({
        tokenUsageImage: {
          period: usagePeriod,
          imageAnalysisTokens: tokensUsed
        }
      });
      
      return {
        period: usagePeriod,
        tokensUsed: tokensUsed,
        featureType: 'imageAnalysis'
      };
    }
    
    if (userData.tokenUsageImage.period !== usagePeriod) {
      await userRef.update({
        'tokenUsageImage.period': usagePeriod,
        'tokenUsageImage.imageAnalysisTokens': tokensUsed
      });
      
      return {
        period: usagePeriod,
        tokensUsed: tokensUsed,
        featureType: 'imageAnalysis'
      };
    } else {
      const currentTokens = userData.tokenUsageImage.imageAnalysisTokens || 0;
      const newTokensTotal = currentTokens + tokensUsed;
      
      await userRef.update({
        'tokenUsageImage.imageAnalysisTokens': newTokensTotal
      });
      
      return {
        period: usagePeriod,
        tokensUsed: newTokensTotal,
        featureType: 'imageAnalysis'
      };
    }
  } catch (error) {
    console.error('Error tracking image analysis token usage:', error);
    return { error: 'Failed to track image analysis token usage' };
  }
}

// Function to analyze image with Gemini API (similar to mobile app logic)
async function analyzeImageWithGemini(base64Image) {
  try {
    // Extract just the base64 data without the prefix
    let base64Data = base64Image;
    if (base64Image.includes(',')) {
      base64Data = base64Image.split(',')[1];
    }

    // Prepare request for Gemini with a structured prompt
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: 'This is an image of food. Analyze this image and respond ONLY with the following numbered format:\n\n1) [Name of food]\n2) [Number] calories\n3) [Number] g protein\n4) [Number] g fat\n5) [Number] g carbohydrates\n6) [Number] g sugar\n7) [Yes/No] for whether this is considered junk food\n\nDo not include any other text, explanations, or formatting.',
            },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        },
      ],
      generation_config: {
        temperature: 0.2, // Lower temperature for more consistent formatting
        top_p: 0.95,
        max_output_tokens: 2048,
      },
    };

    // Send request to Gemini API
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    // Process Gemini response
    if (data.candidates && data.candidates.length > 0) {
      const textResponse = data.candidates[0].content.parts[0].text;
      
      // Parse the response using regex patterns (same as mobile app)
      const result = {
        foodName: 'Unknown food',
        calories: '0',
        protein: '0',
        fat: '0',
        carbohydrates: '0',
        sugars: '0',
        isJunkFood: 0,
        rawResponse: textResponse
      };
      
      // Extract food name
      const foodNameMatch = textResponse.match(/1\)[ \t]*([^\n]+)/);
      if (foodNameMatch && foodNameMatch[1]) {
        result.foodName = foodNameMatch[1].trim();
      }
      
      // Extract calories
      const calorieMatch = textResponse.match(/2\)[ \t]*(\d+(?:\.\d+)?)/);
      if (calorieMatch && calorieMatch[1]) {
        result.calories = calorieMatch[1];
      }
      
      // Extract protein
      const proteinMatch = textResponse.match(/3\)[ \t]*(\d+(?:\.\d+)?)/);
      if (proteinMatch && proteinMatch[1]) {
        result.protein = proteinMatch[1];
      }
      
      // Extract fat
      const fatMatch = textResponse.match(/4\)[ \t]*(\d+(?:\.\d+)?)/);
      if (fatMatch && fatMatch[1]) {
        result.fat = fatMatch[1];
      }
      
      // Extract carbohydrates
      const carbohydrateMatch = textResponse.match(/5\)[ \t]*(\d+(?:\.\d+)?)/);
      if (carbohydrateMatch && carbohydrateMatch[1]) {
        result.carbohydrates = carbohydrateMatch[1];
      }
      
      // Extract sugars
      const sugarMatch = textResponse.match(/6\)[ \t]*(\d+(?:\.\d+)?)/);
      if (sugarMatch && sugarMatch[1]) {
        result.sugars = sugarMatch[1];
      }
      
      // Check for junk food classification
      const junkFoodMatch = textResponse.match(/7\)[ \t]*(\w+)/i);
      if (junkFoodMatch && junkFoodMatch[1]) {
        result.isJunkFood = junkFoodMatch[1].toLowerCase().includes('yes') ? 1 : 0;
      }
      
      return result;
    } else {
      throw new Error('No response from Gemini API or invalid response format');
    }
  } catch (error) {
    console.error('Error analyzing image with Gemini:', error);
    throw error;
  }
}

// Similar function for barcode/package scanning
async function scanBarcodeWithGemini(base64Image) {
  try {
    // Extract just the base64 data without the prefix
    let base64Data = base64Image;
    if (base64Image.includes(',')) {
      base64Data = base64Image.split(',')[1];
    }
    
    // Prepare request for Gemini with a barcode scanning prompt
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: 'This is an image of a barcode or packaged food product. Extract the barcode number if visible or read the nutrition facts from the package. Respond ONLY with the following numbered format:\n\n1) [Name of product]\n2) [Number] calories\n3) [Number] g protein\n4) [Number] g fat\n5) [Number] g carbohydrates\n6) [Number] g sugar\n7) [Yes/No] for whether this is considered junk food\n\nDo not include any other text, explanations, or formatting.',
            },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        },
      ],
      generation_config: {
        temperature: 0.2,
        top_p: 0.95,
        max_output_tokens: 2048,
      },
    };
    
    // Send request to Gemini API
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const data = await response.json();
    
    // Process Gemini response using the same parsing logic as food analysis
    if (data.candidates && data.candidates.length > 0) {
      const textResponse = data.candidates[0].content.parts[0].text;
      
      // Parse the response using regex patterns
      const result = {
        foodName: 'Unknown product',
        calories: '0',
        protein: '0',
        fat: '0',
        carbohydrates: '0',
        sugars: '0',
        isJunkFood: 0,
        rawResponse: textResponse
      };
      
      // Extract product name
      const foodNameMatch = textResponse.match(/1\)[ \t]*([^\n]+)/);
      if (foodNameMatch && foodNameMatch[1]) {
        result.foodName = foodNameMatch[1].trim();
      }
      
      // Extract calories
      const calorieMatch = textResponse.match(/2\)[ \t]*(\d+(?:\.\d+)?)/);
      if (calorieMatch && calorieMatch[1]) {
        result.calories = calorieMatch[1];
      }
      
      // Extract protein
      const proteinMatch = textResponse.match(/3\)[ \t]*(\d+(?:\.\d+)?)/);
      if (proteinMatch && proteinMatch[1]) {
        result.protein = proteinMatch[1];
      }
      
      // Extract fat
      const fatMatch = textResponse.match(/4\)[ \t]*(\d+(?:\.\d+)?)/);
      if (fatMatch && fatMatch[1]) {
        result.fat = fatMatch[1];
      }
      
      // Extract carbohydrates
      const carbohydrateMatch = textResponse.match(/5\)[ \t]*(\d+(?:\.\d+)?)/);
      if (carbohydrateMatch && carbohydrateMatch[1]) {
        result.carbohydrates = carbohydrateMatch[1];
      }
      
      // Extract sugars
      const sugarMatch = textResponse.match(/6\)[ \t]*(\d+(?:\.\d+)?)/);
      if (sugarMatch && sugarMatch[1]) {
        result.sugars = sugarMatch[1];
      }
      
      // Check for junk food classification
      const junkFoodMatch = textResponse.match(/7\)[ \t]*(\w+)/i);
      if (junkFoodMatch && junkFoodMatch[1]) {
        result.isJunkFood = junkFoodMatch[1].toLowerCase().includes('yes') ? 1 : 0;
      }
      
      return result;
    } else {
      throw new Error('No response from Gemini API or invalid response format');
    }
  } catch (error) {
    console.error('Error scanning barcode with Gemini:', error);
    throw error;
  }
}

// Endpoint to generate plan and track tokens
router.post('/generate-plan', async (req, res) => {
  try {
    const { userId, prompt } = req.body;
    
    if (!userId || !prompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log(`Processing plan generation request for user: ${userId}`);
    
    // Estimate tokens in the prompt (rough estimation)
    const estimatedPromptTokens = Math.ceil(prompt.length / 4);
    
    // Call Gemini API with correct version and format
    console.log('Calling Gemini API...');
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          role: "user",
          parts: [{ text: prompt }] 
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API error:', errorData);
      return res.status(500).json({ 
        error: 'Gemini API error', 
        details: errorData 
      });
    }
    
    const data = await response.json();
    
    // Updated response handling based on Gemini API structure
    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      console.error('Invalid Gemini API response:', data);
      return res.status(500).json({ error: 'Invalid API response', details: data });
    }
    
    // Extract the response text
    const generatedText = data.candidates[0].content.parts[0].text;
    
    // Get actual token counts if provided by the API
    const promptTokens = data.usageMetadata?.promptTokenCount || estimatedPromptTokens;
    const completionTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(generatedText.length / 4);
    const totalTokensUsed = promptTokens + completionTokens;
    
    // Track the token usage specifically for plan generation using the dedicated function
    console.log('Tracking plan generation token usage...');
    const usage = await trackPlanTokenUsagePlan(userId, totalTokensUsed);
    
    if (usage.error) {
      return res.status(500).json({ error: usage.error });
    }
    
    // Calculate remaining free tokens for plan generation
    const remainingTokens = Math.max(0, FREE_TIER_PLAN_TOKENS - usage.tokensUsed);
    
    // Send back the response with token info
    res.json({
      plan: generatedText,
      tokenInfo: {
        used: usage.tokensUsed,
        remaining: remainingTokens,
        period: usage.period,
        featureType: 'planGeneration'
      }
    });
    
  } catch (error) {
    console.error('Error generating plan:', error);
    res.status(500).json({ error: 'Failed to generate plan', details: error.message });
  }
});

// Analyze food image endpoint
router.post('/analyze-image', upload.single('image'), async (req, res) => {
  try {
    // Extract parameters
    const { userId, scanMode = 'food' } = req.body;
    
    // Validate required fields
    if (!userId) {
      return res.status(400).json({ error: 'Missing required user ID' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    
    // Convert the file buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    
    console.log(`Processing ${scanMode} image for user: ${userId}`);
    
    // Analyze based on scan mode
    let analysisResult;
    if (scanMode === 'barcode') {
      analysisResult = await scanBarcodeWithGemini(base64Image);
    } else {
      analysisResult = await analyzeImageWithGemini(base64Image);
    }
    
    // Estimate token usage (rough estimation based on image size and response)
    const estimatedTokens = Math.ceil(req.file.size / 100) + Math.ceil(JSON.stringify(analysisResult).length / 4);
    
    // Track token usage specifically for image analysis using the dedicated function
    const usage = await trackImageTokenUsageImage(userId, estimatedTokens);
    
    if (usage.error) {
      return res.status(500).json({ error: usage.error });
    }
    
    // Calculate remaining free tokens for image analysis
    const remainingTokens = Math.max(0, FREE_TIER_IMAGE_TOKENS - usage.tokensUsed);
    
    // Send response
    res.json({
      analysis: {
        foodName: analysisResult.foodName,
        calories: parseFloat(analysisResult.calories) || 0,
        protein: parseFloat(analysisResult.protein) || 0,
        fat: parseFloat(analysisResult.fat) || 0,
        carbohydrates: parseFloat(analysisResult.carbohydrates) || 0,
        sugars: parseFloat(analysisResult.sugars) || 0,
        isJunkFood: analysisResult.isJunkFood
      },
      tokenInfo: {
        used: usage.tokensUsed,
        remaining: remainingTokens,
        period: usage.period,
        featureType: 'imageAnalysis'
      },
      scanMode
    });
    
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({ error: 'Failed to analyze image', details: error.message });
  }
});

// Log meal to Firestore endpoint
router.post('/log-meal', async (req, res) => {
  try {
    const { 
      userId, 
      foodName, 
      calories, 
      protein, 
      fat, 
      carbohydrates, 
      sugars, 
      isJunkFood, 
      imageUrl 
    } = req.body;
    
    if (!userId || !foodName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    
    // Create meal object
    const mealData = {
      userId,
      foodName: foodName || 'Unknown food',
      calories: parseInt(calories) || 0,
      protein: protein ? parseInt(protein) : 0,
      fat: fat ? parseInt(fat) : 0,
      carbohydrates: carbohydrates ? parseInt(carbohydrates) : 0,
      sugars: sugars ? parseInt(sugars) : 0,
      junk: isJunkFood ? 1 : 0,
      image: imageUrl || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Add meal to meals collection
    const mealsCollection = db.collection('meals');
    const mealRef = await mealsCollection.add(mealData);
    
    // Update user totals
    const userRef = db.collection('users').doc(userId);
    
    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Check if user exists and get their current data
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    let mealsTrackedToday = userData?.mealsTrackedToday || 0;
    let currentStreak = userData?.streak || 0;
    let lastStreakDate = userData?.lastStreakDate?.toDate();
    let lastTrackingDate = userData?.lastTrackingDate?.toDate();
    
    if (lastTrackingDate) {
      lastTrackingDate.setHours(0, 0, 0, 0);
      
      // If last tracking date is not today, reset counter
      if (lastTrackingDate.getTime() !== today.getTime()) {
        mealsTrackedToday = 1;
        
        // Check if lastStreakDate was yesterday to maintain streak
        if (lastStreakDate) {
          lastStreakDate.setHours(0, 0, 0, 0);
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          
          if (lastStreakDate.getTime() === yesterday.getTime()) {
            // Last streak was yesterday, continue the streak
          } else {
            // Streak broken, reset to 0
            currentStreak = 0;
          }
        }
      } else {
        // Increment counter if already tracking today
        mealsTrackedToday += 1;
        
        // Check if they've now reached 2 meals today to increment streak
        if (
          mealsTrackedToday >= 2 &&
          lastStreakDate?.getTime() !== today.getTime()
        ) {
          currentStreak += 1;
          // Update lastStreakDate to today since they've hit the goal
          lastStreakDate = today;
        }
      }
    } else {
      mealsTrackedToday = 1;
      // First ever tracking, streak remains at 0
    }
    
    // Update user document
    await userRef.update({
      totalCalories: admin.firestore.FieldValue.increment(parseInt(calories) || 0),
      totalProtein: admin.firestore.FieldValue.increment(protein ? parseInt(protein) : 0),
      totalFat: admin.firestore.FieldValue.increment(fat ? parseInt(fat) : 0),
      totalCarbohydrates: admin.firestore.FieldValue.increment(carbohydrates ? parseInt(carbohydrates) : 0),
      totalSugars: admin.firestore.FieldValue.increment(sugars ? parseInt(sugars) : 0),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      lastTrackingDate: today,
      mealsTrackedToday: mealsTrackedToday,
      streak: currentStreak,
      lastStreakDate: mealsTrackedToday >= 2 ? today : lastStreakDate || null,
    });
    
    // Respond with success
    res.json({
      success: true,
      mealId: mealRef.id,
      streak: currentStreak,
      mealsTrackedToday
    });
    
  } catch (error) {
    console.error('Error logging meal:', error);
    res.status(500).json({ error: 'Failed to log meal', details: error.message });
  }
});

// Simple health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    firebase: !!db,
    features: {
      planGeneration: {
        freeTokens: FREE_TIER_PLAN_TOKENS
      },
      imageAnalysis: {
        freeTokens: FREE_TIER_IMAGE_TOKENS
      }
    }
  });
});

// Get user token usage
router.get('/user-tokens/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing user ID' });
    }
    
    if (!db) {
      return res.status(500).json({ error: 'Database not available' });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const tokenUsagePlan = userData.tokenUsagePlan || {
      period: `${new Date().getFullYear()}-${new Date().getMonth() + 1}`,
      planGenerationTokens: 0
    };
    const tokenUsageImage = userData.tokenUsageImage || {
      period: `${new Date().getFullYear()}-${new Date().getMonth() + 1}`,
      imageAnalysisTokens: 0
    };
    
    const planGenRemaining = Math.max(0, FREE_TIER_PLAN_TOKENS - (tokenUsagePlan.planGenerationTokens || 0));
    const imageAnalysisRemaining = Math.max(0, FREE_TIER_IMAGE_TOKENS - (tokenUsageImage.imageAnalysisTokens || 0));
    
    res.json({
      userId,
      tokenUsage: {
        planGeneration: {
          period: tokenUsagePlan.period,
          used: tokenUsagePlan.planGenerationTokens || 0,
          remaining: planGenRemaining,
          limit: FREE_TIER_PLAN_TOKENS
        },
        imageAnalysis: {
          period: tokenUsageImage.period,
          used: tokenUsageImage.imageAnalysisTokens || 0,
          remaining: imageAnalysisRemaining,
          limit: FREE_TIER_IMAGE_TOKENS
        }
      }
    });
    
  } catch (error) {
    console.error('Error getting user token usage:', error);
    res.status(500).json({ error: 'Failed to get token usage', details: error.message });
  }
});

module.exports = router;