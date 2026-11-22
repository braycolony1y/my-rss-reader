// Tunable constants of the deterministic story ranker. Everything here is a plain
// constant; there is no runtime learning. Environment overrides exist only so that
// operators can experiment without a deploy (values are validated and clamped).

const num = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' && process.env[name] != null
    ? Math.min(max, Math.max(min, value)) : fallback;
};

/**
 * Hot-news floor. A story reported by at least `minOutlets` (or the section override) distinct, independent
 * outlets whose first reports fall inside one `windowHours` window, and whose most
 * recent report is at most `activeHours` old, is guaranteed a near-top place in its
 * section and the "Hot" label. Routine patterns (see routine.js) never trigger it.
 */
export const HOT_FLOOR = Object.freeze({
  minOutlets: num('RANKING_HOT_MIN_OUTLETS', 3, 2, 20),
  /** Sections whose sources overlap heavily need more outlets (Vietnamese general news is covered by many near-identical outlets). */
  sectionOverrides: Object.freeze({ news_vietnam: 5 }),
  windowHours: num('RANKING_HOT_WINDOW_HOURS', 4, 0.5, 48),
  activeHours: num('RANKING_HOT_ACTIVE_HOURS', 12, 1, 72),
  /** Floored stories are lifted to at most this (1-based) rank of their section. */
  maxRank: num('RANKING_HOT_MAX_RANK', 3, 1, 20),
  /** Stories the eligibility head considers off-section (pElig below this) never get the floor. */
  minEligibility: num('RANKING_HOT_MIN_ELIG', 0.25, 0, 1),
  /** Outlets within the window at which the label is upgraded from Hot to Breaking. */
  breakingOutlets: num('RANKING_BREAKING_OUTLETS', 7, 3, 50)
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
