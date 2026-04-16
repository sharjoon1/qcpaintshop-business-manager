// tests/unit/painter-marketing-scheduler.test.js
const sched = require('../../services/painter-marketing-scheduler');

describe('applyOutcome', () => {
    const cfg = {
        recycle_days_new: 7, recycle_days_callback: 3, recycle_days_will_visit: 14,
        recycle_days_already_aware: 60, recycle_days_not_interested: 30,
        recycle_days_unreachable: 60, recycle_days_active_painter: 45
    };
    function today() { return new Date('2026-04-16T00:00:00Z'); }

    test('interested_in_program → interested, +7d', () => {
        const r = sched.applyOutcome({ outcome: 'interested_in_program', cfg, today: today() });
        expect(r.status).toBe('interested');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-23');
    });
    test('wants_callback with explicit date honored', () => {
        const r = sched.applyOutcome({ outcome: 'wants_callback', callbackDate: '2026-04-20', cfg, today: today() });
        expect(r.status).toBe('in_progress');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-20');
    });
    test('wants_callback without date → +3d', () => {
        const r = sched.applyOutcome({ outcome: 'wants_callback', cfg, today: today() });
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-19');
    });
    test('wrong_number → next_eligible NULL (permanently off)', () => {
        const r = sched.applyOutcome({ outcome: 'wrong_number', cfg, today: today() });
        expect(r.status).toBe('wrong_number');
        expect(r.next_eligible_date).toBeNull();
    });
    test('not_answered with < 5 consecutive → unchanged status, +3d', () => {
        const r = sched.applyOutcome({ outcome: 'no_answer', consecutiveNoAnswer: 2, currentStatus: 'in_progress', cfg, today: today() });
        expect(r.status).toBe('in_progress');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-04-19');
    });
    test('not_answered 5+ consecutive → unreachable + 60d', () => {
        const r = sched.applyOutcome({ outcome: 'no_answer', consecutiveNoAnswer: 5, currentStatus: 'in_progress', cfg, today: today() });
        expect(r.status).toBe('unreachable');
        expect(r.next_eligible_date.toISOString().slice(0, 10)).toBe('2026-06-15');
    });
    test('not_interested → +30d', () => {
        const r = sched.applyOutcome({ outcome: 'not_interested', cfg, today: today() });
        expect(r.status).toBe('not_interested');
    });
});
