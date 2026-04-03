import { Client, Collection, SlashCommandBuilder, REST, Routes, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, PermissionsBitField } from 'discord.js';
import mongoose from 'mongoose';
import axios from 'axios';
import FormData from 'form-data';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import ytdl from 'yt-dlp-exec';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

process.on('uncaughtException', e => console.error('💥 Uncaught:', e));
process.on('unhandledRejection', e => console.error('💥 Rejection:', e));

await mongoose.connect(process.env.MONGO_URI);

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true, index: true },
  username: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: 'Bronze' },
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  rejected: { type: Number, default: 0 },
  enhanced: { type: Number, default: 0 },
  slowmo: { type: Number, default: 0 },
  warnings: { type: Number, default: 0 },
  timeouts: { type: Number, default: 0 },
  bans: { type: Number, default: 0 },
  peakMMR: { type: Number, default: 1000 },
  peakRank: String,
  coins: { type: Number, default: 0 },
  lastWork: { type: Date, default: null },
  lastDaily: { type: Date, default: null },
  joinedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
  subId: { type: String, unique: true, index: true },
  userId: String,
  username: String,
  msgId: String,
  channelId: String,
  link: String,
  score: { type: Number, default: 0 },
  status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected', 'ranked'] },
  reviewedBy: String,
  notes: String,
  song: String,
  artist: String,
  confidence: Number
}, { timestamps: true });

const infraSchema = new mongoose.Schema({
  userId: String,
  moderatorId: String,
  guildId: String,
  type: { type: String, enum: ['warn', 'timeout', 'ban', 'note'], default: 'note' },
  reason: String,
  expiresAt: Date,
  active: { type: Boolean, default: true }
}, { timestamps: true });

const songSchema = new mongoose.Schema({
  submissionId: String,
  title: String,
  artist: String,
  album: String,
  confidence: Number,
  raw: Object
}, { timestamps: true });

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, unique: true },
  rankRoles: { type: Map, of: String, default: {} },
  reviewChannelId: String,
  logChannelId: String
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Submission = mongoose.model('Submission', submissionSchema);
const Infraction = mongoose.model('Infraction', infraSchema);
const Song = mongoose.model('Song', songSchema);
const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

const RANKS = [
  { name: 'Bronze', mmr: 0, color: 0x8d6e63, emoji: '🥉' },
  { name: 'Silver', mmr: 800, color: 0xb0bec5, emoji: '🥈' },
  { name: 'Gold', mmr: 1000, color: 0xf1c40f, emoji: '🥇' },
  { name: 'Platinum', mmr: 1200, color: 0x00bcd4, emoji: '💎' },
  { name: 'Diamond', mmr: 1400, color: 0x3498db, emoji: '💠' },
  { name: 'Master', mmr: 1600, color: 0x9b59b6, emoji: '👑' },
  { name: 'Grandmaster', mmr: 1800, color: 0xe67e22, emoji: '🔱' },
  { name: 'Legend', mmr: 2100, color: 0xe74c3c, emoji: '⚡' },
  { name: 'Mythic', mmr: 2400, color: 0xc0392b, emoji: '🌟' },
  { name: 'Godlike', mmr: 2800, color: 0x6a1b9a, emoji: '🔴' }
];

const MODES = {
  fast: { filter: 'scale=1920:1080,fps=60,unsharp=5:5:1.0', crf: 20, preset: 'fast', res: '1080p 60fps' },
  hq: { filter: 'scale=3840:2160,fps=120,nlmeans=s=0.8:p=7:pc=5,unsharp=7:7:1.1', crf: 14, preset: 'slow', res: '4K 120fps' },
  extreme: { filter: 'scale=5760:3240,fps=240,minterpolate=mi=mci:me_mode=bidir,unsharp=7:7:1.15', crf: 12, preset: 'slower', res: '6K 240fps' },
  slowmo: { filter: 'scale=3840:2160,fps=120,minterpolate=mi=mci:me_mode=bidir,setpts=2*PTS,nlmeans=s=0.8:p=7:pc=5,unsharp=7:7:1.1', crf: 14, preset: 'slow', res: '4K 2X SLOWMO', audio: 'atempo=0.5' }
};

