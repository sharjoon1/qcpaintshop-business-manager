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

module.exports = {
    normalizePhone,
    parseBranchPrefix
};
