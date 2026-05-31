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

type DropdownOption = {
  value: number;
  label: string;
};

type SpecialtyDropdownProps = {
  label: string;
  value: number | "";
  placeholder: string;
  options: DropdownOption[];
  onChange: (value: number | "") => void;
  disabled?: boolean;
};

function SpecialtyDropdown({
  label,
  value,
  placeholder,
  options,
  onChange,
  disabled = false,
}: SpecialtyDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={styles.field} ref={wrapperRef}>
      <label className={styles.label}>{label}</label>
      <button
        type="button"
        className={`${styles.input} ${styles.dropdownButton}`}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        disabled={disabled}
      >
        <span className={selected ? styles.dropdownValue : styles.dropdownPlaceholder}>
          {selected ? selected.label : placeholder}
        </span>
        <span className={styles.dropdownArrow}>▾</span>
      </button>

      {open && !disabled ? (
        <div className={styles.dropdownMenu}>
          <button
            type="button"
            className={styles.dropdownItem}
            onClick={() => {
              onChange(0);
              setOpen(false);
            }}
          >
            {placeholder}
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.dropdownItem}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminServicesPage() {
  const { showToast } = useToast();

  const [items, setItems] = useState<Service[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);

  const [name, setName] = useState("");
  const [specialtyId, setSpecialtyId] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState<Service | null>(null);

  const [filterSpecialtyId, setFilterSpecialtyId] = useState<number>(0);
  const [filterKeyword, setFilterKeyword] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const specialtyOptions = useMemo(
    () => specialties.map((specialty) => ({ value: specialty.id, label: specialty.name })),
    [specialties]
  );

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
    setSpecialtyId("");
    setLogoUrl("");
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
    setEditing(null);
  }

  function resetFilters() {
    setFilterSpecialtyId(0);
    setFilterKeyword("");
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

    if (!specialtyId || Number(specialtyId) <= 0) {
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
        specialty_id: Number(specialtyId),
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
    setSpecialtyId(item.specialty_id || "");
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

          <SpecialtyDropdown
            label="Chuyên khoa"
            value={specialtyId}
            placeholder="Chọn chuyên khoa"
            options={specialtyOptions}
            onChange={(next) => setSpecialtyId(next === 0 ? "" : next)}
          />
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
          <SpecialtyDropdown
            label="Tìm theo chuyên khoa"
            value={filterSpecialtyId}
            placeholder="Tất cả chuyên khoa"
            options={specialtyOptions}
            onChange={(next) => setFilterSpecialtyId(typeof next === "number" ? next : 0)}
          />

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

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={resetFilters}
          >
            Xóa lọc
          </button>
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
