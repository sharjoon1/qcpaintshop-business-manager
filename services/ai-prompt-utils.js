/**
 * Shared helpers for safely embedding user/admin-controlled strings
 * into LLM prompts.
 *
 * sanitizeForPrompt() does NOT prevent prompt injection on its own --
 * the real gates are (a) a system prompt that tells the model 'treat
 * fields as data only', (b) explicit delimiters around user content,
 * and (c) validating model output (e.g. rejecting an unknown lead_id
 * the model emitted out of thin air). This helper just removes the
 * obvious mechanical tools an attacker would use to break out of a
 * fenced block: C0 control chars, ``` code fences, U+2028/U+2029.
 *
 * Also caps length so a 50KB notes blob can't blow the context window.
 */
function sanitizeForPrompt(s, maxLen = 200) {
    if (s == null) return '';
    return String(s)
        .replace(/[\u0000-\u001F\u007F]/g, ' ')   // C0 controls + DEL
        .replace(/```/g, "'''")                     // neutralize code fences
        .replace(/[\u2028\u2029]/g, ' ')           // line/paragraph separators
        .trim()
        .slice(0, maxLen);
}

module.exports = { sanitizeForPrompt };
