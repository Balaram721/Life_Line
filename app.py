from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import mysql.connector.pooling
import math
import traceback
import requests
from datetime import datetime
import logging
import time
from functools import wraps
import threading  # <-- ADDED: required for background assignment

app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# -------------------- MySQL Connection Pool --------------------
dbconfig = {
    "host": "localhost",
    "user": "root",
    "password": "0826",
    "database": "ambulance_dispatch"
}

try:
    pool = mysql.connector.pooling.MySQLConnectionPool(
        pool_name="ambulance_pool",
        pool_size=10,
        **dbconfig
    )
    logger.info("✅ Database connection pool created successfully")
except Exception as e:
    logger.error(f"❌ Database connection failed: {e}")
    raise

# -------------------- GraphHopper API Key --------------------
GRAPH_HOPPER_KEY = "c8e3e007-a97c-4e74-b432-94892c8fe7e3"

# -------------------- Enhanced Helper Functions --------------------
def get_db_connection():
    """Get database connection with retry logic"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            conn = pool.get_connection()
            logger.debug(f"✅ Database connection acquired (attempt {attempt + 1})")
            return conn
        except Exception as e:
            logger.warning(f"⚠️ Database connection attempt {attempt + 1} failed: {e}")
            if attempt == max_retries - 1:
                logger.error("❌ All database connection attempts failed")
                raise e
            time.sleep(1)
    return None


def handle_database_errors(func):
    """Decorator for database error handling"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except mysql.connector.Error as e:
            logger.error(f"🚨 Database error in {func.__name__}: {e}")
            return jsonify({"success": False, "error": "Database connection failed. Please try again."}), 500
        except Exception as e:
            logger.error(f"🚨 Unexpected error in {func.__name__}: {e}")
            traceback.print_exc()
            return jsonify({"success": False, "error": "Internal server error. Please try again."}), 500
    return wrapper


