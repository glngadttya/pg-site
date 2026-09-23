const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_DIR = path.join(__dirname, 'database');

function dbFile(name) {
    return path.join(DB_DIR, name + '.json');
}

function readDB(name, fallback) {
    try {
        return JSON.parse(fs.readFileSync(dbFile(name), 'utf8'));
    } catch (e) {
        const fb = fallback === undefined ? [] : fallback;
        writeDB(name, fb);
        return fb;
    }
}

function writeDB(name, data) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(dbFile(name), JSON.stringify(data, null, 2));
}

function loadSetup() {
    return readDB('setup', {
        name: 'VANPAY',
        static_qr: '',
        gopay_token: '',
        gopay_phone: '',
        telegram_token: '',
        telegram_chat_id: '',
        google_client_id: '',
        google_client_secret: '',
        github_client_id: '',
        github_client_secret: '',
        base_url: 'http://localhost:3000'
    });
}

function saveSetup(setup) {
    writeDB('setup', setup);
}

function uid(prefix) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = prefix || '';
    for (let i = 0; i < 18; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

function rupiah(n) {
    return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function nowIso() {
    return new Date().toISOString();
}

function genApiKey() {
    return 'VAN-' + crypto.randomBytes(10).toString('hex').toLowerCase();
}

function authUser(req) {
    const token = req.cookies && req.cookies.vanpay_session;
    if (!token) return null;
    const sessions = readDB('sessions', []);
    const session = sessions.find((s) => s.token === token);
    if (!session) return null;
    const users = readDB('users', []);
    return users.find((u) => u.id === session.user_id) || null;
}

function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const sessions = readDB('sessions', []);
    sessions.push({ token, user_id: userId, created_at: nowIso() });
    writeDB('sessions', sessions);
    return token;
}

function destroySession(req) {
    const token = req.cookies && req.cookies.vanpay_session;
    if (!token) return;
    const sessions = readDB('sessions', []);
    writeDB('sessions', sessions.filter((s) => s.token !== token));
}

function findUserByKey(key) {
    if (!key) return null;
    const users = readDB('users', []);
    return users.find((u) =>
        (u.api_keys || []).some((k) => k.key === key && !k.revoked)
    ) || null;
}

function updateUser(userId, patch) {
    const users = readDB('users', []);
    const u = users.find((x) => x.id === userId);
    if (!u) return false;
    Object.assign(u, patch);
    writeDB('users', users);
    return true;
}

const FEE_TIERS = [
    { label: '1 – 20.000', min: 1000, max: 20000, fee: 100 },
    { label: '20.001 – 30.000', min: 20001, max: 30000, fee: 200 },
    { label: '30.001 – 40.000', min: 30001, max: 40000, fee: 300 },
    { label: '40.001 – 50.000', min: 40001, max: 50000, fee: 400 },
    { label: '50.001 – 100.000', min: 50001, max: 100000, fee: 500 },
    { label: '100.001 – 200.000', min: 100001, max: 200000, fee: 1000 },
    { label: '200.001 – 300.000', min: 200001, max: 300000, fee: 2000 },
    { label: '300.001 – 400.000', min: 300001, max: 400000, fee: 3000 },
    { label: '400.001 – 500.000', min: 400001, max: 500000, fee: 4000 },
    { label: '500.000 ke atas', min: 500001, max: Infinity, fee: 10000 }
];

function transactionFee(amount) {
    const a = parseInt(amount, 10) || 0;
    const tier = FEE_TIERS.find((t) => a >= t.min && a <= t.max);
    return tier ? tier.fee : 0;
}

function requireAuth(req, res, next) {
    const user = authUser(req);
    if (!user) {
        const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
        if (wantsJson) return res.status(401).json({ success: false, message: 'Unauthorized' });
        return res.redirect('/auth');
    }
    return next();
}

function requireAdmin(req, res, next) {
    const user = authUser(req);
    if (!user) return res.redirect('/auth');
    if (user.role !== 'owner') return res.status(403).send('Forbidden — halaman hanya untuk owner');
    return next();
}

module.exports = {
    readDB, writeDB, loadSetup, saveSetup, uid, rupiah, nowIso,
    genApiKey, authUser, createSession, destroySession,
    findUserByKey, updateUser, requireAuth, requireAdmin,
    FEE_TIERS, transactionFee
};