require('dotenv').config();

const {
  Client, GatewayIntentBits,
  SlashCommandBuilder, REST, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');

const db = require('./db');
const { startCleanup } = require('./cleanup');

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function buildPartyEmbed(party, members) {
  const list = members.map((m, i) =>
    `${i + 1}. <@${m.user_id}>${m.user_id === party.creator_id ? ' (Creator)' : ''}`
  ).join('\n');

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${party.title}`)
    .setDescription(party.description || '*No details provided.*')
    .addFields({
      name: `Members (${members.length}/${party.max_size})`,
      value: list || '*Empty*',
    })
    .setFooter({ text: `Party ID: ${party.message_id}` })
    .setTimestamp();
}

function buildMemberButtons(messageId, party, members) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${messageId}`)
      .setLabel('Join')
      .setStyle(ButtonStyle.Success)
      .setDisabled(members.length >= party.max_size),
    new ButtonBuilder()
      .setCustomId(`leave_${messageId}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`manage_${messageId}`)
      .setLabel('Manage')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildAdminPanel(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin_edit_${messageId}`)
      .setLabel('Edit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`admin_close_${messageId}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`admin_remove_${messageId}`)
      .setLabel('Remove')
      .setStyle(ButtonStyle.Primary),
  );
}

async function updateEmbed(messageId) {
  const party = db.getParty(messageId);
  if (!party) return;

  const members = db.getMembers(messageId);
  let channel;
  try {
    channel = await client.channels.fetch(party.channel_id);
  } catch {
    return;
  }
  try {
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({
      embeds: [buildPartyEmbed(party, members)],
      components: [buildMemberButtons(messageId, party, members)],
    });
  } catch {
    // Message may be gone
  }
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('lfg')
      .setDescription('Create a new LFG party')
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands },
  );
  console.log('Registered global /lfg command');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  db.init();
  await registerCommands();
  startCleanup(client);
});

