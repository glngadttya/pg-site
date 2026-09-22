const axios = require('axios');

function getAuthUrl(clientId, redirectUri) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'read:user user:email'
    });
    return 'https://github.com/login/oauth/authorize?' + params.toString();
}

async function getToken(clientId, clientSecret, code, redirectUri) {
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri
    });
    const { data } = await axios.post('https://github.com/login/oauth/access_token', params, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
        }
    });
    return data.access_token;
}

async function getUser(accessToken) {
    const { data } = await axios.get('https://api.github.com/user', {
        headers: { Authorization: 'Bearer ' + accessToken, 'User-Agent': 'vanpay' }
    });
    return data;
}

module.exports = { getAuthUrl, getToken, getUser };