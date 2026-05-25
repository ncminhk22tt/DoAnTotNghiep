"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./services.module.css";

type Specialty = {
  id: number;
  name: string;
};

type Service = {
  id: number;
  name: string;
  specialty_id: number;
  specialty_name?: string;
  description: string | null;
  logo_url: string | null;
};

export default function AdminServicesPage() {
  const { showToast } = useToast();

  const [items, setItems] = useState<Service[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);

  const [name, setName] = useState("");
  const [specialtyId, setSpecialtyId] = useState<number>(0);
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState<Service | null>(null);

  const [filterSpecialtyId, setFilterSpecialtyId] = useState<number>(0);
  const [filterKeyword, setFilterKeyword] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadAll() {
    const token = getAccessToken();
    const [servicesRes, specialtiesRes] = await Promise.all([
      apiClient.get<{ data: Service[] }>("/api/admin/services", token),
      apiClient.get<{ data: Specialty[] }>("/api/admin/specialties", token),
    ]);

    setItems(servicesRes.data || []);
    setSpecialties(specialtiesRes.data || []);
  }

  const filteredItems = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    return items.filter((item) => {
      const matchSpecialty = !filterSpecialtyId || item.specialty_id === filterSpecialtyId;
      const matchKeyword =
        !keyword ||
        item.name.toLowerCase().includes(keyword) ||
        (item.description || "").toLowerCase().includes(keyword) ||
        (item.specialty_name || "").toLowerCase().includes(keyword);
      return matchSpecialty && matchKeyword;
    });
  }, [items, filterKeyword, filterSpecialtyId]);

  function resetForm() {
    setName("");
    setDescription("");
    setSpecialtyId(0);
    setLogoUrl("");
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
    setEditing(null);
  }

  async function uploadLogo(file: File): Promise<string> {
    const token = getAccessToken();
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/services/upload", {
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

    if (!name.trim()) {
      showToast("Vui lòng nhập tên dịch vụ", "error");
      return;
    }

    if (!specialtyId || specialtyId <= 0) {
      showToast("Vui lòng chọn chuyên khoa", "error");
      return;
    }

    setIsSaving(true);
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
        specialty_id: specialtyId,
        description,
        logo_url: finalLogoUrl.trim() || null,
      };

      if (editing) {
        await apiClient.patch(`/api/admin/services/${editing.id}`, payload, token);
        showToast("Cập nhật dịch vụ thành công", "success");
      } else {
        await apiClient.post("/api/admin/services", payload, token);
        showToast("Tạo dịch vụ thành công", "success");
      }

      resetForm();
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Lưu thất bại", "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function onDeleteConfirmed() {
    if (!confirmDeleteId) return;

    try {
      const token = getAccessToken();
      await apiClient.delete(`/api/admin/services/${confirmDeleteId}`, token);
      setConfirmDeleteId(null);
      await loadAll();
      showToast("Xóa dịch vụ thành công", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Xóa thất bại", "error");
    }
  }

  function onEdit(item: Service) {
    setEditing(item);
    setName(item.name);
    setDescription(item.description || "");
    setLogoUrl(item.logo_url || "");
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
    setSpecialtyId(item.specialty_id);
  }

  useEffect(() => {
    loadAll().catch((err) =>
      showToast(err instanceof Error ? err.message : "Tải dữ liệu thất bại", "error")
    );
  }, []);

  return (
    <div className={styles.page}>
      {/* <h2 className={styles.title}>Quản lý dịch vụ</h2> */}

      <form onSubmit={onSubmit} className={styles.formCard}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Tên dịch vụ</label>
            <input
              placeholder="Nhập tên dịch vụ"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Chuyên khoa</label>
            <select
              value={specialtyId}
              onChange={(e) => setSpecialtyId(Number(e.target.value))}
              className={`${styles.input} ${styles.selectInput}`}
            >
              <option value={0}>Chọn chuyên khoa</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Mô tả</label>
          <input
            placeholder="Nhập mô tả ngắn"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={styles.input}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Upload Logo</label>
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
          <div className={styles.field}>
            <label className={styles.label}>Xem trước logo</label>
            {logoFile ? (
              <img src={URL.createObjectURL(logoFile)} alt="logo service preview" className={styles.logoPreview} />
            ) : logoUrl.trim() ? (
              <img src={logoUrl} alt="logo service preview" className={styles.logoPreview} />
            ) : (
              <div className={styles.logoPlaceholder}>Chua co logo</div>
            )}
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

      <div className={styles.filterCard}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Tìm theo chuyên khoa</label>
            <select
              value={filterSpecialtyId}
              onChange={(e) => setFilterSpecialtyId(Number(e.target.value))}
              className={`${styles.input} ${styles.selectInput}`}
            >
              <option value={0}>Tất cả chuyên khoa</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Tìm theo dịch vụ</label>
            <input
              placeholder="Nhập tên dịch vụ hoặc mô tả"
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              className={styles.input}
            />
          </div>
        </div>
      </div>

      <div className={styles.listContainer}>
        <table className={styles.desktopTable}>
          <thead>
            <tr>
              <th className={styles.th}>Tên dịch vụ</th>
              <th className={styles.th}>Logo</th>
              <th className={styles.th}>Chuyên khoa</th>
              <th className={styles.th}>Mô tả</th>
              <th className={`${styles.th} ${styles.actionHeader}`}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td className={styles.td}>{item.name}</td>
                <td className={styles.td}>
                  {item.logo_url ? (
                    <img src={item.logo_url} alt={item.name} className={styles.logoThumb} />
                  ) : (
                    "-"
                  )}
                </td>
                <td className={styles.td}>{item.specialty_name || "-"}</td>
                <td className={styles.td}>{item.description || "-"}</td>
                <td className={`${styles.td} ${styles.actionCell}`}>
                  <div className={styles.actionGroup}>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.mobileList}>
          {filteredItems.map((item) => (
            <div key={item.id} className={styles.mobileCard}>
              <div className={styles.mobileRow}>
                <strong>Tên:</strong> <span>{item.name}</span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Logo:</strong> <span>{item.logo_url ? <img src={item.logo_url} alt={item.name} className={styles.logoThumb} /> : "-"}</span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Chuyên khoa:</strong> <span>{item.specialty_name || "-"}</span>
              </div>
              <div className={styles.mobileRow}>
                <strong>Mô tả:</strong> <span>{item.description || "-"}</span>
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
      </div>

      {confirmDeleteId ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xác nhận xóa</h3>
            <p className={styles.modalText}>Bạn có chắc chắn muốn xóa dịch vụ này không?</p>
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
  );
}
