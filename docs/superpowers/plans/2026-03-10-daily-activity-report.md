# Daily Activity Report Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and send daily activity reports (PDF + notification) to admins at 10:05 PM IST, with an always-accessible "Daily Report" tab in admin-activity-monitor.html.

**Architecture:** Extend `services/attendance-report.js` with activity report generation functions. Add a new API endpoint in `routes/activity-tracker.js` for the admin panel. Add a "Daily Report" tab to `admin-activity-monitor.html`.

**Tech Stack:** Express.js, PDFKit, MySQL, Socket.io, notification-service

---

## Chunk 1: Backend — Activity Report Generation & API

### Task 1: Add activity report generation to attendance-report.js

**Files:**
- Modify: `services/attendance-report.js`

- [ ] **Step 1: Add `generateActivityReportData(date)` function**

After the `generateAdminPDF` function (around line 402), add this function that queries `staff_activity_sessions` and `staff_attendance` to build per-staff activity data:

```javascript
/**
 * Generate daily activity report data for all staff on a date
 * Returns array of staff objects with activity breakdown + idle time
 */
async function generateActivityReportData(date) {
    if (!pool) return [];

    try {
        // Get all staff who clocked in on this date
        const [staff] = await pool.query(
            `SELECT a.user_id, u.full_name, b.name as branch_name, a.branch_id,
                    a.clock_in_time, a.clock_out_time,
                    a.total_working_minutes, a.break_duration_minutes,
                    a.outside_work_minutes, a.prayer_minutes, a.overtime_minutes
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             WHERE a.date = ? AND u.role NOT IN ('customer', 'super_admin')
             ORDER BY b.name, u.full_name`,
            [date]
        );

        if (staff.length === 0) return [];

        // Get activity sessions for all staff on this date
        const [sessions] = await pool.query(
            `SELECT user_id, activity_type,
                    SUM(COALESCE(duration_minutes, TIMESTAMPDIFF(MINUTE, started_at, COALESCE(ended_at, NOW())))) as total_minutes,
                    COUNT(*) as session_count
             FROM staff_activity_sessions
             WHERE DATE(started_at) = ?
             GROUP BY user_id, activity_type`,
            [date]
        );

        // Build a map: userId -> { activityType -> minutes }
        const activityMap = {};
        for (const s of sessions) {
            if (!activityMap[s.user_id]) activityMap[s.user_id] = {};
            activityMap[s.user_id][s.activity_type] = {
                minutes: Math.round(s.total_minutes || 0),
                count: s.session_count
            };
        }

        // Build report data per staff
        const reportData = staff.map(s => {
            const activities = activityMap[s.user_id] || {};
            const totalActiveMinutes = Object.values(activities).reduce((sum, a) => sum + a.minutes, 0);
            const totalWorking = s.total_working_minutes || 0;
            const breakMins = s.break_duration_minutes || 0;
            const prayerMins = s.prayer_minutes || 0;
            const outsideMins = s.outside_work_minutes || 0;

            // Idle = total working - active - break - prayer - outside
            const idleMinutes = Math.max(0, totalWorking - totalActiveMinutes - breakMins - prayerMins - outsideMins);

            return {
                user_id: s.user_id,
                full_name: s.full_name,
                branch_name: s.branch_name,
                branch_id: s.branch_id,
                clock_in: formatTime(s.clock_in_time),
                clock_out: s.clock_out_time ? formatTime(s.clock_out_time) : 'Still working',
                total_working: totalWorking,
                break_minutes: breakMins,
                prayer_minutes: prayerMins,
                outside_minutes: outsideMins,
                activities,
                total_active: totalActiveMinutes,
                idle_minutes: idleMinutes,
                idle_percent: totalWorking > 0 ? Math.round((idleMinutes / totalWorking) * 100) : 0
            };
        });

        return reportData;
    } catch (error) {
        console.error('[ActivityReport] generateActivityReportData error:', error.message);
        return [];
    }
}
```

- [ ] **Step 2: Add `generateActivityPDF(date)` function**

After the above function, add the PDF generator:

