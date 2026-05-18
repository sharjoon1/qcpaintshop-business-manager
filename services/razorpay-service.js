const Razorpay = require('razorpay');
const crypto = require('crypto');

let razorpay = null;

function getInstance() {
    if (!razorpay) {
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!keyId || !keySecret) {
            throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment');
        }
        razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return razorpay;
}

async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    return await getInstance().orders.create({
        amount: Math.round(amount * 100), // paise
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
        notes
    });
}

function verifyPaymentSignature({ order_id, payment_id, signature }) {
    const body = order_id + '|' + payment_id;
    const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');
    return expected === signature;
}

module.exports = { createOrder, verifyPaymentSignature };
