/**
 * Error Prevention Service
 * Pattern analysis, data integrity validation, code quality checks, prevention reports
 */

const fs = require('fs');
const path = require('path');

let pool = null;
function setPool(p) { pool = p; }

// ─── Error Pattern Analysis ───────────────────────────────────

async function analyzeErrorPatterns() {
    if (!pool) return { patterns: [], recommendations: [] };

    const patterns = [];
    const recommendations = [];

    try {
        // Top error types in last 24h
        const [byType] = await pool.query(`
            SELECT error_type, COUNT(*) as count, severity,
                   MAX(created_at) as last_seen
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 24 HOUR
            GROUP BY error_type, severity
            ORDER BY count DESC
        `);

        for (const row of byType) {
            if (row.count >= 5) {
                patterns.push({
                    type: 'recurring',
                    error_type: row.error_type,
                    severity: row.severity,
                    count: row.count,
                    last_seen: row.last_seen
                });
            }
        }

        // Repeated errors from same endpoint
        const [byEndpoint] = await pool.query(`
            SELECT request_url, request_method, COUNT(*) as count,
                   GROUP_CONCAT(DISTINCT error_type) as error_types
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 24 HOUR
                AND request_url IS NOT NULL
            GROUP BY request_url, request_method
            HAVING count >= 3
            ORDER BY count DESC
            LIMIT 20
        `);

        for (const row of byEndpoint) {
            patterns.push({
                type: 'endpoint_hotspot',
                url: row.request_url,
                method: row.request_method,
                count: row.count,
                error_types: row.error_types
            });

            recommendations.push({
                priority: row.count >= 10 ? 'high' : 'medium',
                category: 'endpoint_fix',
                title: `Fix recurring errors on ${row.request_method} ${row.request_url}`,
                description: `${row.count} errors in 24h (types: ${row.error_types}). Review error handling and input validation.`,
                actionable: true
            });
        }

        // Database errors trend
        const [dbErrors] = await pool.query(`
            SELECT COUNT(*) as count FROM error_logs
            WHERE error_type = 'database' AND created_at >= NOW() - INTERVAL 1 HOUR
        `);

        if (dbErrors[0].count >= 5) {
            recommendations.push({
                priority: 'critical',
                category: 'database',
                title: 'High database error rate detected',
                description: `${dbErrors[0].count} database errors in the last hour. Check connection pool, query performance, and table locks.`,
                actionable: true
            });
        }

        // Auth error spike
        const [authErrors] = await pool.query(`
            SELECT COUNT(*) as count FROM error_logs
            WHERE error_type = 'authentication' AND created_at >= NOW() - INTERVAL 1 HOUR
        `);

        if (authErrors[0].count >= 10) {
            recommendations.push({
                priority: 'high',
                category: 'security',
                title: 'Authentication error spike',
                description: `${authErrors[0].count} auth errors in the last hour. Possible brute force attempt or session issues.`,
                actionable: true
            });
        }

        // Frontend errors
        const [feErrors] = await pool.query(`
            SELECT COUNT(*) as count FROM error_logs
            WHERE error_type = 'frontend' AND created_at >= NOW() - INTERVAL 24 HOUR
        `);

        if (feErrors[0].count >= 20) {
            recommendations.push({
                priority: 'medium',
                category: 'frontend',
                title: 'High client-side error rate',
                description: `${feErrors[0].count} frontend errors in 24h. Review JS console errors and API response handling.`,
                actionable: true
            });
        }

    } catch (err) {
        console.error('[ErrorPrevention] Pattern analysis failed:', err.message);
    }

    return { patterns, recommendations };
}

// ─── Data Integrity Validation ────────────────────────────────

