# 10. PHỤ LỤC SQL

## 10.1 Khởi tạo DB
- File tham chiếu: `database/init.sql`

## 10.2 Lệnh migration
```bash
npm run migrate:schema-hardening
```

## 10.3 Dữ liệu mẫu để test
1. Tạo admin:
```bash
npm run seed:admin
```

2. Test critical flow:
```bash
npm run test:critical
```

3. Smoke auth flow:
```bash
npm run test:api-smoke
```

## 10.4 Ghi chú
- Nếu gặp `ECONNREFUSED 127.0.0.1:3306`, cần bật MySQL trước khi migrate/test.