```javascript
/**
 * Generate PDF of daily activity report for all staff
 */
async function generateActivityPDF(date) {
    if (!pool) return null;

    try {
        const reportData = await generateActivityReportData(date);
        if (reportData.length === 0) return null;

        const dir = path.join(__dirname, '..', 'public', 'uploads', 'reports');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filename = `activity-report-${date}.pdf`;
        const filepath = path.join(dir, filename);

        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        // Activity type labels (short)
        const activityTypes = [
            { key: 'marketing', label: 'MKT' },
            { key: 'outstanding_followup', label: 'OUT' },
            { key: 'material_arrangement', label: 'MAT' },
            { key: 'material_receiving', label: 'RCV' },
            { key: 'attending_customer', label: 'CUS' },
            { key: 'shop_maintenance', label: 'SHP' }
        ];

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 30, layout: 'landscape' });
            const stream = fs.createWriteStream(filepath);
            doc.pipe(stream);

            // Header
            doc.fontSize(16).font('Helvetica-Bold').text('Quality Colours - Daily Activity Report', { align: 'center' });
            doc.fontSize(11).font('Helvetica').text(dateStr, { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(9).text(`Total Staff: ${reportData.length} | Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'center' });
            doc.moveDown(0.8);

            // Table columns
            const headers = ['#', 'Name', 'Branch', 'In', 'Out', ...activityTypes.map(a => a.label), 'Active', 'Idle*', 'Idle%'];
            const colWidths = [20, 95, 75, 50, 50, 42, 42, 42, 42, 42, 42, 48, 48, 38];
            const startX = 30;
            let y = doc.y;

            // Header row
            doc.font('Helvetica-Bold').fontSize(7);
            let x = startX;
            headers.forEach((h, i) => {
                doc.text(h, x, y, { width: colWidths[i], align: 'center' });
                x += colWidths[i] + 3;
            });
            y += 14;
            const tableWidth = colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 3;
            doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
            y += 4;

            // Data rows
            doc.font('Helvetica').fontSize(7);
            let totalActive = 0, totalIdle = 0;

            reportData.forEach((row, idx) => {
                if (y > 520) {
                    doc.addPage({ layout: 'landscape' });
                    y = 30;
                    doc.font('Helvetica-Bold').fontSize(7);
                    x = startX;
                    headers.forEach((h, i) => {
                        doc.text(h, x, y, { width: colWidths[i], align: 'center' });
                        x += colWidths[i] + 3;
                    });
                    y += 14;
                    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
                    y += 4;
                    doc.font('Helvetica').fontSize(7);
                }

                totalActive += row.total_active;
                totalIdle += row.idle_minutes;

                // Alternate row bg
                if (idx % 2 === 0) {
                    doc.rect(startX - 2, y - 2, tableWidth + 4, 13).fill('#f8f9fa').fillColor('black');
                }

                const vals = [
                    String(idx + 1),
                    row.full_name,
                    row.branch_name,
                    row.clock_in,
                    row.clock_out,
                    ...activityTypes.map(a => {
                        const mins = row.activities[a.key]?.minutes || 0;
                        return mins > 0 ? formatMinutes(mins) : '-';
                    }),
                    formatMinutes(row.total_active),
                    formatMinutes(row.idle_minutes),
                    row.idle_percent + '%'
                ];

                x = startX;
                vals.forEach((v, i) => {
                    const align = i <= 2 ? 'left' : 'center';
                    doc.text(v, x, y, { width: colWidths[i], align });
                    x += colWidths[i] + 3;
                });
                y += 13;
            });

            // Footer
            y += 8;
            doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
            y += 6;
            doc.font('Helvetica-Bold').fontSize(8);
            doc.text(`Summary: ${reportData.length} staff | Total Active: ${formatMinutes(totalActive)} | Total Idle: ${formatMinutes(totalIdle)}`, startX, y);
            y += 14;
            doc.font('Helvetica').fontSize(7).fillColor('#666666');
            doc.text('* Idle = Total Working - Active Activities - Break - Prayer - Outside Work', startX, y);

            doc.end();

            stream.on('finish', () => {
                resolve({ filepath, filename, url: `/uploads/reports/${filename}`, staffCount: reportData.length });
            });
            stream.on('error', reject);
        });
    } catch (error) {
        console.error('[ActivityReport] generateActivityPDF error:', error.message);
        return null;
    }
}
```

- [ ] **Step 3: Add `sendActivityAdminReport(date)` function**

After the PDF generator, add the function that sends the report to admins:

```javascript
/**
 * Send daily activity report to admin users (notification + WhatsApp + PDF)
 */
