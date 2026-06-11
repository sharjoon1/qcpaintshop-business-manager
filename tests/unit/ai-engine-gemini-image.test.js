/**
 * Locks the Gemini vision payload conversion: the clawdbot-style
 * `[IMAGE: data:<mime>;base64,<data>]` convention must become a Gemini
 * inline_data part (the vendor bill scan's fallback path when the clawdbot
 * gateway is down).
 */
const { geminiParts } = require('../../services/ai-engine');

describe('geminiParts', () => {
    it('converts an embedded image into inline_data and keeps surrounding text', () => {
        const parts = geminiParts('[IMAGE: data:image/jpeg;base64,AAAA]\n\nExtract all data. Return JSON only.');
        expect(parts).toEqual([
            { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } },
            { text: 'Extract all data. Return JSON only.' },
        ]);
    });

    it('plain text stays a single text part', () => {
        expect(geminiParts('hello world')).toEqual([{ text: 'hello world' }]);
    });

    it('text before the image is preserved in order', () => {
        const parts = geminiParts('look at this: [IMAGE: data:image/png;base64,BB==] what is it?');
        expect(parts[0]).toEqual({ text: 'look at this:' });
        expect(parts[1].inline_data.mime_type).toBe('image/png');
        expect(parts[2]).toEqual({ text: 'what is it?' });
    });

    it('empty content still yields one (empty) text part — Gemini rejects empty parts arrays', () => {
        expect(geminiParts('')).toEqual([{ text: '' }]);
    });
});
