"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";

type DetailResponse = {
  data: {
    medical_record: {
      id: number;
      diagnosis: string | null;
      notes: string | null;
    };
    prescriptions: Array<{
      id: number;
      items: Array<{
        id: number;
        medicine_name: string;
        dosage: string;
        duration: string;
      }>;
    }>;
    files: Array<{
      id: number;
      file_name: string;
      storage_path: string;
    }>;
  };
};

export default function PatientMedicalRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [id, setId] = useState<string>("");
  const [data, setData] = useState<DetailResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    params.then((p) => {
      if (mounted) setId(p.id);
    });
    return () => {
      mounted = false;
    };
  }, [params]);

  useEffect(() => {
    if (!id) return;

    async function load() {
      try {
        const token = getAccessToken();
        const res = await apiClient.get<DetailResponse>(`/api/patient/medical-records/${id}`, token);
        setData(res.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Khong the tai chi tiet");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) return <p>Dang tai chi tiet ho so...</p>;
  if (error) return <p style={{ color: "#dc2626" }}>{error}</p>;
  if (!data) return <p>Khong co du lieu</p>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Chi tiet ho so #{data.medical_record.id}</h2>
      <p>Chan doan: {data.medical_record.diagnosis || "-"}</p>
      <p>Ghi chu: {data.medical_record.notes || "-"}</p>

      <h3>Don thuoc</h3>
      <ul>
        {data.prescriptions.map((p) => (
          <li key={p.id}>
            Don #{p.id} - {p.items.length} thuoc
          </li>
        ))}
      </ul>

      <h3>Tep dinh kem</h3>
      <ul>
        {data.files.map((f) => (
          <li key={f.id}>
            {f.file_name} ({f.storage_path})
          </li>
        ))}
      </ul>
    </div>
  );
}

