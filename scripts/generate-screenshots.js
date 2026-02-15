/**
 * Generate Play Store Screenshots (1080x1920 phone portrait)
 * Run: node scripts/generate-screenshots.js
 */
const sharp = require('sharp');
const path = require('path');

const W = 1080;
const H = 1920;
const FONT = 'Segoe UI, Arial, sans-serif';
const desktopDir = 'D:\\QUALITY COLOURS\\DEVELOPMENT\\qcpaintshop.com\\google-services';

// Shared SVG helpers
const statusBar = `
    <rect width="${W}" height="88" fill="rgba(0,0,0,0.15)"/>
    <text x="48" y="58" font-family="${FONT}" font-size="30" font-weight="600" fill="white">9:41</text>
    <text x="${W - 48}" y="58" font-family="${FONT}" font-size="28" fill="white" text-anchor="end">LTE ▪ 85%</text>
`;

const bottomNav = (active) => {
    const y = H - 140;
    const items = [
        { icon: '⊞', label: 'Dashboard', x: W * 0.17 },
        { icon: '⏱', label: 'History', x: W * 0.5 },
        { icon: '📋', label: 'Requests', x: W * 0.83 }
    ];
    let svg = `<rect x="0" y="${y}" width="${W}" height="140" fill="white"/>`;
    svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
    items.forEach((item, i) => {
        const color = i === active ? '#667eea' : '#9ca3af';
        svg += `<text x="${item.x}" y="${y + 55}" font-family="${FONT}" font-size="36" fill="${color}" text-anchor="middle">${item.icon}</text>`;
        svg += `<text x="${item.x}" y="${y + 95}" font-family="${FONT}" font-size="22" fill="${color}" text-anchor="middle">${item.label}</text>`;
    });
    return svg;
};

