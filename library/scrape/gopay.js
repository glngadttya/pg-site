const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.join(__dirname, '..', 'database', 'media');

async function sendOTP(phone) {
    if (!phone) throw new Error('Phone is required');

    const response = await axios.post('https://go-merch.vercel.app/auth/otp', {
        phone: phone
    }, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
            'Content-Type': 'application/json',
            'origin': 'https://go-merch.vercel.app',
            'referer': 'https://go-merch.vercel.app/'
        }
    });

    return response.data.data.data;
}

async function verifyOTP(otp, otpToken) {
    if (!otp) throw new Error('OTP is required');
    if (!otpToken) throw new Error('OTP token is required');

    const response = await axios.post('https://go-merch.vercel.app/auth/verify', {
        otp: otp,
        otp_token: otpToken
    }, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
            'Content-Type': 'application/json',
            'origin': 'https://go-merch.vercel.app',
            'referer': 'https://go-merch.vercel.app/'
        }
    });

    return response.data.data;
}

async function saveLocalQRIS(buffer, filename) {
    if (!buffer) throw new Error('Image buffer is required');
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const filePath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return '/media/' + filename;
}

async function createQRIS(amount, staticQr) {
    if (!amount) throw new Error('Amount is required');
    if (!staticQr) throw new Error('Static QR is required');

    const qrisUrl = `https://go-merch.vercel.app/api/qris/create?amount=${amount}&static_qr=${encodeURIComponent(staticQr)}`;

    const response = await axios.get(qrisUrl, {
        responseType: 'arraybuffer',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
            'referer': 'https://go-merch.vercel.app/'
        }
    });

    const qrBuffer = Buffer.from(response.data);
    const timestamp = Date.now();
    const filename = `QRIS-${timestamp}.jpg`;
    const url = await saveLocalQRIS(qrBuffer, filename);

    return {
        filename: filename,
        url: url,
        created_at: new Date().toISOString()
    };
}

async function checkQRIS(amount, createdAt, token) {
    if (!amount) throw new Error('Amount is required');
    if (!createdAt) throw new Error('Created at is required');
    if (!token) throw new Error('Token is required');

    const response = await axios.post('https://go-merch.vercel.app/api/qris/status', {
        amount: amount,
        created_at: createdAt,
        token: token
    }, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
            'Content-Type': 'application/json',
            'origin': 'https://go-merch.vercel.app',
            'referer': 'https://go-merch.vercel.app/'
        }
    });

    return {
        status: response.data.status,
        result: response.data.data
    };
}

module.exports = { sendOTP, verifyOTP, createQRIS, checkQRIS, MEDIA_DIR };