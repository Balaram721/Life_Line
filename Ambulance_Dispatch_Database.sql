-- Create database
CREATE DATABASE ambulance_dispatch;
USE ambulance_dispatch;

-- ==================== TABLE CREATION ====================

-- Ambulances table
CREATE TABLE ambulances (
    ambulance_id INT AUTO_INCREMENT PRIMARY KEY,
    plate_number VARCHAR(20) UNIQUE NOT NULL,
    latitude FLOAT(9,6) NOT NULL,
    longitude FLOAT(9,6) NOT NULL,
    status ENUM('available', 'busy', 'maintenance') DEFAULT 'available'
);

-- Emergency requests table
CREATE TABLE emergency_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_name VARCHAR(100),
    latitude DECIMAL(9,6) NOT NULL,
    longitude DECIMAL(9,6) NOT NULL,
    request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'assigned', 'completed') DEFAULT 'pending'
);

-- Dispatch log
CREATE TABLE dispatch_log (
    dispatch_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT,
    ambulance_id INT,
    dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES emergency_requests(request_id),
    FOREIGN KEY (ambulance_id) REFERENCES ambulances(ambulance_id)
);

-- Status history (audit trail)
CREATE TABLE status_history (
    history_id INT AUTO_INCREMENT PRIMARY KEY,
    ambulance_id INT,
    old_status ENUM('available','busy','maintenance'),
    new_status ENUM('available','busy','maintenance'),
    change_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ambulance_id) REFERENCES ambulances(ambulance_id)
);

-- Spam tracker table 
CREATE TABLE suspicious_requests (
    suspicious_id INT AUTO_INCREMENT PRIMARY KEY,
    ip_address VARCHAR(45),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6),
    request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reason VARCHAR(255)
);

-- Drivers table
CREATE TABLE drivers (
    driver_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,  -- Store hashed passwords
    ambulance_id INT,
    name VARCHAR(100) NOT NULL,
    contact_number VARCHAR(20),
    status ENUM('available', 'busy', 'offline') DEFAULT 'offline',
    FOREIGN KEY (ambulance_id) REFERENCES ambulances(ambulance_id)
);

-- ==================== TABLE ALTERATIONS ====================

-- Update ambulances table to link with drivers
ALTER TABLE ambulances ADD COLUMN driver_id INT;
ALTER TABLE ambulances ADD FOREIGN KEY (driver_id) REFERENCES drivers(driver_id);

-- Add columns to emergency_requests table
ALTER TABLE emergency_requests 
ADD COLUMN emergency_type ENUM(
    'cardiac', 
    'accident', 
    'respiratory', 
    'stroke', 
    'other'
) DEFAULT 'other';

ALTER TABLE emergency_requests
ADD contact_number VARCHAR(20),
ADD notes TEXT,
ADD ip_address VARCHAR(45),
ADD flagged_for_review BOOLEAN DEFAULT FALSE;

-- Add columns to dispatch_log
ALTER TABLE dispatch_log 
ADD COLUMN distance_km DECIMAL(6,2) DEFAULT NULL,
ADD COLUMN eta_min INT DEFAULT NULL,
ADD COLUMN completed_at TIMESTAMP NULL,
ADD COLUMN completion_notes TEXT;

-- ==================== INDEXES ====================

CREATE INDEX idx_ambulance_status ON ambulances(status);
CREATE INDEX idx_requests_status ON emergency_requests(status);

-- ==================== FUNCTIONS ====================

-- Haversine distance calculation function
DELIMITER //
CREATE FUNCTION haversine(lat1 DECIMAL(10,6), lon1 DECIMAL(10,6),
                          lat2 DECIMAL(10,6), lon2 DECIMAL(10,6))
RETURNS DECIMAL(10,6)
DETERMINISTIC
BEGIN
    DECLARE r DECIMAL(10,6);
    SET r = 6371; -- Earth radius in KM
    RETURN r * 2 * ASIN(SQRT(POWER(SIN(RADIANS(lat2 - lat1)/2), 2) +
           COS(RADIANS(lat1)) * COS(RADIANS(lat2)) *
           POWER(SIN(RADIANS(lon2 - lon1)/2), 2)));
END//
DELIMITER ;

