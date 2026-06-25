        let currentDate = new Date();
        let attendanceData = [];

        // Initialize - try current month, if empty and it's early in the month, show previous month
        async function init() {
            updateMonthDisplay();
            await loadAttendance();
            // If no records and we're in the first 5 days of the month, auto-show previous month
            if (attendanceData.length === 0 && new Date().getDate() <= 5) {
                currentDate.setMonth(currentDate.getMonth() - 1);
                document.getElementById('loadingState').style.display = 'block';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('attendanceList').innerHTML = '';
                await loadAttendance();
            }
        }

        // Load attendance for current month
        async function loadAttendance() {
            try {
                const token = localStorage.getItem('auth_token');
                if (!token) {
                    window.location.href = '/login.html';
                    return;
                }

                const month = currentDate.getMonth() + 1;
                const year = currentDate.getFullYear();

                const response = await fetch(`/api/attendance/my-history?month=${month}&year=${year}&limit=100`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.status === 401) {
                    localStorage.removeItem('auth_token');
                    window.location.href = '/login.html';
                    return;
                }

                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.message || 'Failed to load');
                }
                attendanceData = data.data || [];

                // Update UI
                updateMonthDisplay();

                document.getElementById('loadingState').style.display = 'none';

                if (attendanceData.length === 0) {
                    document.getElementById('emptyState').style.display = 'block';
                    document.getElementById('summaryCard').style.display = 'none';
                } else {
                    document.getElementById('emptyState').style.display = 'none';
                    displaySummary();
                    displayAttendance();
                }

            } catch (error) {
                console.error('Load attendance error:', error);
                document.getElementById('loadingState').innerHTML = `
                    <div class="empty-state">
                        <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                        <p style="color: #ef4444; font-weight: 600; margin-bottom: 16px;">Failed to load records</p>
                        <button data-action="reload" style="padding: 12px 24px; background: #1B5E3B; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
                            Retry
                        </button>
                    </div>
                `;
            }
        }

        // Update month display
        function updateMonthDisplay() {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const monthName = monthNames[currentDate.getMonth()];
            const year = currentDate.getFullYear();

            document.getElementById('currentMonth').textContent = `${monthName} ${year}`;
            document.getElementById('recordCount').textContent = `${attendanceData.length} records`;
        }

        // Display monthly summary
        function displaySummary() {
            const presentDays = attendanceData.filter(a => a.status === 'present').length;
            const lateDays = attendanceData.filter(a => a.is_late).length;
            const totalMinutes = attendanceData.reduce((sum, a) => sum + (a.total_working_minutes || 0), 0);
            const totalHours = (totalMinutes / 60).toFixed(1);

            document.getElementById('totalDays').textContent = attendanceData.length;
            document.getElementById('presentDays').textContent = presentDays;
            document.getElementById('lateDays').textContent = lateDays;
            document.getElementById('totalHours').textContent = `${totalHours}h`;

            document.getElementById('summaryCard').style.display = 'block';
        }

        // Display attendance list
        function displayAttendance() {
            const listHtml = attendanceData.map(record => {
                const date = new Date(record.date);
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                const clockInTime = record.clock_in_time ? new Date(record.clock_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                const clockOutTime = record.clock_out_time ? new Date(record.clock_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--:--';

                const workingHours = record.total_working_minutes ? (record.total_working_minutes / 60).toFixed(2) : '0.00';
                const expectedHours = record.expected_hours || 10;

                let statusClass = 'incomplete';
                let statusBadge = '';

                if (!record.clock_out_time) {
                    statusClass = 'late';
                    statusBadge = '<span class="badge badge-warning">Ongoing</span>';
                } else if (record.total_working_minutes >= (expectedHours * 60)) {
                    statusClass = 'complete';
                    statusBadge = '<span class="badge badge-success">Complete</span>';
                } else {
                    statusBadge = '<span class="badge badge-warning">Incomplete</span>';
                }

                const lateBadge = record.is_late ? '<span class="badge badge-danger" style="margin-left: 8px;">Late</span>' : '';
                const earlyBadge = record.is_early_checkout ? '<span class="badge badge-info" style="margin-left: 8px;">Early</span>' : '';

                return `
                    <div class="attendance-item ${statusClass}">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                            <div>
                                <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${dayName}, ${dateStr}</div>
                                <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${escHtml(record.branch_name || 'Branch')}</div>
                            </div>
                            <div style="text-align: right;">
                                ${statusBadge}
                                ${lateBadge}
                                ${earlyBadge}
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
                            <div>
                                <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">Clock In</div>
                                <div style="font-size: 16px; font-weight: 600; color: #10b981;">${clockInTime}</div>
                            </div>
                            <div>
                                <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">Clock Out</div>
                                <div style="font-size: 16px; font-weight: 600; color: #ef4444;">${clockOutTime}</div>
                            </div>
                        </div>

                        <div style="background: white; padding: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <span style="font-size: 12px; color: #6b7280;">Working Hours:</span>
                                <span style="font-size: 16px; font-weight: 700; color: #1B5E3B; margin-left: 8px;">${workingHours}h</span>
                            </div>
                            <div style="font-size: 12px; color: #6b7280;">
                                Expected: ${escHtml(expectedHours)}h
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('attendanceList').innerHTML = `
                <div class="card">
                    <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #1f2937;">Daily Records</h3>
                    ${listHtml}
                </div>
            `;
        }

        // Change month
        function changeMonth(delta) {
            currentDate.setMonth(currentDate.getMonth() + delta);

            // Don't allow future months
            const now = new Date();
            if (currentDate > now) {
                currentDate = now;
                return;
            }

            document.getElementById('loadingState').style.display = 'block';
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('summaryCard').style.display = 'none';
            document.getElementById('attendanceList').innerHTML = '';

            loadAttendance();
        }

        // Go back
        function goBack() {
            window.location.href = 'dashboard.html';
        }

        // Wire static handlers (externalized from inline on*= attributes, S9+F5 Phase C, 2026-06-25)
        document.getElementById('btn-back').addEventListener('click', goBack);
        document.getElementById('btn-prev-month').addEventListener('click', () => changeMonth(-1));
        document.getElementById('btn-next-month').addEventListener('click', () => changeMonth(1));

        // Delegated listener for runtime-rendered data-action elements (e.g. Retry button)
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            const action = el.dataset.action;
            if (action === 'reload') {
                location.reload();
            }
        });

        // Init on load
        init();
