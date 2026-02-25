document.addEventListener('DOMContentLoaded', () => {
    let isProcessing = false;
    let currentDriver = null;
    let checkAssignmentInterval = null;
    let currentAssignment = null;

    // ==================== ENHANCED HELPER FUNCTIONS ====================
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function updateStatus(message, color, isError = false) {
        const statusDisplay = document.getElementById('statusDisplay');
        const icon = isError ? 'fa-exclamation-circle' : 'fa-info-circle';
        if (!statusDisplay) return;
        statusDisplay.innerHTML = `
            <div class="status-message">
                <i class="fas ${icon}"></i>
                <p style="color: ${color}; font-weight: ${isError ? 'bold' : 'normal'}">${message}</p>
            </div>
        `;
        
        // Add visual feedback for errors
        if (isError) {
            statusDisplay.style.animation = 'shake 0.5s ease-in-out';
            setTimeout(() => statusDisplay.style.animation = '', 500);
        }
    }

    function showToast(message, type = 'info') {
        // Remove existing toasts to prevent stacking
        document.querySelectorAll('.toast').forEach(toast => toast.remove());
        
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas ${type === 'error' ? 'fa-exclamation-triangle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);
    }

    // ==================== ENHANCED GEOLOCATION ====================
    function getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported by this browser'));
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 15000,  // Increased timeout
                maximumAge: 60000
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    
                    // Validate coordinates
                    if (isValidCoordinate(lat, lon)) {
                        resolve({ lat, lon });
                    } else {
                        reject(new Error('Invalid coordinates received'));
                    }
                },
                (error) => {
                    let errorMessage = 'Unable to get your location. ';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage += 'Please allow location access to use this service.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage += 'Location information is unavailable.';
                            break;
                        case error.TIMEOUT:
                            errorMessage += 'Location request timed out. Please try again.';
                            break;
                        default:
                            errorMessage += 'An unknown error occurred.';
                    }
                    reject(new Error(errorMessage));
                },
                options
            );
        });
    }

    function isValidCoordinate(lat, lon) {
        return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }

    // ==================== ENHANCED API CALLS ====================
    async function apiCall(url, options = {}) {
        // default options for apiCall (not all keys are valid fetch options)
        const defaultOptions = {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        // Merge but do not forward `timeout` into fetch directly
        const mergedOptions = { ...defaultOptions, ...options };
        
        try {
            const controller = new AbortController();
            const timeoutMs = mergedOptions.timeout || 30000;
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            // Prepare fetchOptions by excluding non-fetch keys (like timeout)
            const { timeout, ...fetchOptionsRaw } = mergedOptions;
            const fetchOptions = { ...fetchOptionsRaw, signal: controller.signal };

            const response = await fetch(url, fetchOptions);
            
            clearTimeout(timeoutId);

            // Try to parse JSON body (if any) for better error messages
            const text = await response.text();
            let parsed = null;
            try {
                parsed = text ? JSON.parse(text) : null;
            } catch (e) {
                parsed = null;
            }

            if (!response.ok) {
                const bodySnippet = parsed ? JSON.stringify(parsed) : text;
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${bodySnippet}`);
            }

            // If parsed JSON exists, return it; otherwise return raw text
            return parsed !== null ? parsed : text;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request timeout - please check your connection');
            }
            throw error;
        }
    }

    // ==================== SIDEBAR NAVIGATION ====================
    function initializeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        const menuToggle = document.getElementById('menuToggle');
        const sidebarClose = document.getElementById('sidebarClose');

        if (!sidebar || !sidebarOverlay || !menuToggle || !sidebarClose) {
            console.error('Sidebar elements not found');
            return;
        }

        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('active');
            sidebarOverlay.classList.add('active');
        });

        sidebarClose.addEventListener('click', () => {
            sidebar.classList.remove('active');
            sidebarOverlay.classList.remove('active');
        });

        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
            sidebarOverlay.classList.remove('active');
        });

        // Navigation between sections
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const target = item.getAttribute('data-target');
                
                if (!target) {
                    console.error('No data-target attribute found');
                    return;
                }
                
                // Update active nav item
                document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                // Show target section, hide others
                document.querySelectorAll('.dashboard-section').forEach(section => {
                    section.classList.add('hidden');
                });
                
                const targetSection = document.getElementById(target);
                if (targetSection) {
                    targetSection.classList.remove('hidden');
                } else {
                    console.error(`Target section not found: ${target}`);
                }

                // Close sidebar on mobile after selection
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('active');
                    sidebarOverlay.classList.remove('active');
                }
            });
        });
    }
    // ==================== ENHANCED DRIVER DASHBOARD FUNCTIONALITY ====================
    function initializeDriverDashboard() {
        const driverLoginForm = document.getElementById('driverLoginForm');
        const completeBtn = document.getElementById('completeBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        if (!driverLoginForm) {
            console.error('Driver login form not found');
            return;
        }

        // Driver Login
        driverLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('driverUsername').value.trim();
            const password = document.getElementById('driverPassword').value.trim();
            
            if (!username || !password) {
                showToast('Please enter both username and password', 'error');
                return;
            }

            try {
                const response = await apiCall('/driver_login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });
                
                if (response && response.success) {
                    currentDriver = response.driver;
                    localStorage.setItem('driverToken', response.token);
                    showToast(`Welcome ${response.driver.name}!`, 'success');
                    showDriverDashboard();
                    startAssignmentChecking();
                } else {
                    // Improved message: respect backend error message if present
                    const errMsg = response && response.error ? response.error : 'Login failed';
                    showToast('Login failed: ' + errMsg, 'error');
                }
            } catch (error) {
                console.error('Login error:', error);
                showToast('Login failed. Please try again.', 'error');
            }
        });

        // Complete Emergency Button with Location Update
        if (completeBtn) {
            completeBtn.addEventListener('click', async () => {
                if (!currentDriver || !currentAssignment) {
                    showToast('No active assignment to complete', 'warning');
                    return;
                }

                if (!confirm('Mark this emergency as completed and update your current location?')) return;
                
                try {
                    // Get driver's current location
                    const position = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true,
                            timeout: 10000,
                            maximumAge: 0
                        });
                    });

                    const current_lat = position.coords.latitude;
                    const current_lon = position.coords.longitude;

                    console.log(`📍 Driver current location: ${current_lat}, ${current_lon}`);

                    const response = await apiCall('/complete_emergency', {
                        method: 'POST',
                        body: JSON.stringify({ 
                            driver_id: currentDriver.driver_id,
                            dispatch_id: currentAssignment.dispatch_id,
                            current_lat: current_lat,
                            current_lon: current_lon
                        })
                    });
                    
                    if (response && response.success) {
                        showToast('Emergency marked as completed! Your location has been updated.', 'success');
                        currentAssignment = null;
                        checkCurrentAssignment(); // Refresh display
                    } else {
                        const errMsg = response && response.error ? response.error : 'Failed to complete';
                        showToast('Error: ' + errMsg, 'error');
                    }
                } catch (error) {
                    console.error('Error getting location or completing emergency:', error);
                    
                    // Fallback: Complete without location update
                    if (confirm('Unable to get your location. Complete without updating ambulance location?')) {
                        try {
                            const response = await apiCall('/complete_emergency', {
                                method: 'POST',
                                body: JSON.stringify({ 
                                    driver_id: currentDriver.driver_id,
                                    dispatch_id: currentAssignment.dispatch_id
                                })
                            });
                            
                            if (response && response.success) {
                                showToast('Emergency marked as completed (location not updated).', 'success');
                                currentAssignment = null;
                                checkCurrentAssignment();
                            } else {
                                const errMsg = response && response.error ? response.error : 'Failed to complete';
                                showToast('Error: ' + errMsg, 'error');
                            }
                        } catch (fallbackError) {
                            showToast('Failed to complete emergency: ' + fallbackError.message, 'error');
                        }
                    }
                }
            });
        }

        // Logout Button - FIXED VERSION
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to logout?')) {
                    currentDriver = null;
                    currentAssignment = null;
                    localStorage.removeItem('driverToken');
                    
                    if (checkAssignmentInterval) {
                        clearInterval(checkAssignmentInterval);
                        checkAssignmentInterval = null;
                    }
                    
                    // Hide driver dashboard
                    const driverDashboardEl = document.getElementById('driver-dashboard');
                    if (driverDashboardEl) driverDashboardEl.classList.add('hidden');
                    
                    // Show driver login page initially
                    const driverLoginEl = document.getElementById('driver-login');
                    if (driverLoginEl) driverLoginEl.classList.remove('hidden');
                    
                    // RESET NAVIGATION TO USER DASHBOARD
                    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
                    const userNavItem = document.querySelector('[data-target="user-dashboard"]');
                    if (userNavItem) {
                        userNavItem.classList.add('active');
                    }
                    
                    // Show user dashboard and hide driver sections
                    document.querySelectorAll('.dashboard-section').forEach(section => {
                        section.classList.add('hidden');
                    });
                    const userDashboard = document.getElementById('user-dashboard');
                    if (userDashboard) userDashboard.classList.remove('hidden');
                    
                    // Reset login form
                    const loginForm = document.getElementById('driverLoginForm');
                    if (loginForm) loginForm.reset();
                    
                    showToast('Logged out successfully', 'success');
                }
            });
        }
    }

    // Show driver dashboard
    function showDriverDashboard() {
        const driverLoginEl = document.getElementById('driver-login');
        const driverDashboardEl = document.getElementById('driver-dashboard');
        if (driverLoginEl) driverLoginEl.classList.add('hidden');
        if (driverDashboardEl) driverDashboardEl.classList.remove('hidden');
        
        // Update navigation to show driver dashboard as active
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        const driverNavItem = document.querySelector('[data-target="driver-login"]');
        if (driverNavItem) {
            driverNavItem.classList.add('active');
        }
        
        // Update driver status display
        updateDriverStatus();
        checkCurrentAssignment();
    }

    // Check for current assignments
    async function checkCurrentAssignment() {
        if (!currentDriver) return;
        
        try {
            const response = await apiCall(`/driver_assignment/${currentDriver.driver_id}`);
            
            if (response && response.hasAssignment) {
                currentAssignment = response.emergency;
                displayEmergencyDetails(response.emergency);
                const completeBtn = document.getElementById('completeBtn');
                if (completeBtn) completeBtn.disabled = false;
                const currentStatusEl = document.getElementById('currentStatus');
                if (currentStatusEl) currentStatusEl.textContent = 'ON MISSION';
                const indicator = document.querySelector('.driver-status .status-indicator');
                if (indicator) indicator.className = 'status-indicator busy';
            } else {
                currentAssignment = null;
                const emergencyDetailsEl = document.getElementById('emergencyDetails');
                if (emergencyDetailsEl) emergencyDetailsEl.innerHTML = '<p>No active emergency assignments</p>';
                const completeBtn = document.getElementById('completeBtn');
                if (completeBtn) completeBtn.disabled = true;
                const currentStatusEl = document.getElementById('currentStatus');
                if (currentStatusEl) currentStatusEl.textContent = 'AVAILABLE';
                const indicator = document.querySelector('.driver-status .status-indicator');
                if (indicator) indicator.className = 'status-indicator available';
            }
        } catch (error) {
            console.error('Error checking assignment:', error);
            showToast('Failed to check assignments', 'error');
        }
    }
    // Display emergency details
    function displayEmergencyDetails(emergency) {
        const detailsHtml = `
            <div class="patient-info">
                <div class="info-item">
                    <div class="info-label">Patient Name</div>
                    <div class="info-value">${escapeHtml(emergency.patient_name || 'Anonymous')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Contact Number</div>
                    <div class="info-value">${escapeHtml(emergency.contact_number || 'N/A')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Emergency Type</div>
                    <div class="info-value">${formatEmergencyType(emergency.emergency_type)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Distance</div>
                    <div class="info-value">${emergency.distance_km || 'Unknown'} km</div>
                </div>
            </div>
            
            <div class="location-section">
                <div class="info-label">Patient Location</div>
                <a href="https://www.google.com/maps?q=${emergency.latitude},${emergency.longitude}" 
                   target="_blank" class="coordinate-link">
                    <i class="fas fa-map-marker-alt"></i>
                    ${emergency.latitude}, ${emergency.longitude}
                </a>
                <p class="location-address" id="locationAddress">Fetching address...</p>
            </div>
            
            ${emergency.notes ? `
                <div class="notes-section">
                    <div class="info-label">Additional Notes</div>
                    <div class="info-value">${escapeHtml(emergency.notes)}</div>
                </div>
            ` : ''}
        `;
        
        const el = document.getElementById('emergencyDetails');
        if (el) el.innerHTML = detailsHtml;
        
        // Get address from coordinates
        getAddressFromCoordinates(emergency.latitude, emergency.longitude);
    }

    // Get address from coordinates (reverse geocoding)
    async function getAddressFromCoordinates(lat, lon) {
        try {
            // Using OpenStreetMap Nominatim (free)
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
            const data = await response.json();
            
            if (data.display_name) {
                const addrEl = document.getElementById('locationAddress');
                if (addrEl) addrEl.textContent = data.display_name;
            } else {
                const addrEl = document.getElementById('locationAddress');
                if (addrEl) addrEl.textContent = 'Address not available';
            }
        } catch (error) {
            console.error('Error fetching address:', error);
            const addrEl = document.getElementById('locationAddress');
            if (addrEl) addrEl.textContent = 'Error fetching address';
        }
    }

    // Format emergency type
    function formatEmergencyType(type) {
        const types = {
            'cardiac': 'Cardiac Arrest',
            'accident': 'Accident',
            'respiratory': 'Respiratory Distress',
            'stroke': 'Stroke',
            'other': 'Other'
        };
        return types[type] || type;
    }

    // Escape HTML to prevent XSS
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Update driver status
    function updateDriverStatus() {
        // Implementation for updating driver status in the future
        console.log('Driver status updated');
    }

    // Start checking for assignments
    function startAssignmentChecking() {
        // Check immediately first
        checkCurrentAssignment();
        
        // Then set up interval for continuous checking
        if (checkAssignmentInterval) clearInterval(checkAssignmentInterval);
        // removed undefined `loadHospitalData()` call which caused ReferenceError
        checkAssignmentInterval = setInterval(checkCurrentAssignment, 5000); // Check every 5 seconds
    }

    // ==================== ENHANCED EMERGENCY PROTOCOL ====================
    async function initiateEmergencyProtocol(patientName, contactNumber, notes, lat, lon, emergencyType) {
        if (isProcessing) {
            showToast('Please wait while processing current request', 'warning');
            return;
        }
        
        isProcessing = true;

        const btn = document.getElementById('book-btn');
        const alertOverlay = document.getElementById('alertOverlay');
        const metricsDashboard = document.getElementById('metricsDashboard');

        if (!btn || !alertOverlay) {
            showToast('System error: UI elements not found', 'error');
            isProcessing = false;
            return;
        }

        btn.disabled = true;
        alertOverlay.classList.add('active');

        try {
            updateStatus('INITIATING EMERGENCY PROTOCOL...', '#e74c3c'); await delay(800);
            updateStatus('ACQUIRING GEOLOCATION DATA...', '#e67e22'); await delay(800);
            updateStatus('ANALYZING NEAREST AVAILABLE UNITS...', '#f39c12'); await delay(1200);
            updateStatus('DISPATCHING EMERGENCY UNIT...', '#3498db'); await delay(800);

            const requestData = { 
                patientName, 
                contactNumber, 
                notes, 
                lat, 
                lon, 
                emergencyType 
            };

            // Use apiCall (async/await) to handle immediate assignment OR request_id flows
            const response = await apiCall('/book_ambulance', {
                method: 'POST',
                body: JSON.stringify(requestData)
            });

            // If backend returns immediate assignment info
            if (response && response.success) {
                // Case A: immediate assignment object (ambulance info included)
                if (response.ambulancePlate || response.driverName || response.ambulance_id) {
                    const plate = response.ambulancePlate || response.ambulance_id || 'N/A';
                    const driver = response.driverName || response.driver_name || 'Unknown';
                    const distanceVal = (typeof response.distance !== 'undefined') ? response.distance : (response.distance_km || '---');
                    const etaVal = (typeof response.eta !== 'undefined') ? response.eta : (response.eta_min || '---');

                    const ambulanceEl = document.getElementById('ambulanceId');
                    const distanceEl = document.getElementById('distance');
                    const etaEl = document.getElementById('eta');
                    const hospitalEl = document.getElementById('hospitalName');

                    if (ambulanceEl) ambulanceEl.textContent = plate;
                    if (distanceEl) distanceEl.textContent = (distanceVal !== '---' ? distanceVal + ' km' : '---');
                    if (etaEl) etaEl.textContent = (etaVal !== '---' ? etaVal + ' min' : '---');
                    if (hospitalEl) hospitalEl.textContent = response.hospital_name || response.hospitalName || 'Hospital Not Available';

                    if (metricsDashboard) metricsDashboard.classList.add('visible');
                    updateStatus(`🚑 UNIT ${plate} DISPATCHED | DRIVER: ${driver}`, '#2ecc71');
                    showToast('Emergency assistance dispatched successfully!', 'success');
                }
                // Case B: backend returned request_id for async assignment -> start polling
                else if (response.request_id) {
                    const reqId = response.request_id;
                    showToast(response.message || 'Request received. Waiting for ambulance assignment...', 'info');

                    // Show pending indicators
                    const ambulanceEl = document.getElementById('ambulanceId');
                    const distanceEl = document.getElementById('distance');
                    const etaEl = document.getElementById('eta');
                    const hospitalEl = document.getElementById('hospitalName');

                    if (ambulanceEl) ambulanceEl.textContent = 'Pending...';
                    if (distanceEl) distanceEl.textContent = '---';
                    if (etaEl) etaEl.textContent = '---';
                    if (hospitalEl) hospitalEl.textContent = '---';
                    if (metricsDashboard) metricsDashboard.classList.remove('visible');

                    // Start polling for assignment
                    startPollingDispatch(reqId, async (status) => {
                        if (status && status.assigned) {
                            // update UI via shared helper
                            updateDispatchUI(status);
                        } else if (status && status.error) {
                            updateStatus(status.error, '#e74c3c', true);
                            showToast(status.error, 'error');
                        }
                    });
                } else {
                    // Unexpected but success; show message and keep UI in waiting state
                    showToast(response.message || 'Request accepted. Waiting for assignment...', 'info');
                    updateStatus(response.message || 'AWAITING ASSIGNMENT', '#f39c12');
                }
            } else {
                const errorMsg = (response && response.error) ? response.error : 'NO AVAILABLE AMBULANCE NEARBY';
                updateStatus(errorMsg, '#e74c3c', true);
                showToast(errorMsg, 'error');
            }
        } catch (err) {
            console.error('Emergency protocol error:', err);
            const errorMsg = err.message ? err.message : 'Failed to dispatch emergency assistance';
            updateStatus(errorMsg, '#e74c3c', true);
            showToast(errorMsg, 'error');
        } finally {
            alertOverlay.classList.remove('active');
            btn.disabled = false;
            isProcessing = false;
        }
    }
    // ==================== POLLING & DISPATCH UI HELPERS ====================
    // Starts polling /get_dispatch_status/<reqId> every 3s until assignment or timeout
    function startPollingDispatch(reqId, onUpdate) {
        let attempts = 0;
        const maxAttempts = 40; // ~2 minutes (40 * 3s = 120s)
        const intervalMs = 3000;

        const pollInterval = setInterval(async () => {
            attempts += 1;
            try {
                const status = await apiCall(`/get_dispatch_status/${reqId}`);
                // If assigned, call callback and stop polling
                if (status && status.assigned) {
                    clearInterval(pollInterval);
                    if (typeof onUpdate === 'function') onUpdate(status);
                } else if (status && status.error) {
                    // stop if server returned an error
                    clearInterval(pollInterval);
                    if (typeof onUpdate === 'function') onUpdate({ error: status.error });
                } else {
                    // not assigned yet; update minimal UI if needed
                    updateStatus('Searching for nearest ambulance...', '#f39c12');
                }
            } catch (err) {
                console.error('Polling dispatch status error:', err);
                // Do not spam user; only stop on too many failures
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    updateStatus('Failed to get assignment. Please try again or contact support.', '#e74c3c', true);
                    showToast('Unable to confirm ambulance assignment. Try again shortly.', 'error');
                }
            }

            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                updateStatus('Assignment timed out. Please try again.', '#e74c3c', true);
                showToast('Assignment timed out. Please try again.', 'error');
            }
        }, intervalMs);
    }

    // Update UI when dispatch status arrives
    function updateDispatchUI(status) {
        if (!status) return;

        // assign fields safely
        const plate = status.ambulance_plate || status.ambulancePlate || status.ambulance_id || 'N/A';
        const driver = status.driver_name || status.driverName || 'Unknown';
        const distance = typeof status.distance_km !== 'undefined' ? status.distance_km : (status.distance || '---');
        const eta = typeof status.eta_min !== 'undefined' ? status.eta_min : (status.eta || '---');

        const ambulanceEl = document.getElementById('ambulanceId');
        const distanceEl = document.getElementById('distance');
        const etaEl = document.getElementById('eta');
        const hospitalEl = document.getElementById('hospitalName');

        if (ambulanceEl) ambulanceEl.textContent = plate;
        if (distanceEl) distanceEl.textContent = (distance !== '---' ? distance + ' km' : '---');
        if (etaEl) etaEl.textContent = (eta !== '---' ? eta + ' min' : '---');
        if (hospitalEl) hospitalEl.textContent = status.hospital_name || status.hospitalName || 'Hospital Not Available';

        const metricsDashboard = document.getElementById('metricsDashboard');
        if (metricsDashboard) metricsDashboard.classList.add('visible');

        updateStatus(`🚑 UNIT ${plate} DISPATCHED | DRIVER: ${driver}`, '#2ecc71');
        showToast(`Ambulance ${plate} dispatched — Driver: ${driver} — ETA: ${eta} min`, 'success');
    }

    // ==================== ENHANCED BOOK BUTTON HANDLER ====================
    const bookBtn = document.getElementById('book-btn');
    if (bookBtn) {
        bookBtn.addEventListener('click', async () => {
            const patientName = (document.getElementById('patientName') || {}).value?.trim() || '';
            const contactNumber = (document.getElementById('contactNumber') || {}).value?.trim() || '';
            const notes = (document.getElementById('notes') || {}).value?.trim() || '';
            const emergencyType = (document.getElementById('emergencyType') || {}).value || '';

            // Enhanced form validation
            const nameRegex = /^[A-Za-z\s]{2,50}$/;
            const phoneRegex = /^[0-9]{10}$/;

            if (!patientName || !nameRegex.test(patientName)) {
                showToast('Please enter a valid name (2-50 alphabetic characters)', 'error');
                return;
            }

            if (!phoneRegex.test(contactNumber)) {
                showToast('Please enter a valid 10-digit contact number', 'error');
                return;
            }

            if (!emergencyType) {
                showToast('Please select an emergency type', 'error');
                return;
            }

            try {
                const location = await getCurrentLocation();
                const lat = location.lat;
                const lon = location.lon;
                const latInput = document.getElementById('user-lat');
                const lonInput = document.getElementById('user-lon');
                if (latInput) latInput.value = lat;
                if (lonInput) lonInput.value = lon;
                
                await initiateEmergencyProtocol(patientName, contactNumber, notes, lat, lon, emergencyType);
            } catch (error) {
                console.error('Location error:', error);
                showToast(error.message, 'error');
            }
        });
    }

    // ==================== METRICS & STATUS ====================
    function resetForm() {
        const toClear = ['patientName','contactNumber','notes','emergencyType','user-lat','user-lon'];
        toClear.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        ['ambulanceId','distance','eta','hospitalName'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '---';
        });

        const metricsDashboard = document.getElementById('metricsDashboard');
        if (metricsDashboard) {
            metricsDashboard.classList.remove('visible');
        }
        
        updateStatus('AWAITING EMERGENCY REQUEST', '#3498db');
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') resetForm();
    });

    // ==================== INITIALIZE ====================
    function initializeApp() {
        // Initialize sidebar navigation
        initializeSidebar();
        
        // Initialize driver dashboard functionality
        initializeDriverDashboard();
        
        // Check if driver was previously logged in
        const savedDriverToken = localStorage.getItem('driverToken');
        if (savedDriverToken) {
            // In a real app, you would verify the token with the backend
            // For now, we'll just clear it to force fresh login
            localStorage.removeItem('driverToken');
        }

        // Animate cards on load
        const cards = document.querySelectorAll('.card');
        cards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            setTimeout(() => {
                card.style.transition = 'all 0.6s ease';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 100 + (index * 200));
        });

        updateStatus('AWAITING EMERGENCY REQUEST', '#3498db');
        console.log('🚑 LifeLine Emergency Dispatch System Enhanced - Hospital integration active');
    }

    // Add CSS for new animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }
        
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            border-left: 4px solid #3498db;
            animation: slideIn 0.3s ease-out;
            max-width: 400px;
            word-wrap: break-word;
        }
        
        .toast-error { 
            border-left-color: #e74c3c; 
            background: #ffeaea;
        }
        .toast-success { 
            border-left-color: #2ecc71; 
            background: #eaffea;
        }
        .toast-warning { 
            border-left-color: #f39c12; 
            background: #fff4ea;
        }
        .toast-info { 
            border-left-color: #3498db; 
            background: #eaf4ff;
        }
        
        .toast-content {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 500;
        }
        
        .toast-content i {
            font-size: 1.2rem;
        }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }

        .toast.fade-out {
            animation: slideOut 0.3s ease-in forwards;
        }
    `;
    document.head.appendChild(style);

    // Start the application
    initializeApp();
});
