import type { Criterion, Event, Participant, RubricLevel, Scorecard } from "@/lib/types";

const rubricTemplates: Array<Pick<RubricLevel, "label" | "description">> = [
  { label: "A", description: "Exceptional" },
  { label: "B", description: "Strong" },
  { label: "C", description: "Solid" },
  { label: "D", description: "Developing" },
  { label: "E", description: "Needs work" }
];

export function clampScore(value: number, maxPoints: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(maxPoints, Math.max(0, Math.round(value * 10) / 10));
}

export function getDefaultScores(criteria: Criterion[]) {
  return Object.fromEntries(criteria.map((criterion) => [criterion.id, 0]));
}

export function createRubricLevels(maxPoints: number, rubricLevels?: RubricLevel[]) {
  const safeMaxPoints = Math.max(1, Math.round(maxPoints));
  const stepCount = rubricTemplates.length - 1;

  return rubricTemplates.map((template, index) => {
    const source = rubricLevels?.[index];
    const scaledPoints = Math.round(safeMaxPoints - (stepCount === 0 ? 0 : (safeMaxPoints - 1) * (index / stepCount)));

    return {
      points: Math.max(1, Math.min(safeMaxPoints, scaledPoints)),
      label: template.label,
      description: source?.description ?? template.description
    };
  });
}

export function getRubricLevelForScore(maxPoints: number, score: number, rubricLevels?: RubricLevel[]) {
  const levels = createRubricLevels(maxPoints, rubricLevels);
  if (levels.length === 0) return undefined;

  return levels.reduce((best, level) => {
    const currentDelta = Math.abs(level.points - score);
    const bestDelta = Math.abs(best.points - score);

    if (currentDelta < bestDelta) return level;
    if (currentDelta > bestDelta) return best;
    return level.points > best.points ? level : best;
  }, levels[0]);
}

export function calculateTotals(event: Event, scores: Record<string, number>) {
  const details = event.criteria.map((criterion) => {
    const score = clampScore(scores[criterion.id] ?? 0, criterion.maxPoints);
    const weightedRaw = score * criterion.weight;
    const weightedMax = criterion.maxPoints * criterion.weight;
    const normalized = criterion.maxPoints === 0 ? 0 : score / criterion.maxPoints;

    return {
      criterionId: criterion.id,
      score,
      weightedRaw,
      weightedMax,
      weightedNormalized: normalized
    };
  });

  const rawScore = details.reduce((sum, item) => sum + item.weightedRaw, 0);
  const maxScore = details.reduce((sum, item) => sum + item.weightedMax, 0);
  const averageScore = maxScore === 0 ? 0 : (rawScore / maxScore) * 100;
  const completion = event.criteria.length === 0 ? 0 : (details.filter((item) => item.score > 0).length / event.criteria.length) * 100;

  return {
    rawScore,
    maxScore,
    averageScore,
    completion,
    details
  };
}

export function buildScorecard(event: Event, scorecard: Scorecard) {
  return calculateTotals(event, scorecard.scores);
}

export function criterionWeightLabel(criterion: Criterion) {
  return `x${criterion.weight.toFixed(1)} max ${criterion.maxPoints}`;
}

export function getScorecardsForStandings(event: Event, scorecards: Scorecard[]) {
  if (!event.dropHighestAndLowestJudgeScores || scorecards.length < 3) {
    return scorecards;
  }

  const sortedByRawScore = [...scorecards].sort((left, right) => {
    const leftScore = calculateTotals(event, left.scores).rawScore;
    const rightScore = calculateTotals(event, right.scores).rawScore;

    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.updatedAt.localeCompare(right.updatedAt);
  });

  return sortedByRawScore.slice(1, -1);
}

export function buildLeaderboardRow(event: Event, participant: Participant, scorecards: Scorecard[]) {
  const weightedMaxPerJudge = event.criteria.reduce((sum, criterion) => sum + criterion.maxPoints * criterion.weight, 0);
  const scorecardsForStandings = getScorecardsForStandings(event, scorecards);
  const totalRaw = scorecardsForStandings.reduce((sum, card) => sum + calculateTotals(event, card.scores).rawScore, 0);
  const maxScore = scorecardsForStandings.length * weightedMaxPerJudge;
  const averageScore = maxScore === 0 ? 0 : (totalRaw / maxScore) * 100;

  return {
    participant,
    scorecardCount: scorecardsForStandings.length,
    averageScore,
    rawScore: totalRaw,
    maxScore,
    criteriaAverages: {}
  };
}
