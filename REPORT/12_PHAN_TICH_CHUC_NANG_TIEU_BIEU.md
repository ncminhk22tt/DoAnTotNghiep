# 12. PHÂN TÍCH CHỨC NĂNG TIÊU BIỂU VÀ MỞ RỘNG

## 1. Đăng ký tài khoản

**Mô tả:**  
Người dùng nhập thông tin cơ bản để tạo tài khoản bệnh nhân.

**API:**  
`POST /api/auth/register`

**Xử lý:**  
- Kiểm tra dữ liệu bắt buộc (`username`, `password`, `full_name`).  
- Chuẩn hóa chuỗi nhập vào (`trim`).  
- Mã hóa mật khẩu bằng `bcrypt`.  
- Lưu vào bảng `users` với `role = 'patient'`.  
- Bắt lỗi trùng dữ liệu (`ER_DUP_ENTRY`).

---

## 2. Đăng nhập hệ thống

**Mô tả:**  
Người dùng đăng nhập để nhận token truy cập API theo vai trò.

**API:**  
`POST /api/auth/login`

**Xử lý:**  
- Kiểm tra tần suất đăng nhập (rate limit).  
- Kiểm tra `username`, `password`.  
- Truy vấn user theo `username`.  
- So sánh mật khẩu bằng `bcrypt.compare`.  
- Kiểm tra trạng thái tài khoản (`active`).  
- Tạo `access token` và `refresh token`.  
- Ghi log vào `audit_logs`.

---

## 3. Đặt lịch khám

**Mô tả:**  
Bệnh nhân chọn slot khám còn trống và tạo lịch hẹn.

**API:**  
`POST /api/patient/appointments`

**Xử lý:**  
- Xác thực vai trò `patient`.  
- Validate `slot_id`.  
- Mở transaction và lock slot (`FOR UPDATE`).  
- Kiểm tra slot hợp lệ (chưa đầy, chưa đóng, chưa quá giờ).  
- Kiểm tra bệnh nhân không bị trùng giờ khám.  
- Tăng `booked_count`, cập nhật trạng thái `full` nếu cần.  
- Tạo bản ghi `appointments` trạng thái `pending`.  
- Commit transaction.

---

## 4. Hủy lịch khám

**Mô tả:**  
Bệnh nhân hủy lịch đã đặt khi lịch còn ở trạng thái cho phép.

**API:**  
`PATCH /api/patient/appointments`

**Xử lý:**  
- Xác thực vai trò `patient`.  
- Validate `appointment_id`.  
- Mở transaction, lock appointment và slot liên quan.  
- Kiểm tra quyền sở hữu lịch.  
- Chỉ cho hủy khi `pending` hoặc `confirmed`.  
- Cập nhật appointment thành `cancelled`.  
- Giảm `booked_count`, mở lại slot nếu trước đó `full`.  
- Commit transaction.

---

## 5. Bác sĩ tạo lịch làm việc

**Mô tả:**  
Bác sĩ tạo nhiều slot khám từ một khung giờ trong ngày.

**API:**  
`POST /api/doctor/schedules`

**Xử lý:**  
- Xác thực vai trò `doctor`.  
- Validate dữ liệu (`work_date`, `start_time`, `end_time`, `slot_duration`, `service_id`).  
- Sinh danh sách slot bằng `generateSlots`.  
- Kiểm tra `service_id` có thuộc bác sĩ.  
- Insert hàng loạt vào `doctor_schedule_slots`.  
- Bắt lỗi trùng slot (`ER_DUP_ENTRY`).

---

## 6. Bác sĩ cập nhật kết quả khám

**Mô tả:**  
Bác sĩ lưu chẩn đoán cho lịch hẹn và hoàn tất lượt khám.

**API:**  
`POST /api/doctor/appointments/{id}/exam`

**Xử lý:**  
- Xác thực vai trò `doctor`.  
- Parse `appointment_id` từ URL.  
- Validate dữ liệu khám (`diagnosis`, `notes`).  
- Kiểm tra lịch hẹn thuộc đúng bác sĩ.  
- Tạo/cập nhật `medical_records`.  
- Cập nhật trạng thái appointment sang `completed`.

---

## 7. Làm mới phiên đăng nhập

**Mô tả:**  
Cấp lại access token khi access token cũ hết hạn.

**API:**  
`POST /api/auth/refresh`

**Xử lý:**  
- Nhận `refresh_token`.  
- Xác minh chữ ký và hạn token.  
- Đối chiếu token với bảng lưu refresh token.  
- Cấp access token mới.  
- Có thể xoay vòng refresh token theo cấu hình bảo mật.

