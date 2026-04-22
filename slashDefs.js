'use strict';
const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder().setName('submit').setDescription('Submit a clip for review'),
  new SlashCommandBuilder().setName('profile').setDescription('View your rank profile'),
  new SlashCommandBuilder().setName('review').setDescription('Open review panel (staff)'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('ELO leaderboard')
    .addIntegerOption(o => o.setName('page').setDescription('Page').setMinValue(1)),
  new SlashCommandBuilder().setName('ticket_setup').setDescription('Send ticket panel (staff)'),
  new SlashCommandBuilder().setName('verify_panel').setDescription('Send verification panel (staff)'),
  new SlashCommandBuilder().setName('lockdown_all').setDescription('Lock all channels (staff)'),
  new SlashCommandBuilder().setName('unlockdown_all').setDescription('Unlock all channels (staff)'),
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway (staff)')
    .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setDescription('Winners').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration (min)').setRequired(true)),
  new SlashCommandBuilder().setName('suggestion').setDescription('Submit a suggestion')
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true)),
  new SlashCommandBuilder().setName('shop').setDescription('View the shop'),
  new SlashCommandBuilder().setName('sync_roles').setDescription('Re-assign auto-role to all (owner only)'),
].map(c => c.toJSON());
