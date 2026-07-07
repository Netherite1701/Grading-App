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

function parseCsvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

const createParticipantId = (name: string, usedIds: Set<string>, index: number) => {
  const baseId = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "") || "participant";
  let candidate = `${baseId}-${index}`;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${index}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
};

export function buildParticipantTemplateCsv() {
  return [
    ["Team name", "Project title", "Description"].map(csvEscape).join(","),
    ["Team Example", "Project Example", "Optional notes about the team or submission"].map(csvEscape).join(",")
  ].join("\n");
}

export function parseParticipantsCsv(csv: string, existingParticipants: Participant[] = []) {
  const rows = parseCsvRows(csv);
  const errors: string[] = [];
  const participants: Participant[] = [];
  const usedIds = new Set(existingParticipants.map((participant) => participant.id));
  const now = new Date().toISOString();

  if (!rows.length) {
    return { participants, errors: ["CSV file is empty."] };
  }

  const firstRowHeaders = rows[0].map(normalizeHeader);
  const hasHeader = firstRowHeaders.some((header) => ["teamname", "team", "participant", "participantname", "팀이름", "팀명"].includes(header));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const headerIndex = (names: string[]) => firstRowHeaders.findIndex((header) => names.includes(header));
  const nameIndex = hasHeader ? headerIndex(["teamname", "team", "participant", "participantname", "name", "팀이름", "팀명", "참가자"]) : 0;
  const titleIndex = hasHeader ? headerIndex(["projecttitle", "title", "submission", "project", "프로젝트제목", "제목", "작품명"]) : 1;
  const descriptionIndex = hasHeader ? headerIndex(["description", "notes", "memo", "설명", "메모", "비고"]) : 2;

  dataRows.forEach((row, rowIndex) => {
    const sourceLine = rowIndex + (hasHeader ? 2 : 1);
    const name = (row[nameIndex] ?? "").trim();

    if (!name) {
      errors.push(`Row ${sourceLine}: missing team name.`);
      return;
    }

    participants.push({
      id: createParticipantId(name, usedIds, Date.now() + rowIndex),
      name,
      title: titleIndex >= 0 ? row[titleIndex]?.trim() || undefined : undefined,
      description: descriptionIndex >= 0 ? row[descriptionIndex]?.trim() || undefined : undefined,
      createdAt: now,
      updatedAt: now
    });
  });

  return { participants, errors };
}
