import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";
import { db } from "@/lib/db";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { RowDataPacket } from "mysql2";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatBody = {
  messages?: unknown;
};

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>;
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  error?: {
    message?: string;
  };
};

type GeminiModelInfo = {
  name?: string;
  supportedGenerationMethods?: string[];
};

type GeminiListModelsResponse = {
  models?: GeminiModelInfo[];
};

interface SpecialtyServiceRow extends RowDataPacket {
  specialty_id: number;
  specialty_name: string;
  specialty_description: string | null;
  service_id: number | null;
  service_name: string | null;
  service_description: string | null;
}

interface ServiceDoctorRow extends RowDataPacket {
  service_id: number;
  service_name: string;
  service_description: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
  doctor_code: string | null;
  experience: number | null;
  doctor_description: string | null;
  specialty_name: string | null;
}

interface ServiceLookupRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
}

interface ServiceDoctorLookupRow extends RowDataPacket {
  doctor_id: number;
  doctor_name: string;
  doctor_code: string | null;
  specialty_name: string | null;
  experience: number | null;
}

interface SpecialtyLookupRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
}

interface ServiceBySpecialtyRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
}

interface DoctorBySpecialtyRow extends RowDataPacket {
  doctor_id: number;
  doctor_name: string;
  doctor_code: string | null;
  experience: number | null;
}

interface DoctorLookupRow extends RowDataPacket {
  doctor_id: number;
  doctor_name: string;
  doctor_code: string | null;
  specialty_name: string | null;
  doctor_description: string | null;
}

interface UpcomingAppointmentRow extends RowDataPacket {
  appointment_id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  doctor_name: string | null;
  service_name: string | null;
}

interface PendingReviewRow extends RowDataPacket {
  appointment_id: number;
  work_date: string;
  doctor_name: string | null;
  service_name: string | null;
}

interface PatientContextRow extends RowDataPacket {
  appointment_id: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  work_date: string | null;
  service_id: number | null;
  service_name: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
}

interface ServiceScheduleRow extends RowDataPacket {
  doctor_id: number;
  doctor_name: string;
  doctor_code: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  status: "available" | "full" | "closed";
}

interface WeeklyScheduleRow extends RowDataPacket {
  work_date: string;
  start_time: string;
  end_time: string;
  status: "available" | "full" | "closed";
  doctor_id: number;
  doctor_name: string;
  service_id: number | null;
  service_name: string | null;
}

function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  const result: ChatMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<ChatMessage>;
    if (raw.role !== "user" && raw.role !== "assistant") continue;
    if (typeof raw.content !== "string") continue;
    const content = raw.content.trim();
    if (!content) continue;
    result.push({ role: raw.role, content: content.slice(0, 2000) });
  }

  return result.slice(-20);
}

function mapToGeminiRole(role: ChatRole): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function extractGeminiAnswer(payload: GeminiResponse): string {
  const first = payload?.candidates?.[0];
  const parts = first?.content?.parts || [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
  return text;
}

function normalizeModelName(modelName: string): string {
  return modelName.startsWith("models/") ? modelName.slice("models/".length) : modelName;
}

function buildRequestedModelCandidates(rawModel: string): string[] {
  const candidates = [
    rawModel,
    normalizeModelName(rawModel),
    "gemini-2.0-flash",
    "gemini-1.5-flash",
  ];

  return Array.from(
    new Set(
      candidates
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    )
  );
}

function shouldDiscoverModel(response: Response, payload: GeminiResponse): boolean {
  if (response.status === 404) return true;

  const message = (payload?.error?.message || "").toLowerCase();
  return message.includes("not found") || message.includes("call listmodels");
}

function isTransientOverload(response: Response, payload: GeminiResponse): boolean {
  if (response.status === 429 || response.status === 503) return true;
  const message = (payload?.error?.message || "").toLowerCase();
  return (
    message.includes("high demand") ||
    message.includes("try again later") ||
    message.includes("resource exhausted") ||
    message.includes("rate limit")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFriendlyAiError(payload: GeminiResponse, model: string): string {
  const raw = payload?.error?.message || "";
  const lower = raw.toLowerCase();

  if (
    lower.includes("high demand") ||
    lower.includes("try again later") ||
    lower.includes("resource exhausted")
  ) {
    return "Hệ thống AI đang quá tải tạm thời. Vui lòng thử lại sau 10-30 giây.";
  }

  if (lower.includes("not found") || lower.includes("call listmodels")) {
    return `Model AI hiện tại không còn hỗ trợ (${model}). Vui lòng đổi model khác.`;
  }

  return "AI tạm thời không phản hồi. Vui lòng thử lại sau.";
}

async function listGenerateContentModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: "GET", headers: { "Content-Type": "application/json" } }
  );

  if (!res.ok) return [];

  const payload = (await res.json().catch(() => ({}))) as GeminiListModelsResponse;
  const models = payload.models || [];

  const supported = models
    .filter((model) =>
      (model.supportedGenerationMethods || []).some(
        (method) => method.toLowerCase() === "generatecontent"
      )
    )
    .map((model) => normalizeModelName(model.name || ""))
    .filter((name) => name.length > 0);

  const preferred = supported.filter((name) => name.includes("flash"));
  const others = supported.filter((name) => !name.includes("flash"));
  return Array.from(new Set([...preferred, ...others]));
}

