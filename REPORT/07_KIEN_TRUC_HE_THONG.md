# 6. KIẾN TRÚC HỆ THỐNG

## 6.1 Mô hình tổng thể
- Kiến trúc Client - Server.
- Frontend/Backend cùng nằm trong Next.js App Router.
- DB tách riêng trên MySQL.

## 6.2 Tầng xử lý
1. Presentation: giao diện web.
2. API Layer: `src/app/api/*`.
3. Service/Helper Layer: `src/lib/*`.
4. Data Layer: MySQL.

## 6.3 Cơ chế bảo mật
- Proxy check token trước khi vào API private.
- Role-based access:
  - `/api/admin/*` chỉ admin
  - `/api/doctor/*` chỉ doctor
- Password hash bằng bcrypt.

## 6.4 Tính nhất quán dữ liệu
- Đặt/hủy lịch dùng transaction.
- Sử dụng `FOR UPDATE` khi lock slot.
