const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const f = require('./library/function');
const gopay = require('./library/scrape/gopay');
const google = require('./library/scrape/google');
const github = require('./library/scrape/github');
const telegram = require('./library/telegram');

const {
    readDB, writeDB, loadSetup, saveSetup, uid, rupiah, nowIso,
    genApiKey, authUser, createSession, destroySession, findUserByKey,
    updateUser, requireAuth, requireAdmin
} = f;

const app = express();
const PORT = process.env.PORT || 3000;
const EWALLETS = ['dana', 'gopay', 'shopeepay'];
const PAYMENT_TTL = 30 * 60 * 1000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use(function (req, res, next) {
    res.locals.user = authUser(req);
    res.locals.setup = loadSetup();
    res.locals.helpers = { rupiah };
    res.locals.msg = null;
    res.locals.err = null;
    next();
});

async function checkAndSettle(payment) {
    const setup = loadSetup();
    if (!setup.gopay_token) return payment;
    if (payment.status !== 'pending') return payment;
    try {
        const { status, result } = await gopay.checkQRIS(payment.amount, payment.qr_created, setup.gopay_token);
        const paid = status === 'success' && result && (result.status === 'success' || result.status === 'PAID' || !!result.paid);
        if (!paid) return payment;
        const payments = readDB('payments', []);
        const idx = payments.findIndex((x) => x.id === payment.id);
        if (idx === -1) return payment;
        const p = payments[idx];
        p.status = 'paid';
        p.paid_at = nowIso();
        if (!p.credited) {
            const users = readDB('users', []);
            const u = users.find((x) => x.id === p.user_id);
            if (u) {
                u.balance = (u.balance || 0) + p.amount;
                writeDB('users', users);
                await telegram.notifyDeposit(setup, u, p);
            }
            p.credited = true;
        }
        writeDB('payments', payments);
        return p;
    } catch (e) {
        return payment;
    }
}

setInterval(async () => {
    const payments = readDB('payments', []);
    const now = Date.now();
    for (const p of payments) {
        if (p.status !== 'pending') continue;
        if (now - new Date(p.created_at).getTime() > PAYMENT_TTL) {
            p.status = 'expired';
            p.expired_at = nowIso();
            writeDB('payments', payments);
            continue;
        }
        await checkAndSettle(p);
    }
}, 5000);

function redirectUri(setup, provider) {
    return (setup.base_url || '').replace(/\/$/, '') + '/auth/' + provider + '/callback';
}

async function upsertUser(provider, profile) {
    const users = readDB('users', []);
    let user = users.find((u) => u.provider === provider && u.provider_id === String(profile.id));
    if (!user) {
        const raw = provider === 'github'
            ? (profile.login || 'gh_' + profile.id)
            : (profile.name || profile.email || 'gk_' + profile.id);
        const username = String(raw).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
        const role = provider === 'github' && profile.login === 'glngadttya' ? 'owner' : 'user';
        user = {
            id: uid('U_'),
            provider,
            provider_id: String(profile.id),
            username,
            email: profile.email || '',
            avatar: profile.avatar_url || profile.picture || '',
            role,
            balance: 0,
            api_keys: [],
            created_at: nowIso()
        };
        users.push(user);
        writeDB('users', users);
    } else {
        if (provider === 'github' && profile.login === 'glngadttya' && user.role !== 'owner') {
            user.role = 'owner';
            writeDB('users', users);
        }
    }
    return user;
}

function setAuthCookie(res, user) {
    const session = createSession(user.id);
    res.cookie('vanpay_session', session, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
}

app.get('/', (req, res) => {
    res.render('index', { title: 'Home' });
});

app.get('/docs', (req, res) => {
    res.render('docs', { title: 'Dokumentasi API' });
});

app.get('/auth', (req, res) => {
    if (authUser(req)) return res.redirect('/dashboard');
    res.render('login', { title: 'Masuk', err: req.query.err || null });
});

app.get('/auth/google', (req, res) => {
    const setup = loadSetup();
    if (!setup.google_client_id) {
        return res.render('login', { title: 'Masuk', err: 'Google OAuth belum dikonfigurasi oleh pemilik website.' });
    }
    res.redirect(google.getAuthUrl(setup.google_client_id, redirectUri(setup, 'google')));
});

app.get('/auth/github', (req, res) => {
    const setup = loadSetup();
    if (!setup.github_client_id) {
        return res.render('login', { title: 'Masuk', err: 'GitHub OAuth belum dikonfigurasi oleh pemilik website.' });
    }
    res.redirect(github.getAuthUrl(setup.github_client_id, redirectUri(setup, 'github')));
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const setup = loadSetup();
        if (!req.query.code) return res.redirect('/auth');
        const token = await google.getToken(setup.google_client_id, setup.google_client_secret, req.query.code, redirectUri(setup, 'google'));
        const profile = await google.getUser(token);
        const user = await upsertUser('google', profile);
        setAuthCookie(res, user);
        res.redirect('/dashboard');
    } catch (e) {
        res.redirect('/auth?err=google');
    }
});

