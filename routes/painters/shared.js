/**
 * Painter Routes — shared state + cross-sub-router helpers (A8a split).
 *
 * Holds the single pool/io/sessionManager references for the painters route
 * family. setPool keeps the original fan-out side effects (points engine,
 * Zoho API, attendance service, idempotency) — invoked exactly once via
 * ./index.js setPool. Helpers here are the ones used by more than one
 * sub-router (or re-exported for tests): logEstimateStatusChange,
 * toISTDateString.
 */

const pointsEngine = require('../../services/painter-points-engine');
const zohoAPI = require('../../services/zoho-api');
const attendanceService = require('../../services/painter-attendance-service');
const { setPool: setIdempotencyPool } = require('../../middleware/idempotency');
const painterNotificationService = require('../../services/painter-notification-service');

let pool;
let io;
let sessionManager;

function setPool(p) {
    pool = p;
    pointsEngine.setPool(p);
    zohoAPI.setPool(p);
    attendanceService.setPool(p);
    setIdempotencyPool(p);
}

function setIO(ioInstance) { io = ioInstance; }
function setSessionManager(sm) { sessionManager = sm; }

// ─── Estimate Status History Logging ─────────────────────────
async function logEstimateStatusChange(estimateId, oldStatus, newStatus, changedBy, notes) {
    try {
        await pool.query(
            `INSERT INTO estimate_status_history (estimate_id, estimate_type, old_status, new_status, changed_by_user_id, notes, timestamp)
             VALUES (?, 'painter', ?, ?, ?, ?, NOW())`,
            [estimateId, oldStatus, newStatus, changedBy, notes || null]
        );
    } catch (err) {
        console.error('[Painters] Failed to log estimate status change:', err.message);
    }

    // Send painter notification for key status changes
    const NOTIFY_STATUSES = {
        'approved': { type: 'estimate_approved', title: 'Estimate Approved', body: 'Your estimate #{est} has been approved.' },
        'rejected': { type: 'estimate_rejected', title: 'Estimate Rejected', body: 'Your estimate #{est} was rejected.{notes}' },
        'sent_to_customer': { type: 'estimate_sent', title: 'Estimate Sent to Customer', body: 'Your estimate #{est} has been sent to the customer.' },
        'final_approved': { type: 'estimate_final_approved', title: 'Estimate Final Approved', body: 'Your estimate #{est} has been final approved.{notes}' },
        'payment_recorded': { type: 'payment_confirmed', title: 'Payment Confirmed', body: 'Payment for estimate #{est} has been confirmed.' },
        'pushed_to_zoho': { type: 'estimate_invoiced', title: 'Invoice Created', body: 'Zoho invoice created for estimate #{est}.' },
        'discount_requested': null, // painter initiated, no need to notify
        'payment_submitted': null // painter initiated
    };
    try {
        const notifConfig = NOTIFY_STATUSES[newStatus];
        if (notifConfig) {
            const [estRows] = await pool.query('SELECT painter_id, estimate_number FROM painter_estimates WHERE id = ?', [estimateId]);
            if (estRows.length) {
                const est = estRows[0];
                const body = notifConfig.body
                    .replace('{est}', est.estimate_number || estimateId)
                    .replace('{notes}', notes ? ' ' + notes : '');
                await painterNotificationService.sendToPainter(est.painter_id, {
                    type: notifConfig.type,
                    title: notifConfig.title,
                    body,
                    data: { estimate_id: String(estimateId), status: newStatus }
                });
            }
        }
    } catch (notifErr) {
        console.error('[Painters] Estimate notification error (non-fatal):', notifErr.message);
    }
}

// ─── IST date string (YYYY-MM-DD) for a given Date ───────────
function toISTDateString(date) {
    const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

module.exports = {
    setPool,
    setIO,
    setSessionManager,
    getPool: () => pool,
    getIO: () => io,
    getSessionManager: () => sessionManager,
    logEstimateStatusChange,
    toISTDateString,
};
