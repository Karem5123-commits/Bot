'use strict';
// =============================================================
// GOD MODE BOT v8 — INFINITY EDITION
// Core Engine: DI Container, Tiered Cache, Circuit Breakers,
// Cinematic Video Processor, Mongo Transactions, Metrics, Health
// =============================================================

const {
    Client, GatewayIntentBits, Partials, ActivityType, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle, REST, Routes,
    PermissionFlagsBits, ChannelType, Colors
} = require('discord.js');

const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');

EventEmitter.defaultMaxListeners = 100;

// =============================================================
// ENVIRONMENT VALIDATION
// =============================================================
const REQUIRED_ENV = ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error(`[FATAL] Missing env vars:\n  ${missingEnv.join('\n  ')}`);
    process.exit(1);
}

const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    mongoUri: process.env.MONGO_URI,
    dbName: process.env.MONGO_DB || 'godbot_v8',
    prefix: process.env.BOT_PREFIX || '!',
    port: parseInt(process.env.PORT) || 3000,
    ownerIds: (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    adminPassword: process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex'),
    jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    reviewChannelId: process.env.REVIEW_CHANNEL_ID || '',
    logChannelId: process.env.LOG_CHANNEL_ID || '',
    autoRoleId: process.env.AUTO_ROLE_ID || '',
    autoDeleteSeconds: parseInt(process.env.AUTO_DELETE_SECS) || 10,
    maxBulkDelete: 200,
    cacheSize: 5000,
    cacheTTL: 120000,
    rateLimitWindow: 60000,
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY) || 2,
    minBet: 1,
    maxBet: 500000,
    dailyAmount: 500,
    dailyStreakBonus: 100,
    jackpotCut: 0.05,
    disabledCommands: new Set(),
    videoPresets: {
        fast: { crf: 20, preset: 'fast', tune: 'fastdecode' },
        balanced: { crf: 18, preset: 'medium', tune: 'film' },
        quality: { crf: 16, preset: 'slow', tune: 'grain' },
        lossless: { crf: 14, preset: 'veryslow', tune: 'grain' }
    }
};

// =============================================================
// INFRASTRUCTURE CLASSES
// =============================================================
class AsyncQueue {
    constructor(concurrency = 2) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
        this.results = new Map();
    }
    async enqueue(id, fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ id, fn, resolve, reject });
            this._next();
        });
    }
    _next() {
        if (this.running >= this.concurrency || !this.queue.length) return;
        this.running++;
        const { id, fn, resolve, reject } = this.queue.shift();
        const start = Date.now();
        Promise.resolve(fn())
            .then(v => { this.results.set(id, { result: v, time: Date.now() - start }); resolve(v); })
            .catch(e => { this.results.set(id, { error: e.message, time: Date.now() - start }); reject(e); })
            .finally(() => { this.running--; setTimeout(() => this._next(), 0); });
    }
    stats() { return { running: this.running, queued: this.queue.length, processed: this.results.size }; }
}

class CircuitBreaker {
    constructor(threshold = 5, timeout = 30000) {
        this.threshold = threshold;
        this.timeout = timeout;
        this.failures = 0;
        this.state = 'CLOSED';
        this.lastFailure = 0;
    }
    async fire(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailure > this.timeout) this.state = 'HALF_OPEN';
            else throw new Error('Circuit breaker is OPEN');
        }
        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure();
            throw err;
        }
    }
    _onSuccess() { this.failures = 0; this.state = 'CLOSED'; }
    _onFailure() { this.failures++; this.lastFailure = Date.now(); if (this.failures >= this.threshold) this.state = 'OPEN'; }
}

class LRUCache {
    constructor(maxSize = 5000, ttl = 120000) {
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.cache = new Map();
        this.hits = 0; this.misses = 0;
    }
    get(key) {
        const e = this.cache.get(key);
        if (!e) { this.misses++; return null; }
        if (Date.now() - e.ts > this.ttl) { this.cache.delete(key); this.misses++; return null; }
        this.cache.delete(key); this.cache.set(key, e);
        this.hits++;
        return e.value;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
        this.cache.set(key, { value, ts: Date.now() });
    }
    delete(key) { this.cache.delete(key); }
    clear() { this.cache.clear(); }
    stats() { return { size: this.cache.size, maxSize: this.maxSize, hits: this.hits, misses: this.misses, hitRate: this.hits / (this.hits + this.misses || 1) }; }
    evictWhere(pred) { for (const [k, v] of this.cache) if (pred(k, v.value)) this.cache.delete(k); }
}

class StructuredLogger {
    constructor(level = 'INFO') {
        this.levels = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5 };
        this.level = this.levels[level] ?? 2;
        this._buffer = [];
        this._maxBuffer = 2000;
    }
    _log(level, message, meta = {}) {
        const lv = this.levels[level] ?? 2;
        if (lv < this.level) return;
        const ts = new Date().toISOString();
        const entry = { ts, level, msg: message, ...meta };
        this._buffer.push(entry);
        if (this._buffer.length > this._maxBuffer) this._buffer.shift();
        const icon = { TRACE: 'TRC', DEBUG: 'DBG', INFO: 'INF', WARN: 'WRN', ERROR: 'ERR', FATAL: 'FTL' }[level];
        if (lv >= 4) console.error(`[${ts}] [${icon}]`, JSON.stringify(entry));
        else console.log(`[${ts}] [${icon}]`, JSON.stringify(entry));
    }
    trace(m, meta) { this._log('TRACE', m, meta); }
    debug(m, meta) { this._log('DEBUG', m, meta); }
    info(m, meta) { this._log('INFO', m, meta); }
    warn(m, meta) { this._log('WARN', m, meta); }
    error(m, meta) { this._log('ERROR', m, meta); }
    fatal(m, meta) { this._log('FATAL', m, meta); }
    getBuffer() { return this._buffer; }
    child(meta) {
        const c = new StructuredLogger(Object.keys(this.levels).find(k => this.levels[k] === this.level));
        c._baseMeta = meta;
        return c;
    }
}

class Metrics {
    constructor() {
        this.counters = new Map();
        this.histograms = new Map();
        this.gauges = new Map();
    }
    inc(name, labels = {}, value = 1) { const k = this._key(name, labels); this.counters.set(k, (this.counters.get(k) || 0) + value); }
    record(name, value, labels = {}) { const k = this._key(name, labels); const arr = this.histograms.get(k) || []; arr.push(value); if (arr.length > 1000) arr.shift(); this.histograms.set(k, arr); }
    gauge(name, value, labels = {}) { this.gauges.set(this._key(name, labels), value); }
    _key(name, labels) { return name + ':' + JSON.stringify(labels); }
    snapshot() {
        const h = {};
        for (const [k, arr] of this.histograms) {
            arr.sort((a, b) => a - b);
            h[k] = { count: arr.length, min: arr[0], max: arr[arr.length - 1], p50: arr[Math.floor(arr.length * 0.5)], p99: arr[Math.floor(arr.length * 0.99)] || arr[arr.length - 1] };
        }
        return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges), histograms: h };
    }
}

class HealthMonitor {
    constructor(logger) {
        this.log = logger;
        this.checks = new Map();
        this.status = 'HEALTHY';
        setInterval(() => this._runChecks(), 30000);
    }
    register(name, fn) { this.checks.set(name, fn); }
    async _runChecks() {
        let healthy = true;
        for (const [name, fn] of this.checks) {
            try { await fn(); } catch (e) { healthy = false; this.log.warn('Health check failed', { check: name, err: e.message }); }
        }
        this.status = healthy ? 'HEALTHY' : 'DEGRADED';
    }
    report() { return { status: this.status, uptime: process.uptime(), memory: process.memoryUsage(), checks: Array.from(this.checks.keys()) }; }
}