const active = new Set(), processing = { count: 0, max: 3 };
let stats = { totalProcessed: 0, totalSubmissions: 0, totalErrors: 0, totalSlowmo: 0, uptime: Date.now() };

function getRank(mmr) {
  let r = RANKS[0];
  for (const rank of RANKS) if (mmr >= rank.mmr) r = rank;
  return r;
}

function deltaMMR(score) {
  return Math.round((score - 5.5) * 40);
}

function uid(len = 8) {
  return crypto.randomBytes(len).toString('hex');
}

function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

async function getMediaInfo(file) {
  return new Promise((res, rej) => {
    ffmpeg.ffprobe(file, (err, data) => {
      if (err) return rej(err);
      const v = data.streams.find(s => s.codec_type === 'video');
      const a = data.streams.find(s => s.codec_type === 'audio');
      let fps = 0;
      if (v?.avg_frame_rate && v.avg_frame_rate !== '0/0') {
        const [num, den] = v.avg_frame_rate.split('/').map(Number);
        fps = den ? num / den : 0;
      }
      res({
        duration: Number(data.format.duration || 0),
        sizeMB: (Number(data.format.size || 0) / 1024 / 1024),
        width: v?.width || 0,
        height: v?.height || 0,
        fps,
        hasAudio: !!a
      });
    });
  });
}

async function processVideo(url, mode = 'hq') {
  const id = uid();
  const inp = `tmp_${id}.mp4`, out = `out_${id}.mp4`;
  
  try {
    const res = await fetch(url);
    const buf = await res.buffer();
    if (buf.length > 100 * 1024 * 1024) throw new Error('File too large (>100MB)');
    await fs.writeFile(inp, buf);
    
    const cfg = MODES[mode];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Processing timeout')), 1000 * 60 * 12);
      
      let ffmpegCmd = ffmpeg(inp)
        .videoFilters(cfg.filter)
        .outputOptions([
          `-crf ${cfg.crf}`,
          `-preset ${cfg.preset}`,
          '-movflags +faststart',
          '-profile:v high',
          '-level 6.2',
          '-maxrate 120M',
          '-bufsize 240M',
          '-g 120',
          '-keyint_min 120',
          '-x264-params scenecut=0:open_gop=0:aq-mode=3:bframes=3:ref=4:deblock=-1,-1',
          '-pix_fmt yuv420p'
        ])
        .audioCodec('aac')
        .audioBitrate('256k');

      if (cfg.audio) {
        ffmpegCmd = ffmpegCmd.audioFilters(['highpass=f=80', 'lowpass=f=16000', 'afftdn=nf=-22', 'loudnorm=I=-14:TP=-1.5:LRA=11', cfg.audio]);
      } else {
        ffmpegCmd = ffmpegCmd.audioFilters(['highpass=f=80', 'lowpass=f=16000', 'afftdn=nf=-22', 'loudnorm=I=-14:TP=-1.5:LRA=11']);
      }

      ffmpegCmd.save(out)
        .on('end', () => {
          clearTimeout(timer);
          resolve(out);
        })
        .on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  } catch (e) {
    stats.totalErrors++;
    console.error(e);
    return null;
  }
}

