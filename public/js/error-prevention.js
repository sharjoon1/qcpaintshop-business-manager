/**
 * Client-Side Error Prevention & Tracking
 * Captures JS errors, API failures, and provides user-friendly error display
 */

(function() {
    'use strict';

    const ERROR_LOG_ENDPOINT = '/api/system/errors/log-client';
    const MAX_ERRORS_PER_MINUTE = 10;
    let errorCount = 0;
    let lastErrorReset = Date.now();

    // ─── Rate Limiting ────────────────────────────────────────

    function canLogError() {
        const now = Date.now();
        if (now - lastErrorReset > 60000) {
            errorCount = 0;
            lastErrorReset = now;
        }
        if (errorCount >= MAX_ERRORS_PER_MINUTE) return false;
        errorCount++;
        return true;
    }

    // ─── Send Error to Backend ────────────────────────────────

    function sendErrorToBackend(errorMessage, stackTrace, severity) {
        if (!canLogError()) return;

        const token = localStorage.getItem('auth_token');
        if (!token) return; // Don't log if not authenticated

        try {
            fetch(ERROR_LOG_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({
                    error_message: (errorMessage || 'Unknown error').substring(0, 2000),
                    stack_trace: (stackTrace || '').substring(0, 5000),
                    url: window.location.href,
                    severity: severity || 'medium'
                })
            }).catch(function() {
                // Silently fail - don't create infinite loops
            });
        } catch (e) {
            // Never throw from error handler
        }
    }

    // ─── Global Error Handlers ────────────────────────────────

    // Catch uncaught JS errors
    window.addEventListener('error', function(event) {
        var msg = event.message || 'Script error';
        var stack = '';
        if (event.error && event.error.stack) {
            stack = event.error.stack;
        } else {
            stack = (event.filename || '') + ':' + (event.lineno || '') + ':' + (event.colno || '');
        }

        // Skip CORS-blocked script errors (generic "Script error." with no details)
        if (msg === 'Script error.' && !event.filename) return;

        sendErrorToBackend(msg, stack, 'medium');
    });

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason;
        var msg = 'Unhandled Promise Rejection: ';
        var stack = '';

        if (reason instanceof Error) {
            msg += reason.message;
            stack = reason.stack || '';
        } else if (typeof reason === 'string') {
            msg += reason;
        } else {
            msg += JSON.stringify(reason);
        }

        sendErrorToBackend(msg, stack, 'medium');
    });

    // ─── Fetch Interceptor ───────────────────────────────────

    var originalFetch = window.fetch;
    window.fetch = function() {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

        return originalFetch.apply(this, args).then(function(response) {
            // Log server errors (5xx) but not client errors (4xx - those are expected)
            if (response.status >= 500 && !url.includes(ERROR_LOG_ENDPOINT)) {
                var errMsg = 'API Error ' + response.status + ': ' + (args[1]?.method || 'GET') + ' ' + url;
                sendErrorToBackend(errMsg, '', response.status >= 500 ? 'high' : 'low');
            }
            return response;
        }).catch(function(err) {
            // Network errors (CORS, timeout, offline)
            if (!url.includes(ERROR_LOG_ENDPOINT)) {
                sendErrorToBackend(
                    'Network Error: ' + (err.message || 'fetch failed') + ' - ' + url,
                    err.stack || '',
                    'high'
                );
            }
            throw err; // Re-throw so calling code can handle it
        });
    };

    // ─── User-Friendly Error Display ──────────────────────────

    window.showErrorToast = function(message, duration) {
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);background:#ef4444;max-width:400px;word-wrap:break-word;';
        toast.textContent = message || 'Something went wrong. Please try again.';
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, duration || 5000);
    };

    window.showSuccessToast = function(message, duration) {
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);background:#22c55e;max-width:400px;';
        toast.textContent = message || 'Success!';
        document.body.appendChild(toast);
        setTimeout(function() { toast.remove(); }, duration || 3000);
    };

    // ─── Form Validation Helper ───────────────────────────────

    window.validateFormData = function(formElement, rules) {
        var errors = [];
        if (!formElement || !rules) return errors;

        for (var field in rules) {
            var rule = rules[field];
            var input = formElement.querySelector('[name="' + field + '"]');
            var value = input ? input.value.trim() : '';

            // Remove previous error styling
            if (input) {
                input.classList.remove('border-red-500');
                var existingError = input.parentElement.querySelector('.field-error');
                if (existingError) existingError.remove();
            }

            if (rule.required && !value) {
                errors.push({ field: field, message: rule.label + ' is required' });
                if (input) markFieldError(input, rule.label + ' is required');
                continue;
            }

            if (value) {
                if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                    errors.push({ field: field, message: 'Invalid email format' });
                    if (input) markFieldError(input, 'Invalid email format');
                }
                if (rule.minLength && value.length < rule.minLength) {
                    errors.push({ field: field, message: rule.label + ' must be at least ' + rule.minLength + ' characters' });
                    if (input) markFieldError(input, 'Min ' + rule.minLength + ' characters');
                }
                if (rule.type === 'phone' && !/^[\d\+\-\s\(\)]{7,15}$/.test(value)) {
                    errors.push({ field: field, message: 'Invalid phone number' });
                    if (input) markFieldError(input, 'Invalid phone number');
                }
            }
        }

        return errors;
    };

    function markFieldError(input, message) {
        input.classList.add('border-red-500');
        var errDiv = document.createElement('div');
        errDiv.className = 'field-error text-red-500 text-xs mt-1';
        errDiv.textContent = message;
        input.parentElement.appendChild(errDiv);
    }

    console.log('[ErrorPrevention] Client-side error tracking initialized');
})();