class Container {
    constructor() { this.registry = new Map(); }
    register(name, factory, { singleton = true } = {}) {
        this.registry.set(name, { factory, singleton, instance: null });
    }
    resolve(name) {
        const def = this.registry.get(name);
        if (!def) throw new Error(`Service not registered: ${name}`);
        if (def.singleton) {
            if (!def.instance) def.instance = def.factory(this);
            return def.instance;
        }
        return def.factory(this);
    }
}

const container = new Container();
const logger = new StructuredLogger(process.env.LOG_LEVEL || 'INFO');
const metrics = new Metrics();
const health = new HealthMonitor(logger);

// =============================================================
// LOG WRAPPER (matches legacy signature: log('LEVEL', ...args))
// =============================================================
const log = (...args) => {
    const level = args[0] || 'INFO';
    const message = args.slice(1).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logger._log(level, message);
};

// =============================================================
// MONGO MANAGER
// =============================================================
class MongoManager {
    constructor(uri, dbName) {
        this.uri = uri; this.dbName = dbName;
        this.client = null; this.db = null;
        this.connected = false;
    }
    async connect(retries = 5) {
        for (let i = 1; i <= retries; i++) {
            try {
                this.client = new MongoClient(this.uri, { maxPoolSize: 30, serverSelectionTimeoutMS: 10000, retryWrites: true, w: 'majority' });
                await this.client.connect();
                this.db = this.client.db(this.dbName);
                await this._ensureIndexes();
                this.connected = true;
                log('SUCCESS', 'MongoDB connected', { poolSize: 30 });
                return;
            } catch (err) {
                log('ERROR', `MongoDB attempt ${i}/${retries}`, err.message);
                if (i === retries) throw err;
                await new Promise(r => setTimeout(r, i * 2000));
            }
        }
    }
    async _ensureIndexes() {
        const db = this.db;
        await db.collection('users').createIndex({ userId: 1 }, { unique: true });
        await db.collection('users').createIndex({ elo: -1, peakElo: -1 });
        await db.collection('users').createIndex({ rank: 1 });
        await db.collection('submissions').createIndex({ reviewed: 1, submittedAt: -1 });
        await db.collection('submissions').createIndex({ userId: 1 });
        await db.collection('giveaways').createIndex({ endsAt: 1, ended: 1 });
        await db.collection('guildConfigs').createIndex({ guildId: 1 }, { unique: true });
        await db.collection('modCases').createIndex({ guildId: 1, createdAt: -1 });
        await db.collection('modCases').createIndex({ targetId: 1 });
        await db.collection('transactions').createIndex({ userId: 1, createdAt: -1 });
        await db.collection('analytics').createIndex({ type: 1, timestamp: -1 });
        await db.collection('command_logs').createIndex({ command: 1, timestamp: -1 });
        await db.collection('jackpot').createIndex({ id: 1 }, { unique: true });
        await db.collection('codes').createIndex({ code: 1 }, { unique: true });
        await db.collection('settings').createIndex({ key: 1 }, { unique: true });
        log('INFO', 'Database indexes ensured');
    }
    async transaction(fn) {
        const session = this.client.startSession();
        try {
            session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
            const result = await fn(session);
            await session.commitTransaction();
            return result;
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            await session.endSession();
        }
    }
    collection(name) { return this.db.collection(name); }
    async close() { if (this.client) await this.client.close(); this.connected = false; }
}

// =============================================================
// CACHE MANAGER (Tiered L1/L2)
// =============================================================
class CacheManager {
    constructor(ttl = 120000, maxSize = 5000) {
        this.l1 = new LRUCache(maxSize, ttl);
        this.l2 = new LRUCache(maxSize * 2, ttl * 2);
    }
    get(key) {
        let v = this.l1.get(key);
        if (v !== null) { metrics.inc('cache_hit', { tier: 'l1' }); return v; }
        v = this.l2.get(key);
        if (v !== null) { this.l1.set(key, v); metrics.inc('cache_hit', { tier: 'l2' }); return v; }
        metrics.inc('cache_miss');
        return null;
    }
    set(key, value, opts = {}) {
        if (opts.hot) this.l1.set(key, value);
        else this.l2.set(key, value);
    }
    invalidate(pattern) {
        this.l1.evictWhere((k, v) => k.includes(pattern));
        this.l2.evictWhere((k, v) => k.includes(pattern));
    }
    underPressure() {
        const mem = process.memoryUsage();
        return mem.heapUsed / mem.heapTotal > 0.85;
    }
    maybeEvict() {
        if (this.underPressure()) {
            const target = Math.floor(this.l1.cache.size * 0.3);
            let i = 0;
            for (const k of this.l1.cache.keys()) {
                if (i >= target) break;
                this.l1.delete(k); i++;
            }
            log('WARN', 'Cache evicted under memory pressure', { evicted: i });
        }
    }
    stats() { return { l1: this.l1.stats(), l2: this.l2.stats(), pressure: this.underPressure() }; }
}

// =============================================================
// TOKEN BUCKET RATE LIMITER
// =============================================================
class TokenBucket {
    constructor(capacity, refillRateMs) {
        this.capacity = capacity;
        this.refillRate = refillRateMs;
        this.buckets = new Map();
    }
    consume(key, tokens = 1) {
        const now = Date.now();
        let b = this.buckets.get(key);
        if (!b) { b = { tokens: this.capacity, last: now }; this.buckets.set(key, b); }
        const refill = Math.floor((now - b.last) / this.refillRate);
        b.tokens = Math.min(this.capacity, b.tokens + refill);
        b.last = now;
        if (b.tokens >= tokens) { b.tokens -= tokens; return { allowed: true, remaining: b.tokens }; }
        const waitMs = this.refillRate * (tokens - b.tokens);
        return { allowed: false, remaining: b.tokens, retryAfter: waitMs };
    }
}