client.on('messageDelete', (message) => {
  if (db.getParty(message.id)) {
    db.deleteParty(message.id);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    /* ───── /lfg ───── */
    if (interaction.isChatInputCommand() && interaction.commandName === 'lfg') {
      const modal = new ModalBuilder()
        .setCustomId('create_modal')
        .setTitle('Create LFG Party');

      const titleInput = new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Party Title / Game Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const sizeInput = new TextInputBuilder()
        .setCustomId('max_size')
        .setLabel('Max Members (1–32)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2)
        .setValue('4');

      const descInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Details / Requirements')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(sizeInput),
        new ActionRowBuilder().addComponents(descInput),
      );

      await interaction.showModal(modal);
      return;
    }

    /* ───── Modal submissions ───── */
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'create_modal') {
        const title = interaction.fields.getTextInputValue('title');
        const sizeRaw = interaction.fields.getTextInputValue('max_size');
        const maxSize = parseInt(sizeRaw, 10);
        if (!/^\d+$/.test(sizeRaw) || maxSize < 1 || maxSize > 32) {
          await interaction.reply({
            content: 'Max Members must be a whole number between 1 and 32.',
            ephemeral: true,
          });
          return;
        }
        const description = interaction.fields.getTextInputValue('description') || '';

        await interaction.deferReply();

        const reply = await interaction.fetchReply();
        const messageId = reply.id;

        db.createParty(
          messageId,
          interaction.guildId,
          interaction.channelId,
          interaction.user.id,
          title,
          description,
          maxSize,
        );

        const party = db.getParty(messageId);
        const members = db.getMembers(messageId);

        await interaction.editReply({
          embeds: [buildPartyEmbed(party, members)],
          components: [buildMemberButtons(messageId, party, members)],
        });
        return;
      }

      if (interaction.customId.startsWith('edit_modal_')) {
        const messageId = interaction.customId.slice('edit_modal_'.length);
        const party = db.getParty(messageId);

        if (!party) {
          await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
          return;
        }
        if (party.creator_id !== interaction.user.id) {
          await interaction.reply({ content: 'Only the party creator can edit this party.', ephemeral: true });
          return;
        }

        const title = interaction.fields.getTextInputValue('title');
        const description = interaction.fields.getTextInputValue('description') || '';
        db.updateParty(messageId, title, description);

        await interaction.reply({ content: 'Party updated!', ephemeral: true });
        await updateEmbed(messageId);
        return;
      }
    }

    /* ───── Select menu interactions ───── */
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('remove_select_')) {
      const messageId = interaction.customId.slice('remove_select_'.length);
      const targetUserId = interaction.values[0];

      const party = db.getParty(messageId);
      if (!party) {
        await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
        return;
      }
      if (party.creator_id !== interaction.user.id) {
        await interaction.reply({ content: 'Only the party creator can remove members.', ephemeral: true });
        return;
      }

      db.removeMember(messageId, targetUserId);
      const updated = db.getMembers(messageId);

      let targetName = `<@${targetUserId}>`;
      try {
        const user = await client.users.fetch(targetUserId);
        targetName = user.displayName;
      } catch {
        // fallback to mention
      }

      if (updated.length === 0) {
        db.deleteParty(messageId);
        await interaction.update({
          components: [],
          content: `Removed **${targetName}**. Party closed — no members remaining.`,
        });
        try {
          const embedMsg = await interaction.channel.messages.fetch(messageId);
          await embedMsg.delete();
        } catch {
          // Best-effort
        }
        return;
      }

      await updateEmbed(messageId);
      await interaction.update({
        components: [],
        content: `Removed **${targetName}** from the party.`,
      });
      return;
    }

    /* ───── Button interactions ───── */
    if (interaction.isButton()) {
      let action, messageId;

      if (interaction.customId.startsWith('admin_')) {
        const tail = interaction.customId.slice('admin_'.length);
        const sep = tail.indexOf('_');
        action = tail.slice(0, sep);
        messageId = tail.slice(sep + 1);
      } else {
        const sep = interaction.customId.indexOf('_');
        if (sep === -1) return;
        action = interaction.customId.slice(0, sep);
        messageId = interaction.customId.slice(sep + 1);
      }

      const party = db.getParty(messageId);
      if (!party) {
        await interaction.reply({ content: 'This party no longer exists.', ephemeral: true });
        return;
      }

      /* ───── Join ───── */
      if (action === 'join') {
        const members = db.getMembers(messageId);
        if (members.length >= party.max_size) {
          await interaction.reply({ content: 'This party is already full!', ephemeral: true });
          return;
        }
        if (members.some((m) => m.user_id === interaction.user.id)) {
          await interaction.reply({ content: 'You are already in this party!', ephemeral: true });
          return;
        }

        db.addMember(messageId, interaction.user.id);
        const afterJoin = db.getMembers(messageId);
        await interaction.update({
          embeds: [buildPartyEmbed(party, afterJoin)],
          components: [buildMemberButtons(messageId, party, afterJoin)],
        });
        return;
      }

      /* ───── Leave ───── */
      if (action === 'leave') {
        const removed = db.removeMember(messageId, interaction.user.id);
        if (!removed) {
          await interaction.reply({ content: 'You are not a member of this party.', ephemeral: true });
          return;
        }

        const updated = db.getMembers(messageId);

        if (updated.length === 0) {
          db.deleteParty(messageId);
          await interaction.update({
            embeds: [],
            components: [],
            content: 'Party closed — no members remaining.',
          });
          try {
            await new Promise((r) => setTimeout(r, 2000));
            await interaction.message.delete();
          } catch {
            // Best-effort cleanup
          }
          return;
        }

        await interaction.update({
          embeds: [buildPartyEmbed(party, updated)],
          components: [buildMemberButtons(messageId, party, updated)],
        });
        return;
      }

      /* ───── Manage (gateway to admin panel) ───── */
      if (action === 'manage') {
        if (party.creator_id !== interaction.user.id) {
          await interaction.reply({ content: 'Only the party creator can manage this party.', ephemeral: true });
          return;
        }

        await interaction.reply({
          content: '**Party Management** — use these controls for your party:',
          components: [buildAdminPanel(messageId)],
          ephemeral: true,
        });
        return;
      }

      /* ───── Admin: Edit ───── */
      if (action === 'edit') {
        if (party.creator_id !== interaction.user.id) {
          await interaction.reply({ content: 'Only the party creator can edit this party.', ephemeral: true });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`edit_modal_${messageId}`)
          .setTitle('Edit LFG Party');

        const titleInput = new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Party Title / Game Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(party.title);

        const descInput = new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Details / Requirements')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue(party.description || '');

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
        );

        await interaction.showModal(modal);
        return;
      }

      /* ───── Admin: Close ───── */
      if (action === 'close') {
        if (party.creator_id !== interaction.user.id) {
          await interaction.reply({ content: 'Only the party creator can close this party.', ephemeral: true });
          return;
        }

        db.deleteParty(messageId);
        try {
          const msg = await interaction.channel.messages.fetch(messageId);
          await msg.delete();
        } catch {
          // Message may already be gone
        }
        await interaction.reply({ content: 'Party closed.', ephemeral: true });
        return;
      }

      /* ───── Admin: Remove ───── */
      if (action === 'remove') {
        if (party.creator_id !== interaction.user.id) {
          await interaction.reply({ content: 'Only the party creator can remove members.', ephemeral: true });
          return;
        }

        const members = db.getMembers(messageId);
        const removable = members.filter((m) => m.user_id !== interaction.user.id);

        if (removable.length === 0) {
          await interaction.reply({ content: 'No other members to remove.', ephemeral: true });
          return;
        }

        const options = await Promise.all(
          removable.map(async (m) => {
            try {
              const user = await client.users.fetch(m.user_id);
              return new StringSelectMenuOptionBuilder()
                .setLabel(user.displayName)
                .setValue(m.user_id);
            } catch {
              return new StringSelectMenuOptionBuilder()
                .setLabel(`Unknown (${m.user_id})`)
                .setValue(m.user_id);
            }
          }),
        );

        const select = new StringSelectMenuBuilder()
          .setCustomId(`remove_select_${messageId}`)
          .setPlaceholder('Select a member to remove')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options);

        await interaction.update({
          content: 'Choose a member to remove:',
          components: [new ActionRowBuilder().addComponents(select)],
        });
        return;
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    try {
      const payload = { content: 'An error occurred. Please try again.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      // Best-effort error response
    }
  }
});

client.login(TOKEN);
