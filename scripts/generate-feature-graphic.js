/**
 * Generate Play Store Feature Graphic (1024x500)
 * Run: node scripts/generate-feature-graphic.js
 */
const sharp = require('sharp');
const path = require('path');

async function generate() {
    const width = 1024;
    const height = 500;

    // Create SVG with brand gradient, logo text, and tagline
    const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:rgba(255,255,255,0.15)" />
                <stop offset="100%" style="stop-color:rgba(255,255,255,0)" />
            </linearGradient>
        </defs>

        <!-- Background gradient -->
        <rect width="${width}" height="${height}" fill="url(#bg)"/>

        <!-- Decorative circles -->
        <circle cx="850" cy="80" r="200" fill="rgba(255,255,255,0.05)"/>
        <circle cx="900" cy="420" r="150" fill="rgba(255,255,255,0.04)"/>
        <circle cx="150" cy="400" r="120" fill="rgba(255,255,255,0.03)"/>

        <!-- Decorative line -->
        <rect x="80" y="240" width="60" height="4" rx="2" fill="rgba(255,255,255,0.5)"/>

        <!-- App name -->
        <text x="160" y="200" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="700" fill="white">QC Staff</text>

        <!-- Tagline -->
        <text x="160" y="260" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="400" fill="rgba(255,255,255,0.85)">Staff Management &amp; Attendance Tracking</text>

        <!-- Feature pills -->
        <rect x="160" y="300" width="140" height="36" rx="18" fill="rgba(255,255,255,0.15)"/>
        <text x="196" y="324" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="rgba(255,255,255,0.9)">Attendance</text>

        <rect x="320" y="300" width="100" height="36" rx="18" fill="rgba(255,255,255,0.15)"/>
        <text x="343" y="324" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="rgba(255,255,255,0.9)">Tasks</text>

        <rect x="440" y="300" width="100" height="36" rx="18" fill="rgba(255,255,255,0.15)"/>
        <text x="463" y="324" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="rgba(255,255,255,0.9)">Salary</text>

        <rect x="560" y="300" width="80" height="36" rx="18" fill="rgba(255,255,255,0.15)"/>
        <text x="579" y="324" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="rgba(255,255,255,0.9)">KYC</text>

        <!-- Company name -->
        <text x="160" y="420" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="600" fill="rgba(255,255,255,0.6)">Quality Colours</text>
        <text x="160" y="445" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.4)">The Branded Paint Showrooms</text>

        <!-- Phone mockup silhouette (right side) -->
        <rect x="740" y="60" width="220" height="400" rx="24" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
        <rect x="755" y="90" width="190" height="340" rx="4" fill="rgba(255,255,255,0.08)"/>

        <!-- Mock status bar in phone -->
        <rect x="755" y="90" width="190" height="50" rx="4" fill="rgba(102,126,234,0.4)"/>
        <text x="810" y="122" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="600" fill="white">My Attendance</text>

        <!-- Mock clock-in button -->
        <rect x="790" y="220" width="120" height="40" rx="20" fill="rgba(255,255,255,0.25)"/>
        <text x="818" y="246" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="white">Clock In</text>

        <!-- Mock info rows -->
        <rect x="775" y="160" width="150" height="10" rx="5" fill="rgba(255,255,255,0.12)"/>
        <rect x="775" y="180" width="120" height="10" rx="5" fill="rgba(255,255,255,0.08)"/>

        <rect x="775" y="290" width="150" height="10" rx="5" fill="rgba(255,255,255,0.12)"/>
        <rect x="775" y="310" width="130" height="10" rx="5" fill="rgba(255,255,255,0.08)"/>
        <rect x="775" y="340" width="100" height="10" rx="5" fill="rgba(255,255,255,0.06)"/>
    </svg>`;

    const outputPath = path.join(__dirname, '..', 'public', 'uploads', 'play-store-feature-graphic.png');

    await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

    console.log(`Feature graphic saved to: ${outputPath}`);

    // Also save to google-services folder
    const googleServicesPath = 'D:\\QUALITY COLOURS\\DEVELOPMENT\\qcpaintshop.com\\google-services\\QCStaff-feature-graphic-1024x500.png';
    await sharp(Buffer.from(svg))
        .png()
        .toFile(googleServicesPath);

    console.log(`Also saved to: ${googleServicesPath}`);
}

generate().catch(console.error);
