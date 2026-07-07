import type { Event, Participant, Scorecard } from "@/lib/types";
import { calculateTotals } from "@/lib/scoring";

const csvEscape = (value: string | number | undefined | null) => {
  const stringValue = value ?? "";
  const normalized = String(stringValue).replaceAll('"', '""');
  return `"${normalized}"`;
};

export function buildStandingsCsv(event: Event, participants: Participant[], scorecards: Scorecard[]) {
  const header = ["Event", "Participant", "Judge", "Raw Score", "Max Score", "Average %", "Notes"];
  const rows = [header.map(csvEscape).join(",")];

  for (const card of scorecards.filter((item) => item.eventId === event.id)) {
    const participant = participants.find((item) => item.id === card.participantId);
    if (!participant) continue;
    const totals = calculateTotals(event, card.scores);
    rows.push(
      [
        event.name,
        participant.name,
        card.judgeName,
        totals.rawScore.toFixed(1),
        totals.maxScore.toFixed(1),
        totals.averageScore.toFixed(1),
        card.notes ?? ""
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  return rows.join("\n");
}
