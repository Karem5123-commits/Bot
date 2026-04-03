import {
  Client, Collection, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, PermissionsBitField
} from 'discord.js';

import mongoose from 'mongoose';
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const client = new Client({ intents: 32767 });

/* ================= DB ================= */

await mongoose.connect(process.env.MONGO_URI);

const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: 'Bronze' },
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  rejected: { type: Number, default: 0 }
});

const submissionSchema = new mongoose.Schema({
  subId: String,
  userId: String,
  username: String,
  link: String,
  score: Number,
  status: { type: String, default: 'pending' },
  reviewedBy: String
});

const guildConfigSchema = new mongoose.Schema({
  guildId: String,
  reviewChannelId: String
});

const User = mongoose.model('User', userSchema);
const Submission = mongoose.model('Submission', submissionSchema);
const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

/* ================= UTIL ================= */

const uid = () => crypto.randomBytes(4).toString('hex');

const deltaMMR = (score) => Math.round((score - 5.5) * 40);

const RANKS = [
  { name: 'Bronze', mmr: 0 },
  { name: 'Silver', mmr: 800 },
  { name: 'Gold', mmr: 1000 },
  { name: 'Platinum', mmr: 1200 },
  { name: 'Diamond', mmr: 1400 }
];

function getRank(mmr) {
  let r = RANKS[0];
  for (const rank of RANKS) if (mmr >= rank.mmr) r = rank;
  return r;
}

/* ================= BUTTONS ================= */

const reviewButtons = (id) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve_${id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject_${id}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`score_${id}`).setLabel('✏️ Score').setStyle(ButtonStyle.Primary)
  );

/* ================= READY ================= */

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName('submit').setDescription('Submit clip'),
    new SlashCommandBuilder().setName('profile').setDescription('Profile'),
    new SlashCommandBuilder().setName('setup_review').setDescription('Set review channel')
      .addChannelOption(o => o.setName('channel').setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
});

/* ================= INTERACTIONS ================= */

client.on('interactionCreate', async i => {
  try {

    /* ===== COMMANDS ===== */

    if (i.isChatInputCommand()) {

      if (i.commandName === 'setup_review') {
        if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator))
          return i.reply({ content: 'Admin only', ephemeral: true });

        const ch = i.options.getChannel('channel');

        await GuildConfig.findOneAndUpdate(
          { guildId: i.guild.id },
          { reviewChannelId: ch.id },
          { upsert: true }
        );

        return i.reply(`✅ Review channel set to ${ch}`);
      }

      if (i.commandName === 'submit') {
        const modal = new ModalBuilder()
          .setCustomId('submit_modal')
          .setTitle('Submit Clip');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('link')
              .setLabel('Video URL')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return i.showModal(modal);
      }

      if (i.commandName === 'profile') {
        let user = await User.findOne({ userId: i.user.id });
        if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

        const rank = getRank(user.mmr);

        const embed = new EmbedBuilder()
          .setTitle(`${i.user.username}`)
          .setDescription(`Rank: ${rank.name}\nMMR: ${user.mmr}`)
          .setColor(0x3498db);

        return i.reply({ embeds: [embed] });
      }
    }

    /* ===== BUTTONS ===== */

    if (i.isButton()) {
      const [action, subId] = i.customId.split('_');

      const sub = await Submission.findOne({ subId });
      if (!sub) return i.reply({ content: 'Not found', ephemeral: true });

      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
        return i.reply({ content: 'Staff only', ephemeral: true });

      if (action === 'approve') {
        const score = 7;
        const gain = deltaMMR(score);

        await Submission.updateOne({ subId }, { status: 'approved', score });

        await User.updateOne(
          { userId: sub.userId },
          { $inc: { mmr: gain, accepted: 1 } },
          { upsert: true }
        );

        return i.update({ content: `✅ Approved (+${gain})`, components: [] });
      }

      if (action === 'reject') {
        await Submission.updateOne({ subId }, { status: 'rejected' });

        await User.updateOne(
          { userId: sub.userId },
          { $inc: { rejected: 1 } },
          { upsert: true }
        );

        return i.update({ content: `❌ Rejected`, components: [] });
      }

      if (action === 'score') {
        const modal = new ModalBuilder()
          .setCustomId(`score_${subId}`)
          .setTitle('Set Score');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('score')
              .setLabel('0-10')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );

        return i.showModal(modal);
      }
    }

    /* ===== MODALS ===== */

    if (i.isModalSubmit()) {

      if (i.customId === 'submit_modal') {
        const link = i.fields.getTextInputValue('link');
        const subId = uid();

        await Submission.create({
          subId,
          userId: i.user.id,
          username: i.user.tag,
          link
        });

        await User.updateOne(
          { userId: i.user.id },
          { $inc: { submissions: 1 } },
          { upsert: true }
        );

        const config = await GuildConfig.findOne({ guildId: i.guild.id });

        if (config?.reviewChannelId) {
          const ch = await i.guild.channels.fetch(config.reviewChannelId);

          await ch.send({
            content: `New Submission\n${link}`,
            components: [reviewButtons(subId)]
          });
        }

        return i.reply({ content: `✅ Submitted ID: ${subId}`, ephemeral: true });
      }

      if (i.customId.startsWith('score_')) {
        const subId = i.customId.split('_')[1];
        const score = Number(i.fields.getTextInputValue('score'));

        const gain = deltaMMR(score);

        const sub = await Submission.findOne({ subId });

        await Submission.updateOne({ subId }, { score, status: 'approved' });

        await User.updateOne(
          { userId: sub.userId },
          { $inc: { mmr: gain, accepted: 1 } },
          { upsert: true }
        );

        return i.reply({ content: `✅ Score ${score} (+${gain})`, ephemeral: true });
      }
    }

  } catch (err) {
    console.error(err);
  }
});

/* ================= DASHBOARD ================= */

const app = express();

app.get('/', (_, res) => res.send('Bot Running'));

app.get('/api/dashboard', async (_, res) => {
  const users = await User.countDocuments();
  const subs = await Submission.countDocuments();

  res.json({ users, submissions: subs });
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`🌐 Dashboard running`)
);

client.login(process.env.DISCORD_TOKEN);