-- ==================== STORED PROCEDURES ====================

-- Stored Procedure to Assign Nearest Ambulance
DELIMITER //
CREATE PROCEDURE assign_nearest_ambulance(IN req_id INT)
BEGIN
    DECLARE nearest_amb_id INT;

    -- Find the nearest available ambulance
    SELECT ambulance_id INTO nearest_amb_id
    FROM (
        SELECT a.ambulance_id,
               haversine(r.latitude, r.longitude, a.latitude, a.longitude) AS distance_km
        FROM ambulances a
        JOIN emergency_requests r ON r.request_id = req_id
        WHERE a.status = 'available'
        ORDER BY distance_km ASC
        LIMIT 1
    ) AS nearest;

    -- Update ambulance status
    UPDATE ambulances SET status = 'busy' WHERE ambulance_id = nearest_amb_id;

    -- Update request status
    UPDATE emergency_requests SET status = 'assigned' WHERE request_id = req_id;

    -- Log dispatch
    INSERT INTO dispatch_log (request_id, ambulance_id) VALUES (req_id, nearest_amb_id);
END//
DELIMITER ;

-- Procedure to autoflag fake requests
DELIMITER //
CREATE PROCEDURE check_fake_requests(IN user_ip VARCHAR(45), IN lat DECIMAL(9,6), IN lon DECIMAL(9,6))
BEGIN
    DECLARE req_count INT;
    SELECT COUNT(*) INTO req_count
    FROM emergency_requests
    WHERE ip_address = user_ip
      AND request_time >= (NOW() - INTERVAL 5 MINUTE);

    IF req_count >= 3 THEN
        INSERT INTO suspicious_requests (ip_address, latitude, longitude, reason)
        VALUES (user_ip, lat, lon, 'Repeated requests from same IP within 5 minutes');
    END IF;
END//
DELIMITER ;

-- ==================== SAMPLE DATA INSERTION ====================

-- Insert sample ambulances
INSERT INTO ambulances (plate_number, latitude, longitude, status) VALUES
('AP09AB1234', 16.5062, 80.6480, 'available'),  -- Vijayawada center
('AP09XY5678', 16.5170, 80.6550, 'available'),  -- Near Benz Circle
('AP10CD9101', 16.5300, 80.6200, 'available');  -- Outskirts

-- Insert sample drivers
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_raj', 'password123', 'Raj Kumar', '9876543210', 1, 'available'),
('driver_suresh', 'password123', 'Suresh Reddy', '9876543211', 2, 'available'),
('driver_arun', 'password123', 'Arun Varma', '9876543212', 3, 'available');

-- Update ambulances with driver IDs
UPDATE ambulances SET driver_id = 1 WHERE ambulance_id = 1;
UPDATE ambulances SET driver_id = 2 WHERE ambulance_id = 2;
UPDATE ambulances SET driver_id = 3 WHERE ambulance_id = 3;

-- ==================== VERIFICATION QUERIES ====================

-- Verify function creation
SHOW FUNCTION STATUS WHERE Db = 'ambulance_dispatch'; 

-- Test haversine function
SELECT haversine(17.3850, 78.4867, 16.5062, 80.6480) AS distance_km;
SELECT haversine(17.3850, 78.4867, 17.3850, 78.4867) AS distance_km;



-- Add to existing ambulances table
ALTER TABLE ambulances ADD hospital_id INT;

-- Create hospitals table
CREATE TABLE hospitals (
    hospital_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100),
    location VARCHAR(255)
);
CREATE TABLE hospital_users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT,
    username VARCHAR(50),
    password VARCHAR(255)
);

INSERT INTO hospitals (name, location) VALUES ('Metro Hospital', 'Vijayawada');
UPDATE ambulances SET hospital_id = 1 WHERE ambulance_id IN (1,2,3);


-- Existing hospital_id = 1 (Metro Hospital, Vijayawada)

-- Vijayawada
INSERT INTO hospitals (name, location) VALUES
('LifeCare Hospital', 'Benz Circle, Vijayawada'),
('Sunshine Hospital', 'Auto Nagar, Vijayawada');

