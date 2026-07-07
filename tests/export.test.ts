import { describe, expect, it } from "vitest";
import { buildParticipantTemplateCsv, buildStandingsCsv, parseParticipantsCsv } from "@/lib/export";
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

  it("parses participant CSV files with headers and quoted cells", () => {
    const csv = [
      '"Team name","Project title","Description"',
      '"Team, Alpha","Launch ""One""","First line"',
      '"","Missing name","Skipped"',
      '"Team Beta","Project Beta",""'
    ].join("\n");

    const result = parseParticipantsCsv(csv);

    expect(result.participants).toHaveLength(2);
    expect(result.participants[0]).toMatchObject({
      name: "Team, Alpha",
      title: 'Launch "One"',
      description: "First line"
    });
    expect(result.participants[1]).toMatchObject({
      name: "Team Beta",
      title: "Project Beta"
    });
    expect(result.errors).toEqual(["Row 3: missing team name."]);
  });

  it("parses participant CSV files without headers", () => {
    const result = parseParticipantsCsv('"Team Gamma","Project Gamma","Headerless row"');

    expect(result.errors).toEqual([]);
    expect(result.participants).toHaveLength(1);
    expect(result.participants[0]).toMatchObject({
      name: "Team Gamma",
      title: "Project Gamma",
      description: "Headerless row"
    });
  });

  it("parses Korean participant CSV headers", () => {
    const result = parseParticipantsCsv('"팀 이름","프로젝트 제목","설명"\r\n"팀 하나","프로젝트 하나","설명 하나"');

    expect(result.errors).toEqual([]);
    expect(result.participants[0]).toMatchObject({
      name: "팀 하나",
      title: "프로젝트 하나",
      description: "설명 하나"
    });
  });

  it("reports empty participant CSV input", () => {
    const result = parseParticipantsCsv("  \r\n ");

    expect(result.participants).toEqual([]);
    expect(result.errors).toEqual(["CSV file is empty."]);
  });

  it("creates unique participant IDs for repeated names", () => {
    const result = parseParticipantsCsv('"Team name"\n"Team Repeat"\n"Team Repeat"');
    const ids = result.participants.map((participant) => participant.id);

    expect(result.participants).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("builds a participant import template", () => {
    const csv = buildParticipantTemplateCsv();

    expect(csv.split("\n")[0]).toBe('"Team name","Project title","Description"');
    expect(csv).toContain('"Team Example"');
  });
});