// =============================================================
// SECURITY MANAGER
// =============================================================
class SecurityManager {
    static sanitize(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[;&|`$\\{}[\]\n\r]/g, '').slice(0, 2000);
    }
    static isDangerousUrl(url) {
        try {
            const u = new URL(url);
            return ['file:', 'ftp:', 'data:', 'javascript:'].includes(u.protocol);
        } catch { return true; }
    }
    static validateVideoUrl(url) {
        return /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|streamable\.com\/|tiktok\.com\/|cdn\.discordapp\.com\/|media\.discordapp\.net\/)/i.test(url);
    }
}

// =============================================================
// CINEMATIC VIDEO PROCESSOR
// =============================================================
class CinematicProcessor {
    constructor(queue, logger) {
        this.queue = queue;
        this.log = logger.child({ module: 'CinematicProcessor' });
        this.tempDir = '/tmp/godmode_v8';
        this.presets = {
            restore: {
                stages: [
                    { filter: 'deblock', params: { filter: 'strong' } },
                    { filter: 'dedot', params: {} },
                    { filter: 'nlmeans', params: { s: 3, p: 5, pc: 5 } },
                    { filter: 'hqdn3d', params: { luma_spat: 4, chroma_spat: 3, luma_tmp: 6, chroma_tmp: 4 } },
                    { filter: 'bilateral', params: { sigmaS: 3, sigmaR: 0.05 } },
                    { filter: 'unsharp', params: { luma_msize_x: 5, luma_msize_y: 5, luma_amount: 1.2 } },
                    { filter: 'zscale', params: { f: 'spline36', r: 'full' } },
                    { filter: 'eq', params: { brightness: 0.02, contrast: 1.05, saturation: 1.1 } }
                ],
                encode: CONFIG.videoPresets.quality
            },
            cinematic: {
                stages: [
                    { filter: 'bm3d', params: { sigma: 4 } },
                    { filter: 'smartblur', params: { lr: 1.2, lg: 1.2, lb: 1.2 } },
                    { filter: 'unsharp', params: { luma_msize_x: 7, luma_msize_y: 7, luma_amount: 0.8, chroma_amount: 0.4 } },
                    { filter: 'zscale', params: { f: 'lanczos', r: 'full' } },
                    { filter: 'eq', params: { brightness: 0.01, contrast: 1.08, saturation: 1.15 } }
                ],
                encode: CONFIG.videoPresets.lossless
            },
            ai_ready: {
                stages: [
                    { filter: 'deblock', params: { filter: 'strong' } },
                    { filter: 'nlmeans', params: { s: 2, p: 3, pc: 3 } },
                    { filter: 'zscale', params: { f: 'spline36', r: 'full' } }
                ],
                encode: CONFIG.videoPresets.quality,
                aiUpscale: true
            }
        };
    }

    _buildFilterComplex(presetName, w, h, targetW = 1920) {
        const preset = this.presets[presetName] || this.presets.restore;
        const targetH = Math.round(h * (targetW / w));
        const filters = [];
        for (const stage of preset.stages) {
            let f = stage.filter;
            switch (f) {
                case 'nlmeans':
                    const { s = 3, p = 5, pc = 5 } = stage.params;
                    filters.push(`nlmeans=s=${s}:p=${p}:pc=${pc}`);
                    break;
                case 'hqdn3d':
                    const { luma_spat = 4, chroma_spat = 3, luma_tmp = 6, chroma_tmp = 4 } = stage.params;
                    filters.push(`hqdn3d=${luma_spat}:${chroma_spat}:${luma_tmp}:${chroma_tmp}`);
                    break;
                case 'bm3d':
                    filters.push(`bm3d=sigma=${stage.params.sigma || 4}:block=8:bstep=2:group=1`);
                    break;
                case 'bilateral':
                    filters.push(`bilateral=sigmaS=${stage.params.sigmaS || 3}:sigmaR=${stage.params.sigmaR || 0.05}`);
                    break;
                case 'unsharp':
                    const { luma_msize_x = 5, luma_msize_y = 5, luma_amount = 1.2, chroma_amount = 0 } = stage.params;
                    filters.push(`unsharp=luma_msize_x=${luma_msize_x}:luma_msize_y=${luma_msize_y}:luma_amount=${luma_amount}:chroma_amount=${chroma_amount}`);
                    break;
                case 'smartblur':
                    filters.push(`smartblur=lr=${stage.params.lr || 1.2}:lg=${stage.params.lg || 1.2}:lb=${stage.params.lb || 1.2}`);
                    break;
                case 'zscale':
                    const zf = stage.params.f || 'spline36';
                    filters.push(`zscale=f=${zf}:w=${targetW}:h=${targetH}:range=full`);
                    break;
                case 'eq':
                    const { brightness = 0, contrast = 1.0, saturation = 1.0 } = stage.params;
                    filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
                    break;
                case 'deblock':
                    filters.push(`deblock=filter=${stage.params.filter || 'strong'}:block=8`);
                    break;
                case 'dedot':
                    filters.push('dedot=mx=4:my=4');
                    break;
            }
        }
        return filters.join(',');
    }

    async process(sourceUrl, options = {}) {
        const { preset = 'restore', targetWidth = 1920, outputFormat = 'mp4' } = options;
        const jobId = crypto.randomUUID();
        metrics.inc('video_jobs_started', { preset });
        return this.queue.enqueue(jobId, async () => {
            const start = Date.now();
            const tmpIn = path.join(this.tempDir, `in_${jobId}.mp4`);
            const tmpOut = path.join(this.tempDir, `out_${jobId}.${outputFormat}`);
            try {
                await fs.mkdir(this.tempDir, { recursive: true });
                const dlStart = Date.now();
                const resp = await fetch(sourceUrl);
                if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
                const buf = Buffer.from(await resp.arrayBuffer());
                if (buf.length > 250 * 1024 * 1024) throw new Error('Video exceeds 250MB limit');
                await fs.writeFile(tmpIn, buf);
                metrics.record('video_download', Date.now() - dlStart, { preset });
                const probe = await this._probe(tmpIn);
                const w = probe.width || 1280, h = probe.height || 720;
                this.log.info('Probed source', { jobId, w, h, duration: probe.duration });
                const filterComplex = this._buildFilterComplex(preset, w, h, targetWidth);
                const enc = this.presets[preset]?.encode || CONFIG.videoPresets.quality;
                if (preset === 'cinematic' || preset === 'lossless') {
                    const passlog = path.join(this.tempDir, `pass_${jobId}`);
                    const pass1 = `ffmpeg -hide_banner -y -i ${tmpIn} -vf "${filterComplex}" -c:v libx264 -b:v 0 -crf ${enc.crf} -preset ${enc.preset} -pass 1 -passlogfile ${passlog} -an -f null /dev/null`;
                    const pass2 = `ffmpeg -hide_banner -y -i ${tmpIn} -vf "${filterComplex}" -c:v libx264 -crf ${enc.crf} -preset ${enc.preset} -tune ${enc.tune} -pass 2 -passlogfile ${passlog} -movflags +faststart -an ${tmpOut}`;
                    await this._exec(pass1, 600000);
                    await this._exec(pass2, 600000);
                    await fs.unlink(`${passlog}-0.log`).catch(() => {});
                    await fs.unlink(`${passlog}-0.log.mbtree`).catch(() => {});
                } else {
                    const ffmpegCmd = `ffmpeg -hide_banner -y -i ${tmpIn} -vf "${filterComplex}" -c:v libx264 -crf ${enc.crf} -preset ${enc.preset} -tune ${enc.tune} -movflags +faststart -an ${tmpOut}`;
                    await this._exec(ffmpegCmd, 600000);
                }
                const stats = await fs.stat(tmpOut);
                const duration = Date.now() - start;
                metrics.record('video_process', duration, { preset });
                metrics.inc('video_jobs_success', { preset });
                this.log.info('Video processed', { jobId, duration, size: stats.size });
                await fs.unlink(tmpIn).catch(() => {});
                return { filePath: tmpOut, jobId, duration, size: stats.size, width: targetWidth, height: Math.round(h * (targetWidth / w)) };
            } catch (err) {
                metrics.inc('video_jobs_failed', { preset });
                this.log.error('Video processing failed', { jobId, err: err.message });
                await fs.unlink(tmpIn).catch(() => {});
                await fs.unlink(tmpOut).catch(() => {});
                throw err;
            }
        });
    }

    _exec(cmd, timeout = 300000) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout);
            });
        });
    }
    async _probe(file) {
        const out = await this._exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,bit_rate -of json ${file}`, 30000);
        const data = JSON.parse(out);
        const s = data?.streams?.[0] || {};
        return { width: s.width, height: s.height, duration: parseFloat(s.duration) || 0, bitrate: parseInt(s.bit_rate) || 0 };
    }
    async cleanupOldJobs(maxAgeMs = 3600000) {
        try {
            const files = await fs.readdir(this.tempDir);
            const now = Date.now();
            for (const f of files) {
                const fp = path.join(this.tempDir, f);
                const stat = await fs.stat(fp);
                if (now - stat.mtimeMs > maxAgeMs) await fs.unlink(fp).catch(() => {});
            }
        } catch (e) { this.log.warn('Cleanup error', { err: e.message }); }
    }
}