-- Guntur
INSERT INTO hospitals (name, location) VALUES
('StarCare Hospital', 'Arundelpet, Guntur'),
('HopeWell Hospital', 'Brodipet, Guntur'),
('CityLife Hospital', 'Lakshmipuram, Guntur');

-- Hyderabad
INSERT INTO hospitals (name, location) VALUES
('Aster Hospital', 'Banjara Hills, Hyderabad'),
('Medicity Hospital', 'Kukatpally, Hyderabad'),
('Rainbow Hospital', 'Hitech City, Hyderabad');

-- Bangalore
INSERT INTO hospitals (name, location) VALUES
('Apollo Hospital', 'Jayanagar, Bangalore'),
('Fortis Hospital', 'Bannerghatta Road, Bangalore'),
('Manipal Hospital', 'Whitefield, Bangalore');

-- Mumbai
INSERT INTO hospitals (name, location) VALUES
('Nanavati Hospital', 'Vile Parle, Mumbai'),
('Kokilaben Hospital', 'Andheri West, Mumbai'),
('Hinduja Hospital', 'Mahim, Mumbai');

-- Delhi
INSERT INTO hospitals (name, location) VALUES
('AIIMS Hospital', 'Ansari Nagar, Delhi'),
('Max Hospital', 'Saket, Delhi'),
('Fortis Hospital', 'Shalimar Bagh, Delhi');

-- Chennai
INSERT INTO hospitals (name, location) VALUES
('Apollo Hospital', 'Greams Road, Chennai'),
('Kauvery Hospital', 'Alwarpet, Chennai'),
('Global Hospital', 'Perumbakkam, Chennai');

-- Vijayawada (Hospitals 2, 3)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('AP09VV1001', 16.5065, 80.6485, 'available', 2),
('AP09VV1002', 16.5200, 80.6400, 'available', 2),
('AP09VV1003', 16.5120, 80.6550, 'available', 2),
('AP09VV2001', 16.5100, 80.6600, 'available', 3),
('AP09VV2002', 16.5155, 80.6505, 'available', 3),
('AP09VV2003', 16.5250, 80.6450, 'available', 3);

-- Guntur (Hospitals 4–6)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('AP07GT1001', 16.3000, 80.4400, 'available', 4),
('AP07GT1002', 16.3150, 80.4500, 'available', 4),
('AP07GT1003', 16.3250, 80.4300, 'available', 4),
('AP07GT2001', 16.2950, 80.4350, 'available', 5),
('AP07GT2002', 16.3050, 80.4250, 'available', 5),
('AP07GT2003', 16.3150, 80.4200, 'available', 5),
('AP07GT3001', 16.3200, 80.4600, 'available', 6),
('AP07GT3002', 16.3250, 80.4700, 'available', 6),
('AP07GT3003', 16.3300, 80.4500, 'available', 6);

-- Hyderabad (Hospitals 7–9)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('TS09HY1001', 17.3850, 78.4867, 'available', 7),
('TS09HY1002', 17.4000, 78.4900, 'available', 7),
('TS09HY1003', 17.3950, 78.4800, 'available', 7),
('TS09HY2001', 17.4500, 78.4000, 'available', 8),
('TS09HY2002', 17.4550, 78.4050, 'available', 8),
('TS09HY2003', 17.4600, 78.4100, 'available', 8),
('TS09HY3001', 17.4200, 78.3800, 'available', 9),
('TS09HY3002', 17.4250, 78.3850, 'available', 9),
('TS09HY3003', 17.4300, 78.3900, 'available', 9);

-- Bangalore (Hospitals 10–12)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('KA05BL1001', 12.9716, 77.5946, 'available', 10),
('KA05BL1002', 12.9750, 77.6000, 'available', 10),
('KA05BL1003', 12.9800, 77.6100, 'available', 10),
('KA05BL2001', 12.9300, 77.5800, 'available', 11),
('KA05BL2002', 12.9350, 77.5850, 'available', 11),
('KA05BL2003', 12.9400, 77.5900, 'available', 11),
('KA05BL3001', 12.9900, 77.6200, 'available', 12),
('KA05BL3002', 12.9950, 77.6250, 'available', 12),
('KA05BL3003', 13.0000, 77.6300, 'available', 12);

