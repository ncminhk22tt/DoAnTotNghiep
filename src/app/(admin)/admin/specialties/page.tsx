  "use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./specialties.module.css";

type Specialty = {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
  head_doctor_user_id: number | null;
  deputy_doctor_user_id: number | null;
  head_doctor_name: string | null;
  deputy_doctor_name: string | null;
};

type DoctorUser = {
  id: number;
  username: string;
  full_name: string;
  status: string;
  doctor_code: string | null;
};

function doctorDisplayName(fullName: string, doctorCode: string | null) {
  return `${fullName} - ${doctorCode && doctorCode.trim() ? doctorCode : "Chưa có mã"}`;
}

export default function AdminSpecialtiesPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<Specialty[]>([]);
  const [doctorUsers, setDoctorUsers] = useState<DoctorUser[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const [headDoctorId, setHeadDoctorId] = useState<number | null>(null);
  const [deputyDoctorId, setDeputyDoctorId] = useState<number | null>(null);

  const [headKeyword, setHeadKeyword] = useState("");
  const [deputyKeyword, setDeputyKeyword] = useState("");
  const [showHeadSuggest, setShowHeadSuggest] = useState(false);
  const [showDeputySuggest, setShowDeputySuggest] = useState(false);

  const [editing, setEditing] = useState<Specialty | null>(null);
  const [error, setError] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadData() {
    try {
      setError("");
      const token = getAccessToken();
      const [specialtiesRes, doctorsRes] = await Promise.all([
        apiClient.get<{ data: Specialty[] }>("/api/admin/specialties", token),
        apiClient.get<{ data: DoctorUser[] }>("/api/admin/doctors/users", token),
      ]);
      setItems(specialtiesRes.data || []);
      setDoctorUsers((doctorsRes.data || []).filter((d) => d.status === "active"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Không thể tải dữ liệu";
      setError(msg);
      showToast(msg, "error");
    }
  }

  const headSuggestions = useMemo(() => {
    const keyword = headKeyword.trim().toLowerCase();
    if (!keyword) return doctorUsers.slice(0, 8);
    return doctorUsers
      .filter(
        (u) =>
          u.full_name.toLowerCase().includes(keyword) ||
          (u.doctor_code || "").toLowerCase().includes(keyword)
      )
      .slice(0, 8);
  }, [doctorUsers, headKeyword]);

  const deputySuggestions = useMemo(() => {
    const keyword = deputyKeyword.trim().toLowerCase();
    if (!keyword) return doctorUsers.slice(0, 8);
    return doctorUsers
      .filter(
        (u) =>
          u.full_name.toLowerCase().includes(keyword) ||
          (u.doctor_code || "").toLowerCase().includes(keyword)
      )
      .slice(0, 8);
  }, [doctorUsers, deputyKeyword]);

  const selectedHeadDoctor = useMemo(
    () => doctorUsers.find((u) => u.id === headDoctorId) || null,
    [doctorUsers, headDoctorId]
  );
  const selectedDeputyDoctor = useMemo(
    () => doctorUsers.find((u) => u.id === deputyDoctorId) || null,
    [doctorUsers, deputyDoctorId]
  );

  function resetForm() {
    setEditing(null);
    setName("");
    setDescription("");
    setLogoUrl("");
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
    setHeadDoctorId(null);
    setDeputyDoctorId(null);
    setHeadKeyword("");
    setDeputyKeyword("");
    setShowHeadSuggest(false);
    setShowDeputySuggest(false);
  }

  async function uploadLogo(file: File): Promise<string> {
    const token = getAccessToken();
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/specialties/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.message || "Upload logo thất bại");
    }
    return json.data.url as string;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (headKeyword.trim() && !headDoctorId) {
      showToast("Vui lòng chọn Trưởng khoa từ danh sách gợi ý.", "error");
      return;
    }
    if (deputyKeyword.trim() && !deputyDoctorId) {
      showToast("Vui lòng chọn Phó khoa từ danh sách gợi ý.", "error");
      return;
    }
    if (headDoctorId && deputyDoctorId && headDoctorId === deputyDoctorId) {
      showToast("Trưởng khoa và phó khoa không được trùng nhau.", "error");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      let finalLogoUrl = logoUrl;
      if (logoFile) {
        finalLogoUrl = await uploadLogo(logoFile);
        setLogoUrl(finalLogoUrl);
        setLogoFile(null);
        if (logoInputRef.current) logoInputRef.current.value = "";
      }

      const token = getAccessToken();
      const payload = {
        name,
        description,
        logo_url: finalLogoUrl.trim() || null,
        head_doctor_user_id: headDoctorId,
        deputy_doctor_user_id: deputyDoctorId,
      };

      if (editing) {
        await apiClient.patch(`/api/admin/specialties/${editing.id}`, payload, token);
        showToast("Cập nhật chuyên khoa thành công", "success");
      } else {
        await apiClient.post("/api/admin/specialties", payload, token);
        showToast("Tạo chuyên khoa thành công", "success");
      }

      resetForm();
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lưu dữ liệu thất bại";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function onDeleteConfirmed() {
    if (!confirmDeleteId) return;
    try {
      const token = getAccessToken();
      await apiClient.delete(`/api/admin/specialties/${confirmDeleteId}`, token);
      setConfirmDeleteId(null);
      await loadData();
      showToast("Xóa chuyên khoa thành công", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Xóa thất bại";
      setError(msg);
      showToast(msg, "error");
    }
  }

  function onEdit(item: Specialty) {
    setEditing(item);
    setName(item.name);
    setDescription(item.description || "");
    setLogoUrl(item.logo_url || "");
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = "";

    setHeadDoctorId(item.head_doctor_user_id);
    setDeputyDoctorId(item.deputy_doctor_user_id);

    setHeadKeyword(item.head_doctor_name || "");
    setDeputyKeyword(item.deputy_doctor_name || "");
  }

  const logoPreviewSrc = useMemo(() => {
    if (logoFile) return URL.createObjectURL(logoFile);
    return logoUrl.trim() || null;
  }, [logoFile, logoUrl]);

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className={styles.page}>
      {/* <h2 className={styles.title}>Quản lý chuyên khoa</h2> */}

      <form onSubmit={onSubmit} className={styles.formCard}>
        <div className={styles.row}>
          <div>
            <label className={styles.label}>Tên chuyên khoa</label>
            <input
              placeholder="Nhập tên chuyên khoa"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
            />
          </div>

          <div>
            <label className={styles.label}>Mô tả</label>
            <input
              placeholder="Nhập mô tả ngắn"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.input}
            />
          </div>

          <div>
            <label className={styles.label}>Logo</label>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setLogoFile(file);
              }}
              className={styles.input}
            />
            <small className={styles.hint}>Chỉ chấp nhận PNG, JPG, WEBP, GIF. Tối đa 2MB.</small>
          </div>
          <div>
            <label className={styles.label}>Xem trước logo</label>
            {logoPreviewSrc ? (
              <img src={logoPreviewSrc} alt="logo preview" className={styles.logoPreview} />
            ) : (
              <div className={styles.logoPlaceholder}>Chưa có logo</div>
            )}
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.pickerWrap}>
            <label className={styles.label}>Trưởng khoa</label>
            <input
              placeholder="Nhập tên hoặc mã bác sĩ"
              value={headKeyword}
              onChange={(e) => {
                setHeadKeyword(e.target.value);
                setHeadDoctorId(null);
              }}
              onFocus={() => setShowHeadSuggest(true)}
              onBlur={() => setTimeout(() => setShowHeadSuggest(false), 120)}
              className={styles.input}
            />
            {showHeadSuggest ? (
              <div className={styles.suggestBox}>
                {headSuggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={styles.suggestItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setHeadDoctorId(u.id);
                      setHeadKeyword(`${u.full_name} - ${u.doctor_code || u.username}`);
                      setShowHeadSuggest(false);
                    }}
                  >
                    {u.full_name} - {u.doctor_code || u.username}
                  </button>
                ))}
              </div>
            ) : null}
            {selectedHeadDoctor ? (
              <div className={styles.hint}>
                Đã chọn Trưởng khoa: {selectedHeadDoctor.full_name} - {" "}
                {selectedHeadDoctor.doctor_code || selectedHeadDoctor.username}
              </div>
            ) : null}
          </div>

          <div className={styles.pickerWrap}>
            <label className={styles.label}>Phó khoa</label>
            <input
              placeholder="Nhập tên hoặc mã bác sĩ"
              value={deputyKeyword}
              onChange={(e) => {
                setDeputyKeyword(e.target.value);
                setDeputyDoctorId(null);
              }}
              onFocus={() => setShowDeputySuggest(true)}
              onBlur={() => setTimeout(() => setShowDeputySuggest(false), 120)}
              className={styles.input}
            />
            {showDeputySuggest ? (
              <div className={styles.suggestBox}>
                {deputySuggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={styles.suggestItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDeputyDoctorId(u.id);
                      setDeputyKeyword(`${u.full_name} - ${u.doctor_code || u.username}`);
                      setShowDeputySuggest(false);
                    }}
                  >
                    {u.full_name} - {u.doctor_code || u.username}
                  </button>
                ))}
              </div>
            ) : null}
            {selectedDeputyDoctor ? (
              <div className={styles.hint}>
                Đã chọn Phó khoa: {selectedDeputyDoctor.full_name} - {" "}
                {selectedDeputyDoctor.doctor_code || selectedDeputyDoctor.username}
              </div>
            ) : null}
          </div>

        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} type="submit" disabled={isSaving}>
            {isSaving ? "Đang lưu..." : editing ? "Cập nhật" : "Tạo mới"}
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={resetForm}>
            Làm mới
          </button>
        </div>
      </form>

      <div className={styles.listContainer}>
        <table className={`${styles.table} ${styles.desktopTable}`}>
          <thead>
            <tr>
              <th className={styles.th}>Tên</th>
              <th className={styles.th}>Logo</th>
              <th className={styles.th}>Mô tả</th>
              <th className={styles.th}>Trưởng khoa</th>
              <th className={styles.th}>Phó khoa</th>
              <th className={styles.th}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={styles.td}>{item.name}</td>
                <td className={styles.td}>
                  {item.logo_url ? (
                    <img src={item.logo_url} alt={item.name} className={styles.logoThumb} />
                  ) : (
                    "-"
                  )}
                </td>
                <td className={styles.td}>{item.description || "-"}</td>
                <td className={styles.td}>{item.head_doctor_name || "-"}</td>
                <td className={styles.td}>{item.deputy_doctor_name || "-"}</td>
                <td className={`${styles.td} ${styles.actionCell}`}>
                  <div className={styles.actionGroup}>
                    <button className={styles.editBtn} onClick={() => onEdit(item)} translate="no">
                      Sửa
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => setConfirmDeleteId(item.id)}
                      translate="no"
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.mobileList}>
          {items.map((item) => (
            <div key={item.id} className={styles.mobileCard}>
              <div className={styles.mobileRow}>
                <strong>Tên:</strong> <span>{item.name}</span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Logo:</strong>{" "}
                <span>
                  {item.logo_url ? <img src={item.logo_url} alt={item.name} className={styles.logoThumb} /> : "-"}
                </span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Mô tả:</strong> <span>{item.description || "-"}</span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Trưởng khoa:</strong> <span>{item.head_doctor_name || "-"}</span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Phó khoa:</strong> <span>{item.deputy_doctor_name || "-"}</span>
              </div>
              <div className={styles.mobileActions}>
                <button className={styles.editBtn} onClick={() => onEdit(item)}>
                  Sửa
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => setConfirmDeleteId(item.id)}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>

      {confirmDeleteId ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xác nhận xóa</h3>
            <p className={styles.modalText}>
              Bạn có chắc chắn muốn xóa chuyên khoa này không?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setConfirmDeleteId(null)}>
                Hủy
              </button>
              <button className={styles.dangerBtn} onClick={onDeleteConfirmed}>
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}
