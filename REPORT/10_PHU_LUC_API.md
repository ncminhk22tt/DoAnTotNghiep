# 9. PHỤ LỤC API

## 9.1 Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/change-password`

## 9.2 Public
- `GET /api/public/specialties`
- `GET /api/public/services`
- `GET /api/public/doctors`
- `GET /api/public/doctors/{id}`
- `GET /api/public/doctors/{id}/schedule`

## 9.3 Patient
- `GET /api/patient/appointments`
- `POST /api/patient/appointments`
- `PATCH /api/patient/appointments`
- `GET /api/profile`
- `PATCH /api/profile`

## 9.4 Doctor
- `GET/POST /api/doctor/schedules`
- `GET/PUT/DELETE /api/doctor/schedules/{id}`
- `GET /api/doctor/appointments`
- `GET/PATCH /api/doctor/appointments/{id}`
- `POST /api/doctor/appointments/{id}/exam`
- `GET/POST /api/doctor/medical-records`
- `PATCH/DELETE /api/doctor/medical-records/{id}`
- `GET/POST /api/doctor/medical-records/{id}/files`
- `GET/POST /api/doctor/medical-records/{id}/prescriptions`
- `PATCH/DELETE /api/doctor/prescriptions/{id}`

## 9.5 Admin
- `GET /api/admin/users`
- `PATCH /api/admin/users/{id}`
- `GET/POST /api/admin/specialties`
- `GET/PUT/DELETE /api/admin/specialties/{id}`
- `GET/POST /api/admin/services`
- `GET/PUT/DELETE /api/admin/services/{id}`
- `POST /api/admin/create-doctor`
- `GET/POST /api/admin/doctors/setup`
- `PUT/DELETE /api/admin/doctors/setup/{id}`
- `GET /api/admin/appointments`
- `PATCH /api/admin/appointments/{id}`
- `GET /api/admin/reports/overview`

## 9.6 System
- `POST /api/system/reminders/appointments` (header `x-cron-secret`)
