const path = require('path');
const fs = require('fs');
const { initWasm, Resvg } = require('@resvg/resvg-wasm');

const INK = '#111';
const BG = '#f6f3ea';
const PAPER = '#fffdf5';
const YELLOW = '#ffd400';
const MINT = '#46e6a7';
const MUTED = '#6b6f76';

let fonts = [];
let ready = null;

function ensure() {
    if (!ready) {
        ready = (async () => {
            await initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
            fonts = ['ArchivoBlack-Regular.ttf', 'SpaceMono-Bold.ttf', 'SpaceMono-Regular.ttf'].map(
                (f) => fs.readFileSync(path.join(__dirname, 'assets', f))
            );
        })();
    }
    return ready;
}

function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decoyQr(seed, x, y, size) {
    const n = 21;
    const cell = size / n;
    const rnd = mulberry32(hashSeed(seed) || 1);
    let rects = '';
    const find = (fx, fy) => {
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 7; c++) {
                const on = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                if (on) rects += `<rect x="${(x + (fx + c) * cell).toFixed(1)}" y="${(y + (fy + r) * cell).toFixed(1)}" width="${(cell + 0.4).toFixed(1)}" height="${(cell + 0.4).toFixed(1)}" fill="${INK}"/>`;
            }
        }
    };
    find(0, 0); find(n - 7, 0); find(0, n - 7);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const inFinder = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
            if (inFinder) continue;
            if (rnd() < 0.46) rects += `<rect x="${(x + c * cell).toFixed(1)}" y="${(y + r * cell).toFixed(1)}" width="${(cell + 0.4).toFixed(1)}" height="${(cell + 0.4).toFixed(1)}" fill="${INK}"/>`;
        }
    }
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${PAPER}"/><rect x="${(x + 2).toFixed(0)}" y="${(y + 2).toFixed(0)}" width="${size - 4}" height="${size - 4}" fill="${YELLOW}"/>${rects}`;
}

function amountSize(amountStr) {
    const l = amountStr.length;
    if (l <= 7) return 118;
    if (l <= 9) return 96;
    return 78;
}