---

## 8. Đăng xuất

**Mô tả:**  
Kết thúc phiên đăng nhập hiện tại.

**API:**  
`POST /api/auth/logout`

**Xử lý:**  
- Nhận refresh token từ body/header/cookie.  
- Đánh dấu revoke trong bảng refresh token.  
- Trả kết quả đăng xuất thành công.

---

## 9. Quên mật khẩu

**Mô tả:**  
Người dùng yêu cầu cấp mã đặt lại mật khẩu.

**API:**  
`POST /api/auth/forgot-password`

**Xử lý:**  
- Kiểm tra username/email có tồn tại.  
- Tạo token đặt lại mật khẩu có hạn.  
- Lưu token hash và thời điểm hết hạn.  
- Trả token test hoặc gửi qua email tùy môi trường.

---

## 10. Đặt lại mật khẩu

**Mô tả:**  
Đổi mật khẩu bằng token từ luồng quên mật khẩu.

**API:**  
`POST /api/auth/reset-password`

**Xử lý:**  
- Validate token reset và thời hạn.  
- Hash mật khẩu mới bằng `bcrypt`.  
- Cập nhật vào `users`.  
- Thu hồi toàn bộ refresh token cũ của tài khoản.

---

## 11. Đổi mật khẩu khi đã đăng nhập

**Mô tả:**  
Người dùng chủ động đổi mật khẩu trong phần tài khoản.

**API:**  
`POST /api/auth/change-password`

**Xử lý:**  
- Xác thực token đăng nhập.  
- Kiểm tra mật khẩu cũ đúng.  
- Validate mật khẩu mới.  
- Hash và cập nhật mật khẩu mới.  
- Thu hồi các phiên đăng nhập cũ nếu cấu hình yêu cầu.

---

## 12. Xem và cập nhật hồ sơ cá nhân

**Mô tả:**  
Người dùng lấy thông tin hồ sơ và chỉnh sửa dữ liệu cá nhân.

**API:**  
- `GET /api/profile`  
- `PATCH /api/profile`

**Xử lý:**  
- Xác thực người dùng.  
- Truy vấn hồ sơ theo `user_id`.  
- Chỉ cho phép cập nhật các trường an toàn (`full_name`, `phone`, `email`, `avatar`).  
- Bắt lỗi trùng email/số điện thoại.

---

## 13. Admin tạo tài khoản bác sĩ

**Mô tả:**  
Admin tạo user role `doctor` và hồ sơ bác sĩ ban đầu.

**API:**  
`POST /api/admin/create-doctor`

**Xử lý:**  
- Xác thực vai trò `admin`.  
- Validate dữ liệu tạo tài khoản bác sĩ.  
- Hash mật khẩu.  
- Insert vào `users` (`role = doctor`).  
- Insert hồ sơ vào `doctors`.

---

## 14. Admin setup bác sĩ (tạo và xem danh sách)

**Mô tả:**  
Thiết lập chuyên khoa và dịch vụ cho bác sĩ, đồng thời xem danh sách đã setup.

**API:**  
- `POST /api/admin/doctors/setup`  
- `GET /api/admin/doctors/setup`

**Xử lý:**  
- Xác thực `admin`.  
- Validate `user_id`, `specialty_id`, `service_ids`.  
- Kiểm tra service thuộc specialty.  
- Tạo hồ sơ doctor (nếu chưa có), sinh `doctor_code` trong transaction.  
- Gán dịch vụ vào bảng liên kết `doctor_services`.  
- Truy vấn danh sách setup kèm tổng số dịch vụ.

---

## 15. Admin cập nhật/xóa setup bác sĩ

**Mô tả:**  
Cập nhật chuyên khoa, dịch vụ hoặc xóa cấu hình bác sĩ.

**API:**  
- `PUT /api/admin/doctors/setup/{id}`  
- `DELETE /api/admin/doctors/setup/{id}`

**Xử lý:**  
- Xác thực `admin`.  
- Validate `doctor_id` từ URL.  
- Với `PUT`: cập nhật specialty và danh sách service trong transaction.  
- Với `DELETE`: xóa liên kết dịch vụ, xóa hồ sơ setup theo quy tắc hệ thống.

---

## 16. Admin quản lý người dùng

**Mô tả:**  
Admin xem danh sách bệnh nhân và cập nhật trạng thái tài khoản.

**API:**  
- `GET /api/admin/users`  
- `PATCH /api/admin/users/{id}`

**Xử lý:**  
- Xác thực `admin`.  
- Lọc danh sách đúng vai trò cần quản lý (patient).  
- Cập nhật `status` (`active`, `inactive`, `banned`) theo user cụ thể.