def haversine(lat1, lon1, lat2, lon2):
    """Calculate great-circle distance with error handling"""
    try:
        r = 6371  # Earth radius in KM
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        a = math.sin(delta_phi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(delta_lambda/2)**2
        c = 2 * math.asin(math.sqrt(a))
        distance = round(r * c, 2)
        logger.debug(f"📍 Haversine distance: {distance}km between ({lat1}, {lon1}) and ({lat2}, {lon2})")
        return distance
    except Exception as e:
        logger.error(f"❌ Haversine calculation error: {e}")
        return float('inf')


def get_graphhopper_distance(lat1, lon1, lat2, lon2):
    """Get route distance with fallback and timeout"""
    try:
        url = (
            f"https://graphhopper.com/api/1/route?"
            f"point={lat1},{lon1}&point={lat2},{lon2}"
            f"&vehicle=car&locale=en&calc_points=false&key={GRAPH_HOPPER_KEY}"
        )
        
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if "paths" in data and len(data["paths"]) > 0:
                distance_m = data["paths"][0]["distance"]
                time_ms = data["paths"][0]["time"]
                distance_km = round(distance_m / 1000, 2)
                eta_min = max(1, round(time_ms / (1000 * 60)))
                logger.debug(f"🗺️ GraphHopper: {distance_km}km, {eta_min}min")
                return distance_km, eta_min
        
        logger.warning(f"⚠️ GraphHopper API returned status: {response.status_code}")
        return None, None
        
    except requests.Timeout:
        logger.warning("⏰ GraphHopper API timeout")
        return None, None
    except Exception as e:
        logger.error(f"❌ GraphHopper API error: {e}")
        return None, None


def validate_coordinates(lat, lon):
    """Validate coordinate ranges"""
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return False
    return -90 <= lat <= 90 and -180 <= lon <= 180


# ✅ FIX ADDED HERE: helper to ensure all timestamps are ISO-formatted
def safe_isoformat(ts):
    """Ensure timestamps are ISO 8601 formatted for frontend parsing"""
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        parsed = datetime.strptime(str(ts), "%Y-%m-%d %H:%M:%S")
        return parsed.strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        return str(ts).replace(" ", "T")


# -------------------- Assignment core (no Flask decorator) --------------------
def assign_nearest_ambulance_core(req_id):
    """
    Core assignment logic (safe to call from threads or synchronously).
    Returns a dict: {"success": True, ...} or {"success": False, "error": "..."}
    """
    conn = cursor = None
    try:
        conn = get_db_connection()
        if not conn:
            logger.error("❌ assign_nearest_ambulance_core: DB connection unavailable")
            return {"success": False, "error": "Database unavailable"}
        cursor = conn.cursor(dictionary=True)

        # Fetch emergency location
        cursor.execute("SELECT latitude, longitude FROM emergency_requests WHERE request_id=%s", (req_id,))
        req = cursor.fetchone()
        if not req:
            logger.error("❌ Emergency request not found (core)")
            return {"success": False, "error": "Request not found"}

        try:
            req_lat = float(req["latitude"])
            req_lon = float(req["longitude"])
        except (ValueError, TypeError) as e:
            logger.error(f"❌ Invalid request coordinates (core): {e}")
            return {"success": False, "error": "Invalid request coordinates"}

        # Try SQL-level prefilter (fast)
        nearby_ambulances = None
        try:
            cursor.execute(f"""
                SELECT 
                    a.ambulance_id, a.latitude, a.longitude, a.status, a.plate_number,
                    d.driver_id, d.name AS driver_name,
                    h.name AS hospital_name, h.hospital_id,
                    haversine({req_lat}, {req_lon}, a.latitude, a.longitude) AS distance_km
                FROM ambulances a
                JOIN drivers d ON a.ambulance_id = d.ambulance_id
                JOIN hospitals h ON a.hospital_id = h.hospital_id
                WHERE a.status='available' AND d.status='available'
                ORDER BY distance_km ASC
                LIMIT 10;
            """)
            nearby_ambulances = cursor.fetchall()
            logger.debug(f"⚡ SQL pre-filter shortlisted {len(nearby_ambulances)} ambulances")
        except Exception as sql_pref_err:
            logger.warning(f"⚠️ SQL pre-filter failed: {sql_pref_err}. Falling back to Python prefilter.")
            cursor.execute("""
                SELECT a.ambulance_id, a.latitude, a.longitude, a.status, a.plate_number,
                       d.driver_id, d.name AS driver_name,
                       h.name AS hospital_name, h.hospital_id
                FROM ambulances a
                JOIN drivers d ON a.ambulance_id = d.ambulance_id
                LEFT JOIN hospitals h ON a.hospital_id = h.hospital_id
                WHERE a.status='available' AND d.status='available'
            """)
            all_avail = cursor.fetchall()
            for a in all_avail:
                try:
                    a_lat = float(a.get('latitude', 0))
                    a_lon = float(a.get('longitude', 0))
                    a['distance_km'] = haversine(req_lat, req_lon, a_lat, a_lon)
                except Exception:
                    a['distance_km'] = float('inf')
            nearby_ambulances = sorted([a for a in all_avail if a['distance_km'] != float('inf')],
                                       key=lambda x: x['distance_km'])[:10]
            logger.debug(f"⚡ Python prefilter shortlisted {len(nearby_ambulances)} ambulances")

        if not nearby_ambulances:
            logger.warning("🚨 No available ambulances found near request location (core)")
            return {"success": False, "error": "No available ambulances"}

        logger.info(f"✅ Shortlisted {len(nearby_ambulances)} ambulances for route testing (core)")

        # Stage 2: GraphHopper on shortlisted candidates
        best_amb = None
        best_eta = float('inf')
        best_distance = float('inf')

        for amb in nearby_ambulances:
            try:
                amb_lat = float(amb.get('latitude'))
                amb_lon = float(amb.get('longitude'))
            except (ValueError, TypeError):
                logger.debug(f"Skipping ambulance with invalid coords: {amb.get('ambulance_id')}")
                continue

            distance, eta = get_graphhopper_distance(req_lat, req_lon, amb_lat, amb_lon)

            # Fallback to precomputed distance_km (from SQL prefilter) or haversine if GH fails
            if distance is None:
                if amb.get('distance_km') not in (None, '', float('inf')):
                    distance = float(amb.get('distance_km'))
                else:
                    distance = haversine(req_lat, req_lon, amb_lat, amb_lon)
                eta = max(1, round((distance / 40) * 60))  # assume 40 km/h average

            # Weighted scoring (70% ETA, 30% distance)
            score = eta * 0.7 + distance * 0.3
            current_best = best_eta * 0.7 + best_distance * 0.3
            if score < current_best:
                best_eta = eta
                best_distance = distance
                best_amb = {
                    "ambulance_id": amb.get("ambulance_id"),
                    "plate_number": amb.get("plate_number"),
                    "driver_id": amb.get("driver_id"),
                    "driver_name": amb.get("driver_name"),
                    "hospital_name": amb.get("hospital_name"),
                    "hospital_id": amb.get("hospital_id"),
                    "distance_km": distance,
                    "eta_min": eta
                }

        if not best_amb:
            logger.error("❌ No suitable ambulance found after filtering (core)")
            return {"success": False, "error": "No optimal ambulance found"}

        # NEW: Fetch authoritative hospital name from hospitals table if hospital_id present
        hospital_name = None
        try:
            if best_amb.get("hospital_id"):
                try:
                    cursor.execute("SELECT hospital_name FROM hospitals WHERE hospital_id = %s", (best_amb.get("hospital_id"),))
                    hosp_row = cursor.fetchone()
                    if hosp_row and ('hospital_name' in hosp_row or 'name' in hosp_row):
                        hospital_name = hosp_row.get('hospital_name') or hosp_row.get('name')
                    else:
                        hospital_name = best_amb.get("hospital_name") or "Unknown Hospital"
                except Exception as hosp_err:
                    logger.warning(f"⚠️ Could not fetch hospital name from DB: {hosp_err}")
                    hospital_name = best_amb.get("hospital_name") or "Unknown Hospital"
            else:
                hospital_name = best_amb.get("hospital_name") or "Unknown Hospital"
        except Exception as e:
            logger.warning(f"⚠️ Error while determining hospital name: {e}")
            hospital_name = best_amb.get("hospital_name") or "Unknown Hospital"

        # Stage 3: Update DB with chosen ambulance
        try:
            cursor.execute("UPDATE ambulances SET status='busy' WHERE ambulance_id=%s", (best_amb["ambulance_id"],))
            cursor.execute("UPDATE drivers SET status='busy' WHERE driver_id=%s", (best_amb["driver_id"],))
            cursor.execute("UPDATE emergency_requests SET status='assigned' WHERE request_id=%s", (req_id,))
            cursor.execute("""
                INSERT INTO dispatch_log (request_id, ambulance_id, distance_km, eta_min)
                VALUES (%s, %s, %s, %s)
            """, (req_id, best_amb["ambulance_id"], best_distance, best_eta))
            conn.commit()

            logger.info(f"🚑 Assigned {best_amb['plate_number']} ({hospital_name}) {best_distance} km away — ETA {best_eta} min (core)")

            return {
                "success": True,
                "ambulancePlate": best_amb["plate_number"],
                "distance": best_distance,
                "eta": best_eta,
                "driverName": best_amb["driver_name"],
                "hospital_name": hospital_name,
                "message": f"Ambulance {best_amb['plate_number']} dispatched in {best_eta} minutes"
            }

        except Exception as e:
            conn.rollback()
            logger.error(f"❌ DB update failed when assigning ambulance (core): {e}")
            return {"success": False, "error": "Failed to save assignment to DB"}

    except Exception as e:
        logger.error(f"❌ Error in assign_nearest_ambulance_core: {e}")
        if conn:
            conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- Existing wrapper (keeps decorator for compatibility) --------------------
@handle_database_errors
def assign_nearest_ambulance(req_id):
    """Decorated wrapper that calls the core assignment (keeps existing routes safe)."""
    return assign_nearest_ambulance_core(req_id)


# -------------------- Hospital Dashboard Endpoints --------------------
# =============================
# 🏥 HOSPITAL ASSIGNMENTS (Active + Completed Last 24 Hours)
# =============================
@app.route('/hospital_assignments/<int:hospital_id>')
@handle_database_errors
def hospital_assignments(hospital_id):
    """Return active and recently completed (last 24h) assignments for a hospital."""
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # ✅ Active + recently completed (last 24 hours)
        cursor.execute("""
            SELECT 
                dl.dispatch_id,
                er.request_id,
                er.patient_name,
                er.contact_number,
                er.emergency_type,
                er.latitude,
                er.longitude,
                er.notes,
                er.request_time,
                dl.distance_km,
                dl.eta_min,
                dl.dispatch_time,
                dl.completed_at,
                a.plate_number,
                a.ambulance_id,
                d.driver_id,
                d.name AS driver_name,
                d.contact_number AS driver_contact
            FROM dispatch_log dl
            JOIN emergency_requests er ON dl.request_id = er.request_id
            JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            JOIN drivers d ON a.ambulance_id = d.ambulance_id
            WHERE a.hospital_id = %s
              AND (
                  dl.completed_at IS NULL  -- Active cases
                  OR dl.completed_at >= NOW() - INTERVAL 24 HOUR  -- Completed recently
              )
            ORDER BY dl.dispatch_time DESC
        """, (hospital_id,))
        
        assignments = cursor.fetchall()

        # ✅ Convert timestamps for frontend parsing
        for a in assignments:
            for key in ['dispatch_time', 'request_time', 'completed_at']:
                a[key] = safe_isoformat(a.get(key))

        logger.info(f"🏥 Hospital {hospital_id}: Retrieved {len(assignments)} active + recent assignments")
        return jsonify({
            'success': True,
            'assignments': assignments,
            'count': len(assignments)
        })
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route('/hospital_ambulances/<int:hospital_id>')
@handle_database_errors
def hospital_ambulances(hospital_id):
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        ### ================= FIXED =================
        ### Use REAL DB status instead of dispatch_log inference
        cursor.execute("""
            SELECT 
                a.ambulance_id,
                a.plate_number,
                a.latitude,
                a.longitude,
                a.status AS ambulance_status,          -- ✅ REAL STATUS
                d.driver_id,
                d.name AS driver_name,
                d.contact_number AS driver_contact,
                d.status AS driver_status,             -- ✅ REAL STATUS
                (
                    SELECT COUNT(*) 
                    FROM dispatch_log dl 
                    WHERE dl.ambulance_id = a.ambulance_id
                ) AS total_trips,
                (
                    SELECT COUNT(*) 
                    FROM dispatch_log dl 
                    WHERE dl.ambulance_id = a.ambulance_id 
                    AND DATE(dl.completed_at) = CURDATE()
                ) AS completed_today
            FROM ambulances a
            LEFT JOIN drivers d ON a.ambulance_id = d.ambulance_id
            WHERE a.hospital_id = %s
            ORDER BY a.status DESC, a.ambulance_id ASC
        """, (hospital_id,))
        ### ================= FIXED =================

        ambs = cursor.fetchall()

        total = len(ambs)
        available = len([a for a in ambs if a["ambulance_status"] == "available"])
        busy = len([a for a in ambs if a["ambulance_status"] == "busy"])

        return jsonify({
            "success": True,
            "ambulances": ambs,
            "stats": {
                "total": total,
                "available": available,
                "busy": busy
            }
        })
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# ===============================
# 📊 Weekly Completed Trips (Real Data)
# ===============================
@app.route("/hospital_weekly_stats/<int:hospital_id>")
@handle_database_errors
def hospital_weekly_stats(hospital_id):
    """Return count of completed trips per day for the last 7 days (hospital-scoped)."""
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT 
                DATE(dl.completed_at) AS day,
                COUNT(*) AS completed_count
            FROM dispatch_log dl
            JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            WHERE a.hospital_id = %s
                AND dl.completed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY DATE(dl.completed_at)
            ORDER BY day ASC
        """, (hospital_id,))
        rows = cursor.fetchall()

        # Build full 7-day series (oldest -> newest)
        from datetime import date, timedelta
        today = date.today()
        week = []
        for i in range(6, -1, -1):   # 6 days ago .. today
            d = today - timedelta(days=i)
            d_str = d.strftime("%Y-%m-%d")
            found = next((r for r in rows if r['day'] == d_str), None)
            week.append({
                "day": d.strftime("%a"),                # short label e.g. Mon, Tue
                "date": d_str,
                "count": int(found['completed_count']) if found else 0
            })

        return jsonify({"success": True, "week": week})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------- HOSPITAL DRIVERS (Specific to Hospital) --------------------
@app.route('/hospital_drivers/<int:hospital_id>')
@handle_database_errors
def hospital_drivers(hospital_id):
    """Returns drivers belonging only to this hospital"""
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT 
                d.driver_id,
                d.name AS driver_name,
                d.status AS driver_status,
                d.contact_number,
                a.plate_number,
                a.status AS ambulance_status,
                a.hospital_id
            FROM drivers d
            JOIN ambulances a ON d.ambulance_id = a.ambulance_id
            WHERE a.hospital_id = %s
            ORDER BY d.name ASC
        """, (hospital_id,))
        drivers = cursor.fetchall()
        return jsonify({'success': True, 'drivers': drivers, 'count': len(drivers)})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route('/hospital_emergencies/<int:hospital_id>')
