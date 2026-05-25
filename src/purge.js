require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const db = require('./db');

const TOKEN = process.env.DISCORD_TOKEN;

async function main() {
  db.init();

  const parties = db.getAllParties();
  if (parties.length === 0) {
    console.log('No parties to purge.');
    process.exit(0);
  }

  console.log(`Found ${parties.length} party(ies) to purge.`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(TOKEN);

  for (const party of parties) {
    try {
      const channel = await client.channels.fetch(party.channel_id);
      if (channel) {
        try {
          const msg = await channel.messages.fetch(party.message_id);
          await msg.delete();
        } catch {
          // Message already gone
        }
      }
    } catch {
      // Channel gone
    }
    db.deleteParty(party.message_id);
    console.log(`Purged party ${party.message_id} (${party.title})`);
  }

  await client.destroy();
  console.log(`Purge complete — ${parties.length} party(ies) removed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Purge failed:', err);
  process.exit(1);
});