-- Mumbai (Hospitals 13–15)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('MH01MB1001', 19.0760, 72.8777, 'available', 13),
('MH01MB1002', 19.0800, 72.8800, 'available', 13),
('MH01MB1003', 19.0850, 72.8850, 'available', 13),
('MH01MB2001', 19.1200, 72.8500, 'available', 14),
('MH01MB2002', 19.1300, 72.8600, 'available', 14),
('MH01MB2003', 19.1400, 72.8700, 'available', 14),
('MH01MB3001', 19.1000, 72.8900, 'available', 15),
('MH01MB3002', 19.1100, 72.8950, 'available', 15),
('MH01MB3003', 19.1150, 72.9000, 'available', 15);

-- Delhi (Hospitals 16–18)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('DL01DL1001', 28.6139, 77.2090, 'available', 16),
('DL01DL1002', 28.6200, 77.2200, 'available', 16),
('DL01DL1003', 28.6300, 77.2300, 'available', 16),
('DL01DL2001', 28.7000, 77.1200, 'available', 17),
('DL01DL2002', 28.7100, 77.1300, 'available', 17),
('DL01DL2003', 28.7200, 77.1400, 'available', 17),
('DL01DL3001', 28.6400, 77.2000, 'available', 18),
('DL01DL3002', 28.6500, 77.2100, 'available', 18),
('DL01DL3003', 28.6600, 77.2200, 'available', 18);

-- Chennai (Hospitals 19–21)
INSERT INTO ambulances (plate_number, latitude, longitude, status, hospital_id) VALUES
('TN01CH1001', 13.0827, 80.2707, 'available', 19),
('TN01CH1002', 13.0900, 80.2750, 'available', 19),
('TN01CH1003', 13.0950, 80.2800, 'available', 19),
('TN01CH2001', 13.0500, 80.2400, 'available', 20),
('TN01CH2002', 13.0550, 80.2500, 'available', 20),
('TN01CH2003', 13.0600, 80.2600, 'available', 20),
('TN01CH3001', 13.1000, 80.2900, 'available', 21),
('TN01CH3002', 13.1100, 80.2950, 'available', 21),
('TN01CH3003', 13.1200, 80.3000, 'available', 21);

-- Vijayawada (hospitals 2–3)
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_venkat', 'password123', 'Venkat Rao', '9000010001', 4, 'available'),
('driver_rahul', 'password123', 'Rahul Dev', '9000010002', 5, 'available'),
('driver_shiva', 'password123', 'Shiva Teja', '9000010003', 6, 'available'),
('driver_ramesh', 'password123', 'Ramesh G', '9000010004', 7, 'available'),
('driver_naveen', 'password123', 'Naveen Kumar', '9000010005', 8, 'available'),
('driver_arif', 'password123', 'Arif Khan', '9000010006', 9, 'available');

-- Guntur
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_gopi', 'password123', 'Gopi Krishna', '9000020001', 10, 'available'),
('driver_akhil', 'password123', 'Akhil Varma', '9000020002', 11, 'available'),
('driver_santosh', 'password123', 'Santosh Kumar', '9000020003', 12, 'available'),
('driver_sai', 'password123', 'Sai Ram', '9000020004', 13, 'available'),
('driver_pavan', 'password123', 'Pavan Reddy', '9000020005', 14, 'available'),
('driver_hari', 'password123', 'Hari Krishna', '9000020006', 15, 'available'),
('driver_vamsi', 'password123', 'Vamsi Babu', '9000020007', 16, 'available'),
('driver_karan', 'password123', 'Karan Kumar', '9000020008', 17, 'available'),
('driver_sudeep', 'password123', 'Sudeep Rao', '9000020009', 18, 'available');

-- Hyderabad
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_ashok', 'password123', 'Ashok Rao', '9000030001', 19, 'available'),
('driver_vinay', 'password123', 'Vinay Patil', '9000030002', 20, 'available'),
('driver_sachin', 'password123', 'Sachin Naidu', '9000030003', 21, 'available'),
('driver_mahesh', 'password123', 'Mahesh K', '9000030004', 22, 'available'),
('driver_praveen', 'password123', 'Praveen R', '9000030005', 23, 'available'),
('driver_lokesh', 'password123', 'Lokesh M', '9000030006', 24, 'available'),
('driver_sridhar', 'password123', 'Sridhar Rao', '9000030007', 25, 'available'),
('driver_sunil', 'password123', 'Sunil Y', '9000030008', 26, 'available'),
('driver_nikhil', 'password123', 'Nikhil P', '9000030009', 27, 'available');