// =============================================================
// RANK ENGINE
// =============================================================
class RankEngine {
    constructor(db, logger) {
        this.db = db; this.log = logger.child({ module: 'RankEngine' });
        this.RANKS = [
            { name: 'Bronze', elo: 0, color: 0x8d6e63 },
            { name: 'Silver', elo: 1200, color: 0xb0bec5 },
            { name: 'Gold', elo: 1800, color: 0xf1c40f },
            { name: 'Platinum', elo: 2500, color: 0x00bcd4 },
            { name: 'Diamond', elo: 3500, color: 0x3498db },
            { name: 'Master', elo: 4800, color: 0x9b59b6 },
            { name: 'Legend', elo: 6500, color: 0xe74c3c },
        ];
    }
    getRank(elo) { return this.RANKS.slice().reverse().find(r => elo >= r.elo) || this.RANKS[0]; }
    calcEloChange(rating, currentElo, streak, peakElo) {
        const scoreMap = { A: 6, S: 7.5, SS: 9, SSS: 10, F: -5 };
        let score = scoreMap[rating] || 6;
        let gain = (score - 5.5) * 50;
        if (streak >= 5) gain *= 1.8;
        else if (streak >= 3) gain *= 1.5;
        else if (streak >= 2) gain *= 1.2;
        if (currentElo > 4000) gain *= 0.55;
        else if (currentElo > 3000) gain *= 0.7;
        else if (currentElo > 2500) gain *= 0.85;
        const newElo = currentElo + Math.round(gain);
        const peakBonus = newElo > peakElo ? Math.round((newElo - peakElo) * 0.1) : 0;
        return Math.round(gain) + peakBonus;
    }
    async decay(userId) {
        const u = await this.db.collection('users').findOne({ userId });
        if (!u || u.elo < 1500) return;
        const days = (Date.now() - (u.lastActive || Date.now())) / 86400000;
        if (days < 7) return;
        const decay = Math.floor(Math.min(days * 2, u.elo * 0.1));
        await this.db.collection('users').updateOne({ userId }, { $inc: { elo: -decay } });
        this.log.info('ELO decay applied', { userId, decay });
    }
    async applyRankRoles(guild, member, elo, guildRolesConfig) {
        const rankObj = this.getRank(elo);
        const roles = guildRolesConfig || {};
        try {
            const currentRankRoles = this.RANKS.map(r => roles[r.name]).filter(Boolean);
            await member.roles.remove(currentRankRoles.filter(id => member.roles.cache.has(id))).catch(() => {});
            const newRoleId = roles[rankObj.name];
            if (newRoleId && !member.roles.cache.has(newRoleId)) await member.roles.add(newRoleId).catch(() => {});
            return rankObj;
        } catch (err) { this.log.warn('Role update failed', { guild: guild.id, user: member.id, err: err.message }); return rankObj; }
    }
}

