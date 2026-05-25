# 7. KIỂM THỬ HỆ THỐNG

## 7.1 Mục tiêu kiểm thử
- Đảm bảo API hoạt động đúng nghiệp vụ.
- Đảm bảo phân quyền role chính xác.
- Đảm bảo đặt/hủy lịch không gây sai lệch booked_count.

## 7.2 Kịch bản kiểm thử chính
1. Auth:
   - Đăng nhập đúng/sai mật khẩu.
   - Refresh token.
2. Patient:
   - Đặt lịch thành công.
   - Đặt trùng giờ bị chặn.
   - Hủy lịch -> booked_count giảm.
3. Doctor:
   - Tạo slot.
   - Cập nhật trạng thái appointment.
4. Admin:
   - CRUD specialties/services.
   - Setup doctor.

## 7.3 Công cụ kiểm thử
- Postman cho API manual.
- Script:
  - `npm run test:critical`
  - `npm run test:api-smoke`

## 7.4 Kết quả tổng kết (điền số liệu)
- Tổng test case: `...`
- Pass: `...`
- Fail: `...`
- Lỗi đã sửa: `...`
