function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;
    let result = digits;
    if (digits.length === 12 && digits.startsWith('91')) result = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) result = digits.slice(1);
    else if (digits.length > 10) return null;
    return result.length === 10 ? result : null;
}

function parseBranchPrefix(name, branches) {
    if (!name) return null;
    const m = String(name).match(/^\s*PNTR\s+([A-Za-z]{2,5})\s+/i);
    if (!m) return null;
    const code = m[1].toUpperCase();
    const hit = branches.find(b => (b.code || '').toUpperCase() === code);
    return hit ? { id: hit.id, code } : null;
}

function parseSalespersonPhoneSuffix(name) {
    if (!name) return null;
    const m = String(name).match(/(\d{10})\s*$/);
    return m ? m[1] : null;
}

function levenshtein(a, b) {
    a = (a || '').toLowerCase();
    b = (b || '').toLowerCase();
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function matchSalesperson(sp, painters) {
    const phoneSuffix = parseSalespersonPhoneSuffix(sp.name);
    if (phoneSuffix) {
        const hit = painters.find(p => normalizePhone(p.phone) === phoneSuffix);
        if (hit) return { painter_id: hit.id, confidence: 'exact_phone' };
    }
    const nameNoPhone = (sp.name || '').replace(/\s*\d{10}\s*$/, '').trim().toLowerCase();
    const exactName = painters.find(p => (p.full_name || '').trim().toLowerCase() === nameNoPhone);
    if (exactName) return { painter_id: exactName.id, confidence: 'exact_name' };
    let best = null;
    for (const p of painters) {
        const d = levenshtein(nameNoPhone, (p.full_name || '').toLowerCase());
        if (d < 3 && (!best || d < best.dist)) best = { painter_id: p.id, dist: d };
    }
    if (best) return { painter_id: best.painter_id, confidence: 'fuzzy_name' };
    return { painter_id: null, confidence: 'unmatched' };
}

module.exports = {
    normalizePhone,
    parseBranchPrefix,
    parseSalespersonPhoneSuffix,
    levenshtein,
    matchSalesperson
};
