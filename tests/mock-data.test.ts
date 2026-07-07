import { describe, expect, it } from "vitest";
import { demoEvents, demoScorecards, hydrateScorecards } from "@/lib/mock-data";

describe("mock data hydration", () => {
  it("fills computed totals for matching events and preserves unmatched cards", () => {
    const hydrated = hydrateScorecards(demoEvents, [
      demoScorecards[0],
      {
        ...demoScorecards[1],
        eventId: "missing-event",
        totalScore: 17
      }
    ]);

    expect(hydrated[0].totalScore).toBe(48);
    expect(hydrated[1].totalScore).toBe(17);
  });

  it("uses a letter-based rubric scale in the demo event data", () => {
    const rubricLevels = demoEvents[0].criteria[0].rubricLevels ?? [];

    expect(rubricLevels.map((level) => level.label)).toEqual(["A", "B", "C", "D", "E"]);
  });
});
