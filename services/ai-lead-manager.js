/**
 * AI Lead Manager
 * Deterministic scoring (0-100) + AI enhancement
 * Auto-assignment, stale lead alerts, follow-up reminders
 */

const aiEngine = require('./ai-engine');

let pool = null;
function setPool(p) { pool = p; }

// ─── Deterministic Scoring ─────────────────────────────────────

function budgetScore(budget) {
    if (!budget) return 0;
    const b = parseFloat(budget);
    if (b >= 500000) return 25;
    if (b >= 200000) return 20;
    if (b >= 100000) return 15;
    if (b >= 50000) return 10;
    if (b >= 10000) return 5;
    return 2;
}

function statusScore(status) {
    const scores = {
        'negotiating': 20, 'quoted': 18, 'interested': 15,
        'contacted': 10, 'new': 5, 'follow_up': 12,
        'won': 20, 'lost': 0, 'closed': 0
    };
    return scores[(status || '').toLowerCase()] || 5;
}

function recencyScore(updatedAt) {
    if (!updatedAt) return 0;
    const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 20;
    if (days <= 1) return 18;
    if (days <= 3) return 15;
    if (days <= 7) return 12;
    if (days <= 14) return 8;
    if (days <= 30) return 4;
    return 0;
}

function sourceScore(source) {
    const scores = {
        'referral': 10, 'walk_in': 8, 'walk-in': 8, 'walkin': 8,
        'website': 7, 'online': 6, 'phone': 6,
        'social_media': 5, 'advertisement': 4, 'cold_call': 3, 'cold': 3,
        'other': 2
    };
    return scores[(source || '').toLowerCase()] || 2;
}

function engagementScore(followupCount) {
    if (followupCount >= 5) return 15;
    if (followupCount >= 3) return 12;
    if (followupCount >= 2) return 9;
    if (followupCount >= 1) return 5;
    return 0;
}

function responsivenessScore(avgResponseDays) {
    if (avgResponseDays === null || avgResponseDays === undefined) return 5;
    if (avgResponseDays <= 1) return 10;
    if (avgResponseDays <= 3) return 7;
    if (avgResponseDays <= 7) return 4;
    return 1;
}

function computeScore(lead, followupCount, avgResponseDays) {
    const breakdown = {
        budget: budgetScore(lead.budget || lead.estimated_value),
        status: statusScore(lead.status),
        recency: recencyScore(lead.updated_at),
        engagement: engagementScore(followupCount),
        source: sourceScore(lead.source),
        responsiveness: responsivenessScore(avgResponseDays)
    };

    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score: Math.min(total, 100), breakdown };
}

// ─── Lead Data Collection ──────────────────────────────────────

async function collectLeadData() {
    // Get active leads with followup counts
    const [leads] = await pool.query(`
        SELECT
            l.id, l.name, l.email, l.phone, l.source, l.status,
            l.estimated_value, l.assigned_to, l.branch_id,
            l.created_at, l.updated_at, l.notes,
            u.name as assigned_name,
            b.name as branch_name,
            (SELECT COUNT(*) FROM lead_followups lf WHERE lf.lead_id = l.id) as followup_count,
            (SELECT MAX(lf.created_at) FROM lead_followups lf WHERE lf.lead_id = l.id) as last_followup
        FROM leads l
        LEFT JOIN users u ON l.assigned_to = u.id
        LEFT JOIN branches b ON l.branch_id = b.id
        WHERE l.status NOT IN ('won', 'lost', 'closed')
        ORDER BY l.updated_at DESC
        LIMIT 200
    `);

    return leads;
}

// ─── Score All Leads ───────────────────────────────────────────