// =============================================================
// GIVEAWAY ENGINE
// =============================================================
class GiveawayEngine {
    constructor(db, client, logger) {
        this.db = db; this.client = client; this.log = logger.child({ module: 'GiveawayEngine' });
        this.timers = new Map();
        this.lock = new Map();
    }
    async schedule(gwId, endsAt, channelId, messageId = null) {
        const remaining = endsAt.getTime() - Date.now();
        if (remaining <= 0) return this.end(gwId);
        const timer = setTimeout(() => this.end(gwId), remaining);
        this.timers.set(gwId, timer);
    }
    async start(channel, prize, winnerCount, durationMs, hostedById, options = {}) {
        const endsAt = new Date(Date.now() + durationMs);
        const doc = await this.db.collection('giveaways').insertOne({
            channelId: channel.id, guildId: channel.guildId, prize, winnerCount,
            endsAt, hostedBy: hostedById, entries: [], ended: false, winners: [],
            requirements: options.requirements || {}, createdAt: new Date()
        });
        const gwId = doc.insertedId.toString();
        const embed = new EmbedBuilder()
            .setColor(0xFFD700).setTitle('🎉 GIVEAWAY 🎉')
            .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnerCount}\n**Ends:** <t:${Math.floor(endsAt.getTime() / 1000)}:R>\n**Hosted by:** <@${hostedById}>\n\nClick the button to enter!`)
            .setFooter({ text: `ID: ${gwId}` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`gw_enter_${gwId}`).setLabel('Enter').setStyle(ButtonStyle.Success).setEmoji('🎉')
        );
        const msg = await channel.send({ embeds: [embed], components: [row] });
        await this.db.collection('giveaways').updateOne({ _id: doc.insertedId }, { $set: { messageId: msg.id } });
        await this.schedule(gwId, endsAt, channel.id, msg.id);
        return gwId;
    }
    async end(gwId) {
        if (this.lock.get(gwId)) return;
        this.lock.set(gwId, true);
        try {
            const gw = await this.db.collection('giveaways').findOne({ _id: new ObjectId(gwId) });
            if (!gw || gw.ended) return;
            await this.db.collection('giveaways').updateOne({ _id: gw._id }, { $set: { ended: true } });
            const entries = gw.entries || [];
            let winners = [], winnersText = 'No entries.';
            if (entries.length > 0) {
                const shuffled = [...entries];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                winners = shuffled.slice(0, Math.min(gw.winnerCount, entries.length));
                winnersText = winners.map(id => `<@${id}>`).join(', ');
            }
            await this.db.collection('giveaways').updateOne({ _id: gw._id }, { $set: { winners } });
            const embed = new EmbedBuilder().setColor(0xFF4444).setTitle('GIVEAWAY ENDED').setDescription(`**Prize:** ${gw.prize}\n**Winners:** ${winnersText}`);
            const channel = this.client.channels.cache.get(gw.channelId);
            if (channel && gw.messageId) {
                const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
                if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
                if (winners.length > 0) await channel.send(`Congratulations ${winnersText}! You won **${gw.prize}**!`).catch(() => {});
            }
        } catch (err) { this.log.error('Giveaway end failed', { gwId, err: err.message }); }
        finally { this.lock.delete(gwId); this.timers.delete(gwId); }
    }
    async resumeAll() {
        const active = await this.db.collection('giveaways').find({ ended: false }).toArray();
        for (const gw of active) await this.schedule(gw._id.toString(), gw.endsAt, gw.channelId, gw.messageId);
        this.log.info('Resumed giveaways', { count: active.length });
    }
    async enter(gwId, userId) {
        const gw = await this.db.collection('giveaways').findOne({ _id: new ObjectId(gwId) });
        if (!gw || gw.ended) throw new Error('Giveaway ended or not found');
        if (gw.entries.includes(userId)) throw new Error('Already entered');
        await this.db.collection('giveaways').updateOne({ _id: gw._id }, { $push: { entries: userId } });
        metrics.inc('giveaway_entries');
    }
}

// =============================================================
// MODERATION SUITE
// =============================================================
class ModerationSuite {
    constructor(db, logger) {
        this.db = db; this.log = logger.child({ module: 'ModerationSuite' });
    }
    async createCase(guildId, action, moderatorId, targetId, reason, duration = null, metadata = {}) {
        const caseNum = (await this.db.collection('modCases').countDocuments({ guildId })) + 1;
        const doc = { guildId, caseNum, action, moderatorId, targetId, reason, duration, active: ['BAN', 'MUTE', 'SOFTBAN', 'TEMPBAN'].includes(action), createdAt: new Date(), ...metadata };
        await this.db.collection('modCases').insertOne(doc);
        metrics.inc('mod_actions', { action });
        return doc;
    }
    async softban(guild, member, moderator, reason = 'Softban', durationMs = 3600000) {
        await member.ban({ reason: `Softban: ${reason}` });
        await this.createCase(guild.id, 'SOFTBAN', moderator.id, member.id, reason, durationMs);
        setTimeout(async () => {
            try {
                await guild.members.unban(member.id, 'Softban expired');
                await this.db.collection('modCases').updateOne({ guildId: guild.id, targetId: member.id, action: 'SOFTBAN', active: true }, { $set: { active: false, expiredAt: new Date() } });
            } catch (e) { this.log.error('Softban expiry failed', { err: e.message }); }
        }, durationMs);
    }
    async tempban(guild, member, moderator, reason = 'Tempban', durationMs = 86400000) {
        await member.ban({ reason: `Tempban: ${reason}` });
        await this.createCase(guild.id, 'TEMPBAN', moderator.id, member.id, reason, durationMs);
        setTimeout(async () => {
            try {
                await guild.members.unban(member.id, 'Tempban expired');
                await this.db.collection('modCases').updateOne({ guildId: guild.id, targetId: member.id, action: 'TEMPBAN', active: true }, { $set: { active: false, expiredAt: new Date() } });
            } catch (e) { this.log.error('Tempban expiry failed', { err: e.message }); }
        }, durationMs);
    }
    async warn(guild, targetId, moderatorId, reason) {
        await this.db.collection('users').updateOne({ userId: targetId }, { $push: { warns: { reason, by: moderatorId, at: new Date() } } });
        return this.createCase(guild.id, 'WARN', moderatorId, targetId, reason);
    }
    async getCases(guildId, targetId, limit = 10) {
        return this.db.collection('modCases').find({ guildId, targetId }).sort({ createdAt: -1 }).limit(limit).toArray();
    }
}

// =============================================================
// XP SYSTEM
// =============================================================
class XPSystem {
    constructor(db, cache, logger) {
        this.db = db; this.cache = cache; this.log = logger.child({ module: 'XPSystem' });
        this.cooldowns = new Map();
        this.voiceSessions = new Map();
    }
    async grantMessageXP(userId, guildId, multiplier = 1) {
        if (this.cooldowns.has(userId)) return;
        this.cooldowns.set(userId, true);
        setTimeout(() => this.cooldowns.delete(userId), 60000);
        const base = Math.floor((Math.random() * 10 + 5) * multiplier);
        const key = `xp:${userId}`;
        let u = this.cache.get(key);
        if (!u) { u = await this.db.collection('users').findOne({ userId }); if (u) this.cache.set(key, u, { hot: true }); }
        if (!u) return;
        const needed = Math.floor(100 * Math.pow(1.15, u.level || 1));
        const newXP = (u.xp || 0) + base;
        const update = { xp: newXP, lastActive: new Date() };
        let leveled = false;
        if (newXP >= needed) {
            update.xp = newXP - needed;
            update.level = (u.level || 1) + 1;
            leveled = true;
        }
        await this.db.collection('users').updateOne({ userId }, { $set: update });
        this.cache.set(key, { ...u, ...update }, { hot: true });
        metrics.inc('xp_granted', { type: 'message' });
        return { leveled, newLevel: update.level, xpGain: base };
    }
    async grantVoiceXP(guildId, userId) {
        const session = this.voiceSessions.get(guildId)?.get(userId);
        if (!session) return;
        const minutes = Math.floor((Date.now() - session) / 60000);
        if (minutes < 1) return;
        const xp = minutes * 2;
        await this.db.collection('users').updateOne({ userId }, { $inc: { xp: xp, voiceTime: minutes }, $set: { lastActive: new Date() } });
        metrics.inc('xp_granted', { type: 'voice' });
    }
    voiceJoin(guildId, userId) {
        if (!this.voiceSessions.has(guildId)) this.voiceSessions.set(guildId, new Map());
        this.voiceSessions.get(guildId).set(userId, Date.now());
    }
    voiceLeave(guildId, userId) {
        this.grantVoiceXP(guildId, userId);
        this.voiceSessions.get(guildId)?.delete(userId);
    }
}

// =============================================================
// GUILD CONFIG ENGINE
// =============================================================
class GuildConfigEngine {
    constructor(db, cache, logger) {
        this.db = db; this.cache = cache; this.log = logger.child({ module: 'GuildConfigEngine' });
    }
    async get(guildId) {
        const key = `cfg:${guildId}`;
        let cfg = this.cache.get(key);
        if (cfg) return cfg;
        cfg = await this.db.collection('guildConfigs').findOne({ guildId });
        if (!cfg) {
            cfg = {
                guildId, prefix: CONFIG.prefix, rankRoles: {}, autoRoles: [],
                logChannelId: null, reviewChannelId: null, muteRoleId: null,
                xpMultiplier: 1, antiInvite: false, antiSpam: false,
                welcomeChannelId: null, welcomeMessage: null, createdAt: new Date()
            };
            await this.db.collection('guildConfigs').insertOne(cfg);
        }
        this.cache.set(key, cfg);
        return cfg;
    }
    async set(guildId, update) {
        await this.db.collection('guildConfigs').updateOne({ guildId }, { $set: update }, { upsert: true });
        this.cache.invalidate(`cfg:${guildId}`);
    }
}

// =============================================================
// COMMAND REGISTRY
// =============================================================
class CommandRegistry {
    constructor(logger) {
        this.commands = new Map();
        this.middleware = [];
        this.log = logger.child({ module: 'CommandRegistry' });
        this.HELP = {};
    }
    use(mw) { this.middleware.push(mw); }
    register(def) {
        if (!def.name || !def.execute) throw new Error('Command must have name and execute');
        this.commands.set(def.name, def);
        this.HELP[def.name] = { desc: def.desc || 'No description', usage: def.usage || `!${def.name}` };
        if (def.aliases) def.aliases.forEach(a => this.commands.set(a, { ...def, name: a, isAlias: true }));
    }
    async dispatch(ctx) {
        const def = this.commands.get(ctx.cmd);
        if (!def) return false;
        ctx.def = def;
        metrics.inc('commands_invoked', { cmd: def.name });
        const start = Date.now();
        try {
            for (const mw of this.middleware) {
                const result = await mw(ctx);
                if (result === false) return true;
            }
            await def.execute(ctx);
            metrics.record('command_duration', Date.now() - start, { cmd: def.name });
            return true;
        } catch (err) {
            metrics.inc('commands_failed', { cmd: def.name });
            this.log.error('Command failed', { cmd: def.name, err: err.message, user: ctx.message?.author?.id });
            throw err;
        }
    }
}

// =============================================================
// AUTOMOD ENGINE
// =============================================================
class AutoModEngine {
    constructor(db, modSuite, logger) {
        this.db = db; this.mod = modSuite; this.log = logger.child({ module: 'AutoMod' });
        this.spamTracker = new Map();
        this.inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9-]+/i;
    }
    async scan(message) {
        const cfg = await container.resolve('guildConfig').get(message.guild.id);
        if (!cfg) return;
        if (cfg.antiInvite && this.inviteRegex.test(message.content)) {
            await message.delete().catch(() => {});
            await message.member.timeout(300000, 'AutoMod: Invite link').catch(() => {});
            await this.mod.createCase(message.guild.id, 'AUTOMOD_INVITE', message.client.user.id, message.author.id, 'Posted invite link');
            metrics.inc('automod_actions', { type: 'invite' });
            return;
        }
        if (cfg.antiSpam) {
            const now = Date.now();
            const history = this.spamTracker.get(message.author.id) || [];
            history.push({ ts: now, content: message.content.slice(0, 100) });
            const window = history.filter(h => now - h.ts < 7000);
            this.spamTracker.set(message.author.id, window);
            if (window.length >= 5) {
                await message.member.timeout(600000, 'AutoMod: Spam detected').catch(() => {});
                await this.mod.createCase(message.guild.id, 'AUTOMOD_SPAM', message.client.user.id, message.author.id, 'Rapid message spam');
                metrics.inc('automod_actions', { type: 'spam' });
            }
        }
    }
}

// =============================================================
// USER SERVICE
// =============================================================
class UserService {
    constructor(db, cache, logger) {
        this.db = db; this.cache = cache; this.log = logger.child({ module: 'UserService' });
    }
    async getOrCreate(userId) {
        const key = `usr:${userId}`;
        let u = this.cache.get(key);
        if (u) return u;
        try {
            u = await this.db.collection('users').findOne({ userId });
            if (!u) {
                u = {
                    userId, xp: 0, level: 1, elo: 1000, peakElo: 1000,
                    rank: 'Bronze', streak: 0, balance: 1000, premium: false,
                    dailyLast: null, dailyStreak: 0, submissions: 0, warns: [],
                    qualityUses: 0, betHistory: [], totalWagered: 0, totalWon: 0,
                    totalLost: 0, wins: 0, losses: 0, createdAt: new Date(),
                    lastActive: new Date(), voiceTime: 0, botBanned: false
                };
                await this.db.collection('users').insertOne(u);
            }
            this.cache.set(key, u, { hot: true });
            return u;
        } catch (err) { this.log.error('User fetch failed', { userId, err: err.message }); throw err; }
    }
    async update(userId, update) {
        const key = `usr:${userId}`;
        await this.db.collection('users').updateOne({ userId }, { $set: { ...update, lastActive: new Date() } }, { upsert: true });
        const cached = this.cache.get(key);
        if (cached) this.cache.set(key, { ...cached, ...update }, { hot: true });
    }
    async increment(userId, field, amount) {
        const key = `usr:${userId}`;
        await this.db.collection('users').updateOne({ userId }, { $inc: { [field]: amount }, $set: { lastActive: new Date() } });
        const cached = this.cache.get(key);
        if (cached) this.cache.set(key, { ...cached, [field]: (cached[field] || 0) + amount }, { hot: true });
    }
    async topByElo(limit = 10) {
        return this.db.collection('users').find({ elo: { $gt: 0 } }).sort({ elo: -1 }).limit(limit).toArray();
    }
    async topBy(field, limit = 10) {
        return this.db.collection('users').find({ [field]: { $gt: 0 } }).sort({ [field]: -1 }).limit(limit).toArray();
    }
}


// =============================================================
// GAMBLING HELPERS
// =============================================================
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS_CARDS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const bjGames = new Map();

function drawCard() {
    return RANKS_CARDS[Math.floor(Math.random() * RANKS_CARDS.length)] + SUITS[Math.floor(Math.random() * SUITS.length)];
}

function handTotal(hand) {
    let total = 0, aces = 0;
    for (const card of hand) {
        const r = card.slice(0, -2);
        if (['J', 'Q', 'K'].includes(r)) total += 10;
        else if (r === 'A') { total += 11; aces++; }
        else total += parseInt(r);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function spinSlots() {
    const reels = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '🔔', '🍉'];
    return [reels[Math.floor(Math.random() * reels.length)], reels[Math.floor(Math.random() * reels.length)], reels[Math.floor(Math.random() * reels.length)]];
}

function slotsResult(reels) {
    const [a, b, c] = reels;
    if (a === b && b === c) {
        if (a === '💎') return { mult: 10, msg: 'TRIPLE DIAMONDS — JACKPOT!' };
        if (a === '7️⃣') return { mult: 8, msg: 'TRIPLE SEVENS!' };
        return { mult: 4, msg: `Triple ${a}!` };
    }
    if (a === b || b === c || a === c) return { mult: 2, msg: 'Pair match!' };
    if (['🍒', '🍋', '🍊', '🍇', '🍉'].includes(a) && ['🍒', '🍋', '🍊', '🍇', '🍉'].includes(b) && ['🍒', '🍋', '🍊', '🍇', '🍉'].includes(c))
        return { mult: 1.5, msg: 'All fruits!' };
    return { mult: 0, msg: 'No match.' };
}

async function addToJackpot(amount) {
    const cut = Math.floor(amount * CONFIG.jackpotCut);
    if (cut <= 0) return;
    await container.resolve('mongo').collection('jackpot').updateOne(
        { id: 'main' }, { $inc: { pool: cut } }, { upsert: true }
    );
}

async function getJackpot() {
    const doc = await container.resolve('mongo').collection('jackpot').findOne({ id: 'main' });
    return doc?.pool || 0;
}

async function resetJackpot() {
    await container.resolve('mongo').collection('jackpot').updateOne({ id: 'main' }, { $set: { pool: 0 } }, { upsert: true });
}

async function recordBet(userId, cmd, bet, result, change) {
    const entry = { cmd, bet, result, change, at: new Date() };
    const inc = { totalWagered: bet };
    if (change > 0) { inc.totalWon = change; inc.wins = 1; }
    else if (change < 0) { inc.totalLost = Math.abs(change); inc.losses = 1; }
    await container.resolve('mongo').collection('users').updateOne(
        { userId },
        { $push: { betHistory: { $each: [entry], $slice: -100 } }, $inc: inc }
    );
    await container.resolve('mongo').collection('command_logs').insertOne({
        command: cmd, userId, bet, change, success: change >= 0, timestamp: new Date()
    });
    metrics.inc('bets_placed', { cmd });
}

async function trackEvent(type, data) {
    try {
        await container.resolve('mongo').collection('analytics').insertOne({
            type, data, timestamp: new Date()
        });
        metrics.inc('events', { type });
    } catch (e) {}
}

// =============================================================
// DISCORD CLIENT
// =============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember, Partials.User],
    sweepers: {
        messages: { interval: 300, lifetime: 1800 },
        users: { interval: 3600, filter: () => user => !user.bot },
        guildMembers: { interval: 3600, filter: () => member => !member.user?.bot }
    },
    failIfNotExists: false,
    rest: { timeout: 15_000, retries: 3 }
});

const snipeCache = new LRUCache(500, 300000);
const autoDelete = async (msg, secs = CONFIG.autoDeleteSeconds) => {
    if (msg?.deletable) setTimeout(() => msg.delete().catch(() => {}), secs * 1000);
};

const VIDEO_LINK_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/|streamable\.com\/|tiktok\.com\/|cdn\.discordapp\.com\/|media\.discordapp\.net\/|tenor\.com\/|giphy\.com\/media\/|gyazo\.com\/|clips\.twitch\.tv\/)/gi;

// =============================================================
// SERVICE WIRING
// =============================================================
container.register('mongo', () => new MongoManager(CONFIG.mongoUri, CONFIG.dbName), { singleton: true });
container.register('cache', () => new CacheManager(CONFIG.cacheTTL, CONFIG.cacheSize), { singleton: true });
container.register('rateLimiter', () => new TokenBucket(5, 5000), { singleton: true });
container.register('userService', c => new UserService(c.resolve('mongo').db, c.resolve('cache'), logger), { singleton: true });
container.register('rankEngine', c => new RankEngine(c.resolve('mongo').db, logger), { singleton: true });
container.register('modSuite', c => new ModerationSuite(c.resolve('mongo').db, logger), { singleton: true });
container.register('giveawayEngine', c => new GiveawayEngine(c.resolve('mongo').db, client, logger), { singleton: true });
container.register('xpSystem', c => new XPSystem(c.resolve('mongo').db, c.resolve('cache'), logger), { singleton: true });
container.register('guildConfig', c => new GuildConfigEngine(c.resolve('mongo').db, c.resolve('cache'), logger), { singleton: true });
container.register('videoQueue', () => new AsyncQueue(CONFIG.workerConcurrency), { singleton: true });
container.register('videoEngine', c => new CinematicProcessor(c.resolve('videoQueue'), logger), { singleton: true });
container.register('autoMod', c => new AutoModEngine(c.resolve('mongo').db, c.resolve('modSuite'), logger), { singleton: true });
container.register('commandRegistry', () => {
    const reg = new CommandRegistry(logger);
    reg.use(async (ctx) => {
        if (ctx.def.ownerOnly && !CONFIG.ownerIds.includes(ctx.message.author.id)) {
            autoDelete(await ctx.message.reply('Owner only.')); return false;
        }
        if (ctx.def.mod && !ctx.message.member.permissions.has(ctx.def.permission || PermissionFlagsBits.ManageMessages)) {
            autoDelete(await ctx.message.reply('Insufficient permissions.')); return false;
        }
        return true;
    });
    reg.use(async (ctx) => {
        if (CONFIG.disabledCommands.has(ctx.cmd)) {
            autoDelete(await ctx.message.reply('This command is currently disabled.')); return false;
        }
        if (!ctx.def.cooldown) return true;
        const bucket = container.resolve('rateLimiter');
        const rl = bucket.consume(`${ctx.cmd}:${ctx.message.author.id}`, 1);
        if (!rl.allowed) {
            autoDelete(await ctx.message.reply(`Cooldown: ${Math.ceil(rl.retryAfter / 1000)}s remaining.`)); return false;
        }
        return true;
    });
    return reg;
}, { singleton: true });

// =============================================================
// MOD LOG HELPER
// =============================================================
async function modLog(guild, action, moderator, target, reason = 'No reason') {
    try {
        const cfg = await container.resolve('guildConfig').get(guild.id);
        const ch = guild.channels.cache.get(cfg.logChannelId || CONFIG.logChannelId);
        if (!ch) return;
        const embed = new EmbedBuilder().setColor(0xFF4444).setTitle(`Mod Action: ${action}`)
            .addFields(
                { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
                { name: 'Target', value: target.tag ? `${target.tag} (${target.id})` : target.id || 'N/A', inline: true },
                { name: 'Reason', value: reason }
            ).setTimestamp();
        await ch.send({ embeds: [embed] });
    } catch (err) { log('WARN', `modLog: ${err.message}`); }
}

// =============================================================
// AUTO ROLE HELPER
// =============================================================
async function assignAutoRoleToAll(guild) {
    let assigned = 0, skipped = 0, failed = 0;
    if (!CONFIG.autoRoleId) return { assigned, skipped, failed };
    const members = await guild.members.fetch();
    for (const [, member] of members) {
        if (member.user.bot) { skipped++; continue; }
        if (member.roles.cache.has(CONFIG.autoRoleId)) { skipped++; continue; }
        try { await member.roles.add(CONFIG.autoRoleId); assigned++; }
        catch (e) { failed++; }
    }
    return { assigned, skipped, failed };
}

// =============================================================
// COMMAND TOGGLE HELPERS
// =============================================================
function isCommandDisabled(cmd) { return CONFIG.disabledCommands.has(cmd); }
function setCommandEnabled(cmd, enabled) {
    if (enabled) CONFIG.disabledCommands.delete(cmd);
    else CONFIG.disabledCommands.add(cmd);
}

// =============================================================
// PROCESS VIDEO HELPER (legacy compat)
// =============================================================
const processVideo = (url, opts) => container.resolve('videoEngine').process(url, opts);

// =============================================================
// DISCORD EVENT HANDLERS
// =============================================================
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    metrics.inc('messages_seen');

    const autoMod = container.resolve('autoMod');
    if (autoMod) await autoMod.scan(message).catch(() => {});

    const xpSys = container.resolve('xpSystem');
    const cfg = await container.resolve('guildConfig').get(message.guild.id);
    const xpRes = await xpSys.grantMessageXP(message.author.id, message.guild.id, cfg?.xpMultiplier || 1);
    if (xpRes?.leveled) {
        const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('LEVEL UP!')
            .setDescription(`${message.author} reached **Level ${xpRes.newLevel}**!`);
        autoDelete(await message.channel.send({ embeds: [embed] }), 15);
    }

    // Auto-submit on mention
    if (message.mentions.has(client.user.id)) {
        const links = message.content.match(VIDEO_LINK_REGEX);
        if (links?.length) {
            const bucket = container.resolve('rateLimiter');
            const rl = bucket.consume(`submit:${message.author.id}`, 1);
            if (!rl.allowed) { autoDelete(await message.reply(`Rate limited. Try again in ${Math.ceil(rl.retryAfter / 1000)}s.`), 5); return; }
            const reviewCfg = await container.resolve('guildConfig').get(message.guild.id);
            const reviewCh = message.guild.channels.cache.get(reviewCfg.reviewChannelId || CONFIG.reviewChannelId);
            if (reviewCh) {
                const ins = await container.resolve('mongo').collection('submissions').insertOne({
                    userId: message.author.id, url: links[0], description: 'Auto-detected mention submission',
                    reviewed: false, submittedAt: new Date(), guildId: message.guild.id
                });
                const embed = new EmbedBuilder().setColor(Colors.Gold).setTitle('New Auto Submission')
                    .setDescription(`**Link:** ${links[0]}\n**By:** ${message.author.tag}`)
                    .setFooter({ text: `ID: ${ins.insertedId}` });
                const row = new ActionRowBuilder().addComponents(
                    ['A', 'S', 'SS', 'SSS'].map(r => new ButtonBuilder().setCustomId(`rate_${ins.insertedId}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary))
                );
                await reviewCh.send({ embeds: [embed], components: [row] });
                autoDelete(await message.reply('Auto-submission forwarded to review panel.'), 8);
            }
        }
    }

    // Prefix commands
    if (!message.content.startsWith(CONFIG.prefix)) return;
    const args = message.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    const registry = container.resolve('commandRegistry');
    const ctx = { message, args, cmd, client };
    try { await registry.dispatch(ctx); }
    catch (err) { autoDelete(await message.reply('An error occurred processing that command.')); }
});

