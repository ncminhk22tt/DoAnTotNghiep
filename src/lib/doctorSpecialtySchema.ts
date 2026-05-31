import { hasTable } from "@/lib/db";

let readyCache: boolean | null = null;
let loadingPromise: Promise<boolean> | null = null;

export async function getDoctorSpecialtiesReady() {
  if (readyCache !== null) return readyCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    readyCache = await hasTable("doctor_specialties");
    return readyCache;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}
