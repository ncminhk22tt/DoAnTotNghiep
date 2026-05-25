import { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

interface SequenceRow extends RowDataPacket {
  current_value: number;
}

export async function generateCode(
  connection: PoolConnection,
  type: "doctor" | "appointment" | "user"
): Promise<string> {
  const year = new Date().getFullYear();

  // 🔒 lock row để tránh race condition
  const [rows] = await connection.execute<SequenceRow[]>(
    `SELECT current_value FROM code_sequences 
     WHERE type = ? AND year = ? 
     FOR UPDATE`,
    [type, year]
  );

  let nextValue: number;

  if (rows.length === 0) {
    // 👉 chưa có → tạo mới
    nextValue = 1;

    await connection.execute<ResultSetHeader>(
      `INSERT INTO code_sequences (type, year, current_value)
       VALUES (?, ?, ?)`,
      [type, year, nextValue]
    );
  } else {
    nextValue = rows[0].current_value + 1;

    await connection.execute<ResultSetHeader>(
      `UPDATE code_sequences 
       SET current_value = ? 
       WHERE type = ? AND year = ?`,
      [nextValue, type, year]
    );
  }

  // 🎯 format code
  const prefixMap: Record<typeof type, string> = {
    doctor: "BS",
    appointment: "AP",
    user: "US",
  };

  const prefix = prefixMap[type];

  return `${prefix}-${year}-${nextValue.toString().padStart(4, "0")}`;
}