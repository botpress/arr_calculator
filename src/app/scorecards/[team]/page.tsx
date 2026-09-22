import { notFound } from "next/navigation";
import TeamScorecardClient from "./TeamScorecardClient";
import { isTeamScorecardKey } from "@/lib/teamScorecardDefinitions";

export default async function TeamScorecardPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  if (!isTeamScorecardKey(team)) notFound();
  return <TeamScorecardClient teamKey={team} />;
}