client.on('messageDelete', message => {
    if (message.author?.bot || !message.content) return;
    snipeCache.set(message.channelId, {
        content: message.content, author: message.author.tag,
        avatarURL: message.author.displayAvatarURL(), at: new Date()
    });
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const xpSys = container.resolve('xpSystem');
    if (!oldState.channelId && newState.channelId) xpSys.voiceJoin(newState.guild.id, newState.member.id);
    else if (oldState.channelId && !newState.channelId) xpSys.voiceLeave(oldState.guild.id, oldState.member.id);
});

client.on('guildMemberAdd', async member => {
    const cfg = await container.resolve('guildConfig').get(member.guild.id);
    if (cfg?.welcomeChannelId && cfg?.welcomeMessage) {
        const ch = member.guild.channels.cache.get(cfg.welcomeChannelId);
        if (ch) ch.send(cfg.welcomeMessage.replace('{user}', `<@${member.id}>`).replace('{guild}', member.guild.name)).catch(() => {});
    }
    if (cfg?.autoRoles?.length) {
        for (const roleId of cfg.autoRoles) await member.roles.add(roleId).catch(() => {});
    }
});

// =============================================================
// EXPORTS (everything other files require)
// =============================================================
const dbProxy = new Proxy({}, {
    get(_, prop) {
        const m = container.resolve('mongo');
        if (!m.db) throw new Error('Mongo not connected yet');
        return m.db[prop];
    }
});

