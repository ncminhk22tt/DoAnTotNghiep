# 3. PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG

## 3.1 Mô tả tổng quan hệ thống
- Hệ thống gồm các nhóm actor: Khách vãng lai, Bệnh nhân, Bác sĩ, Admin.
- API được chia theo namespace:
  - `/api/public/*`
  - `/api/auth/*`
  - `/api/patient/*`
  - `/api/doctor/*`
  - `/api/admin/*`

## 3.2 Tác nhân hệ thống
1. Khách vãng lai: xem chuyên khoa, danh sách bác sĩ, lịch trống.
2. Bệnh nhân: đặt/hủy lịch, xem lịch hẹn, cập nhật profile.
3. Bác sĩ: tạo lịch làm việc, xem lịch hẹn, khám bệnh, kê đơn.
4. Admin: quản lý users/chuyên khoa/dịch vụ/lịch hẹn/thống kê.

## 3.3 Luồng nghiệp vụ chính
1. Đăng nhập -> lấy token -> gọi API theo role.
2. Patient đặt lịch -> lock slot -> check trùng giờ -> tạo appointment.
3. Doctor xử lý lịch hẹn -> cập nhật trạng thái -> ghi hồ sơ bệnh án.
4. Admin tạo/setup doctor -> gán specialty + services.

## 3.4 Bảo mật và phân quyền
- `proxy.ts` chặn toàn bộ API private.
- Access token bắt buộc cho API private.
- Kiểm tra role cho `/api/admin` và `/api/doctor`.