---

## 17. Admin CRUD chuyên khoa

**Mô tả:**  
Tạo, xem danh sách, sửa, xóa chuyên khoa khám.

**API:**  
- `GET /api/admin/specialties`  
- `POST /api/admin/specialties`  
- `PATCH /api/admin/specialties/{id}`  
- `DELETE /api/admin/specialties/{id}`

**Xử lý:**  
- Xác thực `admin`.  
- Validate tên chuyên khoa.  
- Kiểm tra trùng tên trước khi tạo/sửa.  
- Chặn xóa khi còn dữ liệu phụ thuộc (nếu có ràng buộc).

---

## 18. Admin CRUD dịch vụ

**Mô tả:**  
Quản lý danh mục dịch vụ khám gắn với chuyên khoa.

**API:**  
- `GET /api/admin/services`  
- `POST /api/admin/services`  
- `PATCH /api/admin/services/{id}`  
- `DELETE /api/admin/services/{id}`

**Xử lý:**  
- Xác thực `admin`.  
- Validate `name`, `description`, `specialty_id`.  
- Kiểm tra specialty tồn tại.  
- Thực hiện CRUD và bắt lỗi ràng buộc khóa ngoại.

---

## 19. Admin quản lý lịch hẹn toàn hệ thống

**Mô tả:**  
Admin xem danh sách lịch hẹn và đổi trạng thái khi cần.

**API:**  
- `GET /api/admin/appointments`  
- `PATCH /api/admin/appointments/{id}`

**Xử lý:**  
- Xác thực `admin`.  
- Lọc theo ngày/trạng thái/bác sĩ nếu có query.  
- Cập nhật trạng thái hợp lệ theo luồng nghiệp vụ.

---

## 20. Admin gửi thông báo hệ thống

**Mô tả:**  
Gửi thông báo cho một người dùng hoặc nhóm người dùng.

**API:**  
`POST /api/admin/notifications`

**Xử lý:**  
- Xác thực `admin`.  
- Validate nội dung thông báo.  
- Insert vào bảng `notifications` theo danh sách người nhận.

---

## 21. Admin xem nhật ký hệ thống

**Mô tả:**  
Theo dõi hoạt động nhạy cảm để kiểm tra và audit.

**API:**  
`GET /api/admin/audit-logs`

**Xử lý:**  
- Xác thực `admin`.  
- Lọc theo actor, hành động, khoảng thời gian.  
- Trả dữ liệu phân trang phục vụ tra cứu.

---

## 22. Admin xem báo cáo tổng quan

**Mô tả:**  
Xem số liệu tổng hợp phục vụ quản trị vận hành.

**API:**  
`GET /api/admin/reports/overview`

**Xử lý:**  
- Xác thực `admin`.  
- Tổng hợp số bác sĩ, bệnh nhân, lịch hẹn theo trạng thái, tỉ lệ hoàn tất.  
- Trả dữ liệu dạng dashboard.

---

## 23. Bác sĩ quản lý lịch hẹn của mình

**Mô tả:**  
Bác sĩ xem danh sách lịch hẹn, xem chi tiết và cập nhật trạng thái.

**API:**  
- `GET /api/doctor/appointments`  
- `GET /api/doctor/appointments/{id}`  
- `PATCH /api/doctor/appointments/{id}`

**Xử lý:**  
- Xác thực `doctor`.  
- Chỉ truy cập lịch hẹn thuộc bác sĩ hiện tại.  
- Cập nhật trạng thái hợp lệ (`confirmed`, `cancelled`, `completed`).

---

## 24. Bác sĩ CRUD slot lịch làm việc

**Mô tả:**  
Bác sĩ xem chi tiết, sửa, xóa slot lịch làm việc.

**API:**  
- `GET /api/doctor/schedules/{id}`  
- `PUT /api/doctor/schedules/{id}`  
- `DELETE /api/doctor/schedules/{id}`

**Xử lý:**  
- Xác thực `doctor`.  
- Chỉ cho thao tác slot thuộc bác sĩ.  
- Chặn sửa/xóa slot đã có lịch hẹn tùy quy tắc nghiệp vụ.

---

## 25. Bác sĩ quản lý hồ sơ bệnh án

**Mô tả:**  
Bác sĩ xem danh sách bệnh án, cập nhật hoặc xóa bản ghi.

**API:**  
- `GET /api/doctor/medical-records`  
- `PATCH /api/doctor/medical-records/{id}`  
- `DELETE /api/doctor/medical-records/{id}`

