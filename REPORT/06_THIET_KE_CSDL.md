# 5. THIẾT KẾ CƠ SỞ DỮ LIỆU

## 5.1 Danh mục bảng dữ liệu
| STT | Tên bảng | Mục đích |
|---|---|---|
| 1 | `users` | Lưu tài khoản hệ thống (patient/doctor/admin) |
| 2 | `doctors` | Hồ sơ nghiệp vụ bác sĩ |
| 3 | `specialties` | Danh mục chuyên khoa |
| 4 | `services` | Danh mục dịch vụ khám |
| 5 | `doctor_services` | Ánh xạ bác sĩ - dịch vụ |
| 6 | `doctor_schedule_slots` | Slot lịch khám theo ngày/giờ |
| 7 | `appointments` | Lịch hẹn khám của bệnh nhân |
| 8 | `medical_records` | Hồ sơ khám bệnh |
| 9 | `prescriptions` | Đơn thuốc |
| 10 | `prescription_items` | Chi tiết thuốc trong đơn |
| 11 | `notifications` | Thông báo cho người dùng |
| 12 | `password_reset_tokens` | Token quên mật khẩu |
| 13 | `auth_refresh_tokens` | Phiên đăng nhập bằng refresh token |
| 14 | `audit_logs` | Nhật ký thao tác hệ thống |
| 15 | `medical_record_files` | Tệp đính kèm hồ sơ bệnh án |
| 16 | `appointment_reminders` | Đánh dấu nhắc lịch tự động |
| 17 | `code_sequences` | Bộ đếm sinh mã nghiệp vụ |

## 5.2 Mô tả chi tiết các bảng chính (định dạng 3 cột)

### Bảng `users`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã người dùng |
| `username` | VARCHAR(100) | UNIQUE, NOT NULL; tên đăng nhập |
| `password` | VARCHAR(255) | NOT NULL; mật khẩu đã băm |
| `full_name` | VARCHAR(100) | NOT NULL; họ tên |
| `email` | VARCHAR(100) | UNIQUE, NULL; email |
| `phone` | VARCHAR(20) | UNIQUE, NULL; số điện thoại |
| `avatar` | VARCHAR(255) | DEFAULT; ảnh đại diện |
| `role` | ENUM | NOT NULL; vai trò (`patient`,`doctor`,`admin`) |
| `status` | ENUM | NOT NULL; trạng thái tài khoản |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP; ngày tạo |
| `updated_at` | DATETIME | ON UPDATE; ngày cập nhật |

### Bảng `doctors`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã hồ sơ bác sĩ |
| `user_id` | BIGINT | FK logic tới `users.id`; liên kết tài khoản bác sĩ |
| `specialty_id` | BIGINT | FK logic tới `specialties.id`; chuyên khoa chính |
| `experience` | INT | NULL; số năm kinh nghiệm |
| `description` | TEXT | NULL; mô tả bác sĩ |
| `status` | ENUM | DEFAULT `pending`; trạng thái duyệt hồ sơ |
| `doctor_code` | VARCHAR(20) | UNIQUE; mã bác sĩ nghiệp vụ |

### Bảng `specialties`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã chuyên khoa |
| `name` | VARCHAR(100) | NULL/NOT NULL theo nghiệp vụ; tên chuyên khoa |
| `description` | TEXT | NULL; mô tả |

### Bảng `services`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã dịch vụ |
| `name` | VARCHAR(150) | UNIQUE, NOT NULL; tên dịch vụ |
| `specialty_id` | BIGINT | INDEX; chuyên khoa áp dụng |
| `description` | TEXT | NULL; mô tả dịch vụ |

### Bảng `doctor_services`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `doctor_id` | BIGINT | PK kép; mã bác sĩ |
| `service_id` | BIGINT | PK kép; mã dịch vụ |
| `specialty_id` | BIGINT | INDEX, NULL; chuyên khoa của cặp gán |