@handle_database_errors
def hospital_emergencies(hospital_id):
    """Returns recent emergency requests for hospital's area"""
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT 
                er.request_id,
                er.patient_name,
                er.contact_number,
                er.emergency_type,
                er.latitude,
                er.longitude,
                er.notes,
                er.request_time,
                er.status,
                a.plate_number,
                d.name as driver_name,
                dl.distance_km,
                dl.eta_min,
                dl.dispatch_time,
                dl.completed_at
            FROM emergency_requests er
            LEFT JOIN dispatch_log dl ON er.request_id = dl.request_id
            LEFT JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            LEFT JOIN drivers d ON a.ambulance_id = d.ambulance_id
            WHERE a.hospital_id = %s 
                AND er.request_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY er.request_time DESC
            LIMIT 50
        """, (hospital_id,))
        emergencies = cursor.fetchall()

        # ✅ FIX — Convert timestamps for frontend display
        for e in emergencies:
            for key in ['request_time', 'dispatch_time', 'completed_at']:
                e[key] = safe_isoformat(e.get(key))

        return jsonify({'success': True, 'emergencies': emergencies})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# -------------------- BOOK AMBULANCE --------------------
@app.route("/book_ambulance", methods=["POST"])
@handle_database_errors
def book_ambulance():
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400

        patient_name = data.get("patientName", "Anonymous")
        lat = data.get("lat")
        lon = data.get("lon")
        emergency_type = data.get("emergencyType", "other")
        contact_number = data.get("contactNumber", "")
        notes = data.get("notes", "")
        ip_address = request.remote_addr

        # Validate coordinates
        if lat is None or lon is None:
            return jsonify({"success": False, "error": "Missing coordinates"}), 400

        try:
            lat = float(lat)
            lon = float(lon)
            if not validate_coordinates(lat, lon):
                return jsonify({"success": False, "error": "Invalid coordinate values"}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "error": "Invalid coordinate format"}), 400

        if not patient_name or len(patient_name.strip()) == 0:
            patient_name = "Anonymous"
        elif len(patient_name) > 100:
            patient_name = patient_name[:100]

        if contact_number and len(contact_number) > 20:
            contact_number = contact_number[:20]

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        # Insert emergency request
        cursor.execute("""
            INSERT INTO emergency_requests 
            (patient_name, latitude, longitude, emergency_type, contact_number, notes, ip_address)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (patient_name.strip(), lat, lon, emergency_type, contact_number, notes, ip_address))
        conn.commit()
        req_id = cursor.lastrowid

        # Retrieve the inserted timestamp to format it
        cursor.execute("SELECT request_time FROM emergency_requests WHERE request_id = %s", (req_id,))
        inserted = cursor.fetchone()
        req_time_iso = safe_isoformat(inserted.get('request_time') if inserted else None)

        cursor.close()
        conn.close()

        logger.info(f"🆕 Emergency request {req_id} logged from {ip_address} ({patient_name})")

        # Try synchronous assignment first (fast path).
        try:
            assign_result = assign_nearest_ambulance_core(req_id)
            if assign_result and assign_result.get("success"):
                # Immediate assignment succeeded — return assignment details to frontend
                logger.info(f"🚀 Immediate assignment succeeded for req_id={req_id}: {assign_result}")
                return jsonify({
                    "success": True,
                    "message": assign_result.get("message", "Ambulance assigned"),
                    "request_id": req_id,
                    "request_time": req_time_iso,
                    "assignment": {
                        "ambulance_plate": assign_result.get("ambulancePlate"),
                        "driver_name": assign_result.get("driverName"),
                        "distance_km": assign_result.get("distance"),
                        "eta_min": assign_result.get("eta"),
                        "hospital_name": assign_result.get("hospital_name")
                    }
                }), 200
            else:
                # No immediate assignment — spawn background thread and inform client to poll
                logger.info(f"⏳ Immediate assignment not available for req_id={req_id}. Spawning background worker.")
                threading.Thread(target=assign_nearest_ambulance_core, args=(req_id,)).start()
                return jsonify({
                    "success": True,
                    "message": "✅ Emergency request received! Assigning nearest ambulance (in progress).",
                    "request_id": req_id,
                    "request_time": req_time_iso
                }), 200
        except Exception as e:
            # If synchronous assignment attempt crashes, start background thread and return in-progress
            logger.error(f"❌ Synchronous assignment crashed for req_id={req_id}: {e}")
            threading.Thread(target=assign_nearest_ambulance_core, args=(req_id,)).start()
            return jsonify({
                "success": True,
                "message": "✅ Emergency request received! Assigning nearest ambulance (in progress).",
                "request_id": req_id,
                "request_time": req_time_iso
            }), 200

    except Exception as e:
        logger.error(f"❌ Error in async book_ambulance: {e}")
        return jsonify({"success": False, "error": "Failed to process emergency request"}), 500


