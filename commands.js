'use strict';
// =============================================================
// FILE: slashCommands.js
// ADVANCED SLASH COMMAND DEFINITIONS + AUTOCOMPLETE + LOCALIZATION
// =============================================================
const { SlashCommandBuilder, ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit a clip for cinematic review & rating')
    .addStringOption(o => o.setName('url').setDescription('Direct video URL').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('preset').setDescription('Processing preset').addChoices(
      { name: 'Fast Restore', value: 'fast' },
      { name: 'Cinematic HQ', value: 'cinematic' },
      { name: 'AI Upscale Ready', value: 'ai_ready' }
    ))
    .addStringOption(o => o.setName('description').setDescription('Context for reviewers').setMaxLength(200)),
  
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your rank profile, ELO, and economy stats')
    .addUserOption(o => o.setName('target').setDescription('Check another user')),
  
  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Open staff review queue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Global ELO & economy leaderboards')
    .addStringOption(o => o.setName('type').setDescription('Sort metric').addChoices(
      { name: 'ELO Rating', value: 'elo' },
      { name: 'Wallet Balance', value: 'balance' },
      { name: 'Win Rate', value: 'winrate' },
      { name: 'Submissions', value: 'submissions' }
    ))
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),
  
  new SlashCommandBuilder()
    .setName('ticket_setup')
    .setDescription('Deploy interactive ticket panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  
  new SlashCommandBuilder()
    .setName('verify_panel')
    .setDescription('Deploy verification gate')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  
  new SlashCommandBuilder()
    .setName('lockdown_all')
    .setDescription('Emergency server lockdown (all text channels)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  
  new SlashCommandBuilder()
    .setName('unlockdown_all')
    .setDescription('Restore server permissions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Launch a provably fair giveaway')
    .addStringOption(o => o.setName('prize').setDescription('Prize description').setRequired(true))
    .addIntegerOption(o => o.setName('winners').setDescription('Winner count').setRequired(true).setMinValue(1).setMaxValue(50))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  
  new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Submit a community suggestion')
    .addStringOption(o => o.setName('text').setDescription('Your idea').setRequired(true).setMaxLength(400)),
  
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('View premium shop & redeem codes'),
  
  new SlashCommandBuilder()
    .setName('sync_roles')
    .setDescription('Force-sync rank roles across all members')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());
