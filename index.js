const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const ROBLOX_USER_ID = 8213751331;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// State tracking
let lastBadges = [];
let lastStatus = null;

// Fetch user's badges
async function getUserBadges() {
  try {
    const response = await axios.get(
      `https://badges.roblox.com/v1/users/${ROBLOX_USER_ID}/badges?limit=10&sortOrder=Desc`
    );
    return response.data.data || [];
  } catch (error) {
    console.error('Error fetching badges:', error.message);
    return [];
  }
}

// Fetch user's online status
async function getUserStatus() {
  try {
    const response = await axios.post(
      'https://presence.roblox.com/v1/presence/users',
      { userIds: [ROBLOX_USER_ID] }
    );
    const userData = response.data.userPresences[0];
    return {
      status: userData.userPresenceType, // 0=offline, 1=online, 2=ingame
      lastLocation: userData.lastLocation || 'Unknown',
      placeId: userData.placeId
    };
  } catch (error) {
    console.error('Error fetching status:', error.message);
    return null;
  }
}

// Send Discord webhook
async function sendDiscordWebhook(content, embeds = []) {
  if (!DISCORD_WEBHOOK) {
    console.log('No webhook configured');
    return;
  }
  
  try {
    await axios.post(DISCORD_WEBHOOK, {
      content,
      embeds
    });
  } catch (error) {
    console.error('Error sending webhook:', error.message);
  }
}

// Compare badges and log changes
function compareBadges(newBadges) {
  const newBadgeIds = newBadges.map(b => b.id);
  const oldBadgeIds = lastBadges.map(b => b.id);

  // Check for new badges
  const addedBadges = newBadges.filter(b => !oldBadgeIds.includes(b.id));
  
  // Check for removed badges
  const removedBadges = lastBadges.filter(b => !newBadgeIds.includes(b.id));

  return { addedBadges, removedBadges };
}

// Get status text
function getStatusText(statusCode) {
  switch (statusCode) {
    case 0: return '🔴 Offline';
    case 1: return '🟢 Online';
    case 2: return '🎮 Playing';
    default: return '❓ Unknown';
  }
}

// Main monitoring function
async function checkUser() {
  console.log(`[${new Date().toISOString()}] Checking user ${ROBLOX_USER_ID}...`);

  // Check badges
  const currentBadges = await getUserBadges();
  
  if (lastBadges.length > 0) {
    const { addedBadges, removedBadges } = compareBadges(currentBadges);

    // Log new badges
    for (const badge of addedBadges) {
      await sendDiscordWebhook('', [{
        title: '🏆 New Badge Earned!',
        description: badge.name,
        fields: [
          { name: 'Description', value: badge.description || 'No description' },
          { name: 'Awarded', value: new Date(badge.created).toLocaleString() }
        ],
        color: 0x00ff00,
        thumbnail: { url: badge.iconImageId ? `https://assetdelivery.roblox.com/v1/asset/?id=${badge.iconImageId}` : null },
        timestamp: new Date().toISOString()
      }]);
    }

    // Log removed badges
    for (const badge of removedBadges) {
      await sendDiscordWebhook('', [{
        title: '❌ Badge Removed',
        description: badge.name,
        color: 0xff0000,
        timestamp: new Date().toISOString()
      }]);
    }
  }

  lastBadges = currentBadges;

  // Check status
  const currentStatus = await getUserStatus();
  
  if (lastStatus !== null && currentStatus) {
    if (lastStatus.status !== currentStatus.status) {
      const embeds = [{
        title: '📊 Status Changed',
        fields: [
          { name: 'Previous', value: getStatusText(lastStatus.status), inline: true },
          { name: 'Current', value: getStatusText(currentStatus.status), inline: true }
        ],
        color: currentStatus.status === 2 ? 0x0099ff : currentStatus.status === 1 ? 0x00ff00 : 0x808080,
        timestamp: new Date().toISOString()
      }];

      if (currentStatus.status === 2 && currentStatus.placeId) {
        embeds[0].fields.push({
          name: 'Game',
          value: `[View Game](https://www.roblox.com/games/${currentStatus.placeId})`
        });
      }

      await sendDiscordWebhook('', embeds);
    }
  }

  lastStatus = currentStatus;
}

// Initialize and start monitoring
async function initialize() {
  console.log('🚀 Starting Roblox User Monitor...');
  console.log(`Monitoring User ID: ${ROBLOX_USER_ID}`);
  console.log(`Check interval: Every 5 minutes`);
  
  // Initial check
  await checkUser();
  
  // Set up interval
  setInterval(checkUser, CHECK_INTERVAL);
}

// Health check endpoint for Render
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    userId: ROBLOX_USER_ID,
    lastCheck: lastStatus ? 'Active' : 'Initializing',
    uptime: process.uptime()
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initialize();
});