# -------------------- GET DISPATCH STATUS --------------------
@app.route("/get_dispatch_status/<int:req_id>", methods=["GET"])
@handle_database_errors
def get_dispatch_status(req_id):
    """Check if ambulance has been assigned for a given emergency request"""
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT 
                er.request_id,
                er.status AS request_status,
                dl.distance_km,
                dl.eta_min,
                a.plate_number AS ambulance_plate,
                d.name AS driver_name,
                h.name AS hospital_name,
                dl.dispatch_time
            FROM emergency_requests er
            LEFT JOIN dispatch_log dl ON er.request_id = dl.request_id
            LEFT JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            LEFT JOIN drivers d ON a.ambulance_id = d.ambulance_id
            LEFT JOIN hospitals h ON a.hospital_id = h.hospital_id
            WHERE er.request_id = %s
            ORDER BY dl.dispatch_time DESC
            LIMIT 1
        """, (req_id,))

        result = cursor.fetchone()

        if not result:
            return jsonify({"assigned": False, "message": "Request not found"})

        if result["request_status"] == "assigned":
            dispatch_time_iso = safe_isoformat(result.get("dispatch_time"))
            return jsonify({
                "assigned": True,
                "ambulance_plate": result.get("ambulance_plate"),
                "driver_name": result.get("driver_name"),
                "distance_km": result.get("distance_km"),
                "eta_min": result.get("eta_min"),
                "hospital_name": result.get("hospital_name") or "Unknown Hospital",
                "dispatch_time": dispatch_time_iso,
                "message": "Ambulance dispatched successfully"
            })
        else:
            return jsonify({"assigned": False, "message": "Assignment still in progress"})

    except Exception as e:
        logger.error(f"❌ get_dispatch_status error: {e}")
        return jsonify({"assigned": False, "error": str(e)})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- DRIVER LOGIN --------------------
@app.route("/driver_login", methods=["POST"])
@handle_database_errors
def driver_login():
    conn = cursor = None
    try:
        data = request.json
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        username = data.get('username', '').strip()
        password = data.get('password', '').strip()

        if not username or not password:
            return jsonify({'success': False, 'error': 'Username and password required'}), 400

        if len(username) > 50 or len(password) > 255:
            return jsonify({'success': False, 'error': 'Invalid credentials format'}), 400

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT d.*, a.ambulance_id, a.plate_number, a.hospital_id
            FROM drivers d 
            JOIN ambulances a ON d.ambulance_id = a.ambulance_id 
            WHERE d.username = %s AND d.password = %s
        """, (username, password))

        driver = cursor.fetchone()

        if driver:
            cursor.execute("UPDATE drivers SET status='available' WHERE driver_id=%s", (driver['driver_id'],))
            cursor.execute("UPDATE ambulances SET status='available' WHERE ambulance_id=%s", (driver['ambulance_id'],))
            conn.commit()

            logger.info(f"🔑 DRIVER LOGIN: {driver['name']} ({username}) - Ambulance {driver['plate_number']}")

            return jsonify({
                'success': True,
                'driver': {
                    'driver_id': driver['driver_id'],
                    'name': driver['name'],
                    'username': driver['username'],
                    'ambulance_id': driver['ambulance_id'],
                    'plate_number': driver['plate_number'],
                    'hospital_id': driver['hospital_id']
                },
                'token': f"driver_{driver['driver_id']}_{datetime.now().timestamp()}",
                'message': f"Welcome {driver['name']}! Ambulance {driver['plate_number']} is now available."
            })
        else:
            logger.warning(f"❌ FAILED LOGIN ATTEMPT: {username}")
            return jsonify({'success': False, 'error': 'Invalid username or password'})

    except Exception as e:
        logger.error(f"❌ Login error: {e}")
        return jsonify({'success': False, 'error': 'Server error during login'})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- DRIVER ASSIGNMENT --------------------
