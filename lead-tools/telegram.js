const https = require('https');

function sendTelegram(msg) {
    const token = process.env.SCRAPE_TELEGRAM_TOKEN;
    const chatId = process.env.SCRAPE_TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id: chatId, text: msg });
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
    req.on('error', () => {});
    req.end(body);
}

module.exports = { sendTelegram };