async function validateDataIntegrity() {
    if (!pool) return { status: 'error', message: 'No database pool' };

    const checks = [];

    try {
        // 1. Foreign key constraint checks (orphaned records)
        const fkChecks = [
            { name: 'Leads → Users (assigned_to)', query: `SELECT COUNT(*) as c FROM leads l LEFT JOIN users u ON l.assigned_to = u.id WHERE l.assigned_to IS NOT NULL AND u.id IS NULL` },
            { name: 'Lead Followups → Leads', query: `SELECT COUNT(*) as c FROM lead_followups lf LEFT JOIN leads l ON lf.lead_id = l.id WHERE l.id IS NULL` },
            { name: 'Staff Attendance → Users', query: `SELECT COUNT(*) as c FROM staff_attendance sa LEFT JOIN users u ON sa.user_id = u.id WHERE u.id IS NULL` },
            { name: 'AI Lead Scores → Leads', query: `SELECT COUNT(*) as c FROM ai_lead_scores als LEFT JOIN leads l ON als.lead_id = l.id WHERE l.id IS NULL` },
            { name: 'User Sessions (expired)', query: `SELECT COUNT(*) as c FROM user_sessions WHERE expires_at < NOW() - INTERVAL 7 DAY` },
            { name: 'Role Permissions → Roles', query: `SELECT COUNT(*) as c FROM role_permissions rp LEFT JOIN roles r ON rp.role_id = r.id WHERE r.id IS NULL` }
        ];

        for (const fk of fkChecks) {
            try {
                const [result] = await pool.query(fk.query);
                const count = result[0].c;
                checks.push({
                    name: fk.name,
                    status: count === 0 ? 'pass' : 'fail',
                    count,
                    severity: count > 100 ? 'high' : count > 0 ? 'medium' : 'none'
                });
            } catch (e) {
                checks.push({ name: fk.name, status: 'error', error: e.message });
            }
        }

        // 2. Data consistency checks
        const consistencyChecks = [
            { name: 'Leads with score but no ai_lead_scores', query: `SELECT COUNT(*) as c FROM leads l WHERE l.lead_score IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_lead_scores als WHERE als.lead_id = l.id)` },
            { name: 'Users with invalid role', query: `SELECT COUNT(*) as c FROM users WHERE role NOT IN ('admin', 'manager', 'staff', 'super_admin')` },
            { name: 'Branches with no users', query: `SELECT COUNT(*) as c FROM branches b WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.branch_id = b.id) AND b.status = 'active'` }
        ];

        for (const cc of consistencyChecks) {
            try {
                const [result] = await pool.query(cc.query);
                checks.push({
                    name: cc.name,
                    status: result[0].c === 0 ? 'pass' : 'warning',
                    count: result[0].c,
                    severity: result[0].c > 0 ? 'low' : 'none'
                });
            } catch (e) {
                checks.push({ name: cc.name, status: 'error', error: e.message });
            }
        }

        // Update branch integrity scores
        try {
            const [branches] = await pool.query('SELECT id FROM branches WHERE status = "active"');
            for (const branch of branches) {
                const [issues] = await pool.query(`
                    SELECT
                        (SELECT COUNT(*) FROM users WHERE branch_id = ? AND status = 'active') as users,
                        (SELECT COUNT(*) FROM users WHERE branch_id = ? AND status = 'active' AND (email IS NULL OR email = '')) as missing_email
                `, [branch.id, branch.id]);

                const total = issues[0].users || 1;
                const score = Math.max(0, Math.min(1, 1 - (issues[0].missing_email / total)));
                await pool.query('UPDATE branches SET data_integrity_score = ? WHERE id = ?', [score, branch.id]);
            }
        } catch (e) { /* table might not have column yet */ }

        const failCount = checks.filter(c => c.status === 'fail').length;
        const warnCount = checks.filter(c => c.status === 'warning').length;

        return {
            status: failCount > 0 ? 'issues_found' : warnCount > 0 ? 'warnings' : 'clean',
            totalChecks: checks.length,
            passed: checks.filter(c => c.status === 'pass').length,
            failed: failCount,
            warnings: warnCount,
            errors: checks.filter(c => c.status === 'error').length,
            checks
        };
    } catch (err) {
        return { status: 'error', message: err.message, checks };
    }
}

// ─── Code Quality Scan ────────────────────────────────────────

