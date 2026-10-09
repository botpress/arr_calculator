import { notFound } from "next/navigation";
import TeamScorecardClient from "@/app/scorecards/[team]/TeamScorecardClient";
import { isTeamScorecardKey } from "@/lib/teamScorecardDefinitions";

export default async function TvTeamScorecardPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  if (!isTeamScorecardKey(team)) notFound();
  return <TeamScorecardClient teamKey={team} tvMode />;
}