**Xử lý:**  
- Xác thực `doctor`.  
- Kiểm tra quyền truy cập bệnh án thuộc ca khám của bác sĩ.  
- Cập nhật chuẩn đoán, ghi chú, hướng điều trị.

---

## 26. Bác sĩ quản lý đơn thuốc

**Mô tả:**  
Xem danh sách đơn theo bệnh án, tạo mới, sửa, xóa đơn thuốc.

**API:**  
- `GET /api/doctor/medical-records/{id}/prescriptions`  
- `POST /api/doctor/medical-records/{id}/prescriptions`  
- `PATCH /api/doctor/prescriptions/{id}`  
- `DELETE /api/doctor/prescriptions/{id}`

**Xử lý:**  
- Xác thực `doctor`.  
- Validate danh sách thuốc (`medicine_name`, `dosage`, `duration`).  
- Lưu vào `prescriptions` và `prescription_items` trong transaction.

---

## 27. Bác sĩ quản lý tệp đính kèm bệnh án

**Mô tả:**  
Bác sĩ tải lên và xem danh sách tệp liên quan hồ sơ khám.

**API:**  
- `GET /api/doctor/medical-records/{id}/files`  
- `POST /api/doctor/medical-records/{id}/files`

**Xử lý:**  
- Xác thực `doctor`.  
- Validate loại tệp và dung lượng.  
- Lưu metadata vào `medical_record_files`.  
- Trả đường dẫn/tên tệp để frontend hiển thị.

---

## 28. Bệnh nhân xem lịch hẹn của mình

**Mô tả:**  
Bệnh nhân xem toàn bộ lịch hẹn đã đặt.

**API:**  
`GET /api/patient/appointments`

**Xử lý:**  
- Xác thực `patient`.  
- Lọc theo `user_id` đăng nhập.  
- Join dữ liệu bác sĩ, chuyên khoa, khung giờ để hiển thị đầy đủ.

---

## 29. Quản lý thông báo người dùng

**Mô tả:**  
Người dùng nhận và đánh dấu đã đọc thông báo.

**API:**  
- `GET /api/notifications`  
- `PATCH /api/notifications`  
- `PATCH /api/notifications/{id}`

**Xử lý:**  
- Xác thực người dùng.  
- Lấy danh sách thông báo theo `user_id`.  
- Cập nhật `is_read` cho một thông báo hoặc đánh dấu hàng loạt.

---

## 30. Public API tra cứu dữ liệu khám

**Mô tả:**  
Phần không cần đăng nhập để tra cứu bác sĩ, chuyên khoa, dịch vụ.

**API:**  
- `GET /api/public/doctors`  
- `GET /api/public/doctors/{id}`  
- `GET /api/public/doctors/{id}/schedule`  
- `GET /api/public/specialties`  
- `GET /api/public/services`

**Xử lý:**  
- Truy vấn dữ liệu đã công khai.  
- Hỗ trợ lọc theo chuyên khoa/dịch vụ/từ khóa.  
- Chỉ trả các trường an toàn cho người dùng ngoài hệ thống.

---

## 31. Tác vụ hệ thống nhắc lịch hẹn

**Mô tả:**  
Tác vụ nội bộ chạy định kỳ để tạo/gửi nhắc lịch hẹn sắp tới.

**API:**  
`POST /api/system/reminders/appointments`

**Xử lý:**  
- Xác thực bằng khóa nội bộ hoặc secret hệ thống.  
- Quét các lịch hẹn sắp diễn ra.  
- Tạo bản ghi nhắc lịch vào `appointment_reminders` và `notifications`.  
- Chống gửi trùng theo khóa nghiệp vụ.

---

## 32. Bệnh nhân xem lịch sử khám chi tiết

**Mô tả:**  
Bệnh nhân xem lại toàn bộ kết quả khám đã có, gồm chẩn đoán, đơn thuốc và tệp đính kèm.

**API:**  
- `GET /api/patient/medical-records`  
- `GET /api/patient/medical-records/{id}`

**Xử lý:**  
- Xác thực vai trò `patient`.  
- Chỉ lấy hồ sơ khám thuộc đúng `user_id` đang đăng nhập.  
- Trả dữ liệu tổng hợp: thông tin lịch khám, bác sĩ, dịch vụ, chẩn đoán, ghi chú.  
- Join và gộp thêm danh sách `prescriptions/prescription_items` và `medical_record_files`.

---

## Ghi chú
- Tài liệu này đã mở rộng từ 6 chức năng tiêu biểu lên đầy đủ các chức năng backend hiện có.  
- Tất cả mục đều theo mẫu: **Mô tả → API → Xử lý**, thuận tiện đưa vào báo cáo đồ án.