-- Bangalore
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_arjun', 'password123', 'Arjun R', '9000040001', 28, 'available'),
('driver_keshav', 'password123', 'Keshav R', '9000040002', 29, 'available'),
('driver_srinath', 'password123', 'Srinath M', '9000040003', 30, 'available'),
('driver_ravi', 'password123', 'Ravi Kumar', '9000040004', 31, 'available'),
('driver_balaji', 'password123', 'Balaji T', '9000040005', 32, 'available'),
('driver_manoj', 'password123', 'Manoj S', '9000040006', 33, 'available'),
('driver_naveenblr', 'password123', 'Naveen BLR', '9000040007', 34, 'available'),
('driver_prakash', 'password123', 'Prakash J', '9000040008', 35, 'available'),
('driver_santoshblr', 'password123', 'Santosh BLR', '9000040009', 36, 'available');

-- Mumbai
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_rajiv', 'password123', 'Rajiv M', '9000050001', 37, 'available'),
('driver_ameer', 'password123', 'Ameer S', '9000050002', 38, 'available'),
('driver_vikas', 'password123', 'Vikas K', '9000050003', 39, 'available'),
('driver_rahman', 'password123', 'Rahman U', '9000050004', 40, 'available'),
('driver_patel', 'password123', 'Patel R', '9000050005', 41, 'available'),
('driver_salim', 'password123', 'Salim A', '9000050006', 42, 'available'),
('driver_sureshmum', 'password123', 'Suresh P', '9000050007', 43, 'available'),
('driver_anil', 'password123', 'Anil K', '9000050008', 44, 'available'),
('driver_shankar', 'password123', 'Shankar L', '9000050009', 45, 'available');

-- Delhi
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_manojdl', 'password123', 'Manoj DL', '9000060001', 46, 'available'),
('driver_rakesh', 'password123', 'Rakesh DL', '9000060002', 47, 'available'),
('driver_sanjay', 'password123', 'Sanjay DL', '9000060003', 48, 'available'),
('driver_dilip', 'password123', 'Dilip DL', '9000060004', 49, 'available'),
('driver_hemant', 'password123', 'Hemant DL', '9000060005', 50, 'available'),
('driver_ajay', 'password123', 'Ajay DL', '9000060006', 51, 'available'),
('driver_sumit', 'password123', 'Sumit DL', '9000060007', 52, 'available'),
('driver_varun', 'password123', 'Varun DL', '9000060008', 53, 'available'),
('driver_puneet', 'password123', 'Puneet DL', '9000060009', 54, 'available');

-- Chennai
INSERT INTO drivers (username, password, name, contact_number, ambulance_id, status) VALUES
('driver_arul', 'password123', 'Arul C', '9000070001', 55, 'available'),
('driver_saravanan', 'password123', 'Saravanan T', '9000070002', 56, 'available'),
('driver_karthik', 'password123', 'Karthik P', '9000070003', 57, 'available'),
('driver_muthu', 'password123', 'Muthu R', '9000070004', 58, 'available'),
('driver_vijay', 'password123', 'Vijay S', '9000070005', 59, 'available'),
('driver_mani', 'password123', 'Mani K', '9000070006', 60, 'available'),
('driver_ganesh', 'password123', 'Ganesh V', '9000070007', 61, 'available'),
('driver_dinesh', 'password123', 'Dinesh T', '9000070008', 62, 'available'),
('driver_rajachn', 'password123', 'Raja C', '9000070009', 63, 'available');


-- Vijayawada (Hospitals 1–3)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(1, 'metro_vij', 'Metro@826'),
(2, 'lifecare_vij', 'LifeVij@09'),
(3, 'sunshine_vij', 'SunVij#45');

-- Guntur (Hospitals 4–6)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(4, 'starcare_gnt', 'StarGnt@11'),
(5, 'hopewell_gnt', 'HopeGnt#22'),
(6, 'citylife_gnt', 'CityGnt@33');

