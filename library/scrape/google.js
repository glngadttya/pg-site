const axios = require('axios');

function getAuthUrl(clientId, redirectUri) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'online',
        prompt: 'select_account'
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

async function getToken(clientId, clientSecret, code, redirectUri) {
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    });
    const { data } = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return data.access_token;
}

async function getUser(accessToken) {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken }
    });
    return data;
}

module.exports = { getAuthUrl, getToken, getUser };