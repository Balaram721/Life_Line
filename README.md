# 🚑 LifeLine

## An Emergency Ambulance Dispatch System

It is a web-based Emergency Ambulance Dispatch System designed to efficiently manage ambulance allocation, driver coordination, and hospital communication during emergency situations. The system ensures faster response times using intelligent dispatch logic and route optimization.

---

## 📌 Project Overview

The LifeLine Emergency Ambulance Dispatch System is built to:

- Reduce emergency response time
- Automatically assign the nearest available ambulance
- Allow hospitals to monitor emergency cases
- Enable drivers to manage dispatch status
- Maintain real-time tracking and dispatch logs

This project demonstrates full-stack development using Flask, MySQL, and REST APIs.

---

## 🛠️ Tech Stack

Backend:
- Python
- Flask

Frontend:
- HTML
- CSS
- JavaScript

Database:
- MySQL

External API:
- GraphHopper Routing API (for distance & ETA calculation)

Server:
- Flask Development Server

---

## 📁 Project Structure

```bash
project_testing/
│
├── app.py
├── Ambulance_Dispatch_Database.sql
│
├── static/
│   ├── style.css
│   ├── script.js
│   └── hospital-static/
│       ├── hospital-styles.css
│       └── hospital-script.js
│
├── templates/
│   ├── index.html
│   └── hospital.html
│
└── README.md
```

---

## ✨ Features

- Emergency request registration
- Automatic nearest ambulance assignment
- Driver login & status update
- Hospital dashboard
- Distance and ETA calculation
- Active emergency monitoring
- Emergency completion workflow
- System health check endpoint
- Role-based access (Driver / Hospital)

---

## ⚙️ Installation & Setup Guide

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/your-username/ambulance-dispatch-system.git  
cd ambulance-dispatch-system  
```

---

### 2️⃣ Install Dependencies

Make sure Python 3.x is installed.
```bash
pip install flask mysql-connector-python requests  
```
---

### 3️⃣ Setup MySQL Database

Step 1: Create database
```bash
CREATE DATABASE ambulance_dispatch;
```
Step 2: Import the schema
```bash
mysql -u root -p ambulance_dispatch < Ambulance_Dispatch_Database.sql
```
Step 3: Update database credentials in app.py

Example:
```bash
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "your_password",
    "database": "ambulance_dispatch"
}
```
---

### 4️⃣ Configure GraphHopper API

1. Create account at https://www.graphhopper.com/
2. Generate an API key
3. Replace in app.py:
```bash
GRAPH_HOPPER_API_KEY = "your_api_key_here"
```
---

### 5️⃣ Run the Application
```bash
python app.py
```
Open in browser:
```bash
http://localhost:5000
```
---

## 🌐 Application Endpoints

GET  /                     -> Home Page  
GET  /hospital             -> Hospital Dashboard  
POST /driver_login         -> Driver Login  
POST /hospital_login       -> Hospital Login  
GET  /ambulances           -> View Ambulances  
GET  /requests             -> View Requests  
GET  /active_emergencies   -> Active Emergency Cases  
GET  /health               -> System Health Check  

---

## 🔄 System Workflow

1. User submits emergency request
2. System finds nearest available ambulance
3. Dispatch details are generated
4. Driver receives assignment
5. Ambulance proceeds to patient location
6. Emergency is marked completed
7. Database is updated automatically

---

## 🗄️ Database Design

Main Tables:

- emergency_requests
- ambulances
- drivers
- dispatch_log
- hospitals
- hospital_users

The system maintains relational integrity to ensure accurate tracking and reporting.

---

## 🧪 Testing

- Manual API testing using Postman
- UI testing through browser
- Database validation
- Basic system load testing

---

## 🚀 Future Enhancements

- Mobile application support
- Real-time GPS tracking
- AI-based route optimization
- SMS / Email notifications
- JWT-based authentication
- Analytics dashboard
- Cloud deployment (AWS / Render / Railway)

---

## 📜 License

This project is developed for educational purposes.
It can be modified and reused for learning and research.

---

## 👨‍💻 Author

Gummadi Balaram  