app.get('/auth/github/callback', async (req, res) => {
    try {
        const setup = loadSetup();
        if (!req.query.code) return res.redirect('/auth');
        const token = await github.getToken(setup.github_client_id, setup.github_client_secret, req.query.code, redirectUri(setup, 'github'));
        const profile = await github.getUser(token);
        const user = await upsertUser('github', profile);
        setAuthCookie(res, user);
        res.redirect('/dashboard');
    } catch (e) {
        res.redirect('/auth?err=github');
    }
});

app.get('/auth/logout', (req, res) => {
    destroySession(req);
    res.clearCookie('vanpay_session');
    res.redirect('/');
});

app.get('/dashboard', requireAuth, (req, res) => {
    const user = res.locals.user;
    const payments = readDB('payments', []).filter((p) => p.user_id === user.id && p.source === 'deposit');
    const withdrawals = readDB('withdrawals', []).filter((w) => w.user_id === user.id);
    const deposits = payments.filter((p) => p.status === 'paid');
    const approvedWd = withdrawals.filter((w) => w.status === 'approved');
    const totalDeposit = deposits.reduce((s, p) => s + p.amount, 0);
    const totalWithdraw = approvedWd.reduce((s, w) => s + w.amount, 0);
    const recent = [
        ...payments.map((p) => ({ type: 'deposit', method: 'qris', id: p.id, amount: p.amount, status: p.status, created_at: p.created_at })),
        ...withdrawals.map((w) => ({ type: 'withdraw', method: w.method, id: w.id, amount: w.amount, status: w.status, created_at: w.created_at }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    res.render('user/dashboard', {
        title: 'Dashboard',
        totalDeposit, totalWithdraw,
        countDeposit: deposits.length,
        countWithdraw: withdrawals.length,
        recent,
        msg: req.query.msg ? decodeURIComponent(req.query.msg) : null,
        err: req.query.err ? decodeURIComponent(req.query.err) : null
    });
});

app.post('/dashboard/deposit', requireAuth, async (req, res) => {
    const setup = loadSetup();
    const user = res.locals.user;
    const amount = parseInt(req.body.amount, 10);
    try {
        if (!amount || amount < 1000 || amount > 5000000) {
            return res.redirect('/dashboard?err=' + encodeURIComponent('Nominal harus antara Rp1.000 dan Rp5.000.000'));
        }
        if (!setup.gopay_token || !setup.static_qr) {
            return res.redirect('/dashboard?err=' + encodeURIComponent('Fitur deposit belum diaktifkan. Hubungi admin.'));
        }
        const qr = await gopay.createQRIS(amount, setup.static_qr);
        const payments = readDB('payments', []);
        const payment = {
            id: uid('PAY_'),
            user_id: user.id,
            source: 'deposit',
            external_id: '',
            amount,
            status: 'pending',
            qr_url: qr.url,
            qr_created: qr.created_at,
            credited: false,
            created_at: nowIso(),
            exp_at: new Date(Date.now() + PAYMENT_TTL).toISOString()
        };
        payments.push(payment);
        writeDB('payments', payments);
        res.redirect('/payment?id=' + payment.id);
    } catch (e) {
        res.redirect('/dashboard?err=' + encodeURIComponent('Gagal membuat QRIS: ' + (e.message || e)));
    }
});

app.get('/withdraw', requireAuth, (req, res) => {
    res.render('user/withdraw', {
        title: 'Tarik Dana',
        msg: req.query.msg ? decodeURIComponent(req.query.msg) : null,
        err: req.query.err ? decodeURIComponent(req.query.err) : null
    });
});

app.post('/withdraw', requireAuth, async (req, res) => {
    const setup = loadSetup();
    const user = res.locals.user;
    const amount = parseInt(req.body.amount, 10);
    const fee = parseInt(setup.fee, 10) || 0;
    const method = String(req.body.method || '').toLowerCase();
    const account = String(req.body.account || '').trim();
    const holder = String(req.body.holder || '').trim();
    const back = (msg) => res.redirect('/withdraw?err=' + encodeURIComponent(msg));
    if (!EWALLETS.includes(method)) return back('Metode e-wallet tidak valid');
    if (!/^[0-9]{4,}$/.test(account)) return back('Nomor akun e-wallet tidak valid');
    if (!holder) return back('Nama pemilik akun wajib diisi');
    if (!amount || amount < 5000) return back('Minimal penarikan Rp5.000');
    const total = amount + fee;
    if (user.balance < total) return back('Saldo tidak mencukupi untuk jumlah + biaya layanan');
    updateUser(user.id, { balance: user.balance - total });
    const withdrawals = readDB('withdrawals', []);
    const wd = {
        id: uid('WD_'),
        user_id: user.id,
        method, account, holder,
        amount, fee, total,
        status: 'pending',
        created_at: nowIso()
    };
    withdrawals.push(wd);
    writeDB('withdrawals', withdrawals);
    await telegram.notifyWithdraw(setup, user, wd);
    res.redirect('/history?msg=' + encodeURIComponent('Permintaan penarikan terkirim. Menunggu persetujuan admin.'));
});

app.get('/history', requireAuth, (req, res) => {
    const user = res.locals.user;
    const filter = ['deposit', 'withdraw'].includes(req.query.type) ? req.query.type : 'all';
    const payments = readDB('payments', []).filter((p) => p.user_id === user.id && p.source === 'deposit');
    const withdrawals = readDB('withdrawals', []).filter((w) => w.user_id === user.id);
    let rows = [];
    if (filter === 'deposit' || filter === 'all') {
        rows = rows.concat(payments.map((p) => ({ kind: 'deposit', method: 'qris', amount: p.amount, fee: 0, status: p.status, created_at: p.created_at, ref: p.id })));
    }
    if (filter === 'withdraw' || filter === 'all') {
        rows = rows.concat(withdrawals.map((w) => ({ kind: 'withdraw', method: w.method, amount: w.amount, fee: w.fee, status: w.status, created_at: w.created_at, ref: w.id })));
    }
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.render('user/history', {
        title: 'Riwayat', filter, rows,
        msg: req.query.msg ? decodeURIComponent(req.query.msg) : null
    });
});

app.get('/developer', requireAuth, (req, res) => {
    res.render('user/developers', {
        title: 'Developer',
        msg: req.query.msg ? decodeURIComponent(req.query.msg) : null,
        err: req.query.err ? decodeURIComponent(req.query.err) : null
    });
});

app.post('/developer/apikey', requireAuth, (req, res) => {
    const user = res.locals.user;
    const active = (user.api_keys || []).filter((k) => !k.revoked);
    if (active.length >= 5) return res.redirect('/developer?err=' + encodeURIComponent('Maksimal 5 API key aktif'));
    const keys = user.api_keys || [];
    keys.unshift({ id: uid('K_'), key: genApiKey(), created_at: nowIso(), revoked: false });
    updateUser(user.id, { api_keys: keys });
    res.redirect('/developer?msg=' + encodeURIComponent('API key baru berhasil dibuat.'));
});

app.post('/developer/apikey/revoke', requireAuth, (req, res) => {
    const user = res.locals.user;
    const keys = (user.api_keys || []).map((k) => (k.id === req.body.id ? Object.assign({}, k, { revoked: true }) : k));
    updateUser(user.id, { api_keys: keys });
    res.redirect('/developer?msg=' + encodeURIComponent('API key dicabut.'));
});

app.get('/payment', async (req, res) => {
    const p = readDB('payments', []).find((x) => x.id === String(req.query.id || ''));
    if (!p) return res.status(404).render('user/pay-result', { title: 'Pembayaran', payment: null, owner: null });
    await checkAndSettle(p);
    const fresh = readDB('payments', []).find((x) => x.id === p.id);
    const owner = readDB('users', []).find((x) => x.id === p.user_id);
    res.render('user/pay-result', { title: 'Pembayaran', payment: fresh, owner });
});

app.get('/payment/status', async (req, res) => {
    const p = readDB('payments', []).find((x) => x.id === String(req.query.id || ''));
    if (!p) return res.json({ success: false, message: 'Payment not found' });
    const settled = await checkAndSettle(p);
    res.json({ success: true, id: settled.id, external_id: settled.external_id, amount: settled.amount, status: settled.status, paid_at: settled.paid_at || null });
});

app.get('/api/payment', async (req, res) => {
    const apiKey = String(req.query.api_key || '');
    const user = findUserByKey(apiKey);
    const setup = loadSetup();
    if (!user) return res.json({ success: false, message: 'API key tidak valid' });
    const amount = parseInt(req.query.amount, 10);
    if (!amount || amount < 1000 || amount > 5000000) {
        return res.json({ success: false, message: 'Amount tidak valid (1000 - 5000000)' });
    }
    if (!setup.gopay_token || !setup.static_qr) {
        return res.json({ success: false, message: 'Fitur deposit belum aktif' });
    }
    try {
        const qr = await gopay.createQRIS(amount, setup.static_qr);
        const payments = readDB('payments', []);
        const payment = {
            id: uid('PAY_'),
            user_id: user.id,
            source: 'api',
            external_id: String(req.query.external_id || ''),
            amount,
            status: 'pending',
            qr_url: qr.url,
            qr_created: qr.created_at,
            credited: false,
            created_at: nowIso(),
            exp_at: new Date(Date.now() + PAYMENT_TTL).toISOString()
        };
        payments.push(payment);
        writeDB('payments', payments);
        const base = (setup.base_url || '').replace(/\/$/, '');
        res.json({
            success: true,
            data: {
                id: payment.id,
                external_id: payment.external_id,
                amount: payment.amount,
                status: payment.status,
                qr_url: payment.qr_url,
                payment_url: base + '/payment?id=' + payment.id,
                expired_at: payment.exp_at
            }
        });
    } catch (e) {
        res.json({ success: false, message: 'Gagal membuat pembayaran: ' + (e.message || e) });
    }
});

app.get('/api/payment/check', async (req, res) => {
    const p = readDB('payments', []).find((x) => x.id === String(req.query.id || ''));
    if (!p) return res.json({ success: false, message: 'Payment tidak ditemukan' });
    const settled = await checkAndSettle(p);
    res.json({
        success: true,
        data: {
            id: settled.id,
            external_id: settled.external_id,
            amount: settled.amount,
            status: settled.status,
            paid_at: settled.paid_at || null
        }
    });
});

app.get('/api/balance', (req, res) => {
    const apiKey = String(req.query.api_key || '');
    const user = findUserByKey(apiKey);
    if (!user) return res.json({ success: false, message: 'API key tidak valid' });
    res.json({
        success: true,
        data: {
            username: user.username,
            balance: user.balance,
            currency: 'IDR',
            formatted: rupiah(user.balance)
        }
    });
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    const users = readDB('users', []);
    const payments = readDB('payments', []);
    const withdrawals = readDB('withdrawals', []);
    const paidIn = payments.filter((p) => p.status === 'paid');
    const pendingWd = withdrawals.filter((w) => w.status === 'pending');
    const data = {
        users: users.length,
        activeKeys: users.reduce((s, u) => s + (u.api_keys || []).filter((k) => !k.revoked).length, 0),
        totalBalance: users.reduce((s, u) => s + (u.balance || 0), 0),
        totalPaidIn: paidIn.reduce((s, p) => s + p.amount, 0),
        totalDeposit: payments.reduce((s, p) => s + p.amount, 0),
        pendingPayments: payments.filter((p) => p.status === 'pending').length,
        pendingWithdraws: pendingWd.length,
        totalWithdrawPending: pendingWd.reduce((s, w) => s + w.amount, 0)
    };
    res.render('admin/dashboard', {
        title: 'Admin Dashboard',
        data,
        recentPayments: payments.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8),
        recentWithdraws: withdrawals.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8)
    });
});

app.get('/admin/setup', requireAdmin, (req, res) => {
    res.render('admin/setup', {
        title: 'Setup',
        msg: req.query.msg ? decodeURIComponent(req.query.msg) : null,
        err: req.query.err ? decodeURIComponent(req.query.err) : null
    });
});

app.post('/admin/setup', requireAdmin, (req, res) => {
    const s = loadSetup();
    s.name = String(req.body.name || s.name || 'VANPAY').trim() || 'VANPAY';
    s.fee = Math.max(0, parseInt(req.body.fee, 10) || 0);
    s.static_qr = String(req.body.static_qr || '').trim();
    s.gopay_token = String(req.body.gopay_token || '').trim();
    s.gopay_phone = String(req.body.gopay_phone || '').trim();
    s.telegram_token = String(req.body.telegram_token || '').trim();
    s.telegram_chat_id = String(req.body.telegram_chat_id || '').trim();
    s.google_client_id = String(req.body.google_client_id || '').trim();
    s.google_client_secret = String(req.body.google_client_secret || '').trim();
    s.github_client_id = String(req.body.github_client_id || '').trim();
    s.github_client_secret = String(req.body.github_client_secret || '').trim();
    s.base_url = String(req.body.base_url || s.base_url || '').trim();
    saveSetup(s);
    res.redirect('/admin/setup?msg=' + encodeURIComponent('Pengaturan berhasil disimpan.'));
});

app.post('/admin/gopay/otp', requireAdmin, async (req, res) => {
    const phone = String(req.body.phone || '').trim();
    try {
        if (!phone) return res.status(400).json({ success: false, message: 'Nomor HP wajib diisi' });
        const data = await gopay.sendOTP(phone);
        const token = typeof data === 'string' ? data : (data && (data.otp_token || data.token || data.otpToken)) || JSON.stringify(data || '');
        const dir = path.join(__dirname, 'library/database');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'gopay_otp_token.json'), JSON.stringify({ token, phone, ts: nowIso() }));
        res.json({ success: true, message: 'OTP terkirim ke ' + phone });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message || String(e) });
    }
});