@app.route('/driver_assignment/<int:driver_id>')
@handle_database_errors
def driver_assignment(driver_id):
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT 
                dl.dispatch_id,
                er.request_id,
                er.patient_name,
                er.contact_number,
                er.emergency_type,
                er.latitude,
                er.longitude,
                er.notes,
                er.request_time,
                dl.distance_km,
                dl.eta_min,
                dl.dispatch_time,
                a.plate_number,
                a.hospital_id,
                d.name as driver_name
            FROM dispatch_log dl
            JOIN emergency_requests er ON dl.request_id = er.request_id
            JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            JOIN drivers d ON a.ambulance_id = d.ambulance_id
            WHERE d.driver_id = %s AND dl.completed_at IS NULL
            ORDER BY dl.dispatch_time DESC 
            LIMIT 1
        """, (driver_id,))

        assignment = cursor.fetchone()

        if assignment:
            # ✅ Convert timestamps for frontend
            assignment['request_time'] = safe_isoformat(assignment.get('request_time'))
            assignment['dispatch_time'] = safe_isoformat(assignment.get('dispatch_time'))
            logger.info(f"📋 Driver {driver_id} has active assignment: {assignment['patient_name']}")
            return jsonify({'hasAssignment': True, 'emergency': assignment})
        else:
            logger.debug(f"📋 Driver {driver_id} has no active assignments")
            return jsonify({'hasAssignment': False})

    except Exception as e:
        logger.error(f"❌ Driver assignment error: {e}")
        return jsonify({'hasAssignment': False, 'error': str(e)})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- COMPLETE EMERGENCY --------------------
@app.route('/complete_emergency', methods=['POST'])
@handle_database_errors
def complete_emergency():
    conn = cursor = None
    try:
        data = request.json
        driver_id = data.get('driver_id')
        dispatch_id = data.get('dispatch_id')
        current_lat = data.get('current_lat')
        current_lon = data.get('current_lon')

        if not driver_id or not dispatch_id:
            return jsonify({'success': False, 'error': 'Missing driver_id or dispatch_id'}), 400

        if current_lat and current_lon:
            try:
                current_lat = float(current_lat)
                current_lon = float(current_lon)
                if not validate_coordinates(current_lat, current_lon):
                    return jsonify({'success': False, 'error': 'Invalid coordinates'}), 400
            except (ValueError, TypeError):
                return jsonify({'success': False, 'error': 'Invalid coordinate format'}), 400

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT dl.dispatch_id, dl.ambulance_id, d.driver_id, a.hospital_id, dl.request_id
            FROM dispatch_log dl
            JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            JOIN drivers d ON a.ambulance_id = d.ambulance_id
            WHERE dl.dispatch_id = %s AND d.driver_id = %s AND dl.completed_at IS NULL
        """, (dispatch_id, driver_id))

        valid_dispatch = cursor.fetchone()
        if not valid_dispatch:
            return jsonify({'success': False, 'error': 'Invalid dispatch or already completed'})

        request_id = valid_dispatch.get('request_id')

        if current_lat and current_lon:
            cursor.execute("""
                UPDATE ambulances SET latitude = %s, longitude = %s WHERE ambulance_id = %s
            """, (current_lat, current_lon, valid_dispatch['ambulance_id']))
            logger.info(f"📍 Updated ambulance location to: ({current_lat}, {current_lon})")

        cursor.execute("UPDATE dispatch_log SET completed_at = NOW() WHERE dispatch_id = %s", (dispatch_id,))
        cursor.execute("UPDATE ambulances SET status = 'available' WHERE ambulance_id = %s", (valid_dispatch['ambulance_id'],))
        cursor.execute("UPDATE drivers SET status = 'available' WHERE driver_id = %s", (driver_id,))
        if request_id:
            cursor.execute("UPDATE emergency_requests SET status = 'completed' WHERE request_id = %s", (request_id,))

        conn.commit()

        logger.info(f"✅ COMPLETED: Driver {driver_id} completed emergency {dispatch_id}")
        logger.info(f"📊 STATUS RESET: Ambulance {valid_dispatch['ambulance_id']} and Driver {driver_id} set to 'available'")
        logger.info(f"🏥 HOSPITAL NOTIFICATION: Hospital {valid_dispatch['hospital_id']} notified of completion")

        return jsonify({'success': True, 'message': 'Emergency marked as completed'})

    except Exception as e:
        logger.error(f"❌ Complete emergency error: {e}")
        if conn:
            conn.rollback()
        return jsonify({'success': False, 'error': str(e)})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- EXISTING ROUTES --------------------
