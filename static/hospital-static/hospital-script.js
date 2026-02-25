// ---------------- hospital-static/script.js ----------------

// When the DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    const loginOverlay = document.getElementById("loginOverlay");
    const appRoot = document.getElementById("appRoot");
    const hospitalLoginForm = document.getElementById("hospitalLoginForm");
    const loginMessageEl = document.getElementById("loginMessage");
    const logoutBtn = document.getElementById("logoutBtn");

    const hospitalNameSidebar = document.getElementById("hospitalNameSidebar");
    const hospitalNameHeader = document.getElementById("hospitalNameHeader");
    const hospitalLocationHeader = document.getElementById("hospitalLocationHeader");
    const hospitalAvatar = document.getElementById("hospitalAvatar");
    

    let hospitalId = null;
    let hospitalName = null;
    let autoRefresh = null;

    // ---------- Utilities ----------
    const getJson = (url) => fetch(url).then(r => r.json());
    const postJson = (url, body) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }).then(r => r.json());

    const escapeHtml = (str = "") => str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const getInitials = name =>
        !name ? "HH" : name.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);

    const showToast = (msg) => {
        const toast = document.getElementById("toast");
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
    };

    // ✅ Time formatter (safe for all timestamp formats)
    function formatActivityTime(timestamp) {
        if (!timestamp) return "No Time Available";
        const dateObj = new Date(timestamp);
        if (isNaN(dateObj.getTime())) {
            const fixed = timestamp.replace(" ", "T");
            const fixedDate = new Date(fixed);
            return isNaN(fixedDate.getTime())
                ? "Invalid Date"
                : fixedDate.toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: true
                  });
        }
        return dateObj.toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });
    }

    // ---------- Session restore ----------
    function restoreSession() {
        const id = localStorage.getItem("lifeline_hospital_id");
        const name = localStorage.getItem("lifeline_hospital_name");
        const location = localStorage.getItem("lifeline_hospital_location");
        if (id && name) {
            hospitalId = parseInt(id, 10);
            hospitalName = name;
            applyHospitalInfo(name, location);
            showDashboard();
            startRefresh();
        } else showLogin();
    }

    function applyHospitalInfo(name, loc) {
        if (hospitalNameSidebar) hospitalNameSidebar.textContent = name || "Hospital";
        if (hospitalNameHeader) hospitalNameHeader.textContent = name || "Hospital";
        if (hospitalLocationHeader) hospitalLocationHeader.textContent = loc || "";
        if (hospitalAvatar) hospitalAvatar.textContent = getInitials(name);
    }

    function showLogin() {
        if (loginOverlay) loginOverlay.classList.remove("hidden");
        if (appRoot) appRoot.classList.add("hidden");
    }

    function showDashboard() {
        if (loginOverlay) loginOverlay.classList.add("hidden");
        if (appRoot) appRoot.classList.remove("hidden");
        showToast(`Welcome ${hospitalName}`);
        loadAnalyticsChart(); // ✅ Chart loads once dashboard is visible
    }

    // ---------- Login ----------
    if (hospitalLoginForm) {
        hospitalLoginForm.addEventListener("submit", async e => {
            e.preventDefault();
            if (loginMessageEl) loginMessageEl.textContent = "";

            const username = document.getElementById("hospitalUsername").value.trim();
            const password = document.getElementById("hospitalPassword").value.trim();
            if (!username || !password) {
                if (loginMessageEl) loginMessageEl.textContent = "Please fill all fields.";
                return;
            }

            try {
                const res = await postJson("/hospital_login", { username, password });
                if (res.success) {
                    hospitalId = res.hospital_id;
                    hospitalName = res.hospital_name;
                    localStorage.setItem("lifeline_hospital_id", hospitalId);
                    localStorage.setItem("lifeline_hospital_name", res.hospital_name);
                    localStorage.setItem("lifeline_hospital_location", res.location || "");

                    applyHospitalInfo(res.hospital_name, res.location);
                    showDashboard();
                    startRefresh();
                } else {
                    if (loginMessageEl) loginMessageEl.textContent = res.error || "Invalid credentials";
                }
            } catch (err) {
                console.error(err);
                if (loginMessageEl) loginMessageEl.textContent = "Server error. Try again.";
            }
        });
    }

    // ---------- Logout ----------
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            if (!confirm("Logout from hospital dashboard?")) return;
            localStorage.removeItem("lifeline_hospital_id");
            localStorage.removeItem("lifeline_hospital_name");
            localStorage.removeItem("lifeline_hospital_location");
            hospitalId = null;
            stopRefresh();
            showLogin();
            showToast("Logged out");
        });
    }

    // ---------- Navigation ----------
    document.querySelectorAll(".nav-links a").forEach(link => {
        link.addEventListener("click", e => {
            e.preventDefault();
            document.querySelectorAll(".nav-links a").forEach(l => l.classList.remove("active"));
            link.classList.add("active");

            const target = link.dataset.page;
            if (target) {
                document.querySelectorAll(".page-section").forEach(sec => sec.classList.add("hidden"));
                const targetEl = document.getElementById(`${target}Section`);
                if (targetEl) {
                    targetEl.classList.remove("hidden");
                } else {
                    const dashboardEl = document.getElementById("dashboardSection");
                    if (dashboardEl) dashboardEl.classList.remove("hidden");
                }
            }

            // ✅ Load dashboards dynamically
            if (target === "ambulances") loadAmbulanceDashboard();
            if (target === "drivers") loadDriverDashboard();
            if (target === "patients") loadPatientDashboard();

            showToast(`Opened ${link.dataset.page}`);
        });
    });

    // ---------- Data Refresh ----------
    async function loadHospitalData() {
        if (!hospitalId) return;
        try {
            const [assignRes, ambRes, emerRes] = await Promise.all([
                getJson(`/hospital_assignments/${hospitalId}`),
                getJson(`/hospital_ambulances/${hospitalId}`),
                getJson(`/hospital_emergencies/${hospitalId}`)
            ]);

            if (assignRes && assignRes.success) updatePatientTable(assignRes.assignments);
            if (ambRes && ambRes.success) updateDriverStatus(ambRes.ambulances);
            if (emerRes && emerRes.success) updateActivityFeed(emerRes.emergencies);

            updateStats(assignRes || {}, ambRes || {});
        } catch (e) {
            console.error("Load error:", e);
            showToast("Network error");
        }
    }

    function startRefresh() {
        stopRefresh();
        loadHospitalData();
        autoRefresh = setInterval(loadHospitalData, 10000);
    }

    function stopRefresh() {
        if (autoRefresh) clearInterval(autoRefresh);
        autoRefresh = null;
    }

    // ---------- Table / Feed Builders ----------
    // ✅ Dashboard table – show only active (not completed) assignments