module.exports = {
    CONFIG,
    client,
    get db() { return container.resolve('mongo').db; },
    ObjectId,
    log,
    logger,
    metrics,
    health,
    container,

    // User helpers
    getUser: (userId) => container.resolve('userService').getOrCreate(userId),
    updateUser: (userId, update) => container.resolve('userService').update(userId, update),
    addBalance: (userId, amount) => container.resolve('userService').increment(userId, 'balance', amount),

    // Rank helpers
    getRankFromElo: (elo) => container.resolve('rankEngine').getRank(elo),
    calcElo: (rating, currentElo, streak, peakElo) => container.resolve('rankEngine').calcEloChange(rating, currentElo, streak, peakElo),
    applyRank: async (guild, member, elo) => {
        const cfg = await container.resolve('guildConfig').get(guild.id);
        return container.resolve('rankEngine').applyRankRoles(guild, member, elo, cfg?.rankRoles);
    },
    RANKS: [
        { name: 'Bronze', elo: 0, color: 0x8d6e63 },
        { name: 'Silver', elo: 1200, color: 0xb0bec5 },
        { name: 'Gold', elo: 1800, color: 0xf1c40f },
        { name: 'Platinum', elo: 2500, color: 0x00bcd4 },
        { name: 'Diamond', elo: 3500, color: 0x3498db },
        { name: 'Master', elo: 4800, color: 0x9b59b6 },
        { name: 'Legend', elo: 6500, color: 0xe74c3c },
    ],

    // Video
    processVideo,

    // Mod
    modLog,
    startGiveaway: (channel, prize, winners, durationMs, hostedById) =>
        container.resolve('giveawayEngine').start(channel, prize, winners, durationMs, hostedById),

    // Cache / memory
    snipeCache,
    userCache: {
        get size() { return container.resolve('cache').l1.cache.size; }
    },

    // Security
    SecurityManager,

    // Auto-delete
    autoDelete,

    // Gambling
    bjGames,
    drawCard,
    handTotal,
    recordBet,
    addToJackpot,
    getJackpot,
    resetJackpot,
    spinSlots,
    slotsResult,

    // Event tracking
    trackEvent,

    // Command management
    isCommandDisabled,
    setCommandEnabled,
    get HELP() { return container.resolve('commandRegistry').HELP; },
    get ALL_COMMANDS() { return Array.from(container.resolve('commandRegistry').commands.keys()).filter(k => !container.resolve('commandRegistry').commands.get(k).isAlias); },

    // Role sync
    assignAutoRoleToAll,

    // Log buffer
    get logBuffer() { return logger.getBuffer(); },

    // Container access for advanced use
    get container() { return container; },
};

