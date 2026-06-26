/**
 * Characterization test for services/sms-service.js — the Nettyfish RetailSMS
 * gateway reads credentials + params from the QUERY STRING, not a POST body.
 *
 * Root cause this locks: a 2026-05 "send creds via POST body to keep them out
 * of URL logs" change made every SMS return
 *   {"ErrorCode":"1","ErrorMessage":"login details cannot be blank"}
 * because the gateway never saw user/password. Verified on prod: same creds
 * via GET query string reach auth (template validation); via POST body they
 * do not.
 *
 * This test pins: sendSms issues a GET whose URL query contains user,
 * password, senderid, number, text — and does NOT use a POST body.
 */
jest.mock('https');
const https = require('https');
const { EventEmitter } = require('events');
const sms = require('../../services/sms-service');

beforeEach(() => {
    process.env.SMS_USER = 'TESTUSER';
    process.env.SMS_PASSWORD = 'TESTPASS';
    process.env.SMS_SENDER_ID = 'QUALTQ';

    https.request = jest.fn(() => { const r = new EventEmitter(); r.write = jest.fn(); r.end = jest.fn(); return r; });
    https.get = jest.fn((url, cb) => {
        const res = new EventEmitter();
        const req = new EventEmitter();
        setImmediate(() => { if (cb) cb(res); res.emit('data', 'gateway-resp-body'); res.emit('end'); });
        return req;
    });
});

afterEach(() => { jest.clearAllMocks(); });

test('sendSms sends creds + params in the QUERY STRING via GET (not POST body)', async () => {
    await sms.sendSms({ number: '919999999999', text: 'hello world', label: 'TEST' });

    // Must use GET (Nettyfish reads the query string), not a POST body.
    expect(https.get).toHaveBeenCalledTimes(1);
    expect(https.request).not.toHaveBeenCalled();

    const calledUrl = https.get.mock.calls[0][0];
    expect(calledUrl).toContain('retailsms.nettyfish.com/api/mt/SendSMS');
    expect(calledUrl).toContain('user=TESTUSER');
    expect(calledUrl).toContain('password=TESTPASS');
    expect(calledUrl).toContain('senderid=QUALTQ');
    expect(calledUrl).toContain('number=919999999999');
    expect(calledUrl).toContain('text=hello%20world');
    expect(calledUrl).toContain('route=4');
});

test('sendSms resolves to the gateway response body', async () => {
    const resp = await sms.sendSms({ number: '919999999999', text: 'x', label: 'TEST' });
    expect(resp).toBe('gateway-resp-body');
});

test('sendSms is a no-op (resolves null, no network) when creds are missing', async () => {
    delete process.env.SMS_USER;
    const resp = await sms.sendSms({ number: '919999999999', text: 'x' });
    expect(resp).toBeNull();
    expect(https.get).not.toHaveBeenCalled();
});
