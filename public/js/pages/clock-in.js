// Page logic for staff/clock-in.html. Externalized verbatim from the page's end-of-body
// inline <script> (S9+F5 Phase E batch 10, 2026-06-25) so the page runs under the enforced
// strict CSP. Loaded as a NON-deferred classic script right before </body>, matching the
// original timing. Handler wiring appended at the bottom (was inline on* attributes in the HTML).
// All camera/geolocation logic kept verbatim — no renames, no logic changes.
let latitude = null;
let longitude = null;
let address = '';
let photoBlob = null;
let videoStream = null;
let currentFacingMode = 'user'; // Start with front camera

// Initialize
async function init() {
    await requestLocation();
}

// Request location
async function requestLocation() {
    document.getElementById('locationLoading').style.display = 'block';
    document.getElementById('locationError').style.display = 'none';
    document.getElementById('locationSuccess').style.display = 'none';

    if (!navigator.geolocation) {
        showLocationError('Geolocation is not supported by your device');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            latitude = position.coords.latitude;
            longitude = position.coords.longitude;

            document.getElementById('latitude').textContent = latitude.toFixed(6);
            document.getElementById('longitude').textContent = longitude.toFixed(6);

            // Reverse geocode
            try {
                address = await reverseGeocode(latitude, longitude);
                document.getElementById('locationAddress').textContent = address;
            } catch (e) {
                address = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                document.getElementById('locationAddress').textContent = address;
            }

            document.getElementById('locationLoading').style.display = 'none';
            document.getElementById('locationSuccess').style.display = 'block';

            // Mark step 1 complete
            document.getElementById('step1').classList.add('complete');
            document.getElementById('step1Status').textContent = 'Complete';

            // Show camera
            setTimeout(() => {
                document.getElementById('cameraCard').style.display = 'block';
                startCamera();
            }, 500);
        },
        (error) => {
            let message = 'Unable to get your location';
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location permission denied. Please enable location access in your browser settings.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message = 'Location information unavailable. Please check your device settings.';
            } else if (error.code === error.TIMEOUT) {
                message = 'Location request timed out. Please try again.';
            }
            showLocationError(message);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function showLocationError(message) {
    document.getElementById('locationLoading').style.display = 'none';
    document.getElementById('locationError').style.display = 'block';
    document.getElementById('locationErrorMsg').textContent = message;
}

// Reverse geocode (simplified - you can use Google Maps API if available)
async function reverseGeocode(lat, lng) {
    // For now, just return coordinates
    // In production, use Google Maps Geocoding API
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Start camera
async function startCamera() {
    try {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
        }

        const video = document.getElementById('video');
        const constraints = {
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 1280 },
                height: { ideal: 1280 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = videoStream;
    } catch (error) {
        console.error('Camera error:', error);
        alert('Unable to access camera. Please grant camera permission and try again.');
    }
}

// Flip camera
async function flipCamera() {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    await startCamera();
}

// Capture photo
function capturePhoto() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');

    // Validate video is ready
    if (!video.videoWidth || !video.videoHeight) {
        alert('Camera is not ready yet. Please wait a moment and try again.');
        console.error('Video dimensions not available:', video.videoWidth, video.videoHeight);
        return;
    }

    try {
        // Set canvas size to video size
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw video frame to canvas
        context.drawImage(video, 0, 0);

        // Convert to blob with error handling
        canvas.toBlob((blob) => {
            if (!blob) {
                alert('Failed to capture photo. Please try again.');
                console.error('Blob creation failed');
                return;
            }

            photoBlob = blob;

            // Show preview using data URL (no CSP issues)
            const previewImage = document.getElementById('previewImage');
            previewImage.src = canvas.toDataURL('image/jpeg', 0.8);
            console.log('Preview set with data URL');

            document.getElementById('cameraPreview').style.display = 'none';
            document.getElementById('photoPreview').style.display = 'block';

            // Mark step 2 complete
            document.getElementById('step2').classList.add('complete');
            document.getElementById('step2Status').textContent = 'Complete';

            // Show submit button
            document.getElementById('submitCard').style.display = 'block';

            // Stop camera
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
            }

            console.log('Photo captured successfully, blob size:', blob.size);
        }, 'image/jpeg', 0.8);

    } catch (error) {
        alert('Error capturing photo: ' + error.message);
        console.error('capturePhoto error:', error);
    }
}
// Retake photo
function retakePhoto() {
    photoBlob = null;

    // Clean up old preview URL to prevent memory leaks
    const previewImage = document.getElementById('previewImage');
    if (previewImage.src) {
        URL.revokeObjectURL(previewImage.src);
        previewImage.src = '';
    }

    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('cameraPreview').style.display = 'block';
    document.getElementById('submitCard').style.display = 'none';

    document.getElementById('step2').classList.remove('complete');
    document.getElementById('step2Status').textContent = 'Pending';

    // Restart camera
    startCamera();

    console.log('Photo retake initiated');
}
// Submit clock in
async function submitClockIn() {
    if (!latitude || !longitude) {
        alert('Location is required. Please enable location access.');
        return;
    }

    if (!photoBlob) {
        alert('Photo is required. Please take a selfie.');
        return;
    }

    const submitBtn = document.getElementById('submitBtn');
    const submitBtnText = document.getElementById('submitBtnText');
    submitBtn.disabled = true;
    submitBtnText.textContent = 'Submitting...';

    try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }

        const formData = new FormData();
        formData.append('photo', photoBlob, 'clock-in.jpg');
        formData.append('latitude', latitude);
        formData.append('longitude', longitude);
        formData.append('address', address);

        const response = await fetch('/api/attendance/clock-in', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            // Mark step 3 complete
            document.getElementById('step3').classList.add('complete');
            document.getElementById('step3Status').textContent = 'Complete';

            // Show success
            const clockInTime = new Date(data.data.clock_in_time);
            const timeStr = clockInTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

            let message = `நீங்கள் ${timeStr} மணிக்கு Clock In செய்தீர்கள்.`;
            if (!data.data.is_late) {
                message += ' சரியான நேரத்தில் வந்தீர்கள்! 👍';
            }
            document.getElementById('successMessage').textContent = message;

            // Show late penalty notice if applicable
            if (data.data.is_late && data.data.late_penalty_minutes > 0) {
                document.getElementById('penaltyNotice').style.display = 'block';
                document.getElementById('penaltyDetail').textContent =
                    `${data.data.late_minutes} நிமிடம் தாமதம் — உங்கள் வருகை நேரத்திலிருந்து ${data.data.late_penalty_minutes} நிமிடம் கழிக்கப்படும்.`;
            } else if (data.data.is_late) {
                document.getElementById('penaltyNotice').style.display = 'block';
                document.getElementById('penaltyDetail').textContent =
                    `${data.data.late_minutes} நிமிடம் தாமதம் பதிவு செய்யப்பட்டது. தாமத அனுமதி கோரிக்கை உருவாக்கப்பட்டது.`;
            }

            // Hide all cards
            document.getElementById('locationCard').style.display = 'none';
            document.getElementById('cameraCard').style.display = 'none';
            document.getElementById('submitCard').style.display = 'none';

            // Show success
            document.getElementById('successCard').style.display = 'block';

        } else {
            if (data.code === 'OUTSIDE_GEOFENCE') {
                alert(`You are ${data.distance}m away from the branch.\nYou must be within ${data.radius}m to clock in.\n\nPlease move closer to your branch location.`);
            } else {
                alert(data.message || 'Failed to clock in. Please try again.');
            }
            submitBtn.disabled = false;
            submitBtnText.textContent = '✓ Clock In Now';
        }

    } catch (error) {
        console.error('Clock in error:', error);
        alert('Network error. Please check your connection and try again.');
        submitBtn.disabled = false;
        submitBtnText.textContent = '✓ Clock In Now';
    }
}

// Navigation
function goBack() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }
    window.location.href = 'dashboard.html';
}

function goToDashboard() {
    window.location.href = 'dashboard.html';
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Back button (was onclick="goBack()")
document.getElementById('backBtn').addEventListener('click', goBack);
// Location Retry button (was onclick="requestLocation()")
document.getElementById('retryLocationBtn').addEventListener('click', requestLocation);
// Camera flip button (was onclick="flipCamera()")
document.getElementById('flipBtn').addEventListener('click', flipCamera);
// Capture photo button (was onclick="capturePhoto()")
document.getElementById('captureBtn').addEventListener('click', capturePhoto);
// Retake photo button (was onclick="retakePhoto()")
document.getElementById('retakeBtn').addEventListener('click', retakePhoto);
// Submit clock-in button (was onclick="submitClockIn()")
document.getElementById('submitBtn').addEventListener('click', submitClockIn);
// Go to Dashboard button (was onclick="goToDashboard()")
document.getElementById('goToDashboardBtn').addEventListener('click', goToDashboard);

// Init on load (preserved from original inline script)
init();
