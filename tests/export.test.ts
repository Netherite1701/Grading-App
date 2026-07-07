import { describe, expect, it } from "vitest";
import { buildStandingsCsv } from "@/lib/export";
import { demoEvents, demoParticipants, demoScorecards } from "@/lib/mock-data";

describe("CSV export", () => {
  it("escapes special characters and skips orphan scorecards", () => {
    const event = {
      ...demoEvents[0],
      name: 'Launch, "Night"'
    };

    const participants = [
      {
        ...demoParticipants[event.id][0],
        name: 'Team, "Alpha"'
      }
    ];

    const scorecards = [
      {
        ...demoScorecards[0],
        eventId: event.id,
        participantId: participants[0].id,
        notes: 'Great "detail", keep it up.'
      },
      {
        ...demoScorecards[1],
        eventId: "missing-event",
        participantId: "missing-participant"
      }
    ];

    const csv = buildStandingsCsv(event, participants, scorecards);
    const rows = csv.split("\n");

    expect(rows).toHaveLength(2);
    expect(csv).toContain('"Launch, ""Night"""');
    expect(csv).toContain('"Team, ""Alpha"""');
    expect(csv).toContain('"Great ""detail"", keep it up."');
  });
});
