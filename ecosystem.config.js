// PM2 process definition for production (Hetzner, /www/wwwroot/act.qcpaintshop.com).
// The app has always been started manually; this file makes the assumed
// configuration explicit and version-controlled.
//
// IMPORTANT: instances MUST stay 1 (fork mode). services/cluster-guard.js gates
// every scheduler on NODE_APP_INSTANCE being the primary, but several jobs
// (geofence interval, activity-feed cron, photo cleanup) are NOT guarded yet —
// cluster mode would double-fire crons, FCM pushes, and WhatsApp sends.
module.exports = {
    apps: [
        {
            name: 'business-manager',
            script: 'server.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
            },
        },
    ],
};
