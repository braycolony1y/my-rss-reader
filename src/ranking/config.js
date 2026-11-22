// Tunable constants of the deterministic story ranker. Everything here is a plain
// constant; there is no runtime learning. Environment overrides exist only so that
// operators can experiment without a deploy (values are validated and clamped).

const num = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' && process.env[name] != null
    ? Math.min(max, Math.max(min, value)) : fallback;
};

/**
 * Graded hot-news floor over DISTINCT real outlets (aggregators dropped, syndicated reposts and one publisher's
 * several hostnames collapsed; see outlets.js) whose first reports fall inside one `windowHours` window ending
 * within `activeHours` of now. Routine patterns (routine.js) and off-section stories never trigger it.
 *   Tier 1: `minOutlets` (section override, news_vietnam 5) or more: lifted into the top `maxRank` of the section, "Hot".
 *   Tier 2: `tier2Outlets` or more distinct outlets reported so far (not limited to the window: big stories are covered over
 *           many hours): pinned to #1 of the section, "Breaking" whatever the score. Only while fresh:
 *           at most `tier2MaxAgeHours` after the first report and while a new outlet reported within `tier2StallHours`;
 *           afterwards the story falls back to its normal score (no floor at all).
 * Tier 2 stories are ordered by outlet count (desc), then score. Tier 1 stories are ordered by score like everything else:
 * they are only lifted when their natural rank is below the guarantee (rank maxRank or better), never placed above a higher score otherwise.
 */
export const HOT_FLOOR = Object.freeze({
  minOutlets: num('RANKING_HOT_MIN_OUTLETS', 3, 2, 20),
  /** Sections whose sources overlap heavily need more outlets (Vietnamese general news is covered by many near-identical outlets). */
  sectionOverrides: Object.freeze({ news_vietnam: 5 }),
  tier2Outlets: num('RANKING_HOT_TIER2_OUTLETS', 8, 3, 50),
  windowHours: num('RANKING_HOT_WINDOW_HOURS', 4, 0.5, 48),
  activeHours: num('RANKING_HOT_ACTIVE_HOURS', 12, 1, 72),
  tier2MaxAgeHours: num('RANKING_HOT_TIER2_MAX_AGE_HOURS', 12, 1, 72),
  tier2StallHours: num('RANKING_HOT_TIER2_STALL_HOURS', 3, 0.5, 24),
  /** Tier 1 stories are lifted to at most this (1-based) rank of their section. */
  maxRank: num('RANKING_HOT_MAX_RANK', 3, 1, 20),
  /** Stories the eligibility head considers off-section (pElig below this) never get the floor. */
  minEligibility: num('RANKING_HOT_MIN_ELIG', 0.25, 0, 1)
});

/**
 * Label thresholds on the 1..10 display scale, calibrated on the replay of the non-AI scorer over
 * 8 snapshots (6 h apart) of the stored clusters, fresh stories (latest report <= 12 h):
 * p50 4.2, p90 7.8, p92 8.0, p97 8.6, p98 8.8. Hot = roughly the top 8-10% of fresh stories,
 * Breaking = roughly the top 2-3%. The hot-news floor lifts stories to Hot regardless of score.
 */
export const LABEL_THRESHOLDS = Object.freeze({
  hot: num('RANKING_LABEL_HOT', 7.8, 1, 10),
  breaking: num('RANKING_LABEL_BREAKING', 8.6, 1, 10),
  /** Score-based Breaking also needs the story to be fresh (exp(-age/48h) at or above this, about 14 h). */
  breakingMinFresh: 0.75
});

/**
 * Routine damper. For routine multi-outlet patterns (match results, festivals,
 * anniversaries, award ceremonies, digests, state-media reposts) the effective
 * number of outlets/articles that feed the corroboration and velocity features is
 * shrunk by this strength: 0 = no damping, 1 = treated as a single-outlet story.
 */
export const ROUTINE_DAMPER = Object.freeze({
  strength: num('RANKING_ROUTINE_DAMPER', 0.7, 0, 1),
  /** Strength never exceeds this, even when several routine patterns match. */
  maxStrength: 0.9
});

/** Freshness half-shape: score *= 0.45 + 0.55 * exp(-ageHours / freshnessHours). Fixed by the fitted model. */
export const NOVELTY_WINDOW_HOURS = 48;

/** Environment switch for rollback: CLASSIC_RANKING=legacy restores rankStory(). */
export const classicRankingMode = () =>
  String(process.env.CLASSIC_RANKING || '').trim().toLowerCase() === 'legacy' ? 'legacy' : 'stories';

/** Longest a Classic request waits for e5 vectors to load from the cache before ranking without them. */
export const vectorWaitMs = () => num('RANKING_VECTOR_WAIT_MS', 3000, 0, 30000);