async function sendActivityAdminReport(date) {
    if (!pool) return;

    try {
        const [admins] = await pool.query(
            `SELECT id, full_name, phone FROM users WHERE role = 'admin' AND status = 'active'`
        );
        if (admins.length === 0) return;

        const reportData = await generateActivityReportData(date);
        if (reportData.length === 0) {
            console.log('[ActivityReport] No activity data for', date);
            return;
        }

        const pdf = await generateActivityPDF(date);

        // Build text summary
        const totalActive = reportData.reduce((s, r) => s + r.total_active, 0);
        const totalIdle = reportData.reduce((s, r) => s + r.idle_minutes, 0);
        const avgIdlePct = reportData.length > 0
            ? Math.round(reportData.reduce((s, r) => s + r.idle_percent, 0) / reportData.length)
            : 0;

        const dateObj = new Date(date + 'T00:00:00');
        const dateStr = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

        // Top 3 idle staff
        const topIdle = [...reportData].sort((a, b) => b.idle_minutes - a.idle_minutes).slice(0, 3);
        let idleList = topIdle.map(s => `  ${s.full_name}: ${formatMinutes(s.idle_minutes)} (${s.idle_percent}%)`).join('\n');

        const adminText = `*Daily Activity Report*
---
${dateStr}
---
Total Staff: ${reportData.length}
Total Active Time: ${formatMinutes(totalActive)}
வேலை செய்யாமல் இருந்த மொத்த நேரம்: ${formatMinutes(totalIdle)}
Avg Idle: ${avgIdlePct}%

*அதிக நேரம் வேலை செய்யாமல் இருந்தவர்கள்:*
${idleList}
${pdf ? `\nPDF: https://act.qcpaintshop.com${pdf.url}` : ''}
---
_QC Paint Shop - Activity Report_`;

        for (const admin of admins) {
            try {
                await notificationService.send(admin.id, {
                    type: 'admin_activity_report',
                    title: 'Daily Activity Report',
                    body: `${reportData.length} staff | Active: ${formatMinutes(totalActive)} | Idle: ${formatMinutes(totalIdle)} (${avgIdlePct}%)`,
                    data: { date, pdf_url: pdf?.url, total: reportData.length }
                });
            } catch (e) {
                console.error('[ActivityReport] Admin notification error:', e.message);
            }

            if (whatsappSessionManager && admin.phone) {
                let waPhone = admin.phone.replace(/[^0-9]/g, '');
                if (waPhone.length === 10) waPhone = '91' + waPhone;
                try {
                    await whatsappSessionManager.sendMessage(0, waPhone, adminText);
                    if (pdf) {
                        try {
                            await whatsappSessionManager.sendMessage(0, waPhone, null, {
                                source: 'activity_report',
                                document: { path: pdf.filepath, filename: pdf.filename }
                            });
                        } catch (docErr) {
                            console.error('[ActivityReport] PDF send error:', docErr.message);
                        }
                    }
                } catch (err) {
                    console.error('[ActivityReport] Admin WhatsApp error:', err.message);
                }
            }
        }

        console.log(`[ActivityReport] Admin activity report sent to ${admins.length} admin(s)`);
    } catch (error) {
        console.error('[ActivityReport] sendActivityAdminReport error:', error.message);
    }
}
```

- [ ] **Step 4: Hook into the 10:05 PM cron**

In the `start()` function, add the activity report call inside the existing 10:05 PM cron after `sendAdminReport(today)`:

```javascript
// Inside the 10:05 PM cron callback, after: await sendAdminReport(today);
// Add:
await sendActivityAdminReport(today);
```

Also register it:

```javascript
// Inside start(), add registration:
registry.register('activity-daily-report', { name: 'Activity Reports', service: 'attendance-report', schedule: '5 22 * * *', description: 'Daily activity report to admin at 10:05 PM' });
```

And update the cron try block to mark it:

```javascript
if (registry) registry.markCompleted('activity-daily-report', { details: 'Activity report sent' });
```

- [ ] **Step 5: Export new functions**

Update the `module.exports` at the bottom to include the new functions:

```javascript
module.exports = {
    // existing exports...
    generateActivityReportData,
    generateActivityPDF,
    sendActivityAdminReport
};
```

- [ ] **Step 6: Commit**

```bash
git add services/attendance-report.js
git commit -m "feat: add daily activity report generation with PDF + notification"
```

### Task 2: Add admin API endpoint for daily activity report

**Files:**
- Modify: `routes/activity-tracker.js`

- [ ] **Step 1: Add report service reference**

Add a variable and setter at the top of the file (alongside existing setters):

```javascript
let reportService;
function setReportService(rs) { reportService = rs; }
```

- [ ] **Step 2: Add GET /admin/daily-report endpoint**

After the existing `/admin/summary` endpoint (around line 313), add:

```javascript
/**
 * GET /admin/daily-report — Get daily activity report data for a date
 * Query: date (YYYY-MM-DD), defaults to today
 */
router.get('/admin/daily-report', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!reportService) {
            return res.status(500).json({ success: false, error: 'Report service not available' });
        }

        const reportData = await reportService.generateActivityReportData(date);

        // Check if PDF exists for this date
        const pdfFilename = `activity-report-${date}.pdf`;
        const pdfPath = path.join(__dirname, '..', 'public', 'uploads', 'reports', pdfFilename);
        const pdfExists = fs.existsSync(pdfPath);

        res.json({
            success: true,
            date,
            report: reportData,
            pdf_url: pdfExists ? `/uploads/reports/${pdfFilename}` : null
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /admin/daily-report error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /admin/daily-report/generate-pdf — Generate PDF for a specific date
 * Body: { date }
 */
router.post('/admin/daily-report/generate-pdf', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!reportService) {
            return res.status(500).json({ success: false, error: 'Report service not available' });
        }

        const pdf = await reportService.generateActivityPDF(date);
        if (!pdf) {
            return res.status(404).json({ success: false, error: 'No activity data for this date' });
        }

        res.json({
            success: true,
            pdf_url: pdf.url,
            filename: pdf.filename,
            staffCount: pdf.staffCount
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /admin/daily-report/generate-pdf error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 3: Add fs and path requires at top**

Add at the top of the file (if not already present):

```javascript
const fs = require('fs');
const path = require('path');
```

Note: `fs` and `path` are already imported at line 11-12.

- [ ] **Step 4: Export setReportService**

Update the module.exports:

```javascript
module.exports = { router, setPool, setIO, setActivityService, setNotificationService, setReportService };
```

- [ ] **Step 5: Commit**

```bash
git add routes/activity-tracker.js
git commit -m "feat: add admin daily-report API endpoint"
```

### Task 3: Wire up report service in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Set report service on activity tracker routes**

Find where `activityTrackerRoutes` is configured (search for `setActivityService`) and add:

```javascript
activityTrackerRoutes.setReportService(attendanceReport);
```

This should be near the other `activityTrackerRoutes.set*()` calls.

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat: wire activity report service to activity tracker routes"
```

## Chunk 2: Frontend — Daily Report Tab in Admin Activity Monitor

### Task 4: Add "Daily Report" tab to admin-activity-monitor.html

**Files:**
- Modify: `public/admin-activity-monitor.html`

- [ ] **Step 1: Add tab navigation**

After the header div (around line 197, after the closing `</div>` of the header), add tab navigation:

```html
<!-- Tabs -->
<div style="display: flex; gap: 0; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0;">
    <button class="tab-btn active" onclick="switchTab('live')" id="tabLive"
        style="padding: 10px 20px; font-size: 13px; font-weight: 600; border: none; background: none; cursor: pointer; color: #667eea; border-bottom: 2px solid #667eea; margin-bottom: -2px;">
        Live Monitor
    </button>
    <button class="tab-btn" onclick="switchTab('report')" id="tabReport"
        style="padding: 10px 20px; font-size: 13px; font-weight: 600; border: none; background: none; cursor: pointer; color: #64748b; border-bottom: 2px solid transparent; margin-bottom: -2px;">
        Daily Report
    </button>
</div>
```

- [ ] **Step 2: Wrap existing content in a "live" tab container**

Wrap all existing content from summary cards down to the day summary section in a div:

```html
<div id="tabContentLive">
    <!-- existing content: summary cards, staff grids, day summary -->
</div>
```

- [ ] **Step 3: Add "Daily Report" tab content**

After the live tab container, add:

```html
<div id="tabContentReport" style="display: none;">
    <!-- Report Header -->
    <div style="background: white; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
            <h2 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0;">Daily Activity Report</h2>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <input type="date" id="reportDate" class="filter-input" />
                <select id="reportBranch" class="filter-select">
                    <option value="">All Branches</option>
                </select>
                <button onclick="loadDailyReport()" class="btn-primary" style="padding: 8px 14px; font-size: 12px;">Load Report</button>
                <button onclick="generateReportPDF()" class="btn-primary" style="padding: 8px 14px; font-size: 12px; background: linear-gradient(135deg, #059669, #047857);">
                    PDF Download
                </button>
            </div>
        </div>
    </div>

    <!-- Report Summary Cards -->
    <div class="summary-grid" id="reportSummaryCards" style="margin-bottom: 16px;"></div>

    <!-- Report Table -->
    <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        <div id="reportTableContainer" style="overflow-x: auto; padding: 0;">
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                <p style="font-size: 14px; font-weight: 500;">Select a date and click Load Report</p>
            </div>
        </div>
    </div>
</div>
```

- [ ] **Step 4: Add JavaScript functions for the report tab**

Before the closing `</script>` tag, add:

```javascript
// ── Tab switching ──
function switchTab(tab) {
    document.getElementById('tabContentLive').style.display = tab === 'live' ? '' : 'none';
    document.getElementById('tabContentReport').style.display = tab === 'report' ? '' : 'none';

    document.getElementById('tabLive').style.color = tab === 'live' ? '#667eea' : '#64748b';
    document.getElementById('tabLive').style.borderBottomColor = tab === 'live' ? '#667eea' : 'transparent';
    document.getElementById('tabReport').style.color = tab === 'report' ? '#667eea' : '#64748b';
    document.getElementById('tabReport').style.borderBottomColor = tab === 'report' ? '#667eea' : 'transparent';

    if (tab === 'report' && !document.getElementById('reportDate').value) {
        document.getElementById('reportDate').value = todayISO();
        loadReportBranches();
        loadDailyReport();
    }
}

async function loadReportBranches() {
    try {
        const res = await fetch('/api/branches', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const sel = document.getElementById('reportBranch');
        if (sel.options.length > 1) return; // already loaded
        const branches = data.branches || data || [];
        branches.forEach(function(b) {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name || b.branch_name || ('Branch ' + b.id);
            sel.appendChild(opt);
        });
    } catch (e) { console.error('Failed to load report branches:', e); }
}

// ── Daily Report ──
let currentReportData = null;

async function loadDailyReport() {
    const date = document.getElementById('reportDate').value;
    if (!date) return;

    const container = document.getElementById('reportTableContainer');
    container.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;">Loading report...</div>';
    document.getElementById('reportSummaryCards').innerHTML = '';

    try {
        let url = '/api/activity-tracker/admin/daily-report?date=' + date;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        currentReportData = data;

        const report = data.report || [];
        const branchFilter = document.getElementById('reportBranch').value;
        const filtered = branchFilter ? report.filter(r => String(r.branch_id) === branchFilter) : report;

        renderReportSummary(filtered);
        renderReportTable(filtered, data.pdf_url);
    } catch (e) {
        console.error('Failed to load daily report:', e);
        container.innerHTML = '<div class="empty-state"><p>Failed to load: ' + escapeHtml(e.message) + '</p></div>';
    }
}

function renderReportSummary(data) {
    if (!data || data.length === 0) {
        document.getElementById('reportSummaryCards').innerHTML = '';
        return;
    }

    const totalStaff = data.length;
    const totalActive = data.reduce((s, r) => s + r.total_active, 0);
    const totalIdle = data.reduce((s, r) => s + r.idle_minutes, 0);
    const avgIdlePct = Math.round(data.reduce((s, r) => s + r.idle_percent, 0) / totalStaff);

    document.getElementById('reportSummaryCards').innerHTML =
        renderSummaryCard('Total Staff', totalStaff, '#667eea', '#eef2ff') +
        renderSummaryCard('Active Time', formatMinutes(totalActive), '#10b981', '#d1fae5') +
        '<div class="summary-card"><div style="width:36px;height:36px;border-radius:10px;background:#fef3c7;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;"><div style="width:12px;height:12px;border-radius:50%;background:#f59e0b;"></div></div><div class="summary-value" style="color:#f59e0b;">' + formatMinutes(totalIdle) + '</div><div class="summary-label">வேலை செய்யாமல் இருந்த நேரம்</div></div>' +
        renderSummaryCard('Avg Idle %', avgIdlePct + '%', avgIdlePct > 30 ? '#ef4444' : '#f59e0b', avgIdlePct > 30 ? '#fef2f2' : '#fef3c7');
}

function renderReportTable(data, pdfUrl) {
    const container = document.getElementById('reportTableContainer');

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activity data for this date</p></div>';
        return;
    }

    let grandTotalActive = 0, grandTotalIdle = 0;
    const actTypes = [
        { key: 'marketing', label: 'MKT', emoji: '\uD83D\uDCE2' },
        { key: 'outstanding_followup', label: 'OUT', emoji: '\uD83D\uDCB0' },
        { key: 'material_arrangement', label: 'MAT', emoji: '\uD83D\uDCE6' },
        { key: 'material_receiving', label: 'RCV', emoji: '\uD83D\uDE9B' },
        { key: 'attending_customer', label: 'CUS', emoji: '\uD83E\uDD1D' },
        { key: 'shop_maintenance', label: 'SHP', emoji: '\uD83E\uDDF9' }
    ];

    // Activity type totals
    const actTotals = {};
    actTypes.forEach(a => { actTotals[a.key] = 0; });

    let rows = data.map((s, idx) => {
        grandTotalActive += s.total_active;
        grandTotalIdle += s.idle_minutes;

        let cells = '';
        actTypes.forEach(a => {
            const mins = s.activities[a.key]?.minutes || 0;
            actTotals[a.key] += mins;
            cells += '<td style="text-align:center;">' + (mins > 0 ? formatMinutes(mins) : '<span style="color:#cbd5e1;">-</span>') + '</td>';
        });

        const idleColor = s.idle_percent > 50 ? '#ef4444' : (s.idle_percent > 30 ? '#f59e0b' : '#10b981');

        return '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td style="font-weight:600;">' + escapeHtml(s.full_name) + '</td>' +
            '<td>' + escapeHtml(s.branch_name) + '</td>' +
            '<td>' + escapeHtml(s.clock_in) + '</td>' +
            '<td>' + escapeHtml(s.clock_out) + '</td>' +
            cells +
            '<td style="text-align:center;font-weight:600;color:#10b981;">' + formatMinutes(s.total_active) + '</td>' +
            '<td style="text-align:center;font-weight:600;color:' + idleColor + ';">' + formatMinutes(s.idle_minutes) + '</td>' +
            '<td style="text-align:center;font-weight:700;color:' + idleColor + ';">' + s.idle_percent + '%</td>' +
        '</tr>';
    }).join('');

    // Total row
    let totalCells = '';
    actTypes.forEach(a => {
        totalCells += '<td style="text-align:center;">' + (actTotals[a.key] > 0 ? formatMinutes(actTotals[a.key]) : '-') + '</td>';
    });

    const html = '<table class="summary-table">' +
        '<thead><tr>' +
            '<th>#</th><th>Staff</th><th>Branch</th><th>In</th><th>Out</th>' +
            actTypes.map(a => '<th style="text-align:center;" title="' + escapeHtml(a.label) + '">' + a.emoji + ' ' + a.label + '</th>').join('') +
            '<th style="text-align:center;">Active</th>' +
            '<th style="text-align:center;">Idle*</th>' +
            '<th style="text-align:center;">Idle%</th>' +
        '</tr></thead>' +
        '<tbody>' + rows +
        '<tr class="total-row"><td></td><td>TOTAL</td><td></td><td></td><td></td>' +
            totalCells +
            '<td style="text-align:center;">' + formatMinutes(grandTotalActive) + '</td>' +
            '<td style="text-align:center;">' + formatMinutes(grandTotalIdle) + '</td>' +
            '<td></td>' +
        '</tr></tbody></table>' +
        '<div style="padding:8px 12px;font-size:11px;color:#94a3b8;">* Idle (வேலை செய்யாமல் இருந்த நேரம்) = Total Working - Activities - Break - Prayer - Outside Work</div>';

    container.innerHTML = html;
}

async function generateReportPDF() {
    const date = document.getElementById('reportDate').value;
    if (!date) { alert('Please select a date'); return; }

    try {
        const res = await fetch('/api/activity-tracker/admin/daily-report/generate-pdf', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ date })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to generate PDF');
        }
        const data = await res.json();
        if (data.pdf_url) {
            window.open(data.pdf_url, '_blank');
        }
    } catch (e) {
        alert('PDF generation failed: ' + e.message);
    }
}
```

- [ ] **Step 5: Commit**

```bash
git add public/admin-activity-monitor.html
git commit -m "feat: add Daily Report tab to activity monitor page"
```

### Task 5: Final commit

- [ ] **Step 1: Test the full flow**

Verify:
1. `GET /api/activity-tracker/admin/daily-report?date=2026-03-10` returns data
2. `POST /api/activity-tracker/admin/daily-report/generate-pdf` generates PDF
3. Admin activity monitor page shows both tabs
4. Daily Report tab loads data with correct idle calculation
5. PDF download works

- [ ] **Step 2: Update Skills.md**

Add entry for daily activity report feature.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: daily activity report with PDF, notification, and admin panel tab"
```
