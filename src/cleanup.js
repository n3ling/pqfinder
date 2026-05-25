const db = require('./db');

async function cleanupOldParties(client) {
  const parties = db.getOldParties(24);
  if (parties.length === 0) return;

  for (const party of parties) {
    try {
      const channel = await client.channels.fetch(party.channel_id);
      if (channel) {
        try {
          const msg = await channel.messages.fetch(party.message_id);
          await msg.delete();
        } catch {
          // Message already deleted — nothing to do
        }
      }
    } catch {
      // Channel inaccessible — clean up DB entry regardless
    }
    db.deleteParty(party.message_id);
  }
  console.log(`[Cleanup] Removed ${parties.length} stale party(ies)`);
}

function startCleanup(client) {
  cleanupOldParties(client).catch((err) => console.error('[Cleanup] Startup error:', err));

  setInterval(async () => {
    try {
      await cleanupOldParties(client);
    } catch (err) {
      console.error('[Cleanup] Interval error:', err);
    }
  }, 60 * 60 * 1000);
}

module.exports = { startCleanup };
