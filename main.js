require('dotenv').config(); require('colors');
const { Client, ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder, REST, Routes } = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"), { nanoid } = require('nanoid'), mongoose = require('mongoose');
const { spawn } = require('child_process'), { PassThrough } = require('stream'), { pipeline } = require('stream/promises'), axios = require('axios'), fs = require('fs');
const Kernel = require('./commands.js'), jobs = new Set(), queue = new (require('p-queue').default)({ concurrency: 2 });
const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
const client = new Client({ intents: 32767 }), User = mongoose.model('U', { id: String, r: String, e: Number }), Q = mongoose.model('Q', { c: String, u: Boolean });

const v = async (u) => {
    const res = await axios({ url: u, responseType: 'stream', timeout: 15e3 }), t = `./${nanoid(5)}`, w = fs.createWriteStream(t);
    let b = 0; for await (const c of res.data) { w.write(c); if ((b += c.length) > 2e6) break; } w.end();
    const d = await new Promise(r => { let o = ''; const f = spawn('ffprobe', ['-v', '0', '-show_entries', 'format=duration', '-of', 'csv=p=0', t]); f.stdout.on('data', x => o += x); f.on('close', () => r(parseFloat(o) || 0)); });
    fs.unlink(t, () => {}); if (!d || d > 60) throw 0; return res;
};

const hQ = async (i) => {
    const c = i.fields.getTextInputValue('c').toUpperCase(), u = i.fields.getTextInputValue('u').trim();
    if (jobs.has(u)) return i.reply({ content: '⏳', ephemeral: 1 }); await i.deferReply({ ephemeral: 1 });
    const q = await Q.findOne({ c, u: false }); if (!q) return i.editReply('❌');
    jobs.add(u); queue.add(async () => {
        let ff; try {
            const res = await v(u); ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vf', 'hqdn3d=1.5:1.5:6:6,unsharp=3:3:0.5:3:3:0.0,scale=1280:-2', '-c:v', 'libx264', '-crf', '20', '-f', 'mp4', 'pipe:1']);
            const pt = new PassThrough({ highWaterMark: 1e6 }); let r = 0;
            res.data.on('data', x => { if ((r += x.length) > 5e7) { res.data.destroy(); ff?.kill(); } });
            const k = `f_${nanoid(7)}.mp4`, up = s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: k, Body: pt, ContentType: 'video/mp4' }));
            await Promise.all([pipeline(res.data, ff.stdin), pipeline(ff.stdout, pt), up]);
            await i.editReply(`✅ ${process.env.BASE_URL}/${k}`); await Q.updateOne({ _id: q._id }, { u: true });
        } catch { ff?.kill(); await i.editReply('❌'); } finally { jobs.delete(u); }
    });
};

client.on('interactionCreate', async i => {
    if (i.isChatInputCommand()) {
        if (i.commandName === 'quality') return i.showModal(new ModalBuilder().setCustomId('qm').setTitle('💠').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c').setLabel('K').setStyle(1)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('U').setStyle(1))));
        if (i.commandName === 'profile') { const u = await User.findOne({ id: i.user.id }); return i.reply({ content: `📊 ${u?.e || 0} | ${u?.r || '—'}`, ephemeral: 1 }); }
        return Kernel.handle(i);
    }
    if (i.isModalSubmit() && i.customId === 'qm') return hQ(i);
});

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(process.env.CLIENT_ID, "1488868987805892730"), { body: Kernel.definitions });
    await client.login(process.env.DISCORD_TOKEN); console.log('🟢'.green);
})();