async function identifyMusic(audioFile) {
  try {
    const form = new FormData();
    form.append('api_token', process.env.AUDD_KEY);
    form.append('file', await fs.readFile(audioFile));
    form.append('return', 'apple_music,spotify');
    const { data } = await axios.post('https://api.audd.io/', form, { headers: form.getHeaders(), timeout: 30000 });
    if (data.result) {
      return {
        title: data.result.title,
        artist: data.result.artist,
        confidence: data.result.score,
        album: data.result.album
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function extractAudio(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .duration(30)
      .save(output)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function ensureRankRoles(guild) {
  let config = await GuildConfig.findOne({ guildId: guild.id });
  if (!config) {
    config = await GuildConfig.create({ guildId: guild.id, rankRoles: {} });
  }

  for (const rank of RANKS) {
    let roleId = config.rankRoles.get(rank.name);
    let role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;

    if (!role) {
      role = await guild.roles.create({
        name: rank.name,
        color: rank.color,
        reason: 'Auto-created rank role'
      }).catch(err => {
        console.error(`Role create failed for ${rank.name}`, err);
        return null;
      });

      if (role) {
        config.rankRoles.set(rank.name, role.id);
      }
    }
  }

  await config.save();
  return config.rankRoles;
}

async function applyUserRankRole(member, mmr) {
  const rank = getRank(mmr);
  const config = await GuildConfig.findOne({ guildId: member.guild.id });
  if (!config) return;

  const allRankRoleIds = [...config.rankRoles.values()];
  await member.roles.remove(allRankRoleIds).catch(() => {});

  const roleId = config.rankRoles.get(rank.name);
  if (roleId) {
    await member.roles.add(roleId).catch(() => {});
  }

  await User.updateOne(
    { userId: member.id },
    {
      $set: { 'rank': rank.name, 'mmr': mmr },
      $max: { 'peakMMR': mmr }
    },
    { upsert: true }
  );

  const user = await User.findOne({ userId: member.id });
  if (user && user.peakMMR === mmr) {
    await User.updateOne({ userId: member.id }, { $set: { 'peakRank': rank.name } });
  }
}

async function logToGuild(guild, embed) {
  try {
    const config = await GuildConfig.findOne({ guildId: guild.id });
    if (config?.logChannelId) {
      const ch = await guild.channels.fetch(config.logChannelId);
      if (ch) await ch.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error('Log failed:', e);
  }
}

const client = new Client({ intents: 32767 });

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag}`);
  client.user.setActivity('Ultra AI Engine 🔥', { type: 2 });
  
  const cmds = [
    new SlashCommandBuilder().setName('quality').setDescription('Enhance video to max quality')
      .addStringOption(o => o.setName('url').setDescription('Video URL').setRequired(true))
      .addStringOption(o => o.setName('mode').setDescription('Quality mode').setRequired(false)
        .addChoices(
          { name: '⚡ Fast (1080p 60fps)', value: 'fast' },
          { name: '🎯 HQ (4K 120fps)', value: 'hq' },
          { name: '🔥 Extreme (6K 240fps)', value: 'extreme' },
          { name: '🎬 Slowmo (4K 2X)', value: 'slowmo' }
        )),
    new SlashCommandBuilder().setName('profile').setDescription('View your profile & stats'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 ranked users'),
    new SlashCommandBuilder().setName('stats').setDescription('Your detailed statistics'),
    new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance'),
    new SlashCommandBuilder().setName('work').setDescription('Earn coins (1 min cooldown)'),
    new SlashCommandBuilder().setName('daily').setDescription('Daily reward (24h cooldown)'),
    new SlashCommandBuilder().setName('rank').setDescription('Check your MMR & rank'),
    new SlashCommandBuilder().setName('warn').setDescription('Warn user [STAFF]')
      .addUserOption(o => o.setName('user').setRequired(true))
      .addStringOption(o => o.setName('reason').setRequired(true)),
    new SlashCommandBuilder().setName('timeout').setDescription('Timeout user [STAFF]')
      .addUserOption(o => o.setName('user').setRequired(true))
      .addIntegerOption(o => o.setName('minutes').setRequired(true))
      .addStringOption(o => o.setName('reason').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user [STAFF]')
      .addUserOption(o => o.setName('user').setRequired(true))
      .addStringOption(o => o.setName('reason').setRequired(true)),
    new SlashCommandBuilder().setName('submit').setDescription('Submit clip for ranking review'),
    new SlashCommandBuilder().setName('dashboard').setDescription('View bot dashboard & stats'),
    new SlashCommandBuilder().setName('setup_roles').setDescription('Auto-create rank roles [STAFF]')
  ].map(c => c.toJSON());
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: cmds });
});

client.on('guildMemberAdd', async member => {
  await User.updateOne(
    { userId: member.id },
    { $setOnInsert: { username: member.user.tag, joinedAt: new Date() } },
    { upsert: true }
  );

  const guild = member.guild;
  await ensureRankRoles(guild);

  const user = await User.findOne({ userId: member.id });
  const mmr = user?.mmr || 1000;
  await applyUserRankRole(member, mmr);
});

client.on('interactionCreate', async i => {
  try {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'quality') {
      if (active.has(i.user.id)) return i.reply({ content: '⏳ Already processing a video.', ephemeral: true });
      if (processing.count >= processing.max) return i.reply({ content: `���� Queue full (${processing.count}/${processing.max}).`, ephemeral: true });

      const url = i.options.getString('url');
      const mode = i.options.getString('mode') || 'hq';

      if (!isValidUrl(url)) return i.reply({ content: '❌ Invalid URL.', ephemeral: true });

      active.add(i.user.id);
      processing.count++;
      await i.deferReply();

      const id = uid();
      const inp = `tmp_${i.user.id}_${id}.mp4`, aud = `aud_${i.user.id}_${id}.wav`;
      let output = null;

      try {
        const modeLabel = MODES[mode]?.res || MODES.hq.res;
        await i.editReply(`📥 Downloading video...\n⏱️ Mode: **${modeLabel}**`);
        await ytdl(url, { output: inp, format: 'mp4/bestvideo+bestaudio/best' });

        const info = await getMediaInfo(inp);
        if (info.duration > 600) return i.editReply('❌ Video too long (max 10 mins).');

        await i.editReply(`🎞️ Processing with **${mode.toUpperCase()}** enhancement...\n📊 Applying AI filters & ${mode === 'slowmo' ? 'generating frames' : 'upscaling'}`);
        output = await processVideo(inp, mode);

        if (!output) return i.editReply('❌ Processing failed.');

        let musicInfo = null;
        if (info.hasAudio) {
          try {
            await extractAudio(inp, aud);
            musicInfo = await identifyMusic(aud);
          } catch (e) {}
        }

        const stat = await fs.stat(output);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

        if (stat.size > 24.9 * 1024 * 1024) {
          return i.editReply(`⚠️ Output **${sizeMB} MB** exceeds 24.9 MB limit.`);
        }

        await i.editReply({
          content: `✅ **ENHANCED!**\n🎬 ${modeLabel}\n📦 Size: **${sizeMB} MB**${musicInfo ? `\n🎵 **${musicInfo.artist}** — **${musicInfo.title}**` : ''}`,
          files: [new AttachmentBuilder(output)]
        });

        const statType = mode === 'slowmo' ? 'slowmo' : 'enhanced';
        await User.updateOne({ userId: i.user.id }, { $setOnInsert: { username: i.user.tag }, $inc: { [statType]: 1 } }, { upsert: true });
        stats.totalProcessed++;
        if (mode === 'slowmo') stats.totalSlowmo++;

        await Promise.all([
          fs.unlink(inp).catch(() => {}),
          fs.unlink(output).catch(() => {}),
          fs.unlink(aud).catch(() => {})
        ]);
      } catch (e) {
        stats.totalErrors++;
        await i.editReply(`❌ **Error:** ${e.message}`);
      } finally {
        active.delete(i.user.id);
        processing.count--;
      }
    }

    if (i.commandName === 'profile') {
      let user = await User.findOne({ userId: i.user.id });
      if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

      const rank = getRank(user.mmr);
      const embed = new EmbedBuilder()
        .setTitle(`${rank.emoji} ${i.user.username}'s Profile`)
        .setColor(rank.color)
        .setThumbnail(i.user.avatarURL())
        .addFields(
          { name: '🎖️ Rank', value: `${rank.emoji} **${user.rank}**`, inline: true },
          { name: '📊 MMR', value: `**${user.mmr}**`, inline: true },
          { name: '👑 Peak', value: `${user.peakRank || 'N/A'} (**${user.peakMMR}**)`, inline: true },
          { name: '📤 Submissions', value: `**${user.submissions}**`, inline: true },
          { name: '✅ Accepted', value: `**${user.accepted}**`, inline: true },
          { name: '❌ Rejected', value: `**${user.rejected}**`, inline: true },
          { name: '🎬 Enhanced', value: `**${user.enhanced}**`, inline: true },
          { name: '🎬 Slowmo', value: `**${user.slowmo}**`, inline: true },
          { name: '💰 Coins', value: `**${user.coins}**`, inline: true }
        )
        .setFooter({ text: `Joined ${user.joinedAt.toLocaleDateString()}` });

      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'leaderboard') {
      const top = await User.find({}).sort({ mmr: -1 }).limit(10);
      const lines = top.map((u, idx) => {
        const r = getRank(u.mmr);
        return `**${idx + 1}.** ${r.emoji} <@${u.userId}> — **${u.rank}** (**${u.mmr}** MMR)`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 Global Leaderboard')
        .setColor(0xf1c40f)
        .setDescription(lines.length ? lines.join('\n') : 'No data yet.')
        .setFooter({ text: `Total Users: ${await User.countDocuments()}` });

      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'stats') {
      let user = await User.findOne({ userId: i.user.id });
      if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${i.user.username}'s Statistics`)
        .setColor(0x3498db)
        .addFields(
          { name: '📊 Submissions', value: `${user.submissions}`, inline: true },
          { name: '✅ Accepted', value: `${user.accepted}`, inline: true },
          { name: '❌ Rejected', value: `${user.rejected}`, inline: true },
          { name: '🎬 Enhanced', value: `${user.enhanced}`, inline: true },
          { name: '🎬 Slowmo', value: `${user.slowmo}`, inline: true },
          { name: '⚠️ Warnings', value: `${user.warnings}`, inline: true },
          { name: '💰 Balance', value: `${user.coins}`, inline: true },
          { name: '⏱️ Age', value: `${Math.floor((Date.now() - user.joinedAt) / 1000 / 60 / 60 / 24)} days`, inline: true },
          { name: '🎯 Win Rate', value: user.submissions > 0 ? `${((user.accepted / user.submissions) * 100).toFixed(1)}%` : 'N/A', inline: true }
        );

      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'balance') {
      let user = await User.findOne({ userId: i.user.id });
      if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

      const embed = new EmbedBuilder()
        .setTitle(`💰 Wallet`)
        .setColor(0x2ecc71)
        .setDescription(`**${user.coins}** Coins`);

      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'work') {
      let user = await User.findOne({ userId: i.user.id });
      if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

      const now = Date.now();
      const lastWork = user.lastWork ? user.lastWork.getTime() : 0;

      if (now - lastWork < 1000 * 60) {
        const remaining = Math.ceil((1000 * 60 - (now - lastWork)) / 1000);
        return i.reply({ content: `⏳ Cooldown: **${remaining}s** remaining`, ephemeral: true });
      }

      const earn = Math.floor(Math.random() * 150) + 50;
      await User.updateOne({ userId: i.user.id }, { $inc: { coins: earn }, $set: { lastWork: new Date() } });

      return i.reply({ content: `💵 You earned **${earn}** coins!` });
    }

    if (i.commandName === 'daily') {
      let user = await User.findOne({ userId: i.user.id });
      if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

      const now = Date.now();
      const lastDaily = user.lastDaily ? user.lastDaily.getTime() : 0;

      if (now - lastDaily < 1000 * 60 * 60 * 24) {
        const remaining = Math.ceil((1000 * 60 * 60 * 24 - (now - lastDaily)) / 1000 / 60 / 60);
        return i.reply({ content: `⏳ Daily cooldown: **${remaining}h** remaining`, ephemeral: true });
      }

      const reward = 500;
      await User.updateOne({ userId: i.user.id }, { $inc: { coins: reward }, $set: { lastDaily: new Date() } });

      return i.reply({ content: `🎁 Daily reward: **${reward}** coins!` });
    }

    if (i.commandName === 'rank') {
      let user = await User.findOne({ userId: i.user.id });
      if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

      const rank = getRank(user.mmr);
      const embed = new EmbedBuilder()
        .setTitle(`${rank.emoji} Your Ranking`)
        .setColor(rank.color)
        .addFields(
          { name: 'Current Rank', value: `${rank.emoji} **${user.rank}**`, inline: true },
          { name: 'MMR', value: `**${user.mmr}**`, inline: true },
          { name: 'Peak Rank', value: `${user.peakRank || 'N/A'}`, inline: true }
        );

      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'warn') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: '🔒 Staff only.', ephemeral: true });

      const user = i.options.getUser('user');
      const reason = i.options.getString('reason');

      await User.updateOne({ userId: user.id }, { $inc: { warnings: 1 } }, { upsert: true });
      await Infraction.create({ userId: user.id, moderatorId: i.user.id, guildId: i.guild.id, type: 'warn', reason });

      const embed = new EmbedBuilder()
        .setTitle('⚠️ User Warned')
        .setColor(0xf39c12)
        .setDescription(`**User:** <@${user.id}>\n**Reason:** ${reason}\n**By:** <@${i.user.id}>`);

      await logToGuild(i.guild, embed);
      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'timeout') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: '🔒 Staff only.', ephemeral: true });

      const user = i.options.getUser('user');
      const minutes = i.options.getInteger('minutes');
      const reason = i.options.getString('reason');

      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (!member) return i.reply({ content: 'User not found.', ephemeral: true });

      await member.timeout(minutes * 60 * 1000, reason).catch(() => null);
      await User.updateOne({ userId: user.id }, { $inc: { timeouts: 1 } }, { upsert: true });
      await Infraction.create({ userId: user.id, moderatorId: i.user.id, guildId: i.guild.id, type: 'timeout', reason, expiresAt: new Date(Date.now() + minutes * 60 * 1000) });

      const embed = new EmbedBuilder()
        .setTitle('⏳ User Timed Out')
        .setColor(0xe67e22)
        .setDescription(`**User:** <@${user.id}>\n**Duration:** ${minutes} minutes\n**Reason:** ${reason}`);

      await logToGuild(i.guild, embed);
      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'ban') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: '🔒 Staff only.', ephemeral: true });

      const user = i.options.getUser('user');
      const reason = i.options.getString('reason');

      await i.guild.members.ban(user.id, { reason }).catch(() => null);
      await User.updateOne({ userId: user.id }, { $inc: { bans: 1 } }, { upsert: true });
      await Infraction.create({ userId: user.id, moderatorId: i.user.id, guildId: i.guild.id, type: 'ban', reason });

      const embed = new EmbedBuilder()
        .setTitle('🔨 User Banned')
        .setColor(0xc0392b)
        .setDescription(`**User:** <@${user.id}>\n**Reason:** ${reason}\n**By:** <@${i.user.id}>`);

      await logToGuild(i.guild, embed);
      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === 'submit') {
      const modal = new ModalBuilder()
        .setCustomId('submit_modal')
        .setTitle('Submit Clip for Ranking');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('video_link')
            .setLabel('Video URL')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      return i.showModal(modal);
    }

    if (i.commandName === 'setup_roles') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply({ content: '🔒 Staff only.', ephemeral: true });

      await i.deferReply({ ephemeral: true });
      const roles = await ensureRankRoles(i.guild);

      return i.editReply(`✅ Rank roles ensured.\nCreated/verified: ${[...roles.keys()].join(', ')}`);
    }

    if (i.commandName === 'dashboard') {
      const uptime = Math.floor((Date.now() - stats.uptime) / 1000 / 60);
      const users = await User.countDocuments();
      const topUser = await User.findOne().sort({ mmr: -1 });
      const topRank = topUser ? getRank(topUser.mmr) : RANKS[0];

      const embed = new EmbedBuilder()
        .setTitle('📊 Bot Dashboard')
        .setColor(0x9b59b6)
        .addFields(
          { name: '🟢 Status', value: '**ONLINE**', inline: true },
          { name: '⏱️ Uptime', value: `**${uptime}** minutes`, inline: true },
          { name: '📈 Queue', value: `**${processing.count}/${processing.max}** videos`, inline: true },
          { name: '🎬 Total Processed', value: `**${stats.totalProcessed}**`, inline: true },
          { name: '🎬 Total Slowmo', value: `**${stats.totalSlowmo}**`, inline: true },
          { name: '📤 Submissions', value: `**${await Submission.countDocuments()}**`, inline: true },
          { name: '❌ Errors', value: `**${stats.totalErrors}**`, inline: true },
          { name: '👥 Total Users', value: `**${users}**`, inline: true },
          { name: '🏆 Top Player', value: topUser ? `<@${topUser.userId}> (**${topUser.mmr}** MMR)` : 'N/A', inline: true }
        )
        .setFooter({ text: 'Ultra AI Engine v3.0 • Maximum Capacity • Production Ready' });

      return i.reply({ embeds: [embed] });
    }

  } catch (e) {
    console.error(e);
    if (!i.replied) i.reply({ content: '❌ Error.', ephemeral: true }).catch(() => {});
  }
});

