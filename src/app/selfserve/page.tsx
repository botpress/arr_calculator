import SegmentArrPage from "@/app/segment-arr/SegmentArrPage";
import { notFound } from "next/navigation";

export default function SelfservePage() {
  const archived = true;
  if (archived) notFound();

  return (
    <SegmentArrPage
      segment="selfserve"
      title="Self Serve"
      subtitle="Stripe self-serve ARR only (non sales-assist)."
    />
  );
}
