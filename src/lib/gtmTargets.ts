export const FY27_MONTH_KEYS = [
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
] as const;

export type GtmTargetFormat = "currency" | "count" | "percent";

export type GtmTargetDefinition = {
  id: string;
  section: string;
  label: string;
  format: GtmTargetFormat;
  monthly: Array<number | null>;
  fy27: number | null;
};

// Source of truth: the workbook's Targets tab, columns Apr-26 through Mar-27.
// A dash in the workbook is represented as null.
export const GTM_TARGETS: GtmTargetDefinition[] = [
  { id: "beginning_arr", section: "Company ARR plan", label: "Beginning ARR", format: "currency", monthly: [6549535, 6569856, 6695690, 6826605, 6726213, 7446356, 8318658, 9618386, 11119678, 13517908, 15919146, 18641903], fy27: 6549535 },
  { id: "new_business_arr", section: "Company ARR plan", label: "New Business ARR", format: "currency", monthly: [387144, 320821, 412669, 281047, 1083011, 1283243, 1681436, 1983138, 2104103, 3117172, 3560303, 3298558], fy27: 19512645 },
  { id: "expansion_arr", section: "Company ARR plan", label: "Expansion ARR", format: "currency", monthly: [96347, 134466, 180281, 193555, 87697, 93792, 104255, 115501, 129212, 152746, 174766, 200132], fy27: 1662749 },
  { id: "churn_arr", section: "Company ARR plan", label: "Churn ARR", format: "currency", monthly: [-385321, -247101, -357290, -531140, -415194, -454583, -421320, -520813, -598017, -743912, -856342, -950306], fy27: -6481337 },
  { id: "contraction_arr", section: "Company ARR plan", label: "Contraction ARR", format: "currency", monthly: [-77849, -93657, -117933, -76770, -52758, -60890, -79846, -90225, -103700, -129569, -160015, -193576], fy27: -1236787 },
  { id: "migrations_transfers", section: "Company ARR plan", label: "Migrations & transfers (net)", format: "currency", monthly: [null, 11304, 13188, 32916, 17387, 10739, 15203, 13690, 866633, 4802, 4045, 3289], fy27: 993196 },
  { id: "ending_arr", section: "Company ARR plan", label: "Ending ARR", format: "currency", monthly: [6569856, 6695690, 6826605, 6726213, 7446356, 8318658, 9618386, 11119678, 13517908, 15919146, 18641903, 21000000], fy27: 21000000 },
  { id: "net_new_arr", section: "Company ARR plan", label: "Net New ARR", format: "currency", monthly: [20322, 125833, 130915, -100391, 720143, 872302, 1299728, 1501292, 2398230, 2401239, 2722757, 2358097], fy27: 14450465 },
  { id: "arr_growth_mom", section: "Company ARR plan", label: "ARR growth — MoM", format: "percent", monthly: [0.003, 0.019, 0.02, -0.015, 0.107, 0.117, 0.156, 0.156, 0.216, 0.178, 0.171, 0.126], fy27: 2.206 },

  { id: "new_arr_selfserve", section: "New business ARR by motion", label: "Self-serve", format: "currency", monthly: [205413, 235170, 300754, 219396, 520197, 522906, 864285, 869704, 888670, 1476600, 1506403, 1522659], fy27: 9132158 },
  { id: "new_arr_sales_assist", section: "New business ARR by motion", label: "Sales Assist", format: "currency", monthly: [15230, 14871, 29487, 12957, 155415, 155415, 216933, 216933, 220171, 252549, 255787, 259025], fy27: 1804772 },
  { id: "new_arr_sales_led", section: "New business ARR by motion", label: "Sales-led", format: "currency", monthly: [166501, 70780, 82428, 48694, 212568, 410090, 311329, 607613, 706374, 790090, 1200180, 918942], fy27: 5525587 },
  { id: "new_arr_outbound", section: "New business ARR by motion", label: "Outbound", format: "currency", monthly: [null, null, null, null, 194832, 194832, 288889, 288889, 288889, 597933, 597933, 597933], fy27: 3050128 },
  { id: "new_arr_total", section: "New business ARR by motion", label: "Total New Business ARR", format: "currency", monthly: [387144, 320821, 412669, 281047, 1083011, 1283243, 1681436, 1983138, 2104103, 3117172, 3560303, 3298558], fy27: 19512645 },

  { id: "new_logos_selfserve", section: "New logo targets by motion", label: "Self-serve", format: "count", monthly: [67, 77, 98, 72, 170, 171, 283, 285, 291, 483, 493, 498], fy27: 2988 },
  { id: "new_logos_sales_assist", section: "New logo targets by motion", label: "Sales Assist", format: "count", monthly: [1, 1, 2, 1, 9, 9, 13, 13, 13, 15, 15, 16], fy27: 108 },
  { id: "new_logos_sales_led", section: "New logo targets by motion", label: "Sales-led", format: "count", monthly: [6, 2, 3, 2, 7, 14, 10, 20, 24, 26, 40, 31], fy27: 184 },
  { id: "new_logos_outbound", section: "New logo targets by motion", label: "Outbound", format: "count", monthly: [null, null, null, null, 6, 6, 10, 10, 10, 20, 20, 20], fy27: 102 },
  { id: "new_logos_total", section: "New logo targets by motion", label: "Total New Logos", format: "count", monthly: [74, 80, 103, 74, 193, 201, 316, 327, 337, 545, 568, 564], fy27: 3382 },

  { id: "expansion_sales_led", section: "Expansion ARR targets", label: "Sales-led expansion", format: "currency", monthly: [8060, 800, 27111, 32143, 44849, 47643, 53668, 57664, 65299, 74103, 84067, 99090], fy27: 594499 },
  { id: "expansion_sales_assist", section: "Expansion ARR targets", label: "Sales Assist expansion", format: "currency", monthly: [25380, 73333, 97917, 75624, 18981, 20299, 21432, 23855, 25897, 28571, 31830, 34596], fy27: 477715 },
  { id: "expansion_assigned_total", section: "Expansion ARR targets", label: "Total Expansion ARR (assigned)", format: "currency", monthly: [33440, 74133, 125028, 107767, 63830, 67942, 75100, 81519, 91196, 102674, 115897, 133687], fy27: 1072214 },
  { id: "expansion_selfserve", section: "Expansion ARR targets", label: "Memo: Self-serve expansion", format: "currency", monthly: [62907, 60333, 55253, 85788, 23866, 25850, 29154, 33983, 38015, 50072, 58869, 66445], fy27: 590536 },

  { id: "ending_arr_selfserve", section: "Ending ARR by motion", label: "Self-serve", format: "currency", monthly: [1938211, 2037958, 2202817, 2334525, 2678615, 2985873, 3608474, 4174405, 5568801, 6559054, 7487979, 8360036], fy27: 8360036 },
  { id: "ending_arr_sales_assist", section: "Ending ARR by motion", label: "Sales Assist", format: "currency", monthly: [1006374, 1009226, 1080848, 1031010, 1076947, 1099990, 1188098, 1246764, 1281787, 1316744, 1319280, 1301108], fy27: 1301108 },
  { id: "ending_arr_sales_led", section: "Ending ARR by motion", label: "Sales-led", format: "currency", monthly: [3625271, 3648505, 3542940, 3360679, 3495962, 3843130, 4143261, 4731067, 5410989, 6189086, 7382449, 8288728], fy27: 8288728 },
  { id: "ending_arr_outbound", section: "Ending ARR by motion", label: "Outbound", format: "currency", monthly: [null, null, null, null, 194832, 389664, 678553, 967442, 1256330, 1854263, 2452195, 3050128], fy27: 3050128 },
  { id: "ending_arr_total", section: "Ending ARR by motion", label: "Total Ending ARR", format: "currency", monthly: [6569856, 6695690, 6826605, 6726213, 7446356, 8318658, 9618386, 11119678, 13517908, 15919146, 18641903, 21000000], fy27: 21000000 },

  { id: "pipeline_sales_assist", section: "Pipeline required", label: "Sales Assist", format: "currency", monthly: [41162, 40191, 79695, 35020, 420040, 420040, 586306, 586306, 595056, 682565, 691316, 700066], fy27: 4877761 },
  { id: "pipeline_sales_led", section: "Pipeline required", label: "Sales-led", format: "currency", monthly: [438160, 186263, 216915, 128142, 559389, 1079185, 819287, 1598981, 1858879, 2079184, 3158369, 2418267], fy27: 14541019 },
  { id: "pipeline_outbound", section: "Pipeline required", label: "Outbound", format: "currency", monthly: [null, null, null, null, 556663, 556663, 825397, 825397, 825397, 1708379, 1708379, 1708379], fy27: 8714652 },
  { id: "pipeline_total", section: "Pipeline required", label: "Total Pipeline Required", format: "currency", monthly: [479322, 226454, 296610, 163162, 1536091, 2055887, 2230989, 3010683, 3279331, 4470128, 5558063, 4826712], fy27: 28133431 },

  { id: "team_sales", section: "Monthly targets by team", label: "Sales — new business", format: "currency", monthly: [181731, 85651, 111915, 61651, 562814, 760337, 817151, 1113434, 1215434, 1640571, 2053899, 1775899], fy27: 10380487 },
  { id: "team_marketing", section: "Monthly targets by team", label: "Marketing — new business", format: "currency", monthly: [205413, 235170, 300754, 219396, 520197, 522906, 864285, 869704, 888670, 1476600, 1506403, 1522659], fy27: 9132158 },
  { id: "team_account_management", section: "Monthly targets by team", label: "Account Management — expansion", format: "currency", monthly: [33440, 74133, 125028, 107767, 63830, 67942, 75100, 81519, 91196, 102674, 115897, 133687], fy27: 1072214 },
  { id: "team_total", section: "Monthly targets by team", label: "Total (new business + assigned expansion)", format: "currency", monthly: [420584, 394954, 537697, 388814, 1146841, 1351185, 1756536, 2064657, 2195299, 3219846, 3676199, 3432245], fy27: 20584858 },

  { id: "selfserve_churn", section: "Retention plan by motion", label: "Self-serve — churn", format: "currency", monthly: [-233343, -167263.8, -137220, -149422.68, -200616, -235176, -250176, -309888, -358776, -485256, -565248, -628836], fy27: -3721221.48 },
  { id: "selfserve_contraction", section: "Retention plan by motion", label: "Self-serve — contraction", format: "currency", monthly: [-33337.68, -28492.44, -53928, -24054, -29308.8369, -31149.80257, -40030.68565, -44307.38703, -47720.5252, -62480.17093, -80951.25827, -96598.37672], fy27: -572359.1633 },
  { id: "selfserve_migrations", section: "Retention plan by motion", label: "Self-serve — migrations & transfers", format: "currency", monthly: [0, 0, 0, 0, 29952, 24828, 19368, 16440, 874207.8, 11316, 9852, 8388], fy27: 994351.8 },
  { id: "sales_assist_churn", section: "Retention plan by motion", label: "Sales Assist — churn", format: "currency", monthly: [-73221, -73491, -51921, -118619.4, -83178.06663, -108006.6479, -110944.032, -141724.6319, -170041.416, -200455.7066, -232893.5627, -254269.9973], fy27: -1618766.461 },
  { id: "sales_assist_contraction", section: "Retention plan by motion", label: "Sales Assist — contraction", format: "currency", monthly: [-44511, -23164.56, -17049.36, -52716, -16234.8579, -18094.44642, -22669.05678, -25167.13515, -27188.63136, -32953.15033, -40139.72942, -46183.79277], fy27: -366071.7201 },
  { id: "sales_assist_migrations", section: "Retention plan by motion", label: "Sales Assist — migrations & transfers", format: "currency", monthly: [0, 11304, 13188, 32916.36, -29045.11287, -26569.27824, -16644.70041, -15229.93776, -13815.17511, -12754.10313, -12046.7218, -11339.34048], fy27: -80036.0098 },
  { id: "sales_led_churn", section: "Retention plan by motion", label: "Sales-led — churn", format: "currency", monthly: [-78757, -6346, -168149.01, -263097.5, -131400, -111400, -60200, -69200, -69200, -58200, -58200, -67200], fy27: -1141349.51 },
  { id: "sales_led_contraction", section: "Retention plan by motion", label: "Sales-led — contraction", format: "currency", monthly: [0, -42000, -46955.75007, 0, -7214.11566, -11645.28695, -17146.01455, -20750.88081, -28790.69638, -34136.15184, -38924.04351, -50793.51564], fy27: -298356.4554 },
  { id: "sales_led_migrations", section: "Retention plan by motion", label: "Sales-led — migrations & transfers", format: "currency", monthly: [0, 0, 0, 0, 16480, 12480, 12480, 12480, 6240, 6240, 6240, 6240], fy27: 78880 },
];

export function getGtmTarget(monthKey: string, targetId: string) {
  const monthIndex = FY27_MONTH_KEYS.indexOf(monthKey as (typeof FY27_MONTH_KEYS)[number]);
  if (monthIndex < 0) return null;
  const definition = GTM_TARGETS.find((target) => target.id === targetId);
  return definition?.monthly[monthIndex] ?? null;
}

export function getGtmTargetRows(monthKey: string) {
  const monthIndex = FY27_MONTH_KEYS.indexOf(monthKey as (typeof FY27_MONTH_KEYS)[number]);
  return GTM_TARGETS.map((target) => ({
    id: target.id,
    section: target.section,
    label: target.label,
    format: target.format,
    value: monthIndex >= 0 ? target.monthly[monthIndex] ?? null : null,
    fy27: target.fy27,
  }));
}

export function countBusinessDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  let total = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

export function paceMonthlyTarget(target: number | null, elapsedBusinessDays: number, totalBusinessDays: number) {
  if (target == null || totalBusinessDays <= 0) return null;
  return Math.round(target * (elapsedBusinessDays / totalBusinessDays) * 100) / 100;
}