function paymentCard(pay, setup) {
    const amount = ('Rp' + Number(pay.amount || 0).toLocaleString('id-ID')).replace(/\.0+$/, '');
    const base = (setup.base_url || '').replace(/https?:\/\//, '').replace(/\/+$/, '');
    const expWib = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(pay.exp_at));
    const status = pay.status === 'paid' ? 'LUNAS' : pay.status === 'expired' ? 'KEDALUWARSA' : 'BELUM DIBAYAR';
    const statusFill = pay.status === 'paid' ? MINT : pay.status === 'expired' ? '#f87171' : YELLOW;
    const st = amountSize(amount);
    const qrSeed = pay.id + ':' + pay.amount;
    const qx = 880, qy = 214, qs = 262;
    const fontDis = 'Archivo Black';
    const fontMono = 'Space Mono';

    return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="${BG}"/>
<rect x="0" y="0" width="1200" height="18" fill="${INK}"/>
<rect x="0" y="612" width="1200" height="18" fill="${INK}"/>
${decoyQr(qrSeed, qx, qy, qs)}
<rect x="${qx + qs + 6}" y="${qy + qs + 2}" width="90" height="0" fill="none"/>
<text x="40" y="64" font-family="${fontDis}" font-size="40" fill="${INK}">VANPAY</text>
<rect x="40" y="82" width="196" height="10" fill="${YELLOW}"/>
<text x="1035" y="58" font-family="${fontMono}" font-size="20" text-anchor="end" fill="${MUTED}">PAYMENT GATEWAY</text>
<text x="1035" y="84" font-family="${fontMono}" font-size="14" text-anchor="end" fill="${MUTED}">QRIS · 24/7 SERVICE</text>
<line x1="40" y1="132" x2="1160" y2="132" stroke="${INK}" stroke-width="4"/>
<text x="40" y="192" font-family="${fontMono}" font-size="22" fill="${MUTED}">TOTAL PEMBAYARAN</text>
<text x="40" y="330" font-family="${fontDis}" font-size="${st}" fill="${INK}">${esc(amount)}</text>
<g transform="translate(40,372)">
  <rect x="0" y="0" width="266" height="52" rx="6" fill="${statusFill}" stroke="${INK}" stroke-width="4"/>
  <text x="133" y="35" font-family="${fontMono}" font-size="22" font-weight="bold" text-anchor="middle" fill="${INK}">${status}</text>
</g>
<text x="40" y="488" font-family="${fontMono}" font-size="20" fill="${MUTED}">REF  <tspan font-weight="bold" fill="${INK}">${esc(pay.id)}</tspan></text>
<text x="40" y="524" font-family="${fontMono}" font-size="20" fill="${MUTED}">KADALUWARSA  <tspan font-weight="bold" fill="${INK}">${expWib} WIB</tspan></text>
<line x1="40" y1="572" x2="1160" y2="572" stroke="${INK}" stroke-width="4"/>
<text x="40" y="600" font-family="${fontMono}" font-size="17" fill="${MUTED}">Scan QRIS di samping untuk menyelesaikan pembayaran.</text>
<text x="1160" y="600" font-family="${fontMono}" font-size="17" text-anchor="end" fill="${INK}">${esc(base)}</text>
</svg>`;
}

function brandCard(setup) {
    const base = (setup.base_url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const fontDis = 'Archivo Black';
    const fontMono = 'Space Mono';

    const qr = decoyQr('VANPAY:BRAND', 860, 200, 236);

    return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="${BG}"/>
<line x1="0" y1="0" x2="1200" y2="0" stroke="${INK}" stroke-width="6"/>
<line x1="0" y1="630" x2="1200" y2="630" stroke="${INK}" stroke-width="6"/>
<circle cx="1124" cy="84" r="76" fill="#ff6fbe"/>
<path d="M36 52 V24 H64 M1164 52 V24 H1136 M36 606 V578 H64 M1164 606 V578 H1136" stroke="${INK}" stroke-width="5" fill="none"/>
<text x="40" y="116" font-family="${fontMono}" font-size="20" fill="${MUTED}">vanpay.sys / _brand</text>
<circle cx="1140" cy="40" r="9" fill="#f87171" stroke="${INK}" stroke-width="3"/>
<circle cx="1172" cy="40" r="9" fill="${YELLOW}" stroke="${INK}" stroke-width="3"/>
<circle cx="1204" cy="40" r="9" fill="${MINT}" stroke="${INK}" stroke-width="3"/>
<rect x="620" y="16" width="580" height="10" fill="${YELLOW}"/>
<rect x="40" y="168" width="480" height="150" fill="${YELLOW}"/>
<text x="64" y="286" font-family="${fontDis}" font-size="138" fill="${INK}">VANPAY</text>
<line x1="44" y1="352" x2="740" y2="352" stroke="${INK}" stroke-width="5"/>
<text x="60" y="420" font-family="${fontMono}" font-size="24" fill="${INK}">Payment Gateway QRIS — top up saldo</text>
<text x="60" y="456" font-family="${fontMono}" font-size="24" fill="${INK}">mendekati instan, tarik dana kapanpun.</text>
<line x1="60" y1="520" x2="720" y2="520" stroke="${INK}" stroke-width="4"/>
<text x="60" y="562" font-family="${fontMono}" font-size="17" fill="${MUTED}">${esc(base)} · BEROPERASI 24/7</text>
<g transform="rotate(3 940 350)">
<rect x="760" y="140" width="360" height="380" rx="10" fill="${INK}"/>
${qr}
<text x="940" y="470" font-family="${fontMono}" font-size="20" text-anchor="middle" fill="${YELLOW}">SCAN &amp; TOP UP</text>
<rect x="960" y="480" width="160" height="0" fill="none"/>
</g>
<g transform="rotate(-3 60 596)">
<rect x="28" y="576" width="204" height="40" rx="4" fill="${MINT}" stroke="${INK}" stroke-width="3"/>
<text x="130" y="602" font-family="${fontMono}" font-size="15" font-weight="bold" text-anchor="middle" fill="${INK}">QRIS · PAYMENT</text>
</g>
</svg>`;
}

async function render(svg) {
    await ensure();
    const r = new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false } });
    return Buffer.from(r.render().asPng());
}

const cache = new Map();
function cached(key, ttlMs, build) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ttlMs) return hit.png;
    const png = build();
    cache.set(key, { t: Date.now(), png });
    if (cache.size > 400) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return png;
}

async function paymentPng(payment, setup) {
    const key = 'pay:' + payment.id;
    return cached(key, 1000 * 60 * 60 * 24, () => render(paymentCard(payment, setup)));
}

const brandPngCache = {};
async function brandPng(setup) {
    const base = setup.base_url || '';
    if (brandPngCache.png && brandPngCache.base === base) return brandPngCache.png;
    brandPngCache.base = base;
    brandPngCache.png = await render(brandCard(setup));
    return brandPngCache.png;
}

module.exports = { paymentCard, brandCard, paymentPng, brandPng };