// =============================================================
// BOOT SEQUENCE
// =============================================================
(async () => {
    try {
        console.clear();
        log('INFO', '╔══════════════════════════════════════════════════╗');
        log('INFO', '║  GOD MODE BOT v8 — INFINITY EDITION              ║');
        log('INFO', '║  Cinematic Engine | Circuit Breakers | DI | WS  ║');
        log('INFO', '╚══════════════════════════════════════════════════╝');

        const mongo = container.resolve('mongo');
        await mongo.connect();
        health.register('mongodb', async () => { if (!mongo.connected) throw new Error('Mongo disconnected'); });

        const cache = container.resolve('cache');
        const videoEngine = container.resolve('videoEngine');
        const giveawayEngine = container.resolve('giveawayEngine');
        const guildConfig = container.resolve('guildConfig');

        // Load commands from commands.js
        const defineCommands = require('./commands');
        const registry = container.resolve('commandRegistry');
        defineCommands(registry);

        // Load interactions from interactions.js
        require('./interactions')(client);

        // Load API server from api.js
        const startApiServer = require('./api');
        startApiServer();

        // Register slash commands
        const slashDefs = require('./slashDefs');
        const rest = new REST({ version: '10' }).setToken(CONFIG.token);
        await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: slashDefs });
        log('SUCCESS', 'Slash commands registered globally', { count: slashDefs.length });

        client.once('ready', async () => {
            log('SUCCESS', `Discord connected: ${client.user.tag}`, { guilds: client.guilds.cache.size });
            setInterval(() => {
                client.user.setActivity(`${client.guilds.cache.size} guilds | !help`, { type: ActivityType.Watching });
            }, 30000);

            for (const guild of client.guilds.cache.values()) {
                try {
                    await guildConfig.get(guild.id);
                    const targets = container.resolve('rankEngine').RANKS.map(r => r.name);
                    const roles = {};
                    for (const t of targets) {
                        const role = guild.roles.cache.find(r => r.name.toLowerCase() === t.toLowerCase());
                        if (role) { roles[t] = role.id; log('INFO', `Detected role ${t} in ${guild.name}`); }
                    }
                    if (Object.keys(roles).length) await guildConfig.set(guild.id, { rankRoles: roles });
                    const findCh = pats => guild.channels.cache.find(c => c.isTextBased() && pats.some(p => c.name.toLowerCase().includes(p)));
                    const rCh = findCh(['clip-review', 'submissions', 'review']);
                    const lCh = findCh(['mod-logs', 'modlogs', 'logs']);
                    const wCh = findCh(['welcome', 'general']);
                    const updates = {};
                    if (rCh) updates.reviewChannelId = rCh.id;
                    if (lCh) updates.logChannelId = lCh.id;
                    const existingCfg = await guildConfig.get(guild.id);
                    if (wCh && !existingCfg.welcomeChannelId) updates.welcomeChannelId = wCh.id;
                    if (Object.keys(updates).length) await guildConfig.set(guild.id, updates);
                } catch (e) { log('WARN', 'Guild init error', { guild: guild.id, err: e.message }); }
            }

            await giveawayEngine.resumeAll();
            setInterval(() => videoEngine.cleanupOldJobs(), 600000);
            setInterval(() => cache.maybeEvict(), 30000);
            log('SUCCESS', '>> ALL SYSTEMS OPERATIONAL — MAX OUTPUT REACHED');
        });

        await client.login(CONFIG.token);
    } catch (err) {
        log('FATAL', 'FATAL STARTUP CRASH', err.stack);
        process.exit(1);
    }
})();
