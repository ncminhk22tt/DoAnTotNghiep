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
    return "He thong AI dang qua tai tam thoi. Vui long thu lai sau 10-30 giay.";
  }

  if (lower.includes("not found") || lower.includes("call listmodels")) {
    return `Model AI hien tai khong con ho tro (${model}). Vui long doi model khac.`;
  }

  return "AI tam thoi khong phan hoi. Vui long thu lai sau.";
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

function parseDateFromText(rawText: string): { from: string; to: string; label: string } | null {
  const text = rawText.toLowerCase();
  const now = new Date();

  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    return { from: date, to: date, label: date };
  }

  const vnDateMatch = text.match(/\b([0-3]?\d)\/([01]?\d)(?:\/(20\d{2}))?\b/);
  if (vnDateMatch) {
    const day = vnDateMatch[1].padStart(2, "0");
    const month = vnDateMatch[2].padStart(2, "0");
    const year = vnDateMatch[3] || String(now.getFullYear());
    const date = `${year}-${month}-${day}`;
    return { from: date, to: date, label: date };
  }

  const normalized = normalizeSearchText(rawText);
  if (normalized.includes("homnay")) {
    const date = formatDateYmd(now);
    return { from: date, to: date, label: "hom nay" };
  }
  if (normalized.includes("ngaymai")) {
    const next = new Date(now);
    next.setDate(now.getDate() + 1);
    const date = formatDateYmd(next);
    return { from: date, to: date, label: "ngay mai" };
  }
  if (normalized.includes("tuannay") || normalized.includes("trongtuan")) {
    const start = new Date(now);
    const end = new Date(now);
    end.setDate(now.getDate() + 6);
    return { from: formatDateYmd(start), to: formatDateYmd(end), label: "trong 7 ngay toi" };
  }

  const weekdayMap: Array<{ pattern: RegExp; day: number; label: string }> = [
    { pattern: /\bthu[\s\-]*2\b/i, day: 1, label: "Thu 2" },
    { pattern: /\bthu[\s\-]*3\b/i, day: 2, label: "Thu 3" },
    { pattern: /\bthu[\s\-]*4\b/i, day: 3, label: "Thu 4" },
    { pattern: /\bthu[\s\-]*5\b/i, day: 4, label: "Thu 5" },
    { pattern: /\bthu[\s\-]*6\b/i, day: 5, label: "Thu 6" },
    { pattern: /\bthu[\s\-]*7\b/i, day: 6, label: "Thu 7" },
    { pattern: /\bchu\s*nhat\b/i, day: 0, label: "Chu nhat" },
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
      "Gio lam viec tham khao:",
      "- Thu 2 - Thu 7: 07:30 - 17:00",
      "- Chu nhat: 07:30 - 11:30",
      "Ban co the dat lich nhanh tai: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  if (includesAny(t, ["dia chi", "o dau", "phong kham o dau", "chi nhanh"])) {
    return [
      "Dia chi phong kham hien dang duoc cau hinh trong he thong admin.",
      "Neu ban can, minh co the huong dan ban xem danh sach khoa/bac si de dat lich nhanh: [/dich-vu](/dich-vu).",
    ].join("\n");
  }

  if (includesAny(t, ["gia", "chi phi", "bao nhieu tien", "phi kham"])) {
    return [
      "Chi phi tuy theo dich vu va bac si.",
      "Ban co the xem gia theo khung gio khi chon bac si va ngay kham tren trang dat lich.",
      "Di den trang dat lich: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  if (includesAny(t, ["bao hiem", "bhyt", "bao hiem y te"])) {
    return [
      "Thong tin bao hiem ap dung theo tung dich vu/lich kham.",
      "Khi vao man hinh dat lich, he thong se hien muc 'Loai bao hiem ap dung'.",
      "Ban co the bat dau tai: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  if (includesAny(t, ["dat lich", "book lich", "hen kham", "dang ky kham"])) {
    return [
      "Huong dan dat lich nhanh:",
      "1. Vao [/dich-vu](/dich-vu) hoac chon khoa/dich vu.",
      "2. Chon bac si, ngay kham, khung gio.",
      "3. Nhap thong tin benh nhan va xac nhan dat lich.",
      "4. Theo doi lich da dat tai [/patient/appointments](/patient/appointments).",
    ].join("\n");
  }

  if (includesAny(t, ["huy lich", "cancel lich"])) {
    return [
      "Ban co the huy lich tai trang: [/patient/appointments](/patient/appointments).",
      "Mo lich can huy -> bam 'Huy lich'.",
      "Luu y: co the ap dung gioi han thoi gian huy truoc gio kham.",
    ].join("\n");
  }

  if (includesAny(t, ["doi lich", "reschedule", "doi gio"])) {
    return [
      "Ban co the doi lich tai: [/patient/appointments](/patient/appointments).",
      "Mo lich can doi -> bam 'Doi lich' -> chon slot moi -> xac nhan.",
    ].join("\n");
  }

  if (includesAny(t, ["tai kham", "kham lai"])) {
    return [
      "Ban co the dat tai kham tu lich da hoan tat trong: [/patient/appointments](/patient/appointments).",
      "Mo lich da hoan tat -> bam 'Dat tai kham' -> chon slot phu hop.",
    ].join("\n");
  }

  if (includesAny(t, ["quen mat khau", "reset mat khau", "doi mat khau"])) {
    return [
      "Neu quen mat khau, ban vao trang dang nhap va chon 'Quen mat khau'.",
      "He thong se gui huong dan dat lai mat khau qua email da dang ky.",
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
    "Canh bao: Trieu chung ban mo ta co the la dau hieu nguy hiem.",
    "Ban nen den co so y te gan nhat hoac khoa cap cuu ngay.",
    "Neu can ho tro khan cap, hay goi 115.",
    "Sau khi on dinh, ban co the theo doi lich hen tai [/patient/appointments](/patient/appointments).",
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
      "Ban dang nhap 'kham mat' nen he thong co the hieu 2 nghia:",
      "- Mat (khuon mat/da mat): thuong phu hop Khoa Da lieu.",
      "- Mat (co quan nhin): phu hop Khoa Mat.",
      "Ban vui long mo ta ro hon (vi du: mun da mat, nam da, hay nhin mo/cay mat) de minh goi y chinh xac hon.",
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
    "Voi trieu chung ban mo ta, khoa phu hop de kham ban dau la:"
  );
  lines.push(`- ${selectedSpecialty.name} (ID ${selectedSpecialty.id})`);
  if (selectedSpecialty.description) {
    lines.push(`Mo ta khoa: ${shortenText(selectedSpecialty.description, 220)}`);
  }

  if (services.length) {
    lines.push("Dich vu goi y:");
    for (const service of services) {
      lines.push(
        `- [${service.name}](/dich-vu/${service.id})${
          service.description ? ` (${shortenText(service.description, 90)})` : ""
        }`
      );
    }
  } else {
    lines.push("Hien khoa nay chua co dich vu duoc cau hinh.");
  }

  if (doctors.length) {
    lines.push("Bac si goi y:");
    for (const doctor of doctors) {
      const meta = [
        doctor.doctor_code ? `Ma ${doctor.doctor_code}` : "",
        doctor.experience ? `${doctor.experience} nam kinh nghiem` : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- [${doctor.doctor_name}](/bac-si/${doctor.doctor_id})${meta ? ` (${meta})` : ""}`
      );
    }
  } else {
    lines.push("Hien khoa nay chua co bac si dang hoat dong.");
  }

  lines.push(
    "Luu y: Day la goi y tham khao, khong thay the chan doan. Neu trieu chung nang len, ban nen den co so y te som."
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
      ? `Khong tim thay dich vu co ma ${serviceNo}. Ban vui long kiem tra lai ten/ma dich vu.`
      : "Khong tim thay dich vu phu hop. Ban vui long nhap ro hon ten dich vu.";
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
    `Tim thay dich vu: ${matched.name}${
      matched.specialty_name ? ` (Khoa: ${matched.specialty_name})` : ""
    }.`
  );
  if (matched.description) {
    lines.push(`Mo ta: ${shortenText(matched.description, 220)}`);
  }

  if (!doctors.length) {
    lines.push("Hien chua co bac si duoc gan cho dich vu nay.");
    return lines.join("\n");
  }

  lines.push("Bac si phu hop voi dich vu nay:");
  for (const doctor of doctors.slice(0, 8)) {
    const link = `/bac-si/${doctor.doctor_id}?service_id=${matched.id}`;
    const meta = [
      doctor.specialty_name ? `Khoa ${doctor.specialty_name}` : "",
      doctor.experience ? `${doctor.experience} nam kinh nghiem` : "",
      doctor.doctor_code ? `Ma ${doctor.doctor_code}` : "",
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
    lines.push(`TĂ¬m tháº¥y Ä‘Ăºng dá»‹ch vá»¥ theo yĂªu cáº§u: ${serviceMatch.name}.`);
    if (serviceMatch.specialty_name) lines.push(`Khoa: ${serviceMatch.specialty_name}`);
    if (serviceMatch.description) lines.push(`MĂ´ táº£: ${shortenText(serviceMatch.description, 220)}`);

    if (!doctors.length) {
      lines.push("Hiá»‡n chÆ°a cĂ³ bĂ¡c sÄ© cho dá»‹ch vá»¥ nĂ y.");
    } else {
      lines.push("BĂ¡c sÄ© phĂ¹ há»£p:");
      for (const doctor of doctors.slice(0, 8)) {
        const link = `/bac-si/${doctor.doctor_id}?service_id=${serviceMatch.id}`;
        const meta = [
          doctor.specialty_name ? `Khoa ${doctor.specialty_name}` : "",
          doctor.experience ? `${doctor.experience} nÄƒm kinh nghiá»‡m` : "",
          doctor.doctor_code ? `Ma ${doctor.doctor_code}` : "",
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
    lines.push(`TĂ¬m tháº¥y Ä‘Ăºng khoa theo yĂªu cáº§u: ${specialtyMatch.name}.`);
    if (specialtyMatch.description) lines.push(`MĂ´ táº£: ${shortenText(specialtyMatch.description, 220)}`);
    if (!specServices.length) {
      lines.push("Khoa nĂ y hiá»‡n chÆ°a cĂ³ dá»‹ch vá»¥.");
    } else {
      lines.push("Dá»‹ch vá»¥ trong khoa:");
      for (const service of specServices) {
        lines.push(`- [${service.name}](/dich-vu/${service.id})`);
      }
    }
    return lines.join("\n");
  }

  return `KhĂ´ng tĂ¬m tháº¥y Ä‘Ăºng dá»¯ liá»‡u cho '${queryAfterKham}' trong há»‡ thá»‘ng.`;
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
    `Lá»‹ch khĂ¡m cho dá»‹ch vá»¥ ${matchedService.name}${
      dateFilter ? ` (${dateFilter.label})` : " (7 ngĂ y tá»›i)"
    }:`
  );

  if (!rows.length) {
    lines.push("Hiá»‡n khĂ´ng cĂ³ lá»‹ch phĂ¹ há»£p.");
    lines.push("Báº¡n cĂ³ thá»ƒ thá»­ ngĂ y khĂ¡c hoáº·c xem thĂªm táº¡i [/dich-vu](/dich-vu).");
    return lines.join("\n");
  }

  const grouped = new Map<number, { doctorName: string; doctorCode: string | null; slots: string[] }>();
  for (const row of rows) {
    if (!grouped.has(row.doctor_id)) {
      grouped.set(row.doctor_id, {
        doctorName: row.doctor_name,
        doctorCode: row.doctor_code,
        slots: [],
      });
    }
    grouped
      .get(row.doctor_id)
      ?.slots.push(
        `${row.work_date} ${row.start_time.slice(0, 5)}-${row.end_time.slice(0, 5)}${
          row.status === "full" ? " (Ä‘Ă£ Ä‘áº§y)" : ""
        }`
      );
  }

  for (const [doctorId, info] of grouped.entries()) {
    const doctorLink = `/bac-si/${doctorId}?service_id=${matchedService.id}`;
    lines.push(
      `- [${info.doctorName}](${doctorLink})${info.doctorCode ? ` (MĂ£ ${info.doctorCode})` : ""}: ${info.slots
        .slice(0, 8)
        .join(" | ")}`
    );
  }
  lines.push("Báº¡n cĂ³ thá»ƒ báº¥m vĂ o tĂªn bĂ¡c sÄ© Ä‘á»ƒ xem lá»‹ch chi tiáº¿t ngay trong chat.");
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
    return "Hiá»‡n táº¡i chÆ°a cĂ³ lá»‹ch.";
  }

  const lines: string[] = [];
  lines.push("Lá»‹ch khĂ¡m trong 7 ngĂ y tá»›i:");
  for (const row of rows) {
    const doctorLink = `/bac-si/${row.doctor_id}${row.service_id ? `?service_id=${row.service_id}` : ""}`;
    lines.push(
      `- ${row.work_date} ${row.start_time.slice(0, 5)}-${row.end_time.slice(0, 5)} | [${row.doctor_name}](${doctorLink}) | ${
        row.service_name || "ChÆ°a gáº¯n dá»‹ch vá»¥"
      }${row.status === "full" ? " (Ä‘Ă£ Ä‘áº§y)" : ""}`
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
      ? `Khong tim thay khoa co ma ${specialtyNo}. Ban vui long kiem tra lai ten/ma khoa.`
      : "Khong tim thay khoa phu hop. Ban vui long nhap ro hon ten khoa.";
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
  lines.push(`Khoa ${matched.name} (ID ${matched.id}) co cac thong tin sau:`);
  if (matched.description) {
    lines.push(`Mo ta khoa: ${shortenText(matched.description, 220)}`);
  }

  if (!services.length) {
    lines.push("Hien khoa nay chua co dich vu.");
  } else {
    lines.push("Dich vu trong khoa:");
    for (const service of services) {
      lines.push(
        `- [${service.name}](/dich-vu/${service.id})${
          service.description ? ` (${shortenText(service.description, 90)})` : ""
        }`
      );
    }
  }

  if (!doctors.length) {
    lines.push("Hien khoa nay chua co bac si dang hoat dong.");
  } else {
    lines.push("Bac si lien quan:");
    for (const doctor of doctors) {
      const meta = [
        doctor.doctor_code ? `Ma ${doctor.doctor_code}` : "",
        doctor.experience ? `${doctor.experience} nam kinh nghiem` : "",
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
    return `Khong tim thay bac si '${doctorQuery}' trong he thong.`;
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
  lines.push(`TĂªn: ${matched.doctor_name}`);
  lines.push(`MĂ£ bĂ¡c sÄ©: ${matched.doctor_code || "-"}`);
  lines.push(`Khoa: ${matched.specialty_name || "-"}`);
  lines.push(`MĂ´ táº£: ${shortenText(matched.doctor_description, 260) || "-"}`);
  if (!services.length) {
    lines.push("Dá»‹ch vá»¥: -");
  } else {
    const serviceLinks = services.map(
      (service) => `[${service.name}](/dich-vu/${service.id}?doctor_id=${matched.doctor_id})`
    );
    lines.push(`Dá»‹ch vá»¥: ${serviceLinks.join(", ")}`);
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
      "Ban hien khong co lich kham sap toi.",
      "Ban co the dat lich nhanh tai: [/dich-vu](/dich-vu)",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("Day la cac lich kham sap toi cua ban:");
  for (const row of rows) {
    lines.push(
      `- Lich #${row.appointment_id}: ${row.work_date} ${row.start_time.slice(0, 5)}-${row.end_time.slice(
        0,
        5
      )} | Bac si: ${row.doctor_name || "-"} | Dich vu: ${row.service_name || "-"}`
    );
  }
  lines.push("Ban co the quan ly/huy/doi lich tai [/patient/appointments](/patient/appointments).");
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
    return "Ban hien khong co lich nao can danh gia. Cam on ban da su dung he thong.";
  }

  const lines: string[] = [];
  lines.push("Ban co the danh gia nhanh cac lich da hoan tat nay:");
  for (const row of rows) {
    lines.push(
      `- Lich #${row.appointment_id} (${row.work_date}) | ${row.service_name || "-"} | BS. ${
        row.doctor_name || "-"
      } -> [Danh gia ngay](/danh-gia?appointment_id=${row.appointment_id})`
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
  lines.push("Goi y theo lich su kham cua ban:");
  if (recent.specialty_name && recent.specialty_id) {
    lines.push(`- Khoa uu tien: ${recent.specialty_name} (ID ${recent.specialty_id})`);
  }
  if (recent.service_name && recent.service_id) {
    lines.push(`- Dich vu gan day: [${recent.service_name}](/dich-vu/${recent.service_id})`);
  }
  if (recent.doctor_name && recent.doctor_id) {
    lines.push(`- Bac si tung kham: [${recent.doctor_name}](/bac-si/${recent.doctor_id})`);
  }
  lines.push("Neu ban muon, minh co the tim tiep lich trong tuan cho bac si nay.");
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
      return "Khong co du lieu khoa/dich vu trong CSDL.";
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
          (shortenText(specialty.description) ? ` | Mo ta: ${shortenText(specialty.description)}` : "")
      );

      if (specialty.services.length === 0) {
        lines.push("  Dich vu: Chua co dich vu.");
      } else {
        const serviceParts = specialty.services.map((service) => {
          const serviceId = service.id;
          const serviceLink = `/dich-vu/${serviceId}`;
          const shortDesc = shortenText(service.description, 90);
          return shortDesc
            ? `[${service.name}](${serviceLink}) (${shortDesc})`
            : `[${service.name}](${serviceLink})`;
        });
        lines.push(`  Dich vu: ${serviceParts.join("; ")}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "Khong tai duoc du lieu khoa/dich vu tu CSDL.";
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
      return "Khong co du lieu dich vu/bac si trong CSDL.";
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
        `- Dich vu ${serviceId}: ${service.serviceName}` +
          (shortenText(service.serviceDescription) ? ` | Mo ta: ${shortenText(service.serviceDescription)}` : "")
      );

      if (service.doctors.length === 0) {
        lines.push("  Bac si phu hop: Chua co du lieu.");
      } else {
        const doctorParts = service.doctors.map((doctor) => {
          const meta = [
            doctor.specialtyName ? `Khoa ${doctor.specialtyName}` : "",
            Number.isFinite(doctor.experience as number) ? `${doctor.experience} nam kinh nghiem` : "",
            doctor.doctorCode ? `Ma ${doctor.doctorCode}` : "",
          ].filter(Boolean);

          const intro = shortenText(doctor.doctorDescription, 70);
          const base = meta.length ? `${doctor.doctorName} (${meta.join(", ")})` : doctor.doctorName;
          const link = `/bac-si/${doctor.doctorId}?service_id=${serviceId}`;
          return intro ? `${base} - ${intro} | Lien ket: ${link}` : `${base} | Lien ket: ${link}`;
        });
        lines.push(`  Bac si phu hop: ${doctorParts.join("; ")}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "Khong tai duoc du lieu dich vu/bac si tu CSDL.";
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi duoc su dung chat AI" },
        { status: 403 }
      );
    }

    const ip = getClientIpFromHeaders(req.headers);
    const rate = await consumeRateLimit(`ai:chat:${authUser.id}:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Ban gui qua nhieu yeu cau, vui long thu lai sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    let body: ChatBody;
    try {
      body = (await req.json()) as ChatBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const messages = sanitizeMessages(body.messages);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (!lastUserMessage) {
      return NextResponse.json(
        { success: false, message: "Noi dung chat khong hop le" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "Chua cau hinh GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    // High-priority safety filter for dangerous symptoms
    const emergencyAdvice = tryEmergencyAdvice(lastUserMessage);
    if (emergencyAdvice) {
      return NextResponse.json({
        success: true,
        message: "Canh bao trieu chung nguy hiem",
        data: { answer: emergencyAdvice },
      });
    }

    // Deterministic FAQ
    const faqAnswer = tryFaqAnswer(lastUserMessage);
    if (faqAnswer) {
      return NextResponse.json({
        success: true,
        message: "FAQ tra loi thanh cong",
        data: { answer: faqAnswer },
      });
    }

    const exactExamAnswer = await tryExactExamLookup(lastUserMessage).catch(() => null);
    if (exactExamAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu kham theo du lieu chinh xac thanh cong",
        data: { answer: exactExamAnswer },
      });
    }

    const weeklyScheduleAnswer = await tryGeneralWeeklyScheduleLookup(lastUserMessage).catch(() => null);
    if (weeklyScheduleAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu lich kham trong tuan thanh cong",
        data: { answer: weeklyScheduleAnswer },
      });
    }

    // Deterministic lookup for specialty queries (name/code)
    const directSpecialtyAnswer = await tryDirectSpecialtyLookup(lastUserMessage).catch(() => null);
    if (directSpecialtyAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu khoa thanh cong",
        data: { answer: directSpecialtyAnswer },
      });
    }

    const directDoctorAnswer = await tryDirectDoctorLookup(lastUserMessage).catch(() => null);
    if (directDoctorAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu bac si thanh cong",
        data: { answer: directDoctorAnswer },
      });
    }

    const directScheduleAnswer = await tryServiceScheduleLookup(lastUserMessage).catch(() => null);
    if (directScheduleAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu lich dich vu thanh cong",
        data: { answer: directScheduleAnswer },
      });
    }

    // Deterministic lookup for service code queries (e.g. "dich 01")
    const directServiceAnswer = await tryDirectServiceLookup(lastUserMessage).catch(() => null);
    if (directServiceAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu dich vu thanh cong",
        data: { answer: directServiceAnswer },
      });
    }

    // Deterministic triage for symptom questions
    const symptomTriageAnswer = await tryDirectSymptomTriage(lastUserMessage).catch(() => null);
    if (symptomTriageAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tu van trieu chung thanh cong",
        data: { answer: symptomTriageAnswer },
      });
    }

    const reminderAnswer = await tryAppointmentReminders(lastUserMessage, authUser.id).catch(() => null);
    if (reminderAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu lich sap toi thanh cong",
        data: { answer: reminderAnswer },
      });
    }

    const reviewAnswer = await tryPendingReviewSuggestion(lastUserMessage, authUser.id).catch(() => null);
    if (reviewAnswer) {
      return NextResponse.json({
        success: true,
        message: "Tra cuu danh gia thanh cong",
        data: { answer: reviewAnswer },
      });
    }

    const contextAnswer = await tryPatientContextSuggestion(lastUserMessage, authUser.id).catch(() => null);
    if (contextAnswer) {
      return NextResponse.json({
        success: true,
        message: "Goi y theo lich su thanh cong",
        data: { answer: contextAnswer },
      });
    }

    const model = process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash";
    const dbContext = await buildSpecialtyServiceContext();
    const serviceDoctorContext = await buildServiceDoctorContext();
    const defaultSystemPrompt = `
Ban la tro ly AI ho tro benh nhan tren he thong dat lich kham.

Quy tac:
- Bat buoc tra loi 100% bang tieng Viet (khong dung tieng Anh, tru ten rieng/chuyen mon bat buoc).
- Tra loi ngan gon, lich su, de hieu.
- Khong chan doan benh, khong ke don thuoc.
- Neu co dau hieu nguy hiem, khuyen nguoi dung den co so y te som.
- Khong tu tao du lieu bac si, khoa, dich vu, gia tien neu khong co du lieu dau vao.
- Neu thieu thong tin, hay noi ro can bo sung du lieu.
- Neu nguoi dung hoi ve mot khoa:
  + Mo ta ngan ve khoa do dua tren du lieu CSDL.
  + Goi y cac dich vu thuoc khoa do (neu co).
  + Ten dich vu phai de dang Markdown co link:
    [Ten dich vu](/dich-vu/[service_id])
  + Neu khong thay khoa phu hop, noi ro rang khong co du lieu khoa do.
- Neu nguoi dung hoi ve mot dich vu:
  + Mo ta ngan ve dich vu do dua tren du lieu CSDL.
  + Cung cap danh sach bac si phu hop co trong he thong (neu co).
  + Ten bac si phai de dang Markdown co link den trang chi tiet:
    [Ten bac si](/bac-si/[doctor_id]?service_id=[service_id])
  + Neu chua co bac si cho dich vu do, noi ro de nguoi dung biet.
- Neu nguoi dung hoi thong tin mot bac si, uu tien tra loi dung mau:
  TĂªn: ...
  MĂ£ bĂ¡c sÄ©: ...
  Khoa: ...
  MĂ´ táº£: ...
  Dá»‹ch vá»¥: ...
- Khong dung ky tu ** trong cau tra loi.

Du lieu khoa va dich vu tu CSDL (chi duoc dung trong phien tra loi hien tai):
${dbContext}

Du lieu dich vu va bac si tu CSDL (chi duoc dung trong phien tra loi hien tai):
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
        "He thong AI tam thoi ban. Ban co the thao tac nhanh:",
        "- [Tim bac si/dich vu](/dich-vu)",
        "- [Xem danh sach chuyen khoa](/chuyen-khoa)",
        "- [Quan ly lich hen cua toi](/patient/appointments)",
        "- [Gui yeu cau ho tro admin](/ho-tro/admin)",
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
        { success: false, message: "Khong nhan duoc phan hoi tu AI" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "AI phan hoi thanh cong",
      data: { answer },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { success: false, message: "AI phan hoi qua lau, vui long thu lai" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}