async function requestGeminiGenerateContent(
  apiKey: string,
  model: string,
  body: object,
  timeoutMs = 20_000
): Promise<{ response: Response; payload: GeminiResponse }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function shortenText(input: string | null | undefined, max = 180): string {
  if (!input) return "";
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function normalizeSearchText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSearchPhrase(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractServiceNumber(input: string): number | null {
  const match = input.match(/\b(?:dich|dichvu|dv)\s*0*([0-9]{1,4})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractSpecialtyNumber(input: string): number | null {
  const match = input.match(/\b(?:khoa|chuyenkhoa|ck)\s*0*([0-9]{1,4})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractFirstNumber(input: string): number | null {
  const match = input.match(/0*([0-9]{1,4})/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(normalizeSearchText(k)));
}

function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return "-";
  const datePart = value.includes("T") ? value.slice(0, 10) : value.slice(0, 10);
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function parseDateFromText(rawText: string): { from: string; to: string; label: string } | null {
  const text = rawText.toLowerCase();
  const now = new Date();

  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return { from: date, to: date, label: formatDisplayDate(date) };
  }

  const vnDateMatch = text.match(/\b([0-3]?\d)\/([01]?\d)(?:\/(20\d{2}))?\b/);
  if (vnDateMatch) {
    const day = vnDateMatch[1].padStart(2, "0");
    const month = vnDateMatch[2].padStart(2, "0");
    const year = vnDateMatch[3] || String(now.getFullYear());
    const date = `${year}-${month}-${day}`;
    return { from: date, to: date, label: formatDisplayDate(date) };
  }

  const normalized = normalizeSearchText(rawText);
  if (normalized.includes("homnay")) {
    const date = formatDateYmd(now);
    return { from: date, to: date, label: "hôm nay" };
  }
  if (normalized.includes("ngaymai")) {
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    const date = formatDateYmd(next);
    return { from: date, to: date, label: "ngày mai" };
  }
  if (normalized.includes("tuannay") || normalized.includes("trongtuan")) {
    const start = new Date(now);
    const end = new Date(now);
    end.setDate(now.getDate() + 6);
    return { from: formatDateYmd(start), to: formatDateYmd(end), label: "trong 7 ngày tới" };
  }

  const weekdayMap: Array<{ pattern: RegExp; day: number; label: string }> = [
    { pattern: /\bthu[\s\-]*2\b/i, day: 1, label: "Thứ 2" },
    { pattern: /\bthu[\s\-]*3\b/i, day: 2, label: "Thứ 3" },
    { pattern: /\bthu[\s\-]*4\b/i, day: 3, label: "Thứ 4" },
    { pattern: /\bthu[\s\-]*5\b/i, day: 4, label: "Thứ 5" },
    { pattern: /\bthu[\s\-]*6\b/i, day: 5, label: "Thứ 6" },
    { pattern: /\bthu[\s\-]*7\b/i, day: 6, label: "Thứ 7" },
    { pattern: /\bchu\s*nhat\b/i, day: 0, label: "Chủ nhật" },
  ];

  const foundWeekday = weekdayMap.find((x) => x.pattern.test(text));
  if (foundWeekday) {
    const target = new Date(now);
    const current = target.getDay();
    let delta = (foundWeekday.day - current + 7) % 7;
    if (delta === 0) delta = 7;
    target.setDate(target.getDate() + delta);
    const date = formatDateYmd(target);
    return { from: date, to: date, label: foundWeekday.label };
  }

  return null;
}

function tryFaqAnswer(userText: string): string | null {
  const t = normalizeSearchText(userText);
  if (!t) return null;

  if (includesAny(t, ["gio lam viec", "mo cua", "dong cua", "lam viec may gio"])) {
    return [
      "Giờ làm việc tham khảo:",
      "- Thứ 2 - Thứ 7: 07:30 - 17:00",
      "- Chủ nhật: 07:30 - 11:30",
      "Bạn có thể đặt lịch nhanh tại: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  if (includesAny(t, ["dia chi", "o dau", "phong kham o dau", "chi nhanh"])) {
    return [
      "Địa chỉ phòng khám hiện đang được cấu hình trong hệ thống admin.",
      "Nếu bạn cần, mình có thể hướng dẫn bạn xem danh sách khoa/bác sĩ để đặt lịch nhanh: [/dich-vu](/dich-vu).",
    ].join("\n");
  }

  if (includesAny(t, ["gia", "chi phi", "bao nhieu tien", "phi kham"])) {
    return [
      "Chi phí tùy theo dịch vụ và bác sĩ.",
      "Bạn có thể xem giá theo khung giờ khi chọn bác sĩ và ngày khám trên trang đặt lịch.",
      "Đi đến trang đặt lịch: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  if (includesAny(t, ["bao hiem", "bhyt", "bao hiem y te"])) {
    return [
      "Thông tin bảo hiểm áp dụng theo từng dịch vụ/lịch khám.",
      "Khi vào màn hình đặt lịch, hệ thống sẽ hiện mục 'Loại bảo hiểm áp dụng'.",
      "Bạn có thể bắt đầu tại: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  if (includesAny(t, ["dat lich", "book lich", "hen kham", "dang ky kham"])) {
    return [
      "Hướng dẫn đặt lịch nhanh:",
      "1. Vào [/dich-vu](/dich-vu) hoặc chọn khoa/dịch vụ.",
      "2. Chọn bác sĩ, ngày khám, khung giờ.",
      "3. Nhập thông tin bệnh nhân và xác nhận đặt lịch.",
      "4. Theo dõi lịch đã đặt tại [/patient/appointments](/patient/appointments).",
    ].join("\n");
  }

  if (includesAny(t, ["huy lich", "cancel lich"])) {
    return [
      "Bạn có thể hủy lịch tại trang: [/patient/appointments](/patient/appointments).",
      "Mở lịch cần hủy -> bấm 'Hủy lịch'.",
      "Lưu ý: có thể áp dụng giới hạn thời gian hủy trước giờ khám.",
    ].join("\n");
  }

  if (includesAny(t, ["doi lich", "reschedule", "doi gio"])) {
    return [
      "Bạn có thể đổi lịch tại: [/patient/appointments](/patient/appointments).",
      "Mở lịch cần đổi -> bấm 'Đổi lịch' -> chọn slot mới -> xác nhận.",
    ].join("\n");
  }

  if (includesAny(t, ["tai kham", "kham lai"])) {
    return [
      "Bạn có thể đặt tái khám từ lịch đã hoàn tất trong: [/patient/appointments](/patient/appointments).",
      "Mở lịch đã hoàn tất -> bấm 'Đặt tái khám' -> chọn slot phù hợp.",
    ].join("\n");
  }

  if (includesAny(t, ["quen mat khau", "reset mat khau", "doi mat khau"])) {
    return [
      "Nếu quên mật khẩu, bạn vào trang đăng nhập và chọn 'Quên mật khẩu'.",
      "Hệ thống sẽ gửi hướng dẫn đặt lại mật khẩu qua email đã đăng ký.",
    ].join("\n");
  }

  return null;
}

function tryEmergencyAdvice(userText: string): string | null {
  const t = normalizeSearchText(userText);
  if (!t) return null;

  const urgentSignals = [
    "daungucdudoi",
    "khothonang",
    "timdapnhanhbatthuong",
    "xiumat",
    "matythuc",
    "co giat",
    "dotquy",
    "liettaychan",
    "meo mieng",
    "noikhokhot",
    "chaymaunhieu",
    "nonramau",
    "dadubungdudoi",
    "sotcaokemco giat",
  ].map((x) => normalizeSearchText(x));

  const hit = urgentSignals.some((k) => t.includes(k));
  if (!hit) return null;

  return [
    "Cảnh báo: Triệu chứng bạn mô tả có thể là dấu hiệu nguy hiểm.",
    "Bạn nên đến cơ sở y tế gần nhất hoặc khoa cấp cứu ngay.",
    "Nếu cần hỗ trợ khẩn cấp, hãy gọi 115.",
    "Sau khi ổn định, bạn có thể theo dõi lịch hẹn tại [/patient/appointments](/patient/appointments).",
  ].join("\n");
}

type SymptomRule = {
  triggers: string[];
  specialtyKeywords: string[];
};

const SYMPTOM_RULES: SymptomRule[] = [
  {
    triggers: ["daubung", "tronon", "tieuchay", "dayhoi", "taobon"],
    specialtyKeywords: ["tieuhoa", "noi"],
  },
  {
    triggers: ["dauhong", "viemhong", "somo", "u tai", "dautai", "nghetmui", "somu i", "ho"],
    specialtyKeywords: ["taimuihong", "hohap", "noi"],
  },
  {
    triggers: ["daumat", "nhinmo", "momat", "caymat", "do mat"],
    specialtyKeywords: ["mat"],
  },
  {
    triggers: ["ngua", "man do", "diung", "mun", "dalieu"],
    specialtyKeywords: ["dalieu"],
  },
  {
    triggers: ["dautim", "hoihop", "khotho", "dau nguc", "tanghuyetap"],
    specialtyKeywords: ["timmach", "noi"],
  },
  {
    triggers: ["daulung", "daugo i", "daukhop", "te tay", "coxuongkhop"],
    specialtyKeywords: ["coxuongkhop", "ngoai", "phuchoi"],
  },
  {
    triggers: ["matsngu", "cangthang", "loau", "tramcam", "tamly"],
    specialtyKeywords: ["tamly", "thankinh"],
  },
  {
    triggers: ["sot", "metmoi", "chongmat", "dau dau", "daudau"],
    specialtyKeywords: ["noi", "nhi"],
  },
];

async function tryDirectSymptomTriage(userText: string): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  if (!normalized) return null;

  const hasEyeSpecificSignals = [
    "matmo",
    "nhinmo",
    "caymat",
    "domat",
    "dau mat",
    "daumat",
    "xotmat",
    "nuocmat",
  ]
    .map((x) => normalizeSearchText(x))
    .some((k) => normalized.includes(k));

  const hasFaceSignals = [
    "khammat",
    "damat",
    "munda",
    "samda",
    "namda",
    "seomat",
    "thamda",
    "dau damat",
  ]
    .map((x) => normalizeSearchText(x))
    .some((k) => normalized.includes(k));

  // "mat" is ambiguous in Vietnamese (mat = eyes/face when unaccented).
  // If user asks vaguely about "mat" without clear eye symptoms, ask to clarify
  // instead of forcing Eye specialty and causing wrong guidance.
  if (hasFaceSignals && !hasEyeSpecificSignals) {
    return [
      "Bạn đang nhập 'khám mặt' nên hệ thống có thể hiểu 2 nghĩa:",
      "- Mặt (khuôn mặt/da mặt): thường phù hợp Khoa Da liễu.",
      "- Mắt (cơ quan nhìn): phù hợp Khoa Mắt.",
      "Bạn vui lòng mô tả rõ hơn (ví dụ: mụn da mặt, nám da, hay nhìn mờ/cay mắt) để mình gợi ý chính xác hơn.",
    ].join("\n");
  }

  const matchedRule = SYMPTOM_RULES.find((rule) =>
    rule.triggers.some((trigger) => normalized.includes(normalizeSearchText(trigger)))
  );
  if (!matchedRule) return null;

  const [specialties] = await db.execute<SpecialtyLookupRow[]>(
    `SELECT id, name, description
     FROM specialties
     ORDER BY name ASC`
  );
  if (!specialties.length) return null;

  const selectedSpecialty =
    specialties.find((s) => {
      const n = normalizeSearchText(s.name);
      return matchedRule.specialtyKeywords.some((k) => n.includes(normalizeSearchText(k)));
    }) || specialties[0];

  const softDeleteReady = await getServiceSoftDeleteReady();
  const [services] = await db.execute<ServiceBySpecialtyRow[]>(
    `SELECT id, name, description
     FROM services
     WHERE specialty_id = ?
     ${softDeleteReady ? "AND is_active = 1 AND deleted_at IS NULL" : ""}
     ORDER BY name ASC
     LIMIT 6`,
    [selectedSpecialty.id]
  );

  const [doctors] = await db.execute<DoctorBySpecialtyRow[]>(
    `SELECT d.id AS doctor_id,
            u.full_name AS doctor_name,
            d.doctor_code AS doctor_code,
            d.experience AS experience
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     WHERE d.specialty_id = ?
       AND u.role = 'doctor'
       AND u.status = 'active'
     ORDER BY u.full_name ASC
     LIMIT 6`,
    [selectedSpecialty.id]
  );

  const lines: string[] = [];
  lines.push(
    "Với triệu chứng bạn mô tả, khoa phù hợp để khám ban đầu là:"
  );
  lines.push(`- ${selectedSpecialty.name} (ID ${selectedSpecialty.id})`);
  if (selectedSpecialty.description) {
    lines.push(`Mô tả khoa: ${shortenText(selectedSpecialty.description, 220)}`);
  }

  if (services.length) {
    lines.push("Dịch vụ gợi ý:");
    for (const service of services) {
      lines.push(
        `- [${service.name}](/dich-vu/${service.id})${
          service.description ? ` (${shortenText(service.description, 90)})` : ""
        }`
      );
    }
  } else {
    lines.push("Hiện khoa này chưa có dịch vụ được cấu hình.");
  }

  if (doctors.length) {
    lines.push("Bác sĩ gợi ý:");
    for (const doctor of doctors) {
      const meta = [
        doctor.doctor_code ? `Mã ${doctor.doctor_code}` : "",
        doctor.experience ? `${doctor.experience} năm kinh nghiệm` : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- [${doctor.doctor_name}](/bac-si/${doctor.doctor_id})${meta ? ` (${meta})` : ""}`
      );
    }
  } else {
    lines.push("Hiện khoa này chưa có bác sĩ đang hoạt động.");
  }

  lines.push(
    "Lưu ý: Đây là gợi ý tham khảo, không thay thế chẩn đoán. Nếu triệu chứng nặng lên, bạn nên đến cơ sở y tế sớm."
  );

  return lines.join("\n");
}

async function tryDirectServiceLookup(userText: string): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const serviceNo = extractServiceNumber(normalized);
  const seemsAskService = includesAny(normalized, ["dich vu", "dichvu", "goi kham", "dv"]);
  if (!serviceNo && !seemsAskService) return null;

  const softDeleteReady = await getServiceSoftDeleteReady();
  const [services] = await db.execute<ServiceLookupRow[]>(
    `SELECT s.id, s.name, s.description, s.specialty_id, sp.name AS specialty_name
     FROM services s
     LEFT JOIN specialties sp ON sp.id = s.specialty_id
     ${softDeleteReady ? "WHERE s.is_active = 1 AND s.deleted_at IS NULL" : ""}
     ORDER BY s.name ASC`
  );

  if (!services.length) return null;

  // Match strategy for:
  // - "dich 01" vs "Dich 001"
  // - named service query
  const matched =
    (serviceNo
      ? services.find((s) => extractFirstNumber(s.name) === serviceNo) ||
        services.find((s) => normalizeSearchText(s.name).includes(`dich${serviceNo}`)) ||
        services.find((s) => normalizeSearchText(s.name).includes(`dv${serviceNo}`))
      : null) ||
    services.find((s) => {
      const sn = normalizeSearchText(s.name);
      return normalized.includes(sn) || sn.includes(normalized.replace("dichvu", "").replace("dich", ""));
    });

  if (!matched) {
    return serviceNo
      ? `Không tìm thấy dịch vụ có mã ${serviceNo}. Bạn vui lòng kiểm tra lại tên/mã dịch vụ.`
      : "Không tìm thấy dịch vụ phù hợp. Bạn vui lòng nhập rõ hơn tên dịch vụ.";
  }

  const [doctors] = await db.execute<ServiceDoctorLookupRow[]>(
    `SELECT d.id AS doctor_id,
            u.full_name AS doctor_name,
            d.doctor_code AS doctor_code,
            sp.name AS specialty_name,
            d.experience AS experience
     FROM doctor_services ds
     JOIN doctors d ON d.id = ds.doctor_id
     JOIN users u ON u.id = d.user_id
     LEFT JOIN specialties sp ON sp.id = d.specialty_id
     WHERE ds.service_id = ?
       AND u.role = 'doctor'
       AND u.status = 'active'
     ORDER BY u.full_name ASC`,
    [matched.id]
  );

  const lines: string[] = [];
  lines.push(
    `Tìm thấy dịch vụ: ${matched.name}${
      matched.specialty_name ? ` (Khoa: ${matched.specialty_name})` : ""
    }.`
  );
  if (matched.description) {
    lines.push(`Mô tả: ${shortenText(matched.description, 220)}`);
  }

  if (!doctors.length) {
    lines.push("Hiện chưa có bác sĩ được gán cho dịch vụ này.");
    return lines.join("\n");
  }

  lines.push("Bác sĩ phù hợp với dịch vụ này:");
  for (const doctor of doctors.slice(0, 8)) {
    const link = `/bac-si/${doctor.doctor_id}?service_id=${matched.id}`;
    const meta = [
      doctor.specialty_name ? `Khoa ${doctor.specialty_name}` : "",
      doctor.experience ? `${doctor.experience} năm kinh nghiệm` : "",
      doctor.doctor_code ? `Mã ${doctor.doctor_code}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`- [${doctor.doctor_name}](${link})${meta ? ` (${meta})` : ""}`);
  }

  return lines.join("\n");
}

async function tryExactExamLookup(userText: string): Promise<string | null> {
  const phrase = normalizeSearchPhrase(userText);
  if (!phrase.includes("kham ")) return null;

  const normalized = normalizeSearchText(userText);
  const looksLikeScheduleQuestion =
    includesAny(normalized, ["lichkham", "trongtuan", "tuannay", "thu", "ngay", "khunggio"]);
  if (looksLikeScheduleQuestion) return null;

  const khamIndex = phrase.indexOf("kham ");
  const queryAfterKham = phrase.slice(khamIndex + 5).trim();
  if (!queryAfterKham || queryAfterKham.length < 2) return null;

  const softDeleteReady = await getServiceSoftDeleteReady();
  const [services] = await db.execute<ServiceLookupRow[]>(
    `SELECT s.id, s.name, s.description, s.specialty_id, sp.name AS specialty_name
     FROM services s
     LEFT JOIN specialties sp ON sp.id = s.specialty_id
     ${softDeleteReady ? "WHERE s.is_active = 1 AND s.deleted_at IS NULL" : ""}
     ORDER BY s.name ASC`
  );

  const [specialties] = await db.execute<SpecialtyLookupRow[]>(
    `SELECT id, name, description
     FROM specialties
     ORDER BY name ASC`
  );

  const serviceMatch =
    services.find((s) => normalizeSearchPhrase(s.name) === `kham ${queryAfterKham}`) ||
    services.find((s) => normalizeSearchPhrase(s.name) === queryAfterKham) ||
    services.find((s) => normalizeSearchPhrase(s.name).startsWith(`kham ${queryAfterKham}`));

  if (serviceMatch) {
    const [doctors] = await db.execute<ServiceDoctorLookupRow[]>(
      `SELECT d.id AS doctor_id,
              u.full_name AS doctor_name,
              d.doctor_code AS doctor_code,
              sp.name AS specialty_name,
              d.experience AS experience
       FROM doctor_services ds
       JOIN doctors d ON d.id = ds.doctor_id
       JOIN users u ON u.id = d.user_id
       LEFT JOIN specialties sp ON sp.id = d.specialty_id
       WHERE ds.service_id = ?
         AND u.role = 'doctor'
         AND u.status = 'active'
       ORDER BY u.full_name ASC`,
      [serviceMatch.id]
    );

    const lines: string[] = [];
    lines.push(`Tìm thấy đúng dịch vụ theo yêu cầu: ${serviceMatch.name}.`);
    if (serviceMatch.specialty_name) lines.push(`Khoa: ${serviceMatch.specialty_name}`);
    if (serviceMatch.description) lines.push(`Mô tả: ${shortenText(serviceMatch.description, 220)}`);

    if (!doctors.length) {
      lines.push("Hiện chưa có bác sĩ cho dịch vụ này.");
    } else {
      lines.push("Bác sĩ phù hợp:");
      for (const doctor of doctors.slice(0, 8)) {
        const link = `/bac-si/${doctor.doctor_id}?service_id=${serviceMatch.id}`;
        const meta = [
          doctor.specialty_name ? `Khoa ${doctor.specialty_name}` : "",
          doctor.experience ? `${doctor.experience} năm kinh nghiệm` : "",
          doctor.doctor_code ? `Mã ${doctor.doctor_code}` : "",
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(`- [${doctor.doctor_name}](${link})${meta ? ` (${meta})` : ""}`);
      }
    }
    return lines.join("\n");
  }

  const specialtyMatch =
    specialties.find((s) => normalizeSearchPhrase(s.name) === queryAfterKham) ||
    specialties.find((s) => normalizeSearchPhrase(s.name).startsWith(queryAfterKham));

  if (specialtyMatch) {
    const softDeleteReadyLocal = await getServiceSoftDeleteReady();
    const [specServices] = await db.execute<ServiceBySpecialtyRow[]>(
      `SELECT id, name, description
       FROM services
       WHERE specialty_id = ?
       ${softDeleteReadyLocal ? "AND is_active = 1 AND deleted_at IS NULL" : ""}
       ORDER BY name ASC
       LIMIT 10`,
      [specialtyMatch.id]
    );

    const lines: string[] = [];
    lines.push(`Tìm thấy đúng khoa theo yêu cầu: ${specialtyMatch.name}.`);
    if (specialtyMatch.description) lines.push(`Mô tả: ${shortenText(specialtyMatch.description, 220)}`);
    if (!specServices.length) {
      lines.push("Khoa này hiện chưa có dịch vụ.");
    } else {
      lines.push("Dịch vụ trong khoa:");
      for (const service of specServices) {
        lines.push(`- [${service.name}](/dich-vu/${service.id})`);
      }
    }
    return lines.join("\n");
  }

  return `Không tìm thấy đúng dữ liệu cho '${queryAfterKham}' trong hệ thống.`;
}

async function tryServiceScheduleLookup(userText: string): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const askSchedule = includesAny(normalized, [
    "lichkham",
    "khunggio",
    "lichtuan",
    "thu",
    "ngay",
    "lichtrongtuan",
  ]);
  if (!askSchedule) return null;

  const serviceNo = extractServiceNumber(normalized);
  const softDeleteReady = await getServiceSoftDeleteReady();
  const [services] = await db.execute<ServiceLookupRow[]>(
    `SELECT s.id, s.name, s.description, s.specialty_id, sp.name AS specialty_name
     FROM services s
     LEFT JOIN specialties sp ON sp.id = s.specialty_id
     ${softDeleteReady ? "WHERE s.is_active = 1 AND s.deleted_at IS NULL" : ""}
     ORDER BY s.name ASC`
  );
  if (!services.length) return null;

  const matchedService =
    (serviceNo
      ? services.find((s) => extractFirstNumber(s.name) === serviceNo) ||
        services.find((s) => normalizeSearchText(s.name).includes(`dich${serviceNo}`)) ||
        services.find((s) => normalizeSearchText(s.name).includes(`dv${serviceNo}`))
      : null) ||
    services.find((s) => {
      const name = normalizeSearchText(s.name);
      return normalized.includes(name) || name.includes(normalized.replace("dichvu", "").replace("dich", ""));
    });

  if (!matchedService) return null;

  const dateFilter = parseDateFromText(userText);
  const fromDate = dateFilter?.from || formatDateYmd(new Date());
  const toDate = dateFilter?.to || (() => {
    const end = new Date();
    end.setDate(end.getDate() + 6);
    return formatDateYmd(end);
  })();

  const [rows] = await db.execute<ServiceScheduleRow[]>(
    `SELECT d.id AS doctor_id,
            u.full_name AS doctor_name,
            d.doctor_code AS doctor_code,
            DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
            s.start_time,
            s.end_time,
            s.status
     FROM doctor_schedule_slots s
     JOIN doctors d ON d.id = s.doctor_id
     JOIN users u ON u.id = d.user_id
     WHERE s.service_id = ?
       AND s.work_date BETWEEN ? AND ?
       AND s.status <> 'closed'
       AND u.role = 'doctor'
       AND u.status = 'active'
     ORDER BY s.work_date ASC, s.start_time ASC, u.full_name ASC`,
    [matchedService.id, fromDate, toDate]
  );

  const lines: string[] = [];
  lines.push(
    `Lịch khám cho dịch vụ ${matchedService.name}${
      dateFilter ? ` (${dateFilter.label})` : " (7 ngày tới)"
    }:`
  );

  if (!rows.length) {
    lines.push("Hiện không có lịch phù hợp.");
    lines.push("Bạn có thể thử ngày khác hoặc xem thêm tại [/dich-vu](/dich-vu).");
    return lines.join("\n");
  }

  const grouped = new Map<
    number,
    {
      doctorName: string;
      doctorCode: string | null;
      days: Map<string, { start: string; end: string; hasAvailable: boolean }>;
    }
  >();
  for (const row of rows) {
    if (!grouped.has(row.doctor_id)) {
      grouped.set(row.doctor_id, {
        doctorName: row.doctor_name,
        doctorCode: row.doctor_code,
        days: new Map(),
      });
    }
    const doctor = grouped.get(row.doctor_id);
    if (!doctor) continue;
    const current = doctor.days.get(row.work_date);
    const start = row.start_time.slice(0, 5);
    const end = row.end_time.slice(0, 5);
    if (!current) {
      doctor.days.set(row.work_date, {
        start,
        end,
        hasAvailable: row.status === "available",
      });
    } else {
      if (start < current.start) current.start = start;
      if (end > current.end) current.end = end;
      current.hasAvailable = current.hasAvailable || row.status === "available";
    }
  }

  for (const [doctorId, info] of grouped.entries()) {
    const doctorLink = `/bac-si/${doctorId}?service_id=${matchedService.id}`;
    const dayParts = [...info.days.entries()].map(([date, day]) => {
      const text = `${formatDisplayDate(date)}: ${day.start}-${day.end}`;
      return day.hasAvailable ? text : `${text} đã hết`;
    });
    lines.push(
      `- [${info.doctorName}](${doctorLink})${info.doctorCode ? ` (Mã ${info.doctorCode})` : ""}: ${dayParts.join(" | ")}`
    );
  }
  lines.push("Bạn có thể bấm vào tên bác sĩ để xem lịch chi tiết ngay trong chat.");
  return lines.join("\n");
}

async function tryGeneralWeeklyScheduleLookup(userText: string): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const askWeeklySchedule =
    includesAny(normalized, ["lichkhamtrongtuan", "lichtuannay", "lichkhamtuan"]) ||
    (includesAny(normalized, ["lichkham"]) && includesAny(normalized, ["tuan", "trongtuan", "tuannay"]));

  if (!askWeeklySchedule) return null;

  const today = new Date();
  const toDate = new Date(today);
  toDate.setDate(today.getDate() + 6);

  const [rows] = await db.execute<WeeklyScheduleRow[]>(
    `SELECT DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
            s.start_time,
            s.end_time,
            s.status,
            d.id AS doctor_id,
            u.full_name AS doctor_name,
            sv.id AS service_id,
            sv.name AS service_name
     FROM doctor_schedule_slots s
     JOIN doctors d ON d.id = s.doctor_id
     JOIN users u ON u.id = d.user_id
     LEFT JOIN services sv ON sv.id = s.service_id
     WHERE s.work_date BETWEEN ? AND ?
       AND s.status <> 'closed'
       AND u.role = 'doctor'
       AND u.status = 'active'
     ORDER BY s.work_date ASC, s.start_time ASC, u.full_name ASC
     LIMIT 60`,
    [formatDateYmd(today), formatDateYmd(toDate)]
  );

  if (!rows.length) {
    return "Hiện tại chưa có lịch.";
  }

  const lines: string[] = [];
  lines.push("Lịch khám trong 7 ngày tới:");
  for (const row of rows) {
    const doctorLink = `/bac-si/${row.doctor_id}${row.service_id ? `?service_id=${row.service_id}` : ""}`;
    lines.push(
      `- ${formatDisplayDate(row.work_date)} ${row.start_time.slice(0, 5)}-${row.end_time.slice(0, 5)} | [${row.doctor_name}](${doctorLink}) | ${
        row.service_name || "Chưa gắn dịch vụ"
      }${row.status === "full" ? " (đã đầy)" : ""}`
    );
  }
  return lines.join("\n");
}

async function tryDirectSpecialtyLookup(userText: string): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const specialtyNo = extractSpecialtyNumber(normalized);
  const seemsAskSpecialty = includesAny(normalized, ["khoa", "chuyen khoa", "chuyenkhoa", "ck"]);
  if (!specialtyNo && !seemsAskSpecialty) return null;

  const [specialties] = await db.execute<SpecialtyLookupRow[]>(
    `SELECT id, name, description
     FROM specialties
     ORDER BY name ASC`
  );
  if (!specialties.length) return null;

  const matched =
    (specialtyNo
      ? specialties.find((s) => extractFirstNumber(s.name) === specialtyNo) ||
        specialties.find((s) => normalizeSearchText(s.name).includes(`khoa${specialtyNo}`))
      : null) ||
    specialties.find((s) => {
      const n = normalizeSearchText(s.name);
      return normalized.includes(n) || n.includes(normalized.replace("chuyenkhoa", "").replace("khoa", ""));
    });

  if (!matched) {
    return specialtyNo
      ? `Không tìm thấy khoa có mã ${specialtyNo}. Bạn vui lòng kiểm tra lại tên/mã khoa.`
      : "Không tìm thấy khoa phù hợp. Bạn vui lòng nhập rõ hơn tên khoa.";
  }

  const softDeleteReady = await getServiceSoftDeleteReady();
  const [services] = await db.execute<ServiceBySpecialtyRow[]>(
    `SELECT id, name, description
     FROM services
     WHERE specialty_id = ?
     ${softDeleteReady ? "AND is_active = 1 AND deleted_at IS NULL" : ""}
     ORDER BY name ASC
     LIMIT 10`,
    [matched.id]
  );

  const [doctors] = await db.execute<DoctorBySpecialtyRow[]>(
    `SELECT d.id AS doctor_id,
            u.full_name AS doctor_name,
            d.doctor_code AS doctor_code,
            d.experience AS experience
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     WHERE d.specialty_id = ?
       AND u.role = 'doctor'
       AND u.status = 'active'
     ORDER BY u.full_name ASC
     LIMIT 8`,
    [matched.id]
  );

  const lines: string[] = [];
  lines.push(`Khoa ${matched.name} (ID ${matched.id}) có các thông tin sau:`);
  if (matched.description) {
    lines.push(`Mô tả khoa: ${shortenText(matched.description, 220)}`);
  }

  if (!services.length) {
    lines.push("Hiện khoa này chưa có dịch vụ.");
  } else {
    lines.push("Dịch vụ trong khoa:");
    for (const service of services) {
      lines.push(
        `- [${service.name}](/dich-vu/${service.id})${
          service.description ? ` (${shortenText(service.description, 90)})` : ""
        }`
      );
    }
  }

  if (!doctors.length) {
    lines.push("Hiện khoa này chưa có bác sĩ đang hoạt động.");
  } else {
    lines.push("Bác sĩ liên quan:");
    for (const doctor of doctors) {
      const meta = [
        doctor.doctor_code ? `Mã ${doctor.doctor_code}` : "",
        doctor.experience ? `${doctor.experience} năm kinh nghiệm` : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- [${doctor.doctor_name}](/bac-si/${doctor.doctor_id})${meta ? ` (${meta})` : ""}`
      );
    }
  }

  return lines.join("\n");
}

async function tryDirectDoctorLookup(userText: string): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const phrase = normalizeSearchPhrase(userText);
  const askDoctor = includesAny(normalized, ["bacsi", "bs"]);
  if (!askDoctor) return null;

  let doctorQuery = "";
  const idx = phrase.indexOf("bac si ");
  if (idx >= 0) {
    doctorQuery = phrase.slice(idx + "bac si ".length).trim();
  } else if (phrase.startsWith("bs ")) {
    doctorQuery = phrase.slice(3).trim();
  }
  if (!doctorQuery || doctorQuery.length < 2) return null;

  const [doctors] = await db.execute<DoctorLookupRow[]>(
    `SELECT d.id AS doctor_id,
            u.full_name AS doctor_name,
            d.doctor_code AS doctor_code,
            sp.name AS specialty_name,
            d.description AS doctor_description
     FROM doctors d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN specialties sp ON sp.id = d.specialty_id
     WHERE u.role = 'doctor'
       AND u.status = 'active'
     ORDER BY u.full_name ASC`
  );
  if (!doctors.length) return null;

  const qNorm = normalizeSearchText(doctorQuery);
  const qTokens = doctorQuery.split(" ").map((x) => normalizeSearchText(x)).filter(Boolean);
  const matched =
    doctors.find((d) => normalizeSearchText(d.doctor_code || "").includes(qNorm)) ||
    doctors.find((d) => normalizeSearchText(d.doctor_name) === qNorm) ||
    doctors.find((d) => normalizeSearchText(d.doctor_name).includes(qNorm)) ||
    doctors.find((d) => {
      const nameNorm = normalizeSearchText(d.doctor_name);
      return qTokens.length > 0 && qTokens.every((token) => nameNorm.includes(token));
    });

  if (!matched) {
    return `Không tìm thấy bác sĩ '${doctorQuery}' trong hệ thống.`;
  }

  const [services] = await db.execute<ServiceBySpecialtyRow[]>(
    `SELECT s.id, s.name, s.description
     FROM doctor_services ds
     JOIN services s ON s.id = ds.service_id
     WHERE ds.doctor_id = ?
     ORDER BY s.name ASC
     LIMIT 8`,
    [matched.doctor_id]
  );

  const lines: string[] = [];
  lines.push(`Tên: ${matched.doctor_name}`);
  lines.push(`Mã bác sĩ: ${matched.doctor_code || "-"}`);
  lines.push(`Khoa: ${matched.specialty_name || "-"}`);
  lines.push(`Mô tả: ${shortenText(matched.doctor_description, 260) || "-"}`);
  if (!services.length) {
    lines.push("Dịch vụ: -");
  } else {
    const serviceLinks = services.map(
      (service) => `[${service.name}](/dich-vu/${service.id}?doctor_id=${matched.doctor_id})`
    );
    lines.push(`Dịch vụ: ${serviceLinks.join(", ")}`);
  }
  return lines.join("\n");
}

async function tryAppointmentReminders(userText: string, userId: number): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const askReminder = includesAny(normalized, [
    "nhac lich",
    "lich sap toi",
    "lichtoi",
    "toi sap kham",
    "lichhen",
  ]);
  if (!askReminder) return null;

  const [rows] = await db.execute<UpcomingAppointmentRow[]>(
    `SELECT a.id AS appointment_id,
            DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
            s.start_time,
            s.end_time,
            u.full_name AS doctor_name,
            sv.name AS service_name
     FROM appointments a
     JOIN doctor_schedule_slots s ON s.id = a.slot_id
     LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
     LEFT JOIN users u ON u.id = d.user_id
     LEFT JOIN services sv ON sv.id = s.service_id
     WHERE a.user_id = ?
       AND a.status IN ('pending','confirmed')
       AND s.work_date >= CURDATE()
     ORDER BY s.work_date ASC, s.start_time ASC
     LIMIT 5`,
    [userId]
  );

  if (!rows.length) {
    return [
      "Bạn hiện không có lịch khám sắp tới.",
      "Bạn có thể đặt lịch nhanh tại: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("Đây là các lịch khám sắp tới của bạn:");
  for (const row of rows) {
    lines.push(
      `- Lịch #${row.appointment_id}: ${formatDisplayDate(row.work_date)} ${row.start_time.slice(0, 5)}-${row.end_time.slice(
        0,
        5
      )} | Bác sĩ: ${row.doctor_name || "-"} | Dịch vụ: ${row.service_name || "-"}`
    );
  }
  lines.push("Bạn có thể quản lý/hủy/đổi lịch tại [/patient/appointments](/patient/appointments).");
  return lines.join("\n");
}

async function tryPendingReviewSuggestion(userText: string, userId: number): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const askReview = includesAny(normalized, [
    "danh gia",
    "review",
    "phan hoi sau kham",
    "cham diem bac si",
  ]);
  if (!askReview) return null;

  const [rows] = await db.execute<PendingReviewRow[]>(
    `SELECT a.id AS appointment_id,
            DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
            u.full_name AS doctor_name,
            sv.name AS service_name
     FROM appointments a
     JOIN doctor_schedule_slots s ON s.id = a.slot_id
     LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
     LEFT JOIN users u ON u.id = d.user_id
     LEFT JOIN services sv ON sv.id = s.service_id
     WHERE a.user_id = ?
       AND a.status = 'completed'
       AND NOT EXISTS (
         SELECT 1
         FROM doctor_reviews dr
         WHERE dr.user_id = a.user_id
           AND dr.appointment_id = a.id
       )
     ORDER BY s.work_date DESC
     LIMIT 5`,
    [userId]
  );

  if (!rows.length) {
    return "Bạn hiện không có lịch nào cần đánh giá. Cảm ơn bạn đã sử dụng hệ thống.";
  }

  const lines: string[] = [];
  lines.push("Bạn có thể đánh giá nhanh các lịch đã hoàn tất này:");
  for (const row of rows) {
    lines.push(
      `- Lịch #${row.appointment_id} (${formatDisplayDate(row.work_date)}) | ${row.service_name || "-"} | BS. ${
        row.doctor_name || "-"
      } -> [Đánh giá ngay](/danh-gia?appointment_id=${row.appointment_id})`
    );
  }
  return lines.join("\n");
}

async function tryPatientContextSuggestion(userText: string, userId: number): Promise<string | null> {
  const normalized = normalizeSearchText(userText);
  const askContext = includesAny(normalized, [
    "goi y cho toi",
    "toi nen kham gi",
    "toi nen kham khoa nao",
    "goi y dat lich",
    "toi da kham truoc day",
  ]);
  if (!askContext) return null;

  const [rows] = await db.execute<PatientContextRow[]>(
    `SELECT a.id AS appointment_id,
            a.status,
            DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
            s.service_id AS service_id,
            sv.name AS service_name,
            sp.id AS specialty_id,
            sp.name AS specialty_name,
            d.id AS doctor_id,
            u.full_name AS doctor_name
     FROM appointments a
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     LEFT JOIN services sv ON sv.id = s.service_id
     LEFT JOIN specialties sp ON sp.id = sv.specialty_id
     LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
     LEFT JOIN users u ON u.id = d.user_id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC
     LIMIT 12`,
    [userId]
  );

  if (!rows.length) return null;

  const completed = rows.filter((r) => r.status === "completed");
  const recent = completed[0] || rows[0];
  if (!recent) return null;

  const lines: string[] = [];
  lines.push("Gợi ý theo lịch sử khám của bạn:");
  if (recent.specialty_name && recent.specialty_id) {
    lines.push(`- Khoa ưu tiên: ${recent.specialty_name} (ID ${recent.specialty_id})`);
  }
  if (recent.service_name && recent.service_id) {
    lines.push(`- Dịch vụ gần đây: [${recent.service_name}](/dich-vu/${recent.service_id})`);
  }
  if (recent.doctor_name && recent.doctor_id) {
    lines.push(`- Bác sĩ từng khám: [${recent.doctor_name}](/bac-si/${recent.doctor_id})`);
  }
  lines.push("Nếu bạn muốn, mình có thể tìm tiếp lịch trong tuần cho bác sĩ này.");
  return lines.join("\n");
}

async function buildSpecialtyServiceContext(): Promise<string> {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();
    const [rows] = await db.execute<SpecialtyServiceRow[]>(
      `SELECT sp.id AS specialty_id,
              sp.name AS specialty_name,
              sp.description AS specialty_description,
              s.id AS service_id,
              s.name AS service_name,
              s.description AS service_description
       FROM specialties sp
       LEFT JOIN services s
         ON s.specialty_id = sp.id
         ${softDeleteReady ? "AND s.is_active = 1 AND s.deleted_at IS NULL" : ""}
       ORDER BY sp.name ASC, s.name ASC`
    );

    if (!rows.length) {
      return "Không có dữ liệu khoa/dịch vụ trong CSDL.";
    }

    const grouped = new Map<
      number,
      {
        name: string;
        description: string | null;
        services: Array<{ id: number; name: string; description: string | null }>;
      }
    >();

    for (const row of rows) {
      if (!grouped.has(row.specialty_id)) {
        grouped.set(row.specialty_id, {
          name: row.specialty_name,
          description: row.specialty_description,
          services: [],
        });
      }

      if (row.service_id && row.service_name) {
        grouped.get(row.specialty_id)?.services.push({
          id: row.service_id,
          name: row.service_name,
          description: row.service_description,
        });
      }
    }

    const lines: string[] = [];
    for (const [specialtyId, specialty] of grouped.entries()) {
      lines.push(
        `- Khoa ${specialtyId}: ${specialty.name}` +
          (shortenText(specialty.description) ? ` | Mô tả: ${shortenText(specialty.description)}` : "")
      );

      if (specialty.services.length === 0) {
        lines.push("  Dịch vụ: Chưa có dịch vụ.");
      } else {
        const serviceParts = specialty.services.map((service) => {
          const serviceId = service.id;
          const serviceLink = `/dich-vu/${serviceId}`;
          const shortDesc = shortenText(service.description, 90);
          return shortDesc
            ? `[${service.name}](${serviceLink}) (${shortDesc})`
            : `[${service.name}](${serviceLink})`;
        });
        lines.push(`  Dịch vụ: ${serviceParts.join("; ")}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "Không tải được dữ liệu khoa/dịch vụ từ CSDL.";
  }
}

async function buildServiceDoctorContext(): Promise<string> {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();
    const [rows] = await db.execute<ServiceDoctorRow[]>(
      `SELECT s.id AS service_id,
              s.name AS service_name,
              s.description AS service_description,
              d.id AS doctor_id,
              u.full_name AS doctor_name,
              d.doctor_code AS doctor_code,
              d.experience AS experience,
              d.description AS doctor_description,
              sp.name AS specialty_name
       FROM services s
       LEFT JOIN doctor_services ds ON ds.service_id = s.id
       LEFT JOIN doctors d ON d.id = ds.doctor_id
       LEFT JOIN users u ON u.id = d.user_id AND u.role = 'doctor' AND u.status = 'active'
       LEFT JOIN specialties sp ON sp.id = d.specialty_id
       WHERE 1 = 1
       ${softDeleteReady ? "AND s.is_active = 1 AND s.deleted_at IS NULL" : ""}
       ORDER BY s.name ASC, u.full_name ASC`
    );

    if (!rows.length) {
      return "Không có dữ liệu dịch vụ/bác sĩ trong CSDL.";
    }

    const grouped = new Map<
      number,
      {
        serviceName: string;
        serviceDescription: string | null;
        doctors: Array<{
          doctorId: number;
          doctorName: string;
          doctorCode: string | null;
          specialtyName: string | null;
          experience: number | null;
          doctorDescription: string | null;
        }>;
      }
    >();

    for (const row of rows) {
      if (!grouped.has(row.service_id)) {
        grouped.set(row.service_id, {
          serviceName: row.service_name,
          serviceDescription: row.service_description,
          doctors: [],
        });
      }

      if (row.doctor_id && row.doctor_name) {
        grouped.get(row.service_id)?.doctors.push({
          doctorId: row.doctor_id,
          doctorName: row.doctor_name,
          doctorCode: row.doctor_code,
          specialtyName: row.specialty_name,
          experience: row.experience,
          doctorDescription: row.doctor_description,
        });
      }
    }

    const lines: string[] = [];
    for (const [serviceId, service] of grouped.entries()) {
      lines.push(
        `- Dịch vụ ${serviceId}: ${service.serviceName}` +
          (shortenText(service.serviceDescription) ? ` | Mô tả: ${shortenText(service.serviceDescription)}` : "")
      );

      if (service.doctors.length === 0) {
        lines.push("  Bác sĩ phù hợp: Chưa có dữ liệu.");
      } else {
        const doctorParts = service.doctors.map((doctor) => {
          const meta = [
            doctor.specialtyName ? `Khoa ${doctor.specialtyName}` : "",
            Number.isFinite(doctor.experience as number) ? `${doctor.experience} năm kinh nghiệm` : "",
            doctor.doctorCode ? `Mã ${doctor.doctorCode}` : "",
          ].filter(Boolean);

          const intro = shortenText(doctor.doctorDescription, 70);
          const base = meta.length ? `${doctor.doctorName} (${meta.join(", ")})` : doctor.doctorName;
          const link = `/bac-si/${doctor.doctorId}?service_id=${serviceId}`;
          return intro ? `${base} - ${intro} | Liên kết: ${link}` : `${base} | Liên kết: ${link}`;
        });
        lines.push(`  Bác sĩ phù hợp: ${doctorParts.join("; ")}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "Không tải được dữ liệu dịch vụ/bác sĩ từ CSDL.";
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chỉ bệnh nhân mới được sử dụng chat AI" },
        { status: 403 }
      );
    }

    const ip = getClientIpFromHeaders(req.headers);
    const rate = await consumeRateLimit(`ai:chat:${authUser.id}:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    let body: ChatBody;
    try {
      body = (await req.json()) as ChatBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 }
      );
    }

    const messages = sanitizeMessages(body.messages);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (!lastUserMessage) {
      return NextResponse.json(
        { success: false, message: "Nội dung chat không hợp lệ" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "Chưa cấu hình GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    // High-priority safety filter for dangerous symptoms
    const emergencyAdvice = tryEmergencyAdvice(lastUserMessage);
    if (emergencyAdvice) {
      return NextResponse.json({
        success: true,
        message: "Cảnh báo triệu chứng nguy hiểm",
        data: { answer: emergencyAdvice },
      });
    }

    // Deterministic FAQ
    const faqAnswer = tryFaqAnswer(lastUserMessage);
    if (faqAnswer) {
      return NextResponse.json({
        success: true,
        message: "FAQ trả lời thành công",
        data: { answer: faqAnswer },
      });
    }

    const exactExamAnswer = await tryExactExamLookup(lastUserMessage).catch(() => null);
    if (exactExamAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu khám theo dữ liệu chính xác thành công",
        data: { answer: exactExamAnswer },
      });
    }

    const weeklyScheduleAnswer = await tryGeneralWeeklyScheduleLookup(lastUserMessage).catch(() => null);
    if (weeklyScheduleAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu lịch khám trong tuần thành công",
        data: { answer: weeklyScheduleAnswer },
      });
    }

    // Deterministic lookup for specialty queries (name/code)
    const directSpecialtyAnswer = await tryDirectSpecialtyLookup(lastUserMessage).catch(() => null);
    if (directSpecialtyAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu khoa thành công",
        data: { answer: directSpecialtyAnswer },
      });
    }

    const directDoctorAnswer = await tryDirectDoctorLookup(lastUserMessage).catch(() => null);
    if (directDoctorAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu bác sĩ thành công",
        data: { answer: directDoctorAnswer },
      });
    }

    const directScheduleAnswer = await tryServiceScheduleLookup(lastUserMessage).catch(() => null);
    if (directScheduleAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu lịch dịch vụ thành công",
        data: { answer: directScheduleAnswer },
      });
    }

    // Deterministic lookup for service code queries (e.g. "dich 01")
    const directServiceAnswer = await tryDirectServiceLookup(lastUserMessage).catch(() => null);
    if (directServiceAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu dịch vụ thành công",
        data: { answer: directServiceAnswer },
      });
    }

    // Deterministic triage for symptom questions
    const symptomTriageAnswer = await tryDirectSymptomTriage(lastUserMessage).catch(() => null);
    if (symptomTriageAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tư vấn triệu chứng thành công",
        data: { answer: symptomTriageAnswer },
      });
    }

    const reminderAnswer = await tryAppointmentReminders(lastUserMessage, authUser.id).catch(() => null);
    if (reminderAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu lịch sắp tới thành công",
        data: { answer: reminderAnswer },
      });
    }

    const reviewAnswer = await tryPendingReviewSuggestion(lastUserMessage, authUser.id).catch(() => null);
    if (reviewAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cứu đánh giá thành công",
        data: { answer: reviewAnswer },
      });
    }

    const contextAnswer = await tryPatientContextSuggestion(lastUserMessage, authUser.id).catch(() => null);
    if (contextAnswer) {
      return NextResponse.json({
        success: true,
        message: "Gợi ý theo lịch sử thành công",
        data: { answer: contextAnswer },
      });
    }

    const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash";
    const dbContext = await buildSpecialtyServiceContext();
    const serviceDoctorContext = await buildServiceDoctorContext();
    const defaultSystemPrompt = `
Bạn là trợ lý AI hỗ trợ bệnh nhân trên hệ thống đặt lịch khám.

Quy tắc:
- Bắt buộc trả lời 100% bằng tiếng Việt có dấu, không dùng tiếng Việt không dấu.
- Trả lời ngắn gọn, lịch sự, dễ hiểu.
- Không chẩn đoán bệnh, không kê đơn thuốc.
- Nếu có dấu hiệu nguy hiểm, khuyên người dùng đến cơ sở y tế sớm.
- Không tự tạo dữ liệu bác sĩ, khoa, dịch vụ, giá tiền nếu không có dữ liệu đầu vào.
- Nếu thiếu thông tin, hãy nói rõ cần bổ sung dữ liệu.
- Nếu người dùng hỏi về một khoa:
  + Mô tả ngắn về khoa đó dựa trên dữ liệu CSDL.
  + Gợi ý các dịch vụ thuộc khoa đó nếu có.
  + Tên dịch vụ phải để dạng Markdown có link:
    [Tên dịch vụ](/dich-vu/[service_id])
  + Nếu không thấy khoa phù hợp, nói rõ rằng không có dữ liệu khoa đó.
- Nếu người dùng hỏi về một dịch vụ:
  + Mô tả ngắn về dịch vụ đó dựa trên dữ liệu CSDL.
  + Cung cấp danh sách bác sĩ phù hợp có trong hệ thống nếu có.
  + Tên bác sĩ phải để dạng Markdown có link đến trang chi tiết:
    [Tên bác sĩ](/bac-si/[doctor_id]?service_id=[service_id])
  + Nếu chưa có bác sĩ cho dịch vụ đó, nói rõ để người dùng biết.
- Nếu người dùng hỏi thông tin một bác sĩ, ưu tiên trả lời đúng mẫu:
  Tên: ...
  Mã bác sĩ: ...
  Khoa: ...
  Mô tả: ...
  Dịch vụ: ...
- Không dùng ký tự ** trong câu trả lời.

Dữ liệu khoa và dịch vụ từ CSDL (chỉ được dùng trong phiên trả lời hiện tại):
${dbContext}

Dữ liệu dịch vụ và bác sĩ từ CSDL (chỉ được dùng trong phiên trả lời hiện tại):
${serviceDoctorContext}
`;
    const systemPrompt = process.env.AI_CHAT_SYSTEM_PROMPT?.trim() || defaultSystemPrompt;
    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: messages.map((m) => ({
        role: mapToGeminiRole(m.role),
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: 0.4,
      },
    };

    const modelCandidates = buildRequestedModelCandidates(model);
    let selectedModel = modelCandidates[0];
    let { response, payload } = await requestGeminiGenerateContent(apiKey, selectedModel, requestBody);

    if (!response.ok && (shouldDiscoverModel(response, payload) || isTransientOverload(response, payload))) {
      const discoveredModels = await listGenerateContentModels(apiKey);
      for (const discovered of discoveredModels) {
        if (!modelCandidates.includes(discovered)) {
          modelCandidates.push(discovered);
        }
      }
    }

    // Retry strategy:
    // - with each candidate model, try up to 2 times if transient overload
    // - short backoff keeps chat responsive
    if (!response.ok) {
      outer: for (let i = 0; i < modelCandidates.length; i += 1) {
        selectedModel = modelCandidates[i];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (i === 0 && attempt === 0) continue;
          ({ response, payload } = await requestGeminiGenerateContent(apiKey, selectedModel, requestBody));
          if (response.ok) break outer;
          if (!isTransientOverload(response, payload)) break;
          await sleep(600 + attempt * 500);
        }
      }
    }

    if (!response.ok) {
      const fallbackLinks = [
        "Hệ thống AI tạm thời bận. Bạn có thể thao tác nhanh:",
        "- [Tìm bác sĩ/dịch vụ](/dich-vu)",
        "- [Xem danh sách chuyên khoa](/chuyen-khoa)",
        "- [Quản lý lịch hẹn của tôi](/patient/appointments)",
        "- [Gửi yêu cầu hỗ trợ admin](/ho-tro/admin)",
      ].join("\n");
      return NextResponse.json(
        {
          success: false,
          message: `${toFriendlyAiError(payload, selectedModel)}\n\n${fallbackLinks}`,
        },
        { status: 502 }
      );
    }

    const answer = extractGeminiAnswer(payload);
    if (!answer) {
      return NextResponse.json(
        { success: false, message: "Không nhận được phản hồi từ AI" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "AI phản hồi thành công",
      data: { answer },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { success: false, message: "AI phản hồi quá lâu, vui lòng thử lại" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}


