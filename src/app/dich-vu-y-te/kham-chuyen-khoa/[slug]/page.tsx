import { redirect } from "next/navigation";

export default async function LegacySpecialtyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/chuyen-khoa/${slug}`);
}