app.post('/admin/gopay/verify', requireAdmin, async (req, res) => {
    const otp = String(req.body.otp || '').trim();
    try {
        if (!otp) return res.status(400).json({ success: false, message: 'Kode OTP wajib diisi' });
        const saved = JSON.parse(fs.readFileSync(path.join(__dirname, 'library/database/gopay_otp_token.json'), 'utf8'));
        const data = await gopay.verifyOTP(otp, saved.token);
        const session = typeof data === 'string' ? data : (data && (data.token || data.access_token || data.session)) || JSON.stringify(data || '');
        const s = loadSetup();
        s.gopay_token = typeof session === 'string' ? session : '';
        s.gopay_phone = saved.phone || s.gopay_phone;
        saveSetup(s);
        res.json({ success: true, message: 'Session GoPay merchant tersimpan.', token: session });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message || String(e) });
    }
});

app.get('/admin/withdraw', requireAdmin, (req, res) => {
    const users = readDB('users', []);
    const withdrawals = readDB('withdrawals', []);
    const filter = ['pending', 'approved', 'rejected'].includes(req.query.filter) ? req.query.filter : 'all';
    const rows = withdrawals
        .filter((w) => (filter === 'all' ? true : w.status === filter))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((w) => Object.assign({}, w, { user: users.find((u) => u.id === w.user_id) || {} }));
    res.render('admin/withdraw', {
        title: 'Penarikan', rows, filter,
        msg: req.query.msg ? decodeURIComponent(req.query.msg) : null,
        err: req.query.err ? decodeURIComponent(req.query.err) : null
    });
});