client.on('modalSubmit', async i => {
  try {
    if (i.customId === 'submit_modal') {
      const link = i.fields.getTextInputValue('video_link');
      if (!isValidUrl(link)) return i.reply({ content: '❌ Invalid URL.', ephemeral: true });

      const subId = uid(6);

      await Submission.create({
        subId,
        userId: i.user.id,
        username: i.user.tag,
        link,
        status: 'pending'
      });

      await User.updateOne({ userId: i.user.id }, { $inc: { submissions: 1 } }, { upsert: true });
      stats.totalSubmissions++;

      const embed = new EmbedBuilder()
        .setTitle('✅ Submission Created')
        .setColor(0x2ecc71)
        .setDescription(`**ID:** \`${subId}\`\n**Link:** ${link}\n**Status:** Pending Review`);

      return i.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (e) {
    console.error(e);
  }
});

const app = express();
app.use(express.json());

app.get('/', (_, res) => res.send('🔥 Ultra AI Engine Running'));

app.get('/api/dashboard', async (_, res) => {
  const users = await User.countDocuments();
  const submissions = await Submission.countDocuments();
  const topUsers = await User.find({}).sort({ mmr: -1 }).limit(10);

  res.json({
    stats,
    users,
    submissions,
    queue: { current: processing.count, max: processing.max },
    topUsers: topUsers.map(u => ({
      username: u.username,
      mmr: u.mmr,
      rank: u.rank,
      submissions: u.submissions,
      enhanced: u.enhanced,
      slowmo: u.slowmo
    })),
    timestamp: new Date()
  });
});

app.get('/api/leaderboard', async (_, res) => {
  const top = await User.find({}).sort({ mmr: -1 }).limit(50);
  res.json(top.map((u, i) => ({
    position: i + 1,
    username: u.username,
    mmr: u.mmr,
    rank: u.rank,
    submissions: u.submissions,
    enhanced: u.enhanced,
    slowmo: u.slowmo
  })));
});

app.listen(process.env.PORT || 3000, () => console.log(`🌐 Dashboard on port ${process.env.PORT || 3000}`));

client.login(process.env.DISCORD_TOKEN);
