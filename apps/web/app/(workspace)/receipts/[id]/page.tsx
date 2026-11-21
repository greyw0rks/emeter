import { notFound } from "next/navigation";
import { HashSchema } from "@emeter/shared";
import { ReceiptInspector } from "../../../../components/receipt-inspector";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, parsed = HashSchema.safeParse(id);
  if (!parsed.success) notFound();
  return <ReceiptInspector id={parsed.data} />;
}