app.post('/admin/withdraw/:id/:action', requireAdmin, (req, res) => {
    const withdrawals = readDB('withdrawals', []);
    const w = withdrawals.find((x) => x.id === req.params.id);
    if (!w) return res.redirect('/admin/withdraw?err=' + encodeURIComponent('Data tidak ditemukan'));
    if (w.status !== 'pending') return res.redirect('/admin/withdraw?err=' + encodeURIComponent('Penarikan sudah diproses'));
    if (req.params.action === 'approve') {
        w.status = 'approved';
        w.processed_at = nowIso();
    } else if (req.params.action === 'reject') {
        w.status = 'rejected';
        w.processed_at = nowIso();
        const users = readDB('users', []);
        const u = users.find((x) => x.id === w.user_id);
        if (u) {
            u.balance = (u.balance || 0) + w.total;
            writeDB('users', users);
            w.refunded = true;
        }
    } else {
        return res.redirect('/admin/withdraw');
    }
    writeDB('withdrawals', withdrawals);
    res.redirect('/admin/withdraw?msg=' + encodeURIComponent('Penarikan berhasil diproses.'));
});

app.use((req, res) => {
    res.status(404).send('<h1 style="font-family:sans-serif">404 Not Found</h1>');
});

app.listen(PORT, () => {
    console.log('[vanpay] running on http://localhost:' + PORT);
});