async function scoreAllLeads() {
    const startTime = Date.now();

    const [runResult] = await pool.query(
        'INSERT INTO ai_analysis_runs (analysis_type, status) VALUES (?, ?)',
        ['lead_scoring', 'running']
    );
    const runId = runResult.insertId;

    try {
        const leads = await collectLeadData();
        const scoredLeads = [];

        for (const lead of leads) {
            const avgResponseDays = lead.last_followup ?
                Math.floor((Date.now() - new Date(lead.last_followup).getTime()) / (1000 * 60 * 60 * 24)) : null;

            const { score, breakdown } = computeScore(lead, lead.followup_count, avgResponseDays);

            scoredLeads.push({
                ...lead,
                score,
                breakdown,
                days_since_last_activity: lead.updated_at ?
                    Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / (1000 * 60 * 60 * 24)) : null
            });
        }

        // Sort by score descending
        scoredLeads.sort((a, b) => b.score - a.score);

        // Get AI enhancement for top leads
        let aiRecommendations = {};
        const topLeads = scoredLeads.slice(0, 20);

        if (topLeads.length > 0) {
            try {
                const prompt = buildLeadPrompt(topLeads);
                const messages = [
                    { role: 'system', content: aiEngine.getSystemPrompt('You are analyzing sales leads for a paint retail company. Provide recommendations as JSON.') },
                    { role: 'user', content: prompt }
                ];

                const result = await aiEngine.generateWithFailover(messages);

                try {
                    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        // Map recommendations to lead IDs
                        if (parsed.recommendations) {
                            for (const rec of parsed.recommendations) {
                                if (rec.lead_id) aiRecommendations[rec.lead_id] = rec;
                            }
                        }
                        // Store lead insights
                        if (parsed.insights) {
                            for (const insight of parsed.insights) {
                                await pool.query(
                                    `INSERT INTO ai_insights (analysis_run_id, category, severity, title, description, action_recommended)
                                     VALUES (?, 'leads', ?, ?, ?, ?)`,
                                    [runId, insight.severity || 'info', insight.title, insight.description, insight.action_recommended]
                                );
                            }
                        }
                    }
                } catch (e) { /* AI recommendation parse failed, continue with deterministic scores */ }
            } catch (e) {
                console.error('[AI Lead Manager] AI enhancement failed:', e.message);
            }
        }

        // Save scores to ai_lead_scores
        for (const lead of scoredLeads) {
            const rec = aiRecommendations[lead.id] || {};

            // Upsert: delete old score for this lead, insert new
            await pool.query('DELETE FROM ai_lead_scores WHERE lead_id = ?', [lead.id]);
            await pool.query(
                `INSERT INTO ai_lead_scores (lead_id, score, score_breakdown, ai_recommendation, suggested_assignee, next_action, next_action_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    lead.id, lead.score, JSON.stringify(lead.breakdown),
                    rec.recommendation || null,
                    rec.suggested_assignee_id || lead.assigned_to || null,
                    rec.next_action || null,
                    rec.next_action_date || null
                ]
            );
        }

        const durationMs = Date.now() - startTime;
        await pool.query(
            `UPDATE ai_analysis_runs SET status = 'completed', summary = ?,
             tokens_used = 0, duration_ms = ? WHERE id = ?`,
            [`Scored ${scoredLeads.length} leads. Top score: ${scoredLeads[0]?.score || 0}`, durationMs, runId]
        );

        return { runId, totalScored: scoredLeads.length, topLeads: scoredLeads.slice(0, 10), durationMs };

    } catch (error) {
        await pool.query(
            'UPDATE ai_analysis_runs SET status = ?, summary = ? WHERE id = ?',
            ['failed', error.message, runId]
        );
        throw error;
    }
}

function buildLeadPrompt(leads) {
    const lines = [];
    lines.push('## Top Sales Leads for Review');
    lines.push(`Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    lines.push('');

    leads.forEach((lead, i) => {
        lines.push(`### ${i + 1}. ${lead.name} (ID: ${lead.id}, Score: ${lead.score}/100)`);
        lines.push(`Status: ${lead.status} | Source: ${lead.source || 'unknown'} | Value: ₹${Number(lead.estimated_value || 0).toLocaleString('en-IN')}`);
        lines.push(`Assigned: ${lead.assigned_name || 'Unassigned'} | Branch: ${lead.branch_name || 'None'}`);
        lines.push(`Follow-ups: ${lead.followup_count} | Days since activity: ${lead.days_since_last_activity ?? 'N/A'}`);
        if (lead.notes) lines.push(`Notes: ${lead.notes.substring(0, 200)}`);
        lines.push('');
    });

    lines.push(`Provide JSON response with:
{
  "recommendations": [
    {
      "lead_id": <number>,
      "recommendation": "string",
      "next_action": "string",
      "next_action_date": "YYYY-MM-DD or null",
      "priority": "high|medium|low"
    }
  ],
  "insights": [
    {
      "severity": "info|warning|critical",
      "title": "string",
      "description": "string",
      "action_recommended": "string"
    }
  ]
}`);

    return lines.join('\n');
}

// ─── Stale Lead Detection ──────────────────────────────────────

async function getStalLeads(daysInactive = 7) {
    const [stale] = await pool.query(`
        SELECT l.id, l.name, l.phone, l.status, l.assigned_to,
               u.name as assigned_name, u.phone as assigned_phone,
               DATEDIFF(CURDATE(), l.updated_at) as days_inactive
        FROM leads l
        LEFT JOIN users u ON l.assigned_to = u.id
        WHERE l.status NOT IN ('won', 'lost', 'closed')
            AND DATEDIFF(CURDATE(), l.updated_at) >= ?
        ORDER BY days_inactive DESC
    `, [daysInactive]);

    return stale;
}

module.exports = {
    setPool,
    computeScore,
    collectLeadData,
    scoreAllLeads,
    getStalLeads
};
