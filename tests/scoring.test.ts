import { describe, expect, it } from "vitest";
import { buildLeaderboardRow, calculateTotals, clampScore, createRubricLevels, criterionWeightLabel, getDefaultScores, getRubricLevelForScore } from "@/lib/scoring";
import { demoEvents } from "@/lib/mock-data";
import type { Event } from "@/lib/types";

describe("scoring helpers", () => {
  it("clamps and rounds scores within bounds", () => {
    expect(clampScore(-3, 5)).toBe(0);
    expect(clampScore(2.26, 5)).toBe(2.3);
    expect(clampScore(8.2, 5)).toBe(5);
  });

  it("builds the expected weighted totals for the rubric event", () => {
    const event = demoEvents[0];
    const totals = calculateTotals(event, {
      innovation: 1,
      technical: 4,
      design: 4,
      viability: 4
    });

    expect(totals.rawScore).toBe(39);
    expect(totals.maxScore).toBe(60);
    expect(totals.averageScore).toBeCloseTo(65);
    expect(totals.completion).toBe(100);
  });

  it("handles empty criteria without dividing by zero", () => {
    const emptyEvent: Event = {
      id: "empty",
      name: "Empty Event",
      status: "draft",
      gradingType: "manual",
      ownerId: "admin-1",
      ownerEmail: "organizer@hackweek.dev",
      criteria: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };

    expect(calculateTotals(emptyEvent, {}).averageScore).toBe(0);
    expect(calculateTotals(emptyEvent, {}).completion).toBe(0);
  });

  it("derives default scores and labels consistently", () => {
    const event = demoEvents[0];
    expect(getDefaultScores(event.criteria)).toEqual({
      innovation: 0,
      technical: 0,
      design: 0,
      viability: 0
    });
    expect(criterionWeightLabel(event.criteria[0])).toBe("x3.0 max 5");
  });

  it("scales rubric grades to the criterion maximum", () => {
    const levels = createRubricLevels(7);

    expect(levels.map((level) => level.points)).toEqual([7, 6, 4, 3, 1]);
    expect(getRubricLevelForScore(7, 5)?.label).toBe("B");
  });

  it("can trim one highest and one lowest judge total from standings", () => {
    const event = {
      ...demoEvents[0],
      dropHighestAndLowestJudgeScores: true
    };
    const participant = {
      id: "team-1",
      name: "Team One",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
    const scorecards = [
      {
        id: "judge-1_team-1",
        eventId: event.id,
        participantId: participant.id,
        judgeId: "judge-1",
        judgeName: "Judge 1",
        judgeEmail: "judge1@example.com",
        scores: { innovation: 1, technical: 1, design: 1, viability: 1 },
        totalScore: 0,
        updatedAt: "2026-07-01T00:00:00.000Z"
      },
      {
        id: "judge-2_team-1",
        eventId: event.id,
        participantId: participant.id,
        judgeId: "judge-2",
        judgeName: "Judge 2",
        judgeEmail: "judge2@example.com",
        scores: { innovation: 3, technical: 3, design: 3, viability: 3 },
        totalScore: 0,
        updatedAt: "2026-07-01T00:01:00.000Z"
      },
      {
        id: "judge-3_team-1",
        eventId: event.id,
        participantId: participant.id,
        judgeId: "judge-3",
        judgeName: "Judge 3",
        judgeEmail: "judge3@example.com",
        scores: { innovation: 5, technical: 5, design: 5, viability: 5 },
        totalScore: 0,
        updatedAt: "2026-07-01T00:02:00.000Z"
      }
    ];

    const row = buildLeaderboardRow(event, participant, scorecards);

    expect(row.scorecardCount).toBe(1);
    expect(row.rawScore).toBe(calculateTotals(event, scorecards[1].scores).rawScore);
    expect(row.averageScore).toBe(60);
  });
});
