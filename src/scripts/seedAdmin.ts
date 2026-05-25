import { db, hasTableColumn } from "@/lib/db";
import bcrypt from "bcrypt";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// Kieu dữ liệu can dung khi check admin ton tai
interface UserRow extends RowDataPacket {
  id: number;
}

// Script tao admin mac dinh neu chua co trong he thong
async function seedAdmin(): Promise<void> {
  try {
    const phone = process.env.ADMIN_PHONE || "0900000000";
    const password = process.env.ADMIN_PASSWORD || "123456";
    const full_name = process.env.ADMIN_FULL_NAME || "Administrator";
    const email = process.env.ADMIN_EMAIL || "admin@medical-booking.local";

    // Kiem tra admin da ton tai chua
    const [rows] = await db.execute<UserRow[]>(
      "SELECT id FROM users WHERE phone = ?",
      [phone]
    );

    if (rows.length > 0) {
      console.log("Admin da ton tai");
      return;
    }

    // Hash mật khẩu truoc khi luu DB
    const hashedPassword: string = await bcrypt.hash(password, 10);

    // Tao user role admin
    const includeUsername = await hasTableColumn("users", "username");

    const fields = ["password"];
    const placeholders = ["?"];
    const params: Array<string> = [hashedPassword];

    if (includeUsername) {
      fields.push("username");
      placeholders.push("?");
      params.push(phone);
    }

    fields.push("full_name", "email", "phone", "role", "status", "created_at");
    placeholders.push("?", "?", "?", "'admin'", "'active'", "NOW()");
    params.push(full_name, email, phone);

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      params
    );

    console.log("Tao admin thanh cong voi ID:", result.insertId);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Loi seed admin:", error.message);
    } else {
      console.error("Loi khong xac dinh");
    }
  }
}

seedAdmin()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