@app.route("/")
def home():
    logger.info("🏠 Home page accessed")
    return render_template("index.html")


@app.route("/ambulances", methods=["GET"])
@handle_database_errors
def get_ambulances():
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT a.*, d.name AS driver_name, d.contact_number AS driver_contact
            FROM ambulances a
            JOIN drivers d ON a.ambulance_id = d.ambulance_id
        """)
        data = cursor.fetchall()

        # ✅ Format timestamps if they exist
        for row in data:
            if 'last_updated' in row:
                row['last_updated'] = safe_isoformat(row['last_updated'])

        logger.debug(f"📊 Retrieved {len(data)} ambulances")
        return jsonify(data)
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route("/requests", methods=["GET"])
@handle_database_errors
def get_requests():
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT er.*, a.plate_number, d.name AS driver_name
            FROM emergency_requests er
            LEFT JOIN dispatch_log dl ON er.request_id = dl.request_id
            LEFT JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            LEFT JOIN drivers d ON a.ambulance_id = d.ambulance_id
            ORDER BY er.request_time DESC
        """)
        data = cursor.fetchall()

        # ✅ Ensure request_time is ISO
        for row in data:
            row['request_time'] = safe_isoformat(row.get('request_time'))

        logger.debug(f"📊 Retrieved {len(data)} emergency requests")
        return jsonify(data)
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route("/drivers", methods=["GET"])
@handle_database_errors
def get_drivers():
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT d.*, a.plate_number, a.status AS ambulance_status, a.hospital_id
            FROM drivers d
            JOIN ambulances a ON d.ambulance_id = a.ambulance_id
        """)
        data = cursor.fetchall()
        logger.debug(f"📊 Retrieved {len(data)} drivers")
        return jsonify(data)
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route("/active_emergencies", methods=["GET"])
@handle_database_errors
def get_active_emergencies():
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT er.*, a.plate_number, d.name AS driver_name, dl.distance_km, dl.eta_min, a.hospital_id,
                   dl.dispatch_time, dl.completed_at
            FROM emergency_requests er
            JOIN dispatch_log dl ON er.request_id = dl.request_id
            JOIN ambulances a ON dl.ambulance_id = a.ambulance_id
            JOIN drivers d ON a.ambulance_id = d.ambulance_id
            WHERE er.status = 'assigned' AND dl.completed_at IS NULL
            ORDER BY er.request_time DESC
        """)
        data = cursor.fetchall()

        for row in data:
            row['request_time'] = safe_isoformat(row.get('request_time'))
            row['dispatch_time'] = safe_isoformat(row.get('dispatch_time'))

        logger.debug(f"📊 Retrieved {len(data)} active emergencies")
        return jsonify(data)
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route('/driver_status/<int:driver_id>', methods=['GET'])
@handle_database_errors
def get_driver_status(driver_id):
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT d.status, d.name, a.plate_number, a.hospital_id
            FROM drivers d
            JOIN ambulances a ON d.ambulance_id = a.ambulance_id
            WHERE d.driver_id = %s
        """, (driver_id,))
        driver = cursor.fetchone()
        if driver:
            return jsonify({
                'success': True,
                'status': driver['status'],
                'name': driver['name'],
                'plate_number': driver['plate_number'],
                'hospital_id': driver['hospital_id']
            })
        else:
            return jsonify({'success': False, 'error': 'Driver not found'})
    except Exception as e:
        logger.error(f"❌ Driver status error: {e}")
        return jsonify({'success': False, 'error': str(e)})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- HOSPITAL FRONTEND ROUTES --------------------
@app.route("/hospital")
def hospital_dashboard():
    logger.info("🏥 Hospital dashboard accessed")
    return render_template("hospital.html")


@app.route("/hospital_login", methods=["POST"])
@handle_database_errors
def hospital_login():
    conn = cursor = None
    try:
        data = request.json
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()

        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT h.hospital_id, h.name AS hospital_name, h.location
            FROM hospital_users u
            JOIN hospitals h ON u.hospital_id = h.hospital_id
            WHERE u.username = %s AND u.password = %s
        """, (username, password))

        hospital = cursor.fetchone()
        if hospital:
            return jsonify({
                "success": True,
                "hospital_id": hospital["hospital_id"],
                "hospital_name": hospital["hospital_name"],
                "location": hospital.get("location", "Unknown Location"),
                "message": f"Welcome {hospital['hospital_name']}"
            })
        else:
            return jsonify({"success": False, "error": "Invalid username or password"}), 401
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# -------------------- DEBUG & HEALTH CHECK --------------------
@app.route("/debug_drivers", methods=['GET'])
@handle_database_errors
def debug_drivers():
    conn = cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT d.driver_id, d.name AS driver_name, d.username, d.status AS driver_status,
                   a.ambulance_id, a.plate_number, a.status AS ambulance_status,
                   a.latitude, a.longitude, a.hospital_id
            FROM drivers d
            JOIN ambulances a ON d.ambulance_id = a.ambulance_id
        """)
        drivers = cursor.fetchall()
        logger.info(f"🔧 Debug: Retrieved {len(drivers)} driver-ambulance records")
        return jsonify({'drivers': drivers})
    except Exception as e:
        logger.error(f"❌ Debug route error: {e}")
        return jsonify({'error': str(e)})
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


@app.route("/health", methods=["GET"])
def health_check():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        conn.close()
        return jsonify({
            "status": "healthy",
            "database": "connected",
            "timestamp": datetime.now().isoformat(),
            "service": "LifeLine Emergency Dispatch"
        })
    except Exception as e:
        logger.error(f"💔 Health check failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500


# -------------------- ERROR HANDLERS --------------------
@app.errorhandler(404)
def not_found(error):
    logger.warning(f"🔍 404 Error: {request.url}")
    return jsonify({"success": False, "error": "Endpoint not found"}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    logger.warning(f"🚫 405 Error: {request.method} {request.url}")
    return jsonify({"success": False, "error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_server_error(error):
    logger.error(f"💥 500 Error: {error}")
    return jsonify({"success": False, "error": "Internal server error"}), 500


# -------------------- RUN SERVER --------------------
if __name__ == "__main__":
    logger.info("🚀 Starting LifeLine Emergency Dispatch System...")
    logger.info("✅ Database pool size: 10 connections")
    logger.info("🗺️ GraphHopper API: Enabled")
    logger.info("🩺 Hospital Dashboard Endpoints: Active")
    logger.info("💚 Health check endpoint: /health")
    try:
        app.run(debug=True, threaded=True, host="0.0.0.0", port=5000)
    except Exception as e:
        logger.critical(f"❌ Failed to start server: {e}")
        raise
