import Link from "next/link";
import { TEAM_SCORECARD_DEFINITIONS } from "@/lib/teamScorecardDefinitions";

export default function TvTeamScorecardsPage() {
  return (
    <div className="stripe-ui team-scorecards team-scorecards--tv">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Read-only performance dashboards</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Team Scorecards</h1>
            <p className="stripe-ui__subtitle">
              Select the team to display. These TV pages expose calculated scorecard results only and do not provide application-management actions.
            </p>
          </div>
          <span className="team-scorecards__tv-status">Password protected · read only</span>
        </div>
      </section>

      <section className="team-scorecards__directory" aria-label="TV team scorecards">
        {TEAM_SCORECARD_DEFINITIONS.map((team, index) => (
          <Link
            href={`/tv/scorecards/${team.key}`}
            className={`team-scorecards__directory-card ui-reveal ui-reveal-${Math.min(index + 1, 3)}`}
            key={team.key}
          >
            <span className="team-scorecards__directory-index">{String(index + 1).padStart(2, "0")}</span>
            <h2>{team.name}</h2>
            <p>{team.description}</p>
            <span className="team-scorecards__directory-meta">{team.metrics.length} metrics <span aria-hidden="true">→</span></span>
          </Link>
        ))}
      </section>
    </div>
  );
}
