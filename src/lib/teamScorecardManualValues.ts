import type { TeamScorecardManualValues } from "@/lib/teamScorecardManualValuesStore";
import type { TeamScorecardReportResponse } from "@/lib/teamScorecardReport";

export function applyTeamScorecardManualValues(
  report: TeamScorecardReportResponse,
  manualValues: TeamScorecardManualValues,
): TeamScorecardReportResponse {
  const metrics = report.metrics.map((metric) => {
    if (metric.valueKind === "calculated" || metric.values.length) return { ...metric };
    const manual = manualValues[metric.id];
    if (!manual) return { ...metric, valueKind: "blank" as const };
    return {
      ...metric,
      valueKind: "manual" as const,
      manualValue: manual.value,
      manualUpdatedAt: manual.updatedAt,
      manualUpdatedBy: manual.updatedBy,
      values: [{ label: "Manual actual", value: manual.value, format: "number" as const }],
      source: "Manual admin entry",
      calculation: "Entered manually for this reporting month because no calculated data is available.",
    };
  });
  return {
    ...report,
    metrics,
    populatedMetricCount: metrics.filter((metric) => metric.values.length > 0).length,
  };
}
