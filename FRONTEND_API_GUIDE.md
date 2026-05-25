# HƯỚNG DẪN API CHO FRONTEND (MEDICAL BOOKING)

## 1. Quy ước chung
- Base URL local: `http://localhost:3000`
- Header cho API cần đăng nhập: `Authorization: Bearer <access_token>`
- Định dạng phản hồi thành công thường có:
  - `success: true`
  - `message: string`
  - `data: ...`
- Định dạng lỗi thường có:
  - `success: false`
  - `message: string`

## 2. Luồng đăng nhập và phiên

### Màn hình: Đăng ký
- `POST /api/auth/register`
- Body mẫu:
```json
{
  "username": "patient01",
  "password": "123456",
  "full_name": "Nguyen Van A",
  "email": "a@gmail.com",
  "phone": "0900000001"
}
```

### Màn hình: Đăng nhập
- `POST /api/auth/login`
- Body mẫu:
```json
{
  "username": "patient01",
  "password": "123456"
}
```
- Kỳ vọng frontend lưu:
  - `access_token`
  - `refresh_token`
  - thông tin user (id, username, role)

### Tự làm mới token
- `POST /api/auth/refresh`
- Body mẫu:
```json
{
  "refresh_token": "<refresh_token>"
}
```

### Đăng xuất
- `POST /api/auth/logout`
- Body mẫu:
```json
{
  "refresh_token": "<refresh_token>"
}
```

### Đổi / quên mật khẩu
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

## 3. Hồ sơ cá nhân (mọi role)

### Màn hình: Thông tin cá nhân
- `GET /api/profile`

### Màn hình: Cập nhật hồ sơ
- `PATCH /api/profile`
- Body mẫu:
```json
{
  "full_name": "Nguyen Van A Updated",
  "email": "new@gmail.com",
  "phone": "0900000009",
  "avatar": "avatar.png"
}
```

## 4. Frontend bệnh nhân

### Màn hình: Danh sách bác sĩ/chuyên khoa/dịch vụ (public)
- `GET /api/public/doctors`
- `GET /api/public/doctors/{id}`
- `GET /api/public/doctors/{id}/schedule`
- `GET /api/public/specialties`
- `GET /api/public/services`

### Màn hình: Đặt lịch khám
- `POST /api/patient/appointments`
- Body mẫu:
```json
{
  "slot_id": 12,
  "note": "Dau hong 3 ngay"
}
```

### Màn hình: Lịch hẹn của tôi
- `GET /api/patient/appointments`
- Filter dùng query:
  - `?status=pending`
  - `?date=2026-03-31`

### Màn hình: Hủy lịch
- `PATCH /api/patient/appointments`
- Body mẫu:
```json
{
  "appointment_id": 25
}
```

### Màn hình: Lịch sử khám bệnh
- `GET /api/patient/medical-records`
- `GET /api/patient/medical-records/{id}`
- Dùng để hiển thị:
  - chẩn đoán (`diagnosis`, `notes`)
  - đơn thuốc (`prescriptions` + `items`)
  - file đính kèm (`files`)

### Màn hình: Thông báo cá nhân
- `GET /api/notifications`
- `PATCH /api/notifications` (đánh dấu đọc nhiều)
- `PATCH /api/notifications/{id}` (đánh dấu đọc 1 thông báo)

## 5. Frontend bác sĩ

### Màn hình: Lịch làm việc
- `GET /api/doctor/schedules`
- `POST /api/doctor/schedules`
- `GET /api/doctor/schedules/{id}`
- `PUT /api/doctor/schedules/{id}`
- `DELETE /api/doctor/schedules/{id}`

### Màn hình: Danh sách lịch hẹn bác sĩ
- `GET /api/doctor/appointments`
- `GET /api/doctor/appointments/{id}`
- `PATCH /api/doctor/appointments/{id}`

### Màn hình: Khám bệnh / cập nhật kết quả khám
- `POST /api/doctor/appointments/{id}/exam`

### Màn hình: Hồ sơ bệnh án
- `GET /api/doctor/medical-records`
- `PATCH /api/doctor/medical-records/{id}`
- `DELETE /api/doctor/medical-records/{id}`

### Màn hình: Đơn thuốc
- `GET /api/doctor/medical-records/{id}/prescriptions`
- `POST /api/doctor/medical-records/{id}/prescriptions`
- `PATCH /api/doctor/prescriptions/{id}`
- `DELETE /api/doctor/prescriptions/{id}`

### Màn hình: File bệnh án
- `GET /api/doctor/medical-records/{id}/files`
- `POST /api/doctor/medical-records/{id}/files`

## 6. Frontend admin

### Màn hình: Quản lý người dùng
- `GET /api/admin/users`
- `PATCH /api/admin/users/{id}`

### Màn hình: Tạo tài khoản bác sĩ
- `POST /api/admin/create-doctor`

### Màn hình: Setup bác sĩ - chuyên khoa - dịch vụ
- `GET /api/admin/doctors/setup`
- `POST /api/admin/doctors/setup`
- `PUT /api/admin/doctors/setup/{id}`
- `DELETE /api/admin/doctors/setup/{id}`

### Màn hình: Quản lý chuyên khoa
- `GET /api/admin/specialties`
- `POST /api/admin/specialties`
- `PATCH /api/admin/specialties/{id}`
- `DELETE /api/admin/specialties/{id}`

### Màn hình: Quản lý dịch vụ
- `GET /api/admin/services`
- `POST /api/admin/services`
- `PATCH /api/admin/services/{id}`
- `DELETE /api/admin/services/{id}`

### Màn hình: Quản lý lịch hẹn toàn hệ thống
- `GET /api/admin/appointments`
- `PATCH /api/admin/appointments/{id}`

### Màn hình: Thông báo hệ thống
- `POST /api/admin/notifications`

### Màn hình: Nhật ký hoạt động và báo cáo
- `GET /api/admin/audit-logs`
- `GET /api/admin/reports/overview`

## 7. Gợi ý mapping nhanh màn hình frontend
- `/login` -> `/api/auth/login`
- `/register` -> `/api/auth/register`
- `/patient/appointments` -> `GET/POST/PATCH /api/patient/appointments`
- `/patient/medical-records` -> `GET /api/patient/medical-records`
- `/patient/medical-records/[id]` -> `GET /api/patient/medical-records/{id}`
- `/doctor/schedules` -> nhóm `/api/doctor/schedules`
- `/doctor/appointments` -> nhóm `/api/doctor/appointments`
- `/admin/users` -> nhóm `/api/admin/users`
- `/admin/doctors/setup` -> nhóm `/api/admin/doctors/setup`
- `/admin/specialties` -> nhóm `/api/admin/specialties`
- `/admin/services` -> nhóm `/api/admin/services`

## 8. Việc frontend nên làm ngay
1. Tạo 1 `apiClient` chung tự gắn `Authorization`.
2. Tạo interceptor gọi `/api/auth/refresh` khi gặp `401`.
3. Chuẩn hóa toast theo `message` trả về từ backend.
4. Chặn route theo role ở frontend (`admin/doctor/patient`).