-- Hyderabad (Hospitals 7–9)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(7, 'aster_hyd', 'AsterHyd@77'),
(8, 'medicity_hyd', 'MediHyd#88'),
(9, 'rainbow_hyd', 'RainHyd@99');

-- Bangalore (Hospitals 10–12)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(10, 'apollo_blr', 'ApBlr@10'),
(11, 'fortis_blr', 'ForBlr#20'),
(12, 'manipal_blr', 'ManBlr@30');

-- Mumbai (Hospitals 13–15)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(13, 'nanavati_mum', 'NanaMum@13'),
(14, 'kokilaben_mum', 'KokiMum#14'),
(15, 'hinduja_mum', 'HindMum@15');

-- Delhi (Hospitals 16–18)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(16, 'aiims_del', 'AiimsDel@16'),
(17, 'max_del', 'MaxDel#17'),
(18, 'fortis_del', 'ForDel@18');

-- Chennai (Hospitals 19–21)
INSERT INTO hospital_users (hospital_id, username, password) VALUES
(19, 'apollo_chn', 'ApoChn@19'),
(20, 'kauvery_chn', 'KauChn#20'),
(21, 'global_chn', 'GloChn@21');


SELECT a.ambulance_id, a.plate_number, a.hospital_id, h.name AS hospital_name
FROM ambulances a
LEFT JOIN hospitals h ON a.hospital_id = h.hospital_id
WHERE a.plate_number = 'AP09VV2003';

SELECT driver_id, name, ambulance_id 
FROM drivers 
WHERE ambulance_id IS NOT NULL;

SET SQL_SAFE_UPDATES = 0;

UPDATE ambulances a
JOIN drivers d ON a.ambulance_id = d.ambulance_id
SET a.driver_id = d.driver_id;

SET SQL_SAFE_UPDATES = 1;

SELECT 
    a.ambulance_id,
    a.plate_number,
    d.name AS driver_name,
    h.name AS hospital_name
FROM ambulances a
LEFT JOIN drivers d ON a.driver_id = d.driver_id
LEFT JOIN hospitals h ON a.hospital_id = h.hospital_id
ORDER BY a.ambulance_id
LIMIT 10;

ALTER TABLE hospitals ADD COLUMN city VARCHAR(100);

-- Vijayawada
UPDATE hospitals SET city = 'Vijayawada' WHERE hospital_id IN (1,2,3);

-- Guntur
UPDATE hospitals SET city = 'Guntur' WHERE hospital_id IN (4,5,6);

-- Hyderabad
UPDATE hospitals SET city = 'Hyderabad' WHERE hospital_id IN (7,8,9);

-- Bangalore
UPDATE hospitals SET city = 'Bangalore' WHERE hospital_id IN (10,11,12);

-- Mumbai
UPDATE hospitals SET city = 'Mumbai' WHERE hospital_id IN (13,14,15);

-- Delhi
UPDATE hospitals SET city = 'Delhi' WHERE hospital_id IN (16,17,18);

-- Chennai
UPDATE hospitals SET city = 'Chennai' WHERE hospital_id IN (19,20,21);

SELECT hospital_id, name, location, city FROM hospitals;

SELECT 
    a.plate_number,
    d.name AS driver_name,
    h.name AS hospital_name,
    h.city
FROM ambulances a
JOIN drivers d ON a.driver_id = d.driver_id
JOIN hospitals h ON a.hospital_id = h.hospital_id
ORDER BY h.city, a.plate_number
LIMIT 15;

SELECT h.city, COUNT(a.ambulance_id) AS amb_count
FROM hospitals h
JOIN ambulances a ON h.hospital_id = a.hospital_id
GROUP BY h.city;

-- Verify table structures
DESCRIBE emergency_requests;

-- View sample data
SELECT * FROM ambulances;
SELECT * FROM drivers;
SELECT * FROM emergency_requests;
SELECT * FROM dispatch_log;

SELECT dispatch_id, request_id, ambulance_id, completed_at, dispatch_time 
FROM dispatch_log 
ORDER BY dispatch_time DESC 
LIMIT 10;

