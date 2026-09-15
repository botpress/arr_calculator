import Link from "next/link";
import { TEAM_SCORECARD_DEFINITIONS } from "@/lib/teamScorecardDefinitions";

export default function TeamScorecardsPage() {
  return (
    <div className="stripe-ui team-scorecards">
      <section className="stripe-ui__hero ui-reveal">
        <div className="stripe-ui__eyebrow">Company operating scorecards</div>
        <div className="stripe-ui__hero-row">
          <div>
            <h1 className="stripe-ui__title">Team Scorecards</h1>
            <p className="stripe-ui__subtitle">
              One page per team, preserving the V2 scorecard and the added Finance and People Ops metrics. Supported actuals are calculated from connected sources; the rest stay blank.
            </p>
          </div>
        </div>
      </section>

      <section className="team-scorecards__directory" aria-label="Team scorecards">
        {TEAM_SCORECARD_DEFINITIONS.map((team, index) => (
          <Link
            href={`/scorecards/${team.key}`}
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