function updatePatientTable(assignments = []) {
    const tbody = document.querySelector("#patientsTable tbody");
    if (!tbody) return;

    // 🔸 Filter to show only active (in-progress) assignments
    const activeAssignments = assignments.filter(a => !a.completed_at);

    if (!activeAssignments.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;padding:40px;color:var(--text-light)">
                    <i class="fas fa-ambulance" style="font-size:2rem;display:block;margin-bottom:10px"></i>
                    No active emergency assignments
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = activeAssignments.map(a => `
        <tr>
            <td>
                <div class="patient-info">
                    <div class="patient-avatar">${getInitials(a.patient_name)}</div>
                    <div>
                        <div class="patient-name">${escapeHtml(a.patient_name)}</div>
                        <div class="patient-id">#PT-${a.request_id}</div>
                    </div>
                </div>
            </td>
            <td>${escapeHtml(a.emergency_type)}</td>
            <td>${escapeHtml(a.driver_name)}</td>
            <td>${a.eta_min || "-"} min</td>
            <td><span class="status-badge status-in-progress">In Progress</span></td>
        </tr>
    `).join("");
}


    // ✅ UPDATED: Smart status logic
    function updateDriverStatus(list = []) {
        const cont = document.getElementById("driverList");
        if (!cont) return;
        if (!list.length) {
            cont.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-light)">
                <i class="fas fa-user-md" style="font-size:1.4rem;display:block;margin-bottom:8px"></i>
                No drivers available
            </div>`;
            return;
        }

        cont.innerHTML = list.map(d => {
            const ambStatus = (d.ambulance_status || "").toLowerCase();
            const drvStatus = (d.driver_status || d.status || "").toLowerCase();

            const isBusy = ambStatus === "busy" || drvStatus === "busy";
            const indicator = isBusy ? "busy" : "available";
            const label = isBusy ? "On Emergency" : "Available";

            return `
                <div class="driver-card">
                    <div class="driver-avatar">${getInitials(d.driver_name)}</div>
                    <div class="driver-info">
                        <div class="driver-name">${escapeHtml(d.driver_name || "Unassigned")}</div>
                        <div class="driver-status">
                            <div class="status-indicator status-${indicator}"></div>
                            ${label}
                        </div>
                    </div>
                </div>`;
        }).join("");

        if (list.some(d => (d.driver_status === "busy" || d.ambulance_status === "busy"))) {
            setTimeout(() => loadHospitalData(), 3000);
        }
    }

    // ✅ Activity feed formatter
    function updateActivityFeed(emer = []) {
        const list = document.getElementById("activityList");
        if (!list) return;
        if (!emer.length) {
            list.innerHTML = `<li class="activity-item"><div class="activity-content" style="text-align:center;color:var(--text-light)">
                <div class="activity-title">No recent activity</div>
                <div class="activity-desc">Emergency updates appear here</div>
            </div></li>`;
            return;
        }
        list.innerHTML = emer.slice(0, 6).map(e => `
            <li class="activity-item">
                <div class="activity-icon"><i class="fas ${e.status==="completed"?"fa-user-check":"fa-ambulance"}"></i></div>
                <div class="activity-content">
                    <div class="activity-title">${escapeHtml(e.status==="completed"?"Patient Admitted":"Ambulance Dispatched")}</div>
                    <div class="activity-desc">${escapeHtml(e.patient_name)} - ${escapeHtml(e.emergency_type)}</div>
                    <div class="activity-time">${formatActivityTime(e.request_time)}</div>
                </div>
            </li>`).join("");
    }

   function updateStats(assign, amb) {
    const activeEl = document.getElementById("activePatientsCount");
    const availableEl = document.getElementById("availableDriversCount");
    const completedEl = document.getElementById("completedTodayCount");
    const efficiencyEl = document.getElementById("efficiencyScoreValue");

    const totalTrips = amb?.stats?.total || 0;
    const completedToday = amb?.ambulances?.reduce((sum, a) => sum + (a.completed_today || 0), 0) || 0;

    if (activeEl) activeEl.textContent = (assign && (assign.count || (assign.assignments?.length || 0))) || 0;
    if (availableEl) availableEl.textContent = (amb && (amb.stats?.available || amb.ambulances?.length)) || 0;
    if (completedEl) completedEl.textContent = completedToday || 0;

    // ✅ Efficiency Score Calculation
    if (efficiencyEl) {
        if (totalTrips > 0) {
           const efficiency = Math.min(((completedToday / totalTrips) * 100), 100).toFixed(1);

            efficiencyEl.textContent = `${efficiency}%`;
        } else {
            efficiencyEl.textContent = "--%";
        }
    }
}

    // ===================
    // 🚑 Ambulance Dashboard
    // ===================
    async function loadAmbulanceDashboard() {
        const container = document.getElementById("ambulanceDashboard");
        if (!container) return;
        try {
            const hospitalId = localStorage.getItem("lifeline_hospital_id");
            const res = await fetch(`/hospital_ambulances/${hospitalId}`);
            const data = await res.json();
            if (!data.success || !data.ambulances.length) {
                container.innerHTML = `<p style="text-align:center;color:var(--text-light);padding:20px">No ambulances registered for this hospital.</p>`;
                return;
            }
            container.innerHTML = `
                <table class="styled-table">
                    <thead><tr><th>ID</th><th>Plate Number</th><th>Driver</th><th>Status</th><th>Location</th></tr></thead>
                    <tbody>
                        ${data.ambulances.map(a => `
                            <tr>
                                <td>${a.ambulance_id}</td>
                                <td>${a.plate_number}</td>
                                <td>${a.driver_name || "Unassigned"}</td>
                                <td><span class="status-badge ${a.ambulance_status === "busy" ? "status-in-progress" : "status-available"}">${a.ambulance_status}</span></td>
                                <td>${a.latitude?.toFixed(4)}, ${a.longitude?.toFixed(4)}</td>
                            </tr>`).join("")}
                    </tbody>
                </table>`;
        } catch (err) {
            console.error("Ambulance dashboard error:", err);
        }
    }

   // ===================
// 🧍 Driver Dashboard (filtered by hospital)
// ===================
async function loadDriverDashboard() {
    const container = document.getElementById("driverDashboard");
    if (!container) return;
    try {
        const hospitalId = localStorage.getItem("lifeline_hospital_id");
        const res = await fetch(`/hospital_drivers/${hospitalId}`);
        const data = await res.json();

        if (!data.success || !data.drivers.length) {
            container.innerHTML = `<p style="text-align:center;color:var(--text-light);padding:20px">
                No drivers registered for this hospital.
            </p>`;
            return;
        }

        container.innerHTML = `
            <table class="styled-table">
                <thead>
                    <tr><th>ID</th><th>Name</th><th>Ambulance</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${data.drivers.map(d => `
                        <tr>
                            <td>${d.driver_id}</td>
                            <td>${d.driver_name}</td>
                            <td>${d.plate_number}</td>
                            <td><span class="status-badge ${d.driver_status === "busy" ? "status-in-progress" : "status-available"}">${d.driver_status}</span></td>
                        </tr>`).join("")}
                </tbody>
            </table>`;
    } catch (err) {
        console.error("Driver dashboard error:", err);
    }
}

// 🧑‍🤝‍🧑 Patient Dashboard (Active + Recently Completed)
// ===================
async function loadPatientDashboard() {
    const container = document.getElementById("patientDashboard");
    if (!container) return;
    try {
        const hospitalId = localStorage.getItem("lifeline_hospital_id");
        const res = await fetch(`/hospital_assignments/${hospitalId}`);
        const data = await res.json();

        if (!data.success || !data.assignments.length) {
            container.innerHTML = `<p style="text-align:center;color:var(--text-light);padding:20px">
                No active or recent patient records.
            </p>`;
            return;
        }

        container.innerHTML = `
            <table class="styled-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Patient Name</th>
                        <th>Emergency Type</th>
                        <th>Driver</th>
                        <th>ETA</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.assignments.map(p => {
                        const isCompleted = !!p.completed_at;
                        const statusClass = isCompleted ? "status-completed" : "status-in-progress";
                        const statusLabel = isCompleted ? "Completed" : "In Progress";
                        return `
                            <tr>
                                <td>${p.request_id}</td>
                                <td>${p.patient_name}</td>
                                <td>${p.emergency_type}</td>
                                <td>${p.driver_name}</td>
                                <td>${p.eta_min || "-"} min</td>
                                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                            </tr>`;
                    }).join("")}
                </tbody>
            </table>`;
    } catch (err) {
        console.error("Patient dashboard error:", err);
    }
}

    // ---------- Init ----------
    restoreSession();
});


// ---------------- Simulated Stat Updates ----------------
// ======================
// 🚑 Analytics Bar Chart (Real Data)
// ======================
async function loadAnalyticsChart() {
    const ctx = document.getElementById("ambulanceAnalyticsChart");
    if (!ctx) return;
    try {
        const hospitalId = localStorage.getItem("lifeline_hospital_id");
        const res = await fetch(`/hospital_ambulances/${hospitalId}`);
        const data = await res.json();
        if (!data.success) return;
        const labels = data.ambulances.map(a => a.plate_number || "Unknown");
        const totalTrips = data.ambulances.map(a => a.total_trips || 0);
        const completedToday = data.ambulances.map(a => a.completed_today || 0);
        if (window.analyticsChartInstance) window.analyticsChartInstance.destroy();
        window.analyticsChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    { label: "Total Trips", data: totalTrips, backgroundColor: "rgba(54, 162, 235, 0.6)", borderColor: "rgba(54, 162, 235, 1)", borderWidth: 1, borderRadius: 6 },
                    { label: "Completed Today", data: completedToday, backgroundColor: "rgba(75, 192, 192, 0.6)", borderColor: "rgba(75, 192, 192, 1)", borderWidth: 1, borderRadius: 6 }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: true }, title: { display: true, text: "Ambulance Performance Overview" } },
                scales: { y: { beginAtZero: true } }
            }
        });
    } catch (err) {
        console.error("Chart load error:", err);
    }
}

// ✅ Refresh button + Auto-refresh setup
document.getElementById("refreshChartBtn")?.addEventListener("click", loadAnalyticsChart);
setInterval(loadAnalyticsChart, 30000);
// ======================
// 📈 Weekly Trips Line Chart (Real DB Data)
// ======================
async function loadWeeklyTripsChart() {
    const ctx = document.getElementById("weeklyTripsChart");
    if (!ctx) return;

    try {
        const hospitalId = localStorage.getItem("lifeline_hospital_id");
        if (!hospitalId) return;

        // ✅ Fetch real weekly stats from backend
        const res = await fetch(`/hospital_weekly_stats/${hospitalId}`, { cache: "no-store" });
        const data = await res.json();

        if (!data.success || !Array.isArray(data.week)) return;

        // Extract real values from backend
        const labels = data.week.map(d => d.day);     // ['Wed', 'Thu', 'Fri', ...]
        const values = data.week.map(d => d.count);   // [3, 5, 0, 2, ...]

        // Destroy old chart if exists
        if (window.weeklyTripsChartInstance) window.weeklyTripsChartInstance.destroy();

        // Create real line chart
        window.weeklyTripsChartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Completed Trips",
                    data: values,
                    borderColor: "rgba(255, 99, 132, 1)",
                    backgroundColor: "rgba(255, 99, 132, 0.2)",
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: "rgba(255, 99, 132, 1)",
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: true },
                    title: { display: true, text: "Trips Completed (Last 7 Days)" }
                },
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: "Trips" } },
                    x: { title: { display: true, text: "Day" } }
                }
            }
        });
    } catch (err) {
        console.error("Weekly chart load error:", err);
    }
}


// ✅ Load both charts together
async function loadAnalyticsChartsCombined() {
    await loadAnalyticsChart();
    await loadWeeklyTripsChart();
}

// Refresh button will reload both
document.getElementById("refreshChartBtn")?.addEventListener("click", loadAnalyticsChartsCombined);

// Auto-refresh every 30 seconds
setInterval(loadAnalyticsChartsCombined, 30000);


