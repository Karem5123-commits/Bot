/**
 * ARCHITECT V23.1 | THE OMNI-MAIN
 * Final Fusion: Sentinel Media Engine + Omni-Kernel Command Hub
 */

require('dotenv').config();
require('colors');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { nanoid } = require('nanoid');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const https = require('https');
const PQueue = require('p-queue').default;
const fs = require('fs');

// --- 💎 IMPORT KERNEL LOGIC ---
// Assuming your command file is named 'commands.js'
const Kernel = require('./commands.js'); 

// --- 🛰️ SYSTEM SINGLETONS ---
const axiosAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });
const jobQueue = new PQueue({ concurrency: 2 });
const activeJobs = new Set();
const interactionCache = new Set();
const failedMembers = new Set();

const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY },
});

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// --- ⚡ THE CRAZY BOOT SEQUENCE ---
async function boot() {
    console.clear();
    console.log(`\n    ██████╗  ██████╗  ██████╗ ████████╗\n    ██╔══██╗██╔═══██╗██╔═══██╗╚══██╔══╝\n    ██████╔╝██║   ██║██║   ██║   ██║   \n    ██╔══██╗██║   ██║██║   ██║   ██║   \n    ██████╔╝╚██████╔╝╚██████╔╝   ██║   \n    ╚═════╝  ╚═════╝  ╚═════╝    ╚═╝   \n`.cyan.bold);
    console.log(` >>> INITIALIZING OMNI-KERNEL V23.1 <<< `.magenta.bold);

    try {
        console.log(`[1/3] 🧠 Connecting to Neural Database...`.yellow);
        await mongoose.connect(process.env.MONGO_URI, { writeConcern: { w: 1 } });
        
        console.log(`[2/3] 🛰️ Synchronizing Command Definitions...`.yellow);
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, Kernel.CONFIG.GUILD_ID), 
            { body: Kernel.definitions }
        );

        console.log(`[3/3] ⚡ Establishing Discord Uplink...`.yellow);
        await client.login(process.env.DISCORD_TOKEN);

        console.log(`\n >>> SYSTEM ONLINE: TERMINAL VELOCITY REACHED <<< \n`.green.bold);
    } catch (err) {
        console.error(`\n !!! BOOT_FAILURE: ${err.message} !!! \n`.red.bold);
        process.exit(1);
    }
}

// --- 🧠 UNIFIED INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    // 1. Slash Command Routing
    if (i.isChatInputCommand()) {
        return Kernel.handle(i);
    }

    // 2. Button & Modal Routing (For Media & Systems)
    if (i.isModalSubmit() || i.isButton()) {
        // Here we can handle specific kernel components (Verification, Tickets, etc.)
        if (i.customId === 'verify_user') {
            await i.deferReply({ ephemeral: true });
            // Add your verify role logic here
            return i.editReply("✅ **VERIFIED**");
        }
        
        // Pass to Kernel if specialized logic exists
        return Kernel.handle(i);
    }
});

// --- 🛡️ GLOBAL SENTINEL GUARDS ---
process.on('unhandledRejection', (reason) => {
    console.error(' [!] NEURAL_REJECTION:'.red, reason);
});

process.on('uncaughtException', (err) => {
    console.error(' [!] CRITICAL_EXCEPTION:'.red, err);
});

process.on('SIGINT', async () => {
    console.log(`\n >>> SHUTTING DOWN NEURAL LINK... <<< `.yellow);
    await mongoose.disconnect();
    client.destroy();
    process.exit(0);
});

// --- 🏁 IGNITION ---
boot();