async function performCodeQualityCheck() {
    const baseDir = path.join(__dirname, '..');
    const metrics = [];

    const scanDirs = ['routes', 'services', 'middleware'];

    for (const dir of scanDirs) {
        const dirPath = path.join(baseDir, dir);
        if (!fs.existsSync(dirPath)) continue;

        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.js'));

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split('\n');
                const loc = lines.length;

                // Count functions
                const funcMatches = content.match(/(function\s+\w+|async\s+function\s+\w+|const\s+\w+\s*=\s*(async\s+)?\(|router\.(get|post|put|patch|delete))/g);
                const funcCount = funcMatches ? funcMatches.length : 0;

                // Detect potential issues
                const issues = [];

                // Large file
                if (loc > 500) issues.push({ type: 'large_file', message: `${loc} lines - consider splitting` });

                // Console.log left in (not console.error)
                const consoleLogs = (content.match(/console\.log\(/g) || []).length;
                if (consoleLogs > 10) issues.push({ type: 'debug_logging', message: `${consoleLogs} console.log statements` });

                // No error handling in async
                const asyncFuncs = (content.match(/async\s+(function|\()/g) || []).length;
                const tryCatches = (content.match(/try\s*\{/g) || []).length;
                if (asyncFuncs > 0 && tryCatches < asyncFuncs * 0.5) {
                    issues.push({ type: 'missing_error_handling', message: `${asyncFuncs} async functions but only ${tryCatches} try-catch blocks` });
                }

                // TODO/FIXME/HACK comments
                const todoCount = (content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi) || []).length;
                if (todoCount > 0) issues.push({ type: 'todo_items', message: `${todoCount} TODO/FIXME comments` });

                // Complexity estimate (nesting depth)
                let maxNesting = 0, currentNesting = 0;
                for (const line of lines) {
                    currentNesting += (line.match(/\{/g) || []).length;
                    currentNesting -= (line.match(/\}/g) || []).length;
                    if (currentNesting > maxNesting) maxNesting = currentNesting;
                }
                const complexityScore = Math.min(100, Math.round(maxNesting * 5 + (loc / 50)));

                metrics.push({
                    filePath: `${dir}/${file}`,
                    linesOfCode: loc,
                    functions: funcCount,
                    complexityScore,
                    issues
                });

                // Save to DB
                if (pool) {
                    try {
                        await pool.query(`
                            INSERT INTO code_quality_metrics (file_path, complexity_score, lines_of_code, issues)
                            VALUES (?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE complexity_score = VALUES(complexity_score),
                                lines_of_code = VALUES(lines_of_code), issues = VALUES(issues),
                                last_modified = CURRENT_TIMESTAMP
                        `, [`${dir}/${file}`, complexityScore, loc, JSON.stringify(issues)]);
                    } catch (e) { /* skip DB save errors */ }
                }
            } catch (err) {
                metrics.push({ filePath: `${dir}/${file}`, error: err.message });
            }
        }
    }

    // Sort by complexity
    metrics.sort((a, b) => (b.complexityScore || 0) - (a.complexityScore || 0));

    const totalIssues = metrics.reduce((sum, m) => sum + (m.issues?.length || 0), 0);

    return {
        totalFiles: metrics.length,
        totalIssues,
        highComplexity: metrics.filter(m => (m.complexityScore || 0) > 70).length,
        metrics
    };
}

// ─── Prevention Report ────────────────────────────────────────

async function generatePreventionReport() {
    const [patternAnalysis, integrityResult, codeQuality] = await Promise.all([
        analyzeErrorPatterns(),
        validateDataIntegrity(),
        performCodeQualityCheck()
    ]);

    // Error statistics
    let errorStats = { total24h: 0, bySeverity: {}, byType: {} };
    if (pool) {
        try {
            const [total] = await pool.query(`SELECT COUNT(*) as c FROM error_logs WHERE created_at >= NOW() - INTERVAL 24 HOUR`);
            errorStats.total24h = total[0].c;

            const [bySev] = await pool.query(`SELECT severity, COUNT(*) as c FROM error_logs WHERE created_at >= NOW() - INTERVAL 24 HOUR GROUP BY severity`);
            for (const row of bySev) errorStats.bySeverity[row.severity] = row.c;

            const [byType] = await pool.query(`SELECT error_type, COUNT(*) as c FROM error_logs WHERE created_at >= NOW() - INTERVAL 24 HOUR GROUP BY error_type`);
            for (const row of byType) errorStats.byType[row.error_type] = row.c;
        } catch (e) {}
    }

    // Compile all recommendations
    const allRecommendations = [...patternAnalysis.recommendations];

    // Add code quality recommendations
    const complexFiles = codeQuality.metrics?.filter(m => (m.complexityScore || 0) > 70) || [];
    if (complexFiles.length > 0) {
        allRecommendations.push({
            priority: 'medium',
            category: 'code_quality',
            title: `${complexFiles.length} high-complexity files detected`,
            description: `Files: ${complexFiles.map(f => f.filePath).join(', ')}. Consider refactoring for maintainability.`,
            actionable: true
        });
    }

    // Add integrity recommendations
    const failedChecks = integrityResult.checks?.filter(c => c.status === 'fail') || [];
    for (const check of failedChecks) {
        allRecommendations.push({
            priority: check.count > 100 ? 'high' : 'medium',
            category: 'data_integrity',
            title: `Data integrity issue: ${check.name}`,
            description: `${check.count} orphaned/invalid records found. Consider cleanup or adding constraints.`,
            actionable: true
        });
    }

    // Sort recommendations by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    allRecommendations.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

    return {
        generatedAt: new Date().toISOString(),
        errorStats,
        patterns: patternAnalysis.patterns,
        dataIntegrity: {
            status: integrityResult.status,
            passed: integrityResult.passed,
            failed: integrityResult.failed,
            warnings: integrityResult.warnings
        },
        codeQuality: {
            totalFiles: codeQuality.totalFiles,
            totalIssues: codeQuality.totalIssues,
            highComplexity: codeQuality.highComplexity
        },
        recommendations: allRecommendations,
        totalRecommendations: allRecommendations.length
    };
}

module.exports = {
    setPool,
    analyzeErrorPatterns,
    validateDataIntegrity,
    performCodeQualityCheck,
    generatePreventionReport
};
