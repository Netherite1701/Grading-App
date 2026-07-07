import { describe, expect, it } from "vitest";
import { calculateTotals, clampScore, createRubricLevels, criterionWeightLabel, getDefaultScores, getRubricLevelForScore } from "@/lib/scoring";
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
      innovation: 4,
      technical: 4,
      design: 4,
      viability: 4
    });
    expect(criterionWeightLabel(event.criteria[0])).toBe("x3.0 · max 5");
  });

  it("scales rubric grades to the criterion maximum", () => {
    const levels = createRubricLevels(7);

    expect(levels.map((level) => level.points)).toEqual([7, 6, 4, 3, 1]);
    expect(getRubricLevelForScore(7, 5)?.label).toBe("B");
  });
});
