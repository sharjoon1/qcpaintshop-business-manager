// Attendance System Guide (Tamil) — externalized from public/docs/attendance-guide-tamil.html
// Original inline handler was on the .print-btn button and called window.print().
// This script runs at end of body (non-deferred), so the DOM is ready.

(function () {
    var printBtn = document.querySelector('.print-btn');
    if (printBtn) {
        printBtn.addEventListener('click', function () {
            window.print();
        });
    }
})();
