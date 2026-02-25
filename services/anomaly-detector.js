/**
 * Anomaly Detection Service
 * Detects unusual patterns in business data using statistical analysis (Z-scores)
 * Covers: revenue, attendance, stock, collections, API usage
 */

let pool = null;
let alertCallback = null;  // Called with (severity, title, message) for critical/high anomalies
function setPool(p) { pool = p; }
function setAlertCallback(fn) { alertCallback = fn; }

// ─── Statistical Helpers ────────────────────────────────────────

function calculateZScore(value, mean, stdDev) {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
}

function calculateStats(values) {
    if (!values.length) return { mean: 0, stdDev: 0, min: 0, max: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return {
        mean,
        stdDev: Math.sqrt(variance),
        min: Math.min(...values),
        max: Math.max(...values)
    };
}

// ─── Config Loader ──────────────────────────────────────────────

async function getConfig() {
    const [rows] = await pool.query(
        `SELECT config_key, config_value FROM ai_config WHERE config_key LIKE 'anomaly_%'`
    );
    const config = {};
    for (const r of rows) {
        config[r.config_key] = r.config_value;
    }
    return {
        enabled: config.anomaly_detection_enabled !== 'false',
        revenueZThreshold: parseFloat(config.anomaly_revenue_zscore_threshold) || 2.0,
        attendanceZThreshold: parseFloat(config.anomaly_attendance_zscore_threshold) || 2.5,
        stockDeviationPct: parseFloat(config.anomaly_stock_deviation_pct) || 20,
        collectionDelayDays: parseInt(config.anomaly_collection_delay_days) || 7,
        maxPerScan: parseInt(config.anomaly_max_per_scan) || 50,
        notifyCritical: config.anomaly_notify_critical !== 'false',
        autoResolveDays: parseInt(config.anomaly_auto_resolve_days) || 30
    };
}

// ─── Anomaly Inserter ───────────────────────────────────────────

async function insertAnomaly(anomaly) {
    const [result] = await pool.query(
        `INSERT INTO detected_anomalies 
         (anomaly_type, severity, title, description, entity_type, entity_id, 
          metric_name, expected_value, actual_value, deviation_pct, z_score, branch_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            anomaly.type, anomaly.severity, anomaly.title, anomaly.description,
            anomaly.entityType || null, anomaly.entityId || null,
            anomaly.metricName || null, anomaly.expectedValue || null,
            anomaly.actualValue || null, anomaly.deviationPct || null,
            anomaly.zScore || null, anomaly.branchId || null,
            anomaly.metadata ? JSON.stringify(anomaly.metadata) : null
        ]
    );
    return result.insertId;
}

function getSeverityFromZScore(zScore, thresholds = { high: 3, critical: 4 }) {
    const absZ = Math.abs(zScore);
    if (absZ >= thresholds.critical) return 'critical';
    if (absZ >= thresholds.high) return 'high';
    if (absZ >= 2) return 'medium';
    return 'low';
}

// ─── Revenue Anomaly Detection ──────────────────────────────────

async function detectRevenueAnomalies(config) {
    const anomalies = [];
    try {
        // Get daily revenue for last 30 days per branch
        const [dailyRevenue] = await pool.query(`
            SELECT zoho_location_id as branch_id, 
                   DATE(transaction_date) as day,
                   SUM(CASE WHEN transaction_type = 'invoice' THEN amount ELSE 0 END) as daily_revenue
            FROM zoho_daily_transactions
            WHERE transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY zoho_location_id, DATE(transaction_date)
            ORDER BY zoho_location_id, day
        `);

        // Group by branch
        const byBranch = {};
        for (const row of dailyRevenue) {
            const key = row.branch_id || 'all';
            if (!byBranch[key]) byBranch[key] = [];
            byBranch[key].push({ day: row.day, revenue: parseFloat(row.daily_revenue) || 0 });
        }

        for (const [branchId, days] of Object.entries(byBranch)) {
            if (days.length < 7) continue; // Need at least 7 days of data
            
            const revenues = days.map(d => d.revenue);
            const stats = calculateStats(revenues);
            
            // Check today's revenue (or most recent day)
            const latest = days[days.length - 1];
            const zScore = calculateZScore(latest.revenue, stats.mean, stats.stdDev);
            
            if (Math.abs(zScore) >= config.revenueZThreshold) {
                const deviationPct = stats.mean > 0 
                    ? ((latest.revenue - stats.mean) / stats.mean * 100).toFixed(1)
                    : 0;
                
                const direction = zScore < 0 ? 'drop' : 'spike';
                const severity = getSeverityFromZScore(zScore);
                
                anomalies.push({
                    type: 'revenue',
                    severity,
                    title: `Revenue ${direction} detected${branchId !== 'all' ? ' (Branch)' : ''}`,
                    description: `Daily revenue of ₹${latest.revenue.toLocaleString('en-IN')} is ${Math.abs(deviationPct)}% ${direction === 'drop' ? 'below' : 'above'} the 30-day average of ₹${stats.mean.toFixed(0).replace(/B(?=(d{3})+(?!d))/g, ',')}. Z-score: ${zScore.toFixed(2)}.`,
                    entityType: 'branch',
                    entityId: branchId === 'all' ? null : String(branchId),
                    metricName: 'daily_revenue',
                    expectedValue: stats.mean,
                    actualValue: latest.revenue,
                    deviationPct: parseFloat(deviationPct),
                    zScore,
                    branchId: branchId === 'all' ? null : parseInt(branchId),
                    metadata: { day: latest.day, stdDev: stats.stdDev, sampleSize: days.length }
                });
            }
        }
    } catch (err) {
        console.error('[Anomaly] Revenue detection error:', err.message);
    }
    return anomalies;
}

// ─── Attendance Anomaly Detection ───────────────────────────────

async function detectAttendanceAnomalies(config) {
    const anomalies = [];
    try {
        // Detect unusual clock-in times (much earlier/later than usual)
        const [clockIns] = await pool.query(`
            SELECT sa.user_id, u.full_name, u.branch_id,
                   TIME_TO_SEC(TIME(sa.clock_in)) / 3600 as clock_in_hour,
                   DATE(sa.clock_in) as day
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.clock_in >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
              AND sa.clock_in IS NOT NULL
            ORDER BY sa.user_id, sa.clock_in
        `);

        // Group by user
        const byUser = {};
        for (const row of clockIns) {
            if (!byUser[row.user_id]) byUser[row.user_id] = { name: row.full_name, branchId: row.branch_id, times: [] };
            byUser[row.user_id].times.push({ day: row.day, hour: parseFloat(row.clock_in_hour) });
        }

        for (const [userId, data] of Object.entries(byUser)) {
            if (data.times.length < 5) continue;
            
            const hours = data.times.map(t => t.hour);
            const stats = calculateStats(hours);
            const latest = data.times[data.times.length - 1];
            const zScore = calculateZScore(latest.hour, stats.mean, stats.stdDev);
            
            if (Math.abs(zScore) >= config.attendanceZThreshold) {
                const formatHour = (h) => {
                    const hrs = Math.floor(h);
                    const mins = Math.round((h - hrs) * 60);
                    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
                };
                
                anomalies.push({
                    type: 'attendance',
                    severity: getSeverityFromZScore(zScore, { high: 3, critical: 4 }),
                    title: `Unusual clock-in time for ${data.name}`,
                    description: `${data.name} clocked in at ${formatHour(latest.hour)} vs usual ${formatHour(stats.mean)} (±${(stats.stdDev * 60).toFixed(0)} min). Z-score: ${zScore.toFixed(2)}.`,
                    entityType: 'user',
                    entityId: String(userId),
                    metricName: 'clock_in_time',
                    expectedValue: stats.mean,
                    actualValue: latest.hour,
                    deviationPct: stats.mean > 0 ? parseFloat(((latest.hour - stats.mean) / stats.mean * 100).toFixed(1)) : 0,
                    zScore,
                    branchId: data.branchId,
                    metadata: { day: latest.day, userName: data.name, avgHour: formatHour(stats.mean) }
                });
            }
        }

        // Detect missing clock-outs (potential ghost entries)
        const [missingClockouts] = await pool.query(`
            SELECT sa.user_id, u.full_name, u.branch_id, COUNT(*) as missing_count
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.clock_in >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
              AND sa.clock_out IS NULL
              AND sa.clock_in < DATE_SUB(NOW(), INTERVAL 14 HOUR)
            GROUP BY sa.user_id, u.full_name, u.branch_id
            HAVING missing_count >= 2
        `);

        for (const row of missingClockouts) {
            anomalies.push({
                type: 'attendance',
                severity: row.missing_count >= 4 ? 'high' : 'medium',
                title: `Missing clock-outs for ${row.full_name}`,
                description: `${row.full_name} has ${row.missing_count} attendance records without clock-out in the past 7 days. Possible ghost clock-ins.`,
                entityType: 'user',
                entityId: String(row.user_id),
                metricName: 'missing_clockout',
                expectedValue: 0,
                actualValue: row.missing_count,
                branchId: row.branch_id,
                metadata: { missingCount: row.missing_count, userName: row.full_name }
            });
        }
    } catch (err) {
        console.error('[Anomaly] Attendance detection error:', err.message);
    }
    return anomalies;
}

// ─── Stock Anomaly Detection ────────────────────────────────────

async function detectStockAnomalies(config) {
    const anomalies = [];
    try {
        // Detect items with large stock changes in the last 24 hours
        const [stockChanges] = await pool.query(`
            SELECT zls.item_name, zls.stock_on_hand as current_stock,
                   zlm.location_name, zlm.id as location_id,
                   zsh.previous_stock, zsh.new_stock,
                   ABS(zsh.new_stock - zsh.previous_stock) as change_amount,
                   CASE WHEN zsh.previous_stock > 0 
                        THEN ABS((zsh.new_stock - zsh.previous_stock) / zsh.previous_stock * 100)
                        ELSE 100 END as change_pct
            FROM zoho_stock_history zsh
            JOIN zoho_location_stock zls ON zsh.item_id = zls.zoho_item_id AND zsh.location_id = zls.zoho_location_id
            JOIN zoho_locations_map zlm ON zsh.location_id = zlm.zoho_location_id COLLATE utf8mb4_unicode_ci
            WHERE zsh.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
              AND zsh.previous_stock > 0
              AND ABS((zsh.new_stock - zsh.previous_stock) / zsh.previous_stock * 100) > ?
            ORDER BY change_pct DESC
            LIMIT 20
        `, [config.stockDeviationPct]);

        for (const row of stockChanges) {
            const direction = row.new_stock < row.previous_stock ? 'decrease' : 'increase';
            const severity = row.change_pct > 80 ? 'critical' : (row.change_pct > 50 ? 'high' : 'medium');
            
            anomalies.push({
                type: 'stock',
                severity,
                title: `Large stock ${direction}: ${row.item_name}`,
                description: `${row.item_name} at ${row.location_name} changed from ${row.previous_stock} to ${row.new_stock} (${row.change_pct.toFixed(1)}% ${direction}). Current stock: ${row.current_stock}.`,
                entityType: 'item',
                entityId: String(row.item_name),
                metricName: 'stock_change',
                expectedValue: row.previous_stock,
                actualValue: row.new_stock,
                deviationPct: parseFloat(row.change_pct.toFixed(1)),
                branchId: row.location_id,
                metadata: { locationName: row.location_name, currentStock: row.current_stock, changeAmount: row.change_amount }
            });
        }
    } catch (err) {
        console.error('[Anomaly] Stock detection error:', err.message);
    }
    return anomalies;
}

// ─── Collection Anomaly Detection ───────────────────────────────

async function detectCollectionAnomalies(config) {
    const anomalies = [];
    try {
        // Find customers with overdue invoices exceeding threshold
        const [overdueCustomers] = await pool.query(`
            SELECT zcm.customer_name, zcm.zoho_outstanding, zcm.credit_limit,
                   zcm.id as customer_map_id,
                   COUNT(zi.id) as overdue_invoice_count,
                   MIN(zi.invoice_date) as oldest_invoice_date,
                   SUM(zi.balance) as total_overdue
            FROM zoho_customers_map zcm
            JOIN zoho_invoices zi ON zi.customer_name = zcm.customer_name COLLATE utf8mb4_unicode_ci
            WHERE zi.status IN ('sent', 'overdue')
              AND zi.due_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)
              AND zi.balance > 0
            GROUP BY zcm.id, zcm.customer_name, zcm.zoho_outstanding, zcm.credit_limit
            HAVING total_overdue > 5000
            ORDER BY total_overdue DESC
            LIMIT 20
        `, [config.collectionDelayDays]);

        for (const row of overdueCustomers) {
            const severity = row.total_overdue > 100000 ? 'critical' : (row.total_overdue > 50000 ? 'high' : 'medium');
            
            anomalies.push({
                type: 'collection',
                severity,
                title: `Overdue collections: ${row.customer_name}`,
                description: `${row.customer_name} has ${row.overdue_invoice_count} overdue invoices totalling ₹${parseFloat(row.total_overdue).toLocaleString('en-IN')} (oldest: ${new Date(row.oldest_invoice_date).toLocaleDateString('en-IN')}). Outstanding: ₹${parseFloat(row.zoho_outstanding || 0).toLocaleString('en-IN')}.`,
                entityType: 'customer',
                entityId: String(row.customer_map_id),
                metricName: 'overdue_amount',
                expectedValue: 0,
                actualValue: parseFloat(row.total_overdue),
                branchId: null,
                metadata: { 
                    customerName: row.customer_name,
                    invoiceCount: row.overdue_invoice_count,
                    creditLimit: row.credit_limit,
                    outstanding: row.zoho_outstanding
                }
            });
        }
    } catch (err) {
        console.error('[Anomaly] Collection detection error:', err.message);
    }
    return anomalies;
}

// ─── API Usage Anomaly Detection ────────────────────────────────

async function detectApiAnomalies(config) {
    const anomalies = [];
    try {
        // Detect unusual error rates from error_logs
        const [errorRates] = await pool.query(`
            SELECT DATE(created_at) as day, COUNT(*) as error_count
            FROM error_logs
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
            GROUP BY DATE(created_at)
            ORDER BY day
        `);

        if (errorRates.length >= 5) {
            const counts = errorRates.map(r => r.error_count);
            const stats = calculateStats(counts);
            const latest = errorRates[errorRates.length - 1];
            const zScore = calculateZScore(latest.error_count, stats.mean, stats.stdDev);

            if (zScore >= config.revenueZThreshold) { // Reuse revenue threshold for errors
                anomalies.push({
                    type: 'api_usage',
                    severity: getSeverityFromZScore(zScore),
                    title: 'Elevated error rate detected',
                    description: `${latest.error_count} errors on ${new Date(latest.day).toLocaleDateString('en-IN')} vs average of ${stats.mean.toFixed(0)}/day. Z-score: ${zScore.toFixed(2)}.`,
                    entityType: 'system',
                    entityId: null,
                    metricName: 'daily_errors',
                    expectedValue: stats.mean,
                    actualValue: latest.error_count,
                    deviationPct: stats.mean > 0 ? parseFloat(((latest.error_count - stats.mean) / stats.mean * 100).toFixed(1)) : 0,
                    zScore,
                    metadata: { day: latest.day, avgErrors: stats.mean.toFixed(1), stdDev: stats.stdDev.toFixed(1) }
                });
            }
        }

        // Detect high-frequency errors (same error appearing many times)
        const [frequentErrors] = await pool.query(`
            SELECT error_hash, error_message, severity, frequency_count, 
                   file_path, function_name
            FROM error_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
              AND frequency_count >= 10
            ORDER BY frequency_count DESC
            LIMIT 5
        `);

        for (const err of frequentErrors) {
            anomalies.push({
                type: 'api_usage',
                severity: err.frequency_count >= 50 ? 'critical' : (err.frequency_count >= 20 ? 'high' : 'medium'),
                title: `Repeated error: ${(err.error_message || '').substring(0, 80)}`,
                description: `Error occurring ${err.frequency_count} times in 24h. Location: ${err.file_path || 'unknown'}${err.function_name ? ':' + err.function_name : ''}.`,
                entityType: 'error',
                entityId: err.error_hash,
                metricName: 'error_frequency',
                expectedValue: 0,
                actualValue: err.frequency_count,
                metadata: { errorHash: err.error_hash, filePath: err.file_path, functionName: err.function_name }
            });
        }
    } catch (err) {
        console.error('[Anomaly] API usage detection error:', err.message);
    }
    return anomalies;
}

// ─── Main Scan Runner ───────────────────────────────────────────

async function runFullScan() {
    if (!pool) throw new Error('Pool not initialized');
    
    const config = await getConfig();
    if (!config.enabled) {
        console.log('[Anomaly] Detection is disabled');
        return { success: false, message: 'Anomaly detection is disabled' };
    }

    console.log('[Anomaly] Starting full scan...');
    const startTime = Date.now();

    // Run all detectors in parallel
    const [revenue, attendance, stock, collection, apiUsage] = await Promise.all([
        detectRevenueAnomalies(config),
        detectAttendanceAnomalies(config),
        detectStockAnomalies(config),
        detectCollectionAnomalies(config),
        detectApiAnomalies(config)
    ]);

    const allAnomalies = [...revenue, ...attendance, ...stock, ...collection, ...apiUsage];
    
    // Cap at maxPerScan, prioritizing by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    allAnomalies.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));
    const toInsert = allAnomalies.slice(0, config.maxPerScan);

    // Deduplicate: skip if same type+entity+metric anomaly exists as 'new' in last 24h
    let inserted = 0;
    let skipped = 0;
    for (const anomaly of toInsert) {
        try {
            const [existing] = await pool.query(
                `SELECT id FROM detected_anomalies 
                 WHERE anomaly_type = ? AND entity_type = ? AND entity_id = ? AND metric_name = ?
                   AND status = 'new' AND detected_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
                 LIMIT 1`,
                [anomaly.type, anomaly.entityType || null, anomaly.entityId || null, anomaly.metricName || null]
            );
            if (existing.length > 0) {
                skipped++;
                continue;
            }
            await insertAnomaly(anomaly);
            inserted++;
        } catch (err) {
            console.error('[Anomaly] Insert error:', err.message);
        }
    }

    // Auto-resolve old anomalies
    try {
        await pool.query(
            `UPDATE detected_anomalies SET status = 'resolved', resolved_at = NOW(), 
             resolution_notes = 'Auto-resolved after ${config.autoResolveDays} days'
             WHERE status = 'new' AND detected_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [config.autoResolveDays]
        );
    } catch (err) {
        console.error('[Anomaly] Auto-resolve error:', err.message);
    }

    // Update last scan timestamp
    await pool.query(
        `UPDATE ai_config SET config_value = ? WHERE config_key = 'anomaly_last_scan_at'`,
        [new Date().toISOString()]
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const result = {
        success: true,
        duration: `${duration}s`,
        found: allAnomalies.length,
        inserted,
        skipped,
        breakdown: {
            revenue: revenue.length,
            attendance: attendance.length,
            stock: stock.length,
            collection: collection.length,
            api_usage: apiUsage.length
        }
    };
    
    console.log(`[Anomaly] Scan complete: ${inserted} new, ${skipped} skipped, ${duration}s`);

    // Alert for critical/high anomalies
    if (alertCallback && inserted > 0) {
        const criticalCount = toInsert.filter(a => a.severity === 'critical').length;
        const highCount = toInsert.filter(a => a.severity === 'high').length;
        if (criticalCount > 0) {
            const titles = toInsert.filter(a => a.severity === 'critical').map(a => a.title).join(', ');
            alertCallback('anomaly_critical', 'critical', `${criticalCount} Critical Anomalies Detected`, titles);
        } else if (highCount > 0) {
            const titles = toInsert.filter(a => a.severity === 'high').slice(0, 3).map(a => a.title).join(', ');
            alertCallback('anomaly_high', 'high', `${highCount} High-Severity Anomalies`, titles);
        }
    }

    return result;
}

