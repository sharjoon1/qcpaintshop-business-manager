const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

function generateSecret(username) {
    return speakeasy.generateSecret({
        name: `QCPaintShop (${username})`,
        issuer: 'Quality Colours',
        length: 20
    });
}

function generateQRCode(otpauthUrl) {
    return QRCode.toDataURL(otpauthUrl);
}

function verifyToken(secret, token) {
    return speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token: token.replace(/\s/g, ''),
        window: 1  // allow 30s clock drift
    });
}

module.exports = { generateSecret, generateQRCode, verifyToken };