// ============ SCREENSHOT 1: LOGIN ============
function loginScreen() {
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#667eea"/>
            <stop offset="100%" stop-color="#764ba2"/>
        </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${statusBar}

    <!-- Decorative circles -->
    <circle cx="900" cy="200" r="300" fill="rgba(255,255,255,0.04)"/>
    <circle cx="100" cy="1600" r="250" fill="rgba(255,255,255,0.03)"/>

    <!-- Logo circle -->
    <circle cx="${W / 2}" cy="380" r="80" fill="white"/>
    <text x="${W / 2}" y="400" font-family="${FONT}" font-size="52" font-weight="700" fill="#667eea" text-anchor="middle">QC</text>

    <!-- Title -->
    <text x="${W / 2}" y="530" font-family="${FONT}" font-size="48" font-weight="700" fill="white" text-anchor="middle">Quality Colours</text>
    <text x="${W / 2}" y="585" font-family="${FONT}" font-size="28" fill="rgba(255,255,255,0.7)" text-anchor="middle">Business Manager Login</text>

    <!-- Login Card -->
    <rect x="80" y="660" width="${W - 160}" height="680" rx="24" fill="white"/>

    <!-- Phone label -->
    <text x="140" y="740" font-family="${FONT}" font-size="26" font-weight="600" fill="#374151">Phone Number</text>
    <rect x="140" y="760" width="${W - 280}" height="70" rx="12" fill="white" stroke="#e5e7eb" stroke-width="2"/>
    <text x="180" y="805" font-family="${FONT}" font-size="28" fill="#9ca3af">Enter your phone number</text>

    <!-- Password label -->
    <text x="140" y="900" font-family="${FONT}" font-size="26" font-weight="600" fill="#374151">Password</text>
    <rect x="140" y="920" width="${W - 280}" height="70" rx="12" fill="white" stroke="#e5e7eb" stroke-width="2"/>
    <text x="180" y="965" font-family="${FONT}" font-size="28" fill="#9ca3af">Enter your password</text>

    <!-- Remember me row -->
    <rect x="140" y="1030" width="30" height="30" rx="6" fill="white" stroke="#667eea" stroke-width="2"/>
    <text x="185" y="1055" font-family="${FONT}" font-size="24" fill="#6b7280">Remember me</text>
    <text x="${W - 140}" y="1055" font-family="${FONT}" font-size="24" fill="#667eea" text-anchor="end">Forgot password?</text>

    <!-- Login button -->
    <rect x="140" y="1120" width="${W - 280}" height="80" rx="16" fill="url(#bg)"/>
    <text x="${W / 2}" y="1172" font-family="${FONT}" font-size="32" font-weight="700" fill="white" text-anchor="middle">Sign In</text>

    <!-- Register link -->
    <text x="${W / 2}" y="1280" font-family="${FONT}" font-size="26" fill="rgba(255,255,255,0.7)" text-anchor="middle">Staff? Register here</text>

    <!-- Bottom branding -->
    <text x="${W / 2}" y="${H - 80}" font-family="${FONT}" font-size="22" fill="rgba(255,255,255,0.4)" text-anchor="middle">Quality Colours - The Branded Paint Showrooms</text>
</svg>`;
}

// ============ SCREENSHOT 2: DASHBOARD ============
function dashboardScreen() {
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#667eea"/>
            <stop offset="100%" stop-color="#764ba2"/>
        </linearGradient>
        <linearGradient id="green" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#059669"/>
        </linearGradient>
        <linearGradient id="amber" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#d97706"/>
        </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${statusBar}

    <!-- Header Card -->
    <rect x="40" y="120" width="${W - 80}" height="160" rx="20" fill="white"/>
    <!-- Avatar circle -->
    <circle cx="120" cy="200" r="40" fill="url(#bg)"/>
    <text x="120" y="214" font-family="${FONT}" font-size="30" font-weight="700" fill="white" text-anchor="middle">R</text>
    <!-- Greeting -->
    <text x="180" y="190" font-family="${FONT}" font-size="28" font-weight="600" fill="#1f2937">Hi, Rajesh</text>
    <text x="180" y="228" font-family="${FONT}" font-size="22" fill="#6b7280">Saturday, 15 Feb 2026</text>
    <!-- Time -->
    <text x="${W - 100}" y="190" font-family="${FONT}" font-size="44" font-weight="700" fill="#667eea" text-anchor="end">10:35</text>
    <text x="${W - 100}" y="228" font-family="${FONT}" font-size="22" fill="#9ca3af" text-anchor="end">AM</text>

    <!-- Working Timer Card -->
    <rect x="40" y="310" width="${W - 80}" height="180" rx="20" fill="url(#bg)"/>
    <rect x="40" y="310" width="${W - 80}" height="180" rx="20" fill="rgba(255,255,255,0.1)"/>
    <text x="${W / 2}" y="375" font-family="${FONT}" font-size="22" font-weight="600" fill="rgba(255,255,255,0.7)" text-anchor="middle" letter-spacing="3">WORKING TIME</text>
    <text x="${W / 2}" y="450" font-family="${FONT}" font-size="72" font-weight="700" fill="white" text-anchor="middle">02:35:18</text>

    <!-- Stats Row -->
    <rect x="40" y="520" width="316" height="130" rx="16" fill="white"/>
    <circle cx="100" cy="570" r="24" fill="#dcfce7"/>
    <text x="100" y="580" font-family="${FONT}" font-size="22" fill="#10b981" text-anchor="middle">IN</text>
    <text x="200" y="568" font-family="${FONT}" font-size="32" font-weight="700" fill="#1f2937">08:00</text>
    <text x="200" y="600" font-family="${FONT}" font-size="20" fill="#9ca3af">Clock In</text>

    <rect x="382" y="520" width="316" height="130" rx="16" fill="white"/>
    <circle cx="442" cy="570" r="24" fill="#dbeafe"/>
    <text x="442" y="580" font-family="${FONT}" font-size="22" fill="#3b82f6" text-anchor="middle">⏱</text>
    <text x="542" y="568" font-family="${FONT}" font-size="32" font-weight="700" fill="#1f2937">8.0 hrs</text>
    <text x="542" y="600" font-family="${FONT}" font-size="20" fill="#9ca3af">Expected</text>

    <rect x="724" y="520" width="316" height="130" rx="16" fill="white"/>
    <circle cx="784" cy="570" r="24" fill="#fef3c7"/>
    <text x="784" y="580" font-family="${FONT}" font-size="22" fill="#f59e0b" text-anchor="middle">☕</text>
    <text x="884" y="568" font-family="${FONT}" font-size="32" font-weight="700" fill="#1f2937">00:00</text>
    <text x="884" y="600" font-family="${FONT}" font-size="20" fill="#9ca3af">Break</text>

    <!-- Action Buttons -->
    <rect x="40" y="690" width="${W - 80}" height="80" rx="16" fill="url(#amber)"/>
    <text x="${W / 2}" y="742" font-family="${FONT}" font-size="30" font-weight="700" fill="white" text-anchor="middle">☕  Start Break</text>

    <rect x="40" y="790" width="${W - 80}" height="80" rx="16" fill="rgba(239,68,68,0.15)"/>
    <text x="${W / 2}" y="842" font-family="${FONT}" font-size="28" font-weight="600" fill="#ef4444" text-anchor="middle">End of day? Tap to Clock Out</text>

    <!-- Daily Tasks Card -->
    <rect x="40" y="910" width="${W - 80}" height="220" rx="20" fill="white"/>
    <text x="100" y="970" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Daily Tasks</text>
    <text x="${W - 100}" y="970" font-family="${FONT}" font-size="24" fill="#667eea" text-anchor="end">2 of 5</text>
    <!-- Progress bar -->
    <rect x="100" y="1000" width="${W - 200}" height="12" rx="6" fill="#f3f4f6"/>
    <rect x="100" y="1000" width="${(W - 200) * 0.4}" height="12" rx="6" fill="url(#bg)"/>
    <!-- Task items -->
    <circle cx="120" cy="1050" r="12" fill="#10b981"/>
    <text x="120" y="1058" font-family="${FONT}" font-size="18" fill="white" text-anchor="middle">✓</text>
    <text x="148" y="1058" font-family="${FONT}" font-size="24" fill="#6b7280" text-decoration="line-through">Check inventory stock levels</text>
    <circle cx="120" cy="1090" r="12" fill="#10b981"/>
    <text x="120" y="1098" font-family="${FONT}" font-size="18" fill="white" text-anchor="middle">✓</text>
    <text x="148" y="1098" font-family="${FONT}" font-size="24" fill="#6b7280" text-decoration="line-through">Update price tags - Section A</text>

    <!-- Quick Actions -->
    <rect x="40" y="1170" width="${W - 80}" height="350" rx="20" fill="white"/>
    <text x="100" y="1230" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Quick Actions</text>

    <circle cx="110" cy="1300" r="28" fill="#ede9fe"/>
    <text x="110" y="1310" font-family="${FONT}" font-size="24" fill="#667eea" text-anchor="middle">📋</text>
    <text x="160" y="1296" font-family="${FONT}" font-size="26" font-weight="600" fill="#1f2937">My Tasks</text>
    <text x="160" y="1326" font-family="${FONT}" font-size="20" fill="#9ca3af">View assigned tasks</text>
    <text x="${W - 100}" y="1308" font-family="${FONT}" font-size="28" fill="#d1d5db" text-anchor="end">›</text>

    <line x1="100" y1="1350" x2="${W - 100}" y2="1350" stroke="#f3f4f6" stroke-width="1"/>

    <circle cx="110" cy="1400" r="28" fill="#dcfce7"/>
    <text x="110" y="1410" font-family="${FONT}" font-size="24" fill="#10b981" text-anchor="middle">💰</text>
    <text x="160" y="1396" font-family="${FONT}" font-size="26" font-weight="600" fill="#1f2937">Salary</text>
    <text x="160" y="1426" font-family="${FONT}" font-size="20" fill="#9ca3af">View salary details</text>
    <text x="${W - 100}" y="1408" font-family="${FONT}" font-size="28" fill="#d1d5db" text-anchor="end">›</text>

    <line x1="100" y1="1450" x2="${W - 100}" y2="1450" stroke="#f3f4f6" stroke-width="1"/>

    <circle cx="110" cy="1480" r="28" fill="#fef3c7"/>
    <text x="110" y="1490" font-family="${FONT}" font-size="24" fill="#f59e0b" text-anchor="middle">💬</text>
    <text x="160" y="1476" font-family="${FONT}" font-size="26" font-weight="600" fill="#1f2937">Chat</text>
    <text x="160" y="1506" font-family="${FONT}" font-size="20" fill="#9ca3af">Team conversations</text>
    <text x="${W - 100}" y="1488" font-family="${FONT}" font-size="28" fill="#d1d5db" text-anchor="end">›</text>

    ${bottomNav(0)}
</svg>`;
}

