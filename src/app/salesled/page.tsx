import SegmentArrPage from "@/app/segment-arr/SegmentArrPage";
import { notFound } from "next/navigation";

export default function SalesledPage() {
  const archived = true;
  if (archived) notFound();

  return (
    <SegmentArrPage
      segment="salesled"
      title="Sales-led"
      subtitle="HubSpot cloud contracted ARR plus Stripe sales-assist ARR."
    />
  );
}