### Bảng `doctor_schedule_slots`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã slot lịch khám |
| `doctor_id` | BIGINT | INDEX, NOT NULL; bác sĩ phụ trách |
| `service_id` | BIGINT | INDEX, NOT NULL; dịch vụ khám |
| `work_date` | DATE | NOT NULL; ngày khám |
| `start_time` | TIME | NOT NULL; giờ bắt đầu |
| `end_time` | TIME | NOT NULL; giờ kết thúc |
| `room` | VARCHAR(50) | NULL; phòng khám |
| `price` | DECIMAL(10,2) | NULL; giá áp dụng tại slot |
| `max_patients` | INT | DEFAULT 1; số bệnh nhân tối đa |
| `booked_count` | INT | DEFAULT 0; số đã đặt |
| `status` | ENUM | DEFAULT `available`; trạng thái slot |

### Bảng `appointments`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã lịch hẹn |
| `user_id` | BIGINT | INDEX; bệnh nhân đặt lịch |
| `slot_id` | BIGINT | INDEX; slot được đặt |
| `doctor_id` | BIGINT | NULL; bác sĩ (backup dữ liệu) |
| `schedule_id` | BIGINT | NULL; tương thích dữ liệu cũ |
| `status` | ENUM | NULL/DEFAULT theo migration; trạng thái lịch hẹn |
| `note` | TEXT | NULL; ghi chú bệnh nhân |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP; thời điểm tạo |

### Bảng `medical_records`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã hồ sơ khám |
| `appointment_id` | BIGINT | INDEX; lịch hẹn liên quan |
| `diagnosis` | TEXT | NULL; chẩn đoán |
| `notes` | TEXT | NULL; ghi chú bác sĩ |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP; ngày tạo hồ sơ |

### Bảng `prescriptions`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã đơn thuốc |
| `medical_record_id` | BIGINT | INDEX; thuộc hồ sơ khám nào |

### Bảng `prescription_items`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã dòng thuốc |
| `prescription_id` | BIGINT | INDEX; thuộc đơn thuốc |
| `medicine_name` | VARCHAR(100) | NULL; tên thuốc |
| `dosage` | VARCHAR(100) | NULL; liều dùng |
| `duration` | VARCHAR(100) | NULL; thời gian dùng |

### Bảng `notifications`
| Trường | Kiểu dữ liệu | Mô tả + Ràng buộc |
|---|---|---|
| `id` | BIGINT | PK, AUTO_INCREMENT; mã thông báo |
| `user_id` | BIGINT | INDEX; người nhận |
| `message` | TEXT | NULL; nội dung |
| `is_read` | BOOLEAN | DEFAULT false; đã đọc/chưa đọc |
| `created_at` | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP; ngày tạo |

## 5.3 Mô tả bảng hỗ trợ bảo mật/vận hành
| Bảng | Trường cốt lõi | Mục đích |
|---|---|---|
| `password_reset_tokens` | `user_id`, `token`, `expires_at`, `used_at` | Quên mật khẩu |
| `auth_refresh_tokens` | `user_id`, `token_hash`, `jti`, `expires_at`, `revoked_at` | Quản lý phiên đăng nhập |
| `audit_logs` | `user_id`, `action`, `status`, `detail`, `created_at` | Nhật ký thao tác |
| `medical_record_files` | `medical_record_id`, `file_name`, `storage_path` | Lưu file bệnh án |
| `appointment_reminders` | `appointment_id`, `reminder_type`, `reminded_at` | Chống gửi nhắc lịch trùng |
| `code_sequences` | `type`, `year`, `current_value` | Sinh mã tăng dần theo năm |

## 5.4 Quan hệ dữ liệu chính
1. `users (doctor)` -> `doctors` theo `user_id` (1-1 logic).
2. `doctors` <-> `services` qua `doctor_services` (n-n).
3. `doctor_schedule_slots` gắn `doctor_id`, `service_id`.
4. `appointments` gắn `user_id`, `slot_id`, `doctor_id`.
5. `medical_records` gắn `appointment_id`.
6. `prescriptions` gắn `medical_record_id`.
7. `prescription_items` gắn `prescription_id`.

## 5.5 Ràng buộc nghiệp vụ quan trọng
- Slot không đặt trùng (`doctor_id + work_date + start_time` là duy nhất).
- Không đặt lịch trùng giờ cho 1 bệnh nhân.
- Không đặt vào slot đã `full` hoặc `closed`.
- Khi hủy lịch hợp lệ, `booked_count` được giảm an toàn bằng transaction.