// ============ SCREENSHOT 3: ATTENDANCE (Clock In Ready) ============
function attendanceScreen() {
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#667eea"/>
            <stop offset="100%" stop-color="#764ba2"/>
        </linearGradient>
        <linearGradient id="green" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#059669"/>
        </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${statusBar}

    <!-- Header Card -->
    <rect x="40" y="120" width="${W - 80}" height="140" rx="20" fill="white"/>
    <circle cx="120" cy="190" r="36" fill="url(#bg)"/>
    <text x="120" y="202" font-family="${FONT}" font-size="28" font-weight="700" fill="white" text-anchor="middle">R</text>
    <text x="175" y="185" font-family="${FONT}" font-size="26" font-weight="600" fill="#1f2937">Rajesh Kumar</text>
    <text x="175" y="218" font-family="${FONT}" font-size="22" fill="#6b7280">Saturday, 15 Feb 2026</text>
    <text x="${W - 100}" y="185" font-family="${FONT}" font-size="42" font-weight="700" fill="#667eea" text-anchor="end">9:00</text>
    <text x="${W - 100}" y="218" font-family="${FONT}" font-size="22" fill="#9ca3af" text-anchor="end">AM</text>

    <!-- Ready to Start Card -->
    <rect x="40" y="300" width="${W - 80}" height="240" rx="20" fill="white"/>
    <text x="${W / 2}" y="375" font-family="${FONT}" font-size="32" font-weight="700" fill="#1f2937" text-anchor="middle">Ready to Start Your Day?</text>
    <text x="${W / 2}" y="420" font-family="${FONT}" font-size="24" fill="#6b7280" text-anchor="middle">Shop opens at 9:00 AM</text>

    <rect x="120" y="450" width="280" height="60" rx="12" fill="#f0fdf4"/>
    <text x="260" y="490" font-family="${FONT}" font-size="24" fill="#10b981" text-anchor="middle">Expected: 8.0 hrs</text>
    <rect x="${W / 2 + 20}" y="450" width="280" height="60" rx="12" fill="#ede9fe"/>
    <text x="${W / 2 + 160}" y="490" font-family="${FONT}" font-size="24" fill="#667eea" text-anchor="middle">Sunday: 4.0 hrs</text>

    <!-- Clock In Button (large, prominent) -->
    <rect x="100" y="600" width="${W - 200}" height="120" rx="24" fill="url(#green)"/>
    <text x="${W / 2}" y="674" font-family="${FONT}" font-size="40" font-weight="700" fill="white" text-anchor="middle">📍  Clock In Now</text>

    <!-- Location Status -->
    <rect x="40" y="770" width="${W - 80}" height="80" rx="16" fill="white"/>
    <circle cx="110" cy="810" r="20" fill="#dcfce7"/>
    <text x="110" y="820" font-family="${FONT}" font-size="20" fill="#10b981" text-anchor="middle">✓</text>
    <text x="148" y="816" font-family="${FONT}" font-size="24" fill="#1f2937">Location verified - Inside shop area</text>

    <!-- Attendance History Section -->
    <rect x="40" y="900" width="${W - 80}" height="700" rx="20" fill="white"/>
    <text x="100" y="960" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Recent Attendance</text>

    <!-- History items -->
    <rect x="80" y="990" width="${W - 160}" height="110" rx="12" fill="#f9fafb"/>
    <text x="120" y="1030" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937">Friday, 14 Feb</text>
    <text x="120" y="1065" font-family="${FONT}" font-size="22" fill="#6b7280">09:02 AM → 06:15 PM</text>
    <rect x="${W - 240}" y="1020" width="100" height="36" rx="18" fill="#dcfce7"/>
    <text x="${W - 190}" y="1046" font-family="${FONT}" font-size="20" fill="#10b981" text-anchor="middle">8.2 hrs</text>

    <rect x="80" y="1120" width="${W - 160}" height="110" rx="12" fill="#f9fafb"/>
    <text x="120" y="1160" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937">Thursday, 13 Feb</text>
    <text x="120" y="1195" font-family="${FONT}" font-size="22" fill="#6b7280">08:55 AM → 06:30 PM</text>
    <rect x="${W - 240}" y="1150" width="100" height="36" rx="18" fill="#dcfce7"/>
    <text x="${W - 190}" y="1176" font-family="${FONT}" font-size="20" fill="#10b981" text-anchor="middle">8.6 hrs</text>

    <rect x="80" y="1250" width="${W - 160}" height="110" rx="12" fill="#f9fafb"/>
    <text x="120" y="1290" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937">Wednesday, 12 Feb</text>
    <text x="120" y="1325" font-family="${FONT}" font-size="22" fill="#6b7280">09:10 AM → 06:00 PM</text>
    <rect x="${W - 240}" y="1280" width="100" height="36" rx="18" fill="#dcfce7"/>
    <text x="${W - 190}" y="1306" font-family="${FONT}" font-size="20" fill="#10b981" text-anchor="middle">7.8 hrs</text>

    <rect x="80" y="1380" width="${W - 160}" height="110" rx="12" fill="#f9fafb"/>
    <text x="120" y="1420" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937">Tuesday, 11 Feb</text>
    <text x="120" y="1455" font-family="${FONT}" font-size="22" fill="#6b7280">08:50 AM → 06:45 PM</text>
    <rect x="${W - 240}" y="1410" width="120" height="36" rx="18" fill="#fef3c7"/>
    <text x="${W - 180}" y="1436" font-family="${FONT}" font-size="20" fill="#f59e0b" text-anchor="middle">9.0 hrs OT</text>

    ${bottomNav(1)}
</svg>`;
}

// ============ SCREENSHOT 4: TASKS ============
function tasksScreen() {
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#667eea"/>
            <stop offset="100%" stop-color="#764ba2"/>
        </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#f8fafc"/>
    <!-- Top header bar -->
    <rect width="${W}" height="200" fill="url(#bg)"/>
    ${statusBar}
    <text x="48" y="160" font-family="${FONT}" font-size="38" font-weight="700" fill="white">My Tasks</text>
    <text x="${W - 48}" y="160" font-family="${FONT}" font-size="28" fill="rgba(255,255,255,0.8)" text-anchor="end">Feb 2026</text>

    <!-- Summary Cards -->
    <rect x="40" y="230" width="240" height="130" rx="16" fill="white"/>
    <text x="80" y="280" font-family="${FONT}" font-size="42" font-weight="700" fill="#667eea">12</text>
    <text x="80" y="320" font-family="${FONT}" font-size="22" fill="#9ca3af">Total Tasks</text>

    <rect x="300" y="230" width="240" height="130" rx="16" fill="white"/>
    <text x="340" y="280" font-family="${FONT}" font-size="42" font-weight="700" fill="#3b82f6">4</text>
    <text x="340" y="320" font-family="${FONT}" font-size="22" fill="#9ca3af">In Progress</text>

    <rect x="560" y="230" width="240" height="130" rx="16" fill="white"/>
    <text x="600" y="280" font-family="${FONT}" font-size="42" font-weight="700" fill="#10b981">7</text>
    <text x="600" y="320" font-family="${FONT}" font-size="22" fill="#9ca3af">Completed</text>

    <rect x="820" y="230" width="220" height="130" rx="16" fill="white"/>
    <text x="860" y="280" font-family="${FONT}" font-size="42" font-weight="700" fill="#ef4444">1</text>
    <text x="860" y="320" font-family="${FONT}" font-size="22" fill="#9ca3af">Overdue</text>

    <!-- Task Cards -->
    <!-- Task 1: In Progress -->
    <rect x="40" y="400" width="${W - 80}" height="240" rx="16" fill="white"/>
    <rect x="40" y="400" width="6" height="240" rx="3" fill="#3b82f6"/>
    <text x="100" y="450" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Arrange Nerolac Display Stand</text>
    <rect x="100" y="470" width="130" height="34" rx="17" fill="#dbeafe"/>
    <text x="165" y="494" font-family="${FONT}" font-size="20" font-weight="600" fill="#3b82f6" text-anchor="middle">In Progress</text>
    <rect x="245" y="470" width="100" height="34" rx="17" fill="#fef3c7"/>
    <text x="295" y="494" font-family="${FONT}" font-size="20" font-weight="600" fill="#f59e0b" text-anchor="middle">High</text>
    <text x="100" y="544" font-family="${FONT}" font-size="22" fill="#6b7280">Set up the new Nerolac display rack near the</text>
    <text x="100" y="574" font-family="${FONT}" font-size="22" fill="#6b7280">entrance with latest color cards and brochures...</text>
    <rect x="100" y="598" width="${W - 200}" height="8" rx="4" fill="#f3f4f6"/>
    <rect x="100" y="598" width="${(W - 200) * 0.6}" height="8" rx="4" fill="url(#bg)"/>
    <text x="${W - 100}" y="618" font-family="${FONT}" font-size="20" fill="#9ca3af" text-anchor="end">Due: 16 Feb</text>

    <!-- Task 2: Pending -->
    <rect x="40" y="670" width="${W - 80}" height="240" rx="16" fill="white"/>
    <rect x="40" y="670" width="6" height="240" rx="3" fill="#667eea"/>
    <text x="100" y="720" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Stock Count - Asian Paints</text>
    <rect x="100" y="740" width="100" height="34" rx="17" fill="#fef3c7"/>
    <text x="150" y="764" font-family="${FONT}" font-size="20" font-weight="600" fill="#f59e0b" text-anchor="middle">Pending</text>
    <rect x="215" y="740" width="110" height="34" rx="17" fill="#fee2e2"/>
    <text x="270" y="764" font-family="${FONT}" font-size="20" font-weight="600" fill="#ef4444" text-anchor="middle">Urgent</text>
    <text x="100" y="814" font-family="${FONT}" font-size="22" fill="#6b7280">Complete physical stock verification for all Asian</text>
    <text x="100" y="844" font-family="${FONT}" font-size="22" fill="#6b7280">Paints products. Update inventory sheet...</text>
    <rect x="100" y="868" width="${W - 200}" height="8" rx="4" fill="#f3f4f6"/>
    <text x="${W - 100}" y="888" font-family="${FONT}" font-size="20" fill="#ef4444" text-anchor="end">Due: 15 Feb  OVERDUE</text>

    <!-- Task 3: Completed -->
    <rect x="40" y="940" width="${W - 80}" height="200" rx="16" fill="white"/>
    <rect x="40" y="940" width="6" height="200" rx="3" fill="#10b981"/>
    <text x="100" y="990" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Update Price Tags - Section B</text>
    <rect x="100" y="1010" width="120" height="34" rx="17" fill="#dcfce7"/>
    <text x="160" y="1034" font-family="${FONT}" font-size="20" font-weight="600" fill="#10b981" text-anchor="middle">Completed</text>
    <rect x="235" y="1010" width="100" height="34" rx="17" fill="#e5e7eb"/>
    <text x="285" y="1034" font-family="${FONT}" font-size="20" font-weight="600" fill="#6b7280" text-anchor="middle">Medium</text>
    <text x="100" y="1084" font-family="${FONT}" font-size="22" fill="#6b7280">Replace old price tags with updated MRP for</text>
    <text x="100" y="1114" font-family="${FONT}" font-size="22" fill="#6b7280">Berger and Dulux products in Section B.</text>

    <!-- Task 4: In Progress -->
    <rect x="40" y="1170" width="${W - 80}" height="240" rx="16" fill="white"/>
    <rect x="40" y="1170" width="6" height="240" rx="3" fill="#3b82f6"/>
    <text x="100" y="1220" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Customer Follow-up Calls</text>
    <rect x="100" y="1240" width="130" height="34" rx="17" fill="#dbeafe"/>
    <text x="165" y="1264" font-family="${FONT}" font-size="20" font-weight="600" fill="#3b82f6" text-anchor="middle">In Progress</text>
    <rect x="245" y="1240" width="100" height="34" rx="17" fill="#e5e7eb"/>
    <text x="295" y="1264" font-family="${FONT}" font-size="20" font-weight="600" fill="#6b7280" text-anchor="middle">Medium</text>
    <text x="100" y="1314" font-family="${FONT}" font-size="22" fill="#6b7280">Call pending customers from last week's estimates</text>
    <text x="100" y="1344" font-family="${FONT}" font-size="22" fill="#6b7280">to confirm orders and delivery schedule...</text>
    <rect x="100" y="1368" width="${W - 200}" height="8" rx="4" fill="#f3f4f6"/>
    <rect x="100" y="1368" width="${(W - 200) * 0.3}" height="8" rx="4" fill="url(#bg)"/>
    <text x="${W - 100}" y="1388" font-family="${FONT}" font-size="20" fill="#9ca3af" text-anchor="end">Due: 18 Feb</text>

    <!-- Task 5 partial -->
    <rect x="40" y="1440" width="${W - 80}" height="180" rx="16" fill="white"/>
    <rect x="40" y="1440" width="6" height="180" rx="3" fill="#667eea"/>
    <text x="100" y="1490" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Clean Storage Room</text>
    <rect x="100" y="1510" width="100" height="34" rx="17" fill="#fef3c7"/>
    <text x="150" y="1534" font-family="${FONT}" font-size="20" font-weight="600" fill="#f59e0b" text-anchor="middle">Pending</text>
    <rect x="215" y="1510" width="80" height="34" rx="17" fill="#e5e7eb"/>
    <text x="255" y="1534" font-family="${FONT}" font-size="20" font-weight="600" fill="#6b7280" text-anchor="middle">Low</text>
    <text x="100" y="1584" font-family="${FONT}" font-size="22" fill="#6b7280">Organize and clean the back storage room...</text>

    <!-- Bottom nav with back button -->
    <rect x="0" y="${H - 140}" width="${W}" height="140" fill="white"/>
    <line x1="0" y1="${H - 140}" x2="${W}" y2="${H - 140}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="${W * 0.17}" y="${H - 85}" font-family="${FONT}" font-size="36" fill="#9ca3af" text-anchor="middle">⊞</text>
    <text x="${W * 0.17}" y="${H - 45}" font-family="${FONT}" font-size="22" fill="#9ca3af" text-anchor="middle">Dashboard</text>
    <text x="${W * 0.5}" y="${H - 85}" font-family="${FONT}" font-size="36" fill="#667eea" text-anchor="middle">📋</text>
    <text x="${W * 0.5}" y="${H - 45}" font-family="${FONT}" font-size="22" fill="#667eea" text-anchor="middle">Tasks</text>
    <text x="${W * 0.83}" y="${H - 85}" font-family="${FONT}" font-size="36" fill="#9ca3af" text-anchor="middle">💬</text>
    <text x="${W * 0.83}" y="${H - 45}" font-family="${FONT}" font-size="22" fill="#9ca3af" text-anchor="middle">Chat</text>
</svg>`;
}