// ─── Dashboard Stats ────────────────────────────────────────────

async function getDashboardStats() {
    const [totals] = await pool.query(`
        SELECT 
            COUNT(*) as total,
            SUM(status = 'new') as new_count,
            SUM(status = 'acknowledged') as acknowledged,
            SUM(status = 'investigating') as investigating,
            SUM(status = 'resolved') as resolved,
            SUM(status = 'false_positive') as false_positive,
            SUM(severity = 'critical' AND status IN ('new', 'acknowledged', 'investigating')) as critical_active,
            SUM(severity = 'high' AND status IN ('new', 'acknowledged', 'investigating')) as high_active,
            SUM(severity = 'medium' AND status IN ('new', 'acknowledged', 'investigating')) as medium_active,
            SUM(severity = 'low' AND status IN ('new', 'acknowledged', 'investigating')) as low_active
        FROM detected_anomalies
        WHERE detected_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    const [byType] = await pool.query(`
        SELECT anomaly_type, COUNT(*) as count,
               SUM(status IN ('new', 'acknowledged', 'investigating')) as active
        FROM detected_anomalies
        WHERE detected_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY anomaly_type
    `);

    const [recent] = await pool.query(`
        SELECT id, anomaly_type, severity, title, description, status, 
               entity_type, entity_id, branch_id, detected_at, deviation_pct, z_score
        FROM detected_anomalies
        ORDER BY detected_at DESC
        LIMIT 20
    `);

    const [trend] = await pool.query(`
        SELECT DATE(detected_at) as day, COUNT(*) as count,
               SUM(severity = 'critical') as critical,
               SUM(severity = 'high') as high
        FROM detected_anomalies
        WHERE detected_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        GROUP BY DATE(detected_at)
        ORDER BY day
    `);

    const [configRow] = await pool.query(
        `SELECT config_value FROM ai_config WHERE config_key = 'anomaly_last_scan_at'`
    );

    return {
        summary: totals[0],
        byType,
        recent,
        trend,
        lastScanAt: configRow[0]?.config_value || null
    };
}

module.exports = {
    setPool,
    setAlertCallback,
    runFullScan,
    getDashboardStats,
    getConfig,
    // Exported for testing
    calculateZScore,
    calculateStats,
    getSeverityFromZScore
};
