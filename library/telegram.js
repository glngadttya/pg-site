const axios = require('axios');
const { rupiah } = require('./function');

async function sendMessage(token, chatId, text) {
    if (!token || !chatId) return false;
    try {
        const { data } = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        return !!(data && data.ok);
    } catch (e) {
        return false;
    }
}

async function notifyDeposit(setup, user, payment) {
    const text =
        '📥 <b>DANA MASUK</b>\n\n' +
        '════════════════════\n' +
        '🏷️ <b>ID:</b> ' + payment.id + '\n' +
        '💰 <b>Jumlah:</b> ' + rupiah(payment.amount) + '\n' +
        '👤 <b>User:</b> ' + (user ? user.username : '-') + '\n' +
        '🕐 <b>Waktu:</b> ' + new Date(payment.paid_at || Date.now()).toLocaleString('id-ID') +
        '\n════════════════════';
    return sendMessage(setup.telegram_token, setup.telegram_chat_id, text);
}

async function notifyWithdraw(setup, user, wd) {
    const text =
        '📤 <b>PENARIKAN DANA</b>\n\n' +
        '════════════════════\n' +
        '🏷️ <b>ID:</b> ' + wd.id + '\n' +
        '💰 <b>Jumlah:</b> ' + rupiah(wd.amount) + '\n' +
        '👤 <b>User:</b> ' + (user ? user.username : '-') + '\n' +
        '🏦 <b>Metode:</b> ' + (wd.method || '').toUpperCase() + '\n' +
        '📄 <b>Rekening:</b> ' + wd.account + '\n' +
        '🕐 <b>Waktu:</b> ' + new Date(wd.created_at).toLocaleString('id-ID') +
        '\n════════════════════';
    return sendMessage(setup.telegram_token, setup.telegram_chat_id, text);
}

module.exports = { sendMessage, notifyDeposit, notifyWithdraw };