// ============ SCREENSHOT 5: SALARY ============
function salaryScreen() {
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#667eea"/>
            <stop offset="100%" stop-color="#764ba2"/>
        </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    ${statusBar}

    <!-- Header Card -->
    <rect x="40" y="120" width="${W - 80}" height="120" rx="20" fill="white"/>
    <text x="100" y="180" font-family="${FONT}" font-size="32" font-weight="700" fill="#1f2937">My Salary</text>
    <text x="100" y="215" font-family="${FONT}" font-size="22" fill="#6b7280">View salary details and payments</text>

    <!-- Month Selector -->
    <rect x="40" y="270" width="${W - 80}" height="80" rx="16" fill="white"/>
    <text x="100" y="322" font-family="${FONT}" font-size="36" fill="#667eea">‹</text>
    <text x="${W / 2}" y="322" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937" text-anchor="middle">February 2026</text>
    <text x="${W - 100}" y="322" font-family="${FONT}" font-size="36" fill="#667eea" text-anchor="end">›</text>

    <!-- Net Salary Card -->
    <rect x="40" y="380" width="${W - 80}" height="200" rx="20" fill="white"/>
    <text x="${W / 2}" y="440" font-family="${FONT}" font-size="24" fill="#9ca3af" text-anchor="middle">Net Salary (Estimated)</text>
    <text x="${W / 2}" y="510" font-family="${FONT}" font-size="60" font-weight="700" fill="#1f2937" text-anchor="middle">₹ 18,450</text>
    <rect x="${W / 2 - 65}" y="530" width="130" height="34" rx="17" fill="#dbeafe"/>
    <text x="${W / 2}" y="554" font-family="${FONT}" font-size="20" font-weight="600" fill="#3b82f6" text-anchor="middle">Calculated</text>

    <!-- Salary Breakdown Card -->
    <rect x="40" y="610" width="${W - 80}" height="600" rx="20" fill="white"/>
    <text x="100" y="670" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Salary Breakdown</text>

    <!-- Row items -->
    <text x="100" y="730" font-family="${FONT}" font-size="24" fill="#6b7280">Working Days</text>
    <text x="${W - 100}" y="730" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937" text-anchor="end">12 / 15 present</text>
    <line x1="100" y1="750" x2="${W - 100}" y2="750" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="790" font-family="${FONT}" font-size="24" fill="#6b7280">Standard Pay</text>
    <text x="${W - 100}" y="790" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937" text-anchor="end">₹ 14,400</text>
    <line x1="100" y1="810" x2="${W - 100}" y2="810" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="850" font-family="${FONT}" font-size="24" fill="#6b7280">Sunday Pay</text>
    <text x="${W - 100}" y="850" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937" text-anchor="end">₹ 1,800</text>
    <line x1="100" y1="870" x2="${W - 100}" y2="870" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="910" font-family="${FONT}" font-size="24" fill="#6b7280">Overtime Pay</text>
    <text x="${W - 100}" y="910" font-family="${FONT}" font-size="24" font-weight="600" fill="#1f2937" text-anchor="end">₹ 750</text>
    <line x1="100" y1="930" x2="${W - 100}" y2="930" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="970" font-family="${FONT}" font-size="24" fill="#10b981">Transport Allowance</text>
    <text x="${W - 100}" y="970" font-family="${FONT}" font-size="24" font-weight="600" fill="#10b981" text-anchor="end">+ ₹ 1,000</text>
    <line x1="100" y1="990" x2="${W - 100}" y2="990" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="1030" font-family="${FONT}" font-size="24" fill="#10b981">Food Allowance</text>
    <text x="${W - 100}" y="1030" font-family="${FONT}" font-size="24" font-weight="600" fill="#10b981" text-anchor="end">+ ₹ 500</text>
    <line x1="100" y1="1050" x2="${W - 100}" y2="1050" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="1090" font-family="${FONT}" font-size="24" fill="#ef4444">Advance Deduction</text>
    <text x="${W - 100}" y="1090" font-family="${FONT}" font-size="24" font-weight="600" fill="#ef4444" text-anchor="end">- ₹ 2,000</text>
    <line x1="100" y1="1110" x2="${W - 100}" y2="1110" stroke="#f3f4f6" stroke-width="1"/>

    <text x="100" y="1160" font-family="${FONT}" font-size="26" font-weight="700" fill="#1f2937">Net Total</text>
    <text x="${W - 100}" y="1160" font-family="${FONT}" font-size="26" font-weight="700" fill="#667eea" text-anchor="end">₹ 18,450</text>

    <!-- Payment History Card -->
    <rect x="40" y="1250" width="${W - 80}" height="400" rx="20" fill="white"/>
    <text x="100" y="1310" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Recent Payments</text>

    <rect x="80" y="1340" width="${W - 160}" height="100" rx="12" fill="#f0fdf4"/>
    <text x="120" y="1380" font-family="${FONT}" font-size="26" font-weight="700" fill="#10b981">₹ 5,000</text>
    <text x="120" y="1415" font-family="${FONT}" font-size="20" fill="#6b7280">Advance Payment • Cash • 10 Feb</text>
    <rect x="${W - 200}" y="1370" width="80" height="30" rx="15" fill="#dcfce7"/>
    <text x="${W - 160}" y="1392" font-family="${FONT}" font-size="18" fill="#10b981" text-anchor="middle">Paid</text>

    <rect x="80" y="1460" width="${W - 160}" height="100" rx="12" fill="#f9fafb"/>
    <text x="120" y="1500" font-family="${FONT}" font-size="26" font-weight="700" fill="#1f2937">₹ 16,200</text>
    <text x="120" y="1535" font-family="${FONT}" font-size="20" fill="#6b7280">January 2026 Salary • Bank Transfer • 1 Feb</text>
    <rect x="${W - 200}" y="1490" width="80" height="30" rx="15" fill="#dcfce7"/>
    <text x="${W - 160}" y="1512" font-family="${FONT}" font-size="18" fill="#10b981" text-anchor="middle">Paid</text>

    <!-- Bottom Nav -->
    <rect x="0" y="${H - 140}" width="${W}" height="140" fill="white"/>
    <line x1="0" y1="${H - 140}" x2="${W}" y2="${H - 140}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="${W * 0.17}" y="${H - 85}" font-family="${FONT}" font-size="36" fill="#9ca3af" text-anchor="middle">⊞</text>
    <text x="${W * 0.17}" y="${H - 45}" font-family="${FONT}" font-size="22" fill="#9ca3af" text-anchor="middle">Dashboard</text>
    <text x="${W * 0.5}" y="${H - 85}" font-family="${FONT}" font-size="36" fill="#667eea" text-anchor="middle">💰</text>
    <text x="${W * 0.5}" y="${H - 45}" font-family="${FONT}" font-size="22" fill="#667eea" text-anchor="middle">Salary</text>
    <text x="${W * 0.83}" y="${H - 85}" font-family="${FONT}" font-size="36" fill="#9ca3af" text-anchor="middle">📄</text>
    <text x="${W * 0.83}" y="${H - 45}" font-family="${FONT}" font-size="22" fill="#9ca3af" text-anchor="middle">Advances</text>
</svg>`;
}

// ============ SCREENSHOT 6: CHAT ============
function chatScreen() {
    return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#667eea"/>
            <stop offset="100%" stop-color="#764ba2"/>
        </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#f8fafc"/>

    <!-- Chat Header -->
    <rect width="${W}" height="180" fill="white"/>
    <rect width="${W}" height="2" y="178" fill="#e5e7eb"/>
    ${statusBar}
    <text x="120" y="145" font-family="${FONT}" font-size="30" fill="#667eea">‹</text>
    <circle cx="200" cy="130" r="28" fill="url(#bg)"/>
    <text x="200" y="142" font-family="${FONT}" font-size="22" font-weight="700" fill="white" text-anchor="middle">AM</text>
    <text x="248" y="128" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937">Amit Manager</text>
    <text x="248" y="158" font-family="${FONT}" font-size="20" fill="#10b981">Online</text>

    <!-- Messages Area -->
    <!-- Received message 1 -->
    <rect x="60" y="220" width="660" height="90" rx="20" fill="white"/>
    <text x="100" y="260" font-family="${FONT}" font-size="26" fill="#1f2937">Hi Rajesh, have you completed the</text>
    <text x="100" y="292" font-family="${FONT}" font-size="26" fill="#1f2937">Nerolac display stand setup?</text>
    <text x="680" y="296" font-family="${FONT}" font-size="18" fill="#9ca3af" text-anchor="end">9:15</text>

    <!-- Sent message 1 -->
    <rect x="${W - 720}" y="340" width="660" height="130" rx="20" fill="#667eea"/>
    <text x="${W - 680}" y="380" font-family="${FONT}" font-size="26" fill="white">Yes sir, almost done! Just need to</text>
    <text x="${W - 680}" y="412" font-family="${FONT}" font-size="26" fill="white">arrange the color cards. Should be</text>
    <text x="${W - 680}" y="444" font-family="${FONT}" font-size="26" fill="white">ready by lunch time.</text>
    <text x="${W - 100}" y="450" font-family="${FONT}" font-size="18" fill="rgba(255,255,255,0.7)" text-anchor="end">9:18 ✓✓</text>

    <!-- Received message 2 -->
    <rect x="60" y="500" width="540" height="90" rx="20" fill="white"/>
    <text x="100" y="540" font-family="${FONT}" font-size="26" fill="#1f2937">Great work! Also check the stock for</text>
    <text x="100" y="572" font-family="${FONT}" font-size="26" fill="#1f2937">Asian Paints Royale range.</text>
    <text x="560" y="576" font-family="${FONT}" font-size="18" fill="#9ca3af" text-anchor="end">9:20</text>

    <!-- Sent message 2 -->
    <rect x="${W - 520}" y="620" width="460" height="60" rx="20" fill="#667eea"/>
    <text x="${W - 480}" y="660" font-family="${FONT}" font-size="26" fill="white">Sure, I'll do that right away 👍</text>
    <text x="${W - 100}" y="664" font-family="${FONT}" font-size="18" fill="rgba(255,255,255,0.7)" text-anchor="end">9:21 ✓✓</text>

    <!-- Received message 3 -->
    <rect x="60" y="720" width="700" height="130" rx="20" fill="white"/>
    <text x="100" y="760" font-family="${FONT}" font-size="26" fill="#1f2937">One more thing - a customer called about</text>
    <text x="100" y="792" font-family="${FONT}" font-size="26" fill="#1f2937">the exterior paint estimate we sent. Can you</text>
    <text x="100" y="824" font-family="${FONT}" font-size="26" fill="#1f2937">follow up with him? His name is Mr. Patel.</text>
    <text x="720" y="828" font-family="${FONT}" font-size="18" fill="#9ca3af" text-anchor="end">9:25</text>

    <!-- Sent message 3 -->
    <rect x="${W - 680}" y="880" width="620" height="90" rx="20" fill="#667eea"/>
    <text x="${W - 640}" y="920" font-family="${FONT}" font-size="26" fill="white">Yes, I remember that estimate. Let me</text>
    <text x="${W - 640}" y="952" font-family="${FONT}" font-size="26" fill="white">call him after the stock check.</text>
    <text x="${W - 100}" y="956" font-family="${FONT}" font-size="18" fill="rgba(255,255,255,0.7)" text-anchor="end">9:27 ✓✓</text>

    <!-- Received message 4 -->
    <rect x="60" y="1000" width="520" height="60" rx="20" fill="white"/>
    <text x="100" y="1040" font-family="${FONT}" font-size="26" fill="#1f2937">Perfect. Keep me updated. Thanks!</text>
    <text x="540" y="1044" font-family="${FONT}" font-size="18" fill="#9ca3af" text-anchor="end">9:28</text>

    <!-- Sent message 4 -->
    <rect x="${W - 320}" y="1090" width="260" height="60" rx="20" fill="#667eea"/>
    <text x="${W - 280}" y="1130" font-family="${FONT}" font-size="26" fill="white">Will do sir! 🙏</text>
    <text x="${W - 100}" y="1134" font-family="${FONT}" font-size="18" fill="rgba(255,255,255,0.7)" text-anchor="end">9:28 ✓✓</text>

    <!-- Time separator -->
    <text x="${W / 2}" y="1210" font-family="${FONT}" font-size="20" fill="#9ca3af" text-anchor="middle">— Today 10:30 AM —</text>

    <!-- Received message 5 -->
    <rect x="60" y="1240" width="620" height="130" rx="20" fill="white"/>
    <text x="100" y="1280" font-family="${FONT}" font-size="26" fill="#1f2937">Rajesh, the new Berger paint samples</text>
    <text x="100" y="1312" font-family="${FONT}" font-size="26" fill="#1f2937">have arrived. Please unload and arrange</text>
    <text x="100" y="1344" font-family="${FONT}" font-size="26" fill="#1f2937">them in Section C.</text>
    <text x="640" y="1348" font-family="${FONT}" font-size="18" fill="#9ca3af" text-anchor="end">10:30</text>

    <!-- Sent message 5 -->
    <rect x="${W - 640}" y="1400" width="580" height="90" rx="20" fill="#667eea"/>
    <text x="${W - 600}" y="1440" font-family="${FONT}" font-size="26" fill="white">On it! I'll handle them right after</text>
    <text x="${W - 600}" y="1472" font-family="${FONT}" font-size="26" fill="white">my break. Should take about an hour.</text>
    <text x="${W - 100}" y="1476" font-family="${FONT}" font-size="18" fill="rgba(255,255,255,0.7)" text-anchor="end">10:32 ✓✓</text>

    <!-- Typing indicator -->
    <rect x="60" y="1520" width="160" height="50" rx="25" fill="white"/>
    <circle cx="105" cy="1545" r="8" fill="#9ca3af" opacity="0.5"/>
    <circle cx="135" cy="1545" r="8" fill="#9ca3af" opacity="0.7"/>
    <circle cx="165" cy="1545" r="8" fill="#9ca3af" opacity="0.9"/>

    <!-- Input Bar -->
    <rect x="0" y="${H - 180}" width="${W}" height="180" fill="white"/>
    <line x1="0" y1="${H - 180}" x2="${W}" y2="${H - 180}" stroke="#e5e7eb" stroke-width="1"/>
    <rect x="40" y="${H - 150}" width="${W - 160}" height="60" rx="30" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="1"/>
    <text x="80" y="${H - 112}" font-family="${FONT}" font-size="24" fill="#9ca3af">Type a message...</text>
    <circle cx="${W - 70}" cy="${H - 120}" r="30" fill="url(#bg)"/>
    <text x="${W - 70}" y="${H - 110}" font-family="${FONT}" font-size="26" fill="white" text-anchor="middle">▶</text>
</svg>`;
}

// ============ GENERATE ALL ============
async function generateAll() {
    const fs = require('fs');

    // Create output directory
    if (!fs.existsSync(desktopDir)) {
        fs.mkdirSync(desktopDir, { recursive: true });
    }

    const screens = [
        { name: '01-login', fn: loginScreen },
        { name: '02-dashboard', fn: dashboardScreen },
        { name: '03-attendance', fn: attendanceScreen },
        { name: '04-tasks', fn: tasksScreen },
        { name: '05-salary', fn: salaryScreen },
        { name: '06-chat', fn: chatScreen },
    ];

    for (const screen of screens) {
        const svg = screen.fn();
        const outputPath = path.join(desktopDir, `${screen.name}.png`);

        await sharp(Buffer.from(svg))
            .png()
            .toFile(outputPath);

        console.log(`Generated: ${outputPath}`);
    }

    console.log(`\nAll 6 screenshots saved to: ${desktopDir}`);
    console.log('Upload these to Play Console > Main store listing > Phone screenshots');
}

generateAll().catch(console.error);
