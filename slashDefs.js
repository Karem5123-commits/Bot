'use strict';
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit a clip for staff review'),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your rank profile'),

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Open review panel (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('ELO leaderboard')
    .addIntegerOption(o =>
      o.setName('page').setDescription('Page number').setMinValue(1)),

  new SlashCommandBuilder()
    .setName('ticket_setup')
    .setDescription('Send ticket panel (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('verify_panel')
    .setDescription('Send verification panel (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('lockdown_all')
    .setDescription('Lock all text channels (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unlockdown_all')
    .setDescription('Unlock all text channels (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start a giveaway (staff)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('prize').setDescription('Prize text').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Submit a suggestion')
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true)),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View the shop'),

  new SlashCommandBuilder()
    .setName('sync_roles')
    .setDescription('Re-assign auto-role to all members (owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

module.exports = commands.map(c => c.toJSON());
