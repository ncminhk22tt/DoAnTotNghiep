const fs = require("fs");
const path = require("path");

function assertTrue(cond, message) {
  if (!cond) throw new Error(message);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  return out;
}

function main() {
  const root = process.cwd();

  const initSql = readText(path.join(root, "database", "init.sql"));
  const storageApi = readText(path.join(root, "src", "app", "api", "storage", "[...segments]", "route.ts"));
  const forgotApi = readText(path.join(root, "src", "app", "api", "auth", "forgot-password", "route.ts"));
  const resetApi = readText(path.join(root, "src", "app", "api", "auth", "reset-password", "route.ts"));
  const patientRecordIdApi = readText(
    path.join(root, "src", "app", "api", "patient", "medical-records", "[id]", "route.ts")
  );
  const rateLimitLib = readText(path.join(root, "src", "lib", "rateLimit.ts"));
  const patientAppointmentsApi = readText(path.join(root, "src", "app", "api", "patient", "appointments", "route.ts"));
  const patientRescheduleApi = readText(
    path.join(root, "src", "app", "api", "patient", "appointments", "[id]", "reschedule", "route.ts")
  );
  const adminRescheduleApi = readText(
    path.join(root, "src", "app", "api", "admin", "appointments", "[id]", "reschedule", "route.ts")
  );

  // 1) Runtime DDL should not live in API/lib request paths.
  const runtimeRoots = [path.join(root, "src", "app", "api"), path.join(root, "src", "lib")];
  const runtimeFiles = runtimeRoots.flatMap((dir) => walkFiles(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")));
  const ddlPattern = /(CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|ALTER\s+TABLE)/i;
  for (const filePath of runtimeFiles) {
    const content = readText(filePath);
    assertTrue(!ddlPattern.test(content), `Khong duoc co DDL runtime trong ${path.relative(root, filePath)}`);
  }

  // 2) Storage API must enforce medical record ownership checks.
  assertTrue(/medical_record_files/i.test(storageApi), "Storage API phai join medical_record_files de kiem tra quyen");
  assertTrue(/authUser\.role === "patient"/i.test(storageApi), "Storage API phai check role patient");
  assertTrue(/authUser\.role === "doctor"/i.test(storageApi), "Storage API phai check role doctor");
  assertTrue(/authUser\.role === "admin"/i.test(storageApi), "Storage API phai cho phep role admin");

  // 3) Patient cannot hard-delete medical records.
  assertTrue(/status:\s*405/.test(patientRecordIdApi), "DELETE medical record cua patient phai bi chan (405)");

  // 4) Password reset token must be hashed in DB.
  assertTrue(/sha256\(/.test(forgotApi), "forgot-password phai hash reset token");
  assertTrue(/tokenHash/.test(forgotApi), "forgot-password phai luu tokenHash");
  assertTrue(/sha256\(/.test(resetApi), "reset-password phai hash token dau vao");
  assertTrue(/WHERE token = \?/i.test(resetApi), "reset-password phai query token hash trong DB");

  // 5) Rate limit should be DB-backed.
  assertTrue(/rate_limit_buckets/i.test(initSql), "init.sql phai co bang rate_limit_buckets");
  assertTrue(/INSERT INTO rate_limit_buckets/i.test(rateLimitLib), "rateLimit lib phai dung DB buckets");

  // 6) Slot validation should use clinic timezone helper.
  assertTrue(/isClinicSlotInPast/.test(patientAppointmentsApi), "POST /patient/appointments phai dung check gio theo timezone phong kham");
  assertTrue(/isClinicSlotInPast/.test(patientRescheduleApi), "patient reschedule phai dung check gio theo timezone phong kham");
  assertTrue(/isClinicSlotInPast/.test(adminRescheduleApi), "admin reschedule phai dung check gio theo timezone phong kham");

  console.log("PASS: test-ci");
}

try {
  main();
} catch (error) {
  console.error("FAIL: test-ci");
  console.error(error.message || error);
  process.exit(1);
}
