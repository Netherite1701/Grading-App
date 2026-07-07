import type { Event, Participant, Scorecard, User } from "@/lib/types";
import { calculateTotals } from "@/lib/scoring";

export const demoUsers: User[] = [
  {
    uid: "admin-1",
    email: "organizer@hackweek.dev",
    displayName: "Morgan Lee",
    role: "admin",
    createdAt: "2026-06-12T09:00:00.000Z"
  },
  {
    uid: "judge-1",
    email: "judge1@hackweek.dev",
    displayName: "Avery Chen",
    role: "judge",
    createdAt: "2026-06-12T09:00:00.000Z"
  },
  {
    uid: "developer-1",
    email: "developer@hackweek.dev",
    displayName: "Dev Patel",
    role: "dev",
    createdAt: "2026-06-12T09:00:00.000Z"
  },
  {
    uid: "guest-1",
    email: "guest@hackweek.dev",
    displayName: "Guest Viewer",
    role: "guest",
    createdAt: "2026-06-12T09:00:00.000Z"
  }
];

export const demoEvents: Event[] = [
  {
    id: "launchpad-2026",
    name: "LaunchPad Demo Night",
    description: "A high-stakes pitch night with real-time standings and weighted scoring.",
    status: "active",
    gradingType: "rubric",
    ownerId: "admin-1",
    ownerEmail: "organizer@hackweek.dev",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-05T14:10:00.000Z",
    criteria: [
      {
        id: "innovation",
        name: "Innovation",
        description: "Novelty and originality of the concept.",
        maxPoints: 5,
        weight: 3,
        rubricLevels: [
          { points: 5, label: "A", description: "Exceptional originality and a standout idea." },
          { points: 4, label: "B", description: "Very strong differentiation with clear value." },
          { points: 3, label: "C", description: "Solid idea with some useful novelty." },
          { points: 2, label: "D", description: "Limited novelty or only a small twist on an existing idea." },
          { points: 1, label: "E", description: "Very little originality or a mostly familiar approach." }
        ]
      },
      {
        id: "technical",
        name: "Technical Depth",
        description: "Engineering quality and execution confidence.",
        maxPoints: 5,
        weight: 4,
        rubricLevels: [
          { points: 5, label: "A", description: "Excellent execution with strong technical depth." },
          { points: 4, label: "B", description: "Very strong engineering quality." },
          { points: 3, label: "C", description: "Solid technical work with a few gaps." },
          { points: 2, label: "D", description: "Basic execution with notable gaps." },
          { points: 1, label: "E", description: "Early or incomplete technical execution." }
        ]
      },
      {
        id: "design",
        name: "Design & UX",
        description: "Presentation clarity and product polish.",
        maxPoints: 5,
        weight: 2,
        rubricLevels: [
          { points: 5, label: "A", description: "Clear, polished, and easy to understand." },
          { points: 4, label: "B", description: "Strong presentation with only minor rough edges." },
          { points: 3, label: "C", description: "Functional and understandable." },
          { points: 2, label: "D", description: "Somewhat confusing or incomplete." },
          { points: 1, label: "E", description: "Hard to use or follow." }
        ]
      },
      {
        id: "viability",
        name: "Business Viability",
        description: "Potential for adoption and real-world value.",
        maxPoints: 5,
        weight: 3,
        rubricLevels: [
          { points: 5, label: "A", description: "Very strong real-world value and adoption potential." },
          { points: 4, label: "B", description: "Clear practical value with a believable path forward." },
          { points: 3, label: "C", description: "Some value, but the path to adoption needs work." },
          { points: 2, label: "D", description: "Weak market fit or unclear use case." },
          { points: 1, label: "E", description: "Little evidence of practical value." }
        ]
      }
    ]
  },
  {
    id: "science-fair-2026",
    name: "Metro Science Fair",
    description: "Direct-scoring event with higher point ceilings and simpler judging input.",
    status: "draft",
    gradingType: "manual",
    ownerId: "admin-1",
    ownerEmail: "organizer@hackweek.dev",
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-07-04T10:00:00.000Z",
    criteria: [
      { id: "clarity", name: "Clarity", description: "How well the project is presented.", maxPoints: 20, weight: 2 },
      { id: "method", name: "Methodology", description: "Scientific rigor and execution.", maxPoints: 20, weight: 3 },
      { id: "impact", name: "Impact", description: "Potential usefulness or discovery value.", maxPoints: 20, weight: 3 }
    ]
  }
];

export const demoParticipants: Record<string, Participant[]> = {
  "launchpad-2026": [
    {
      id: "solstice",
      name: "Team Solstice",
      title: "Neural campus guide",
      description: "An AI campus assistant for student services.",
      createdAt: "2026-07-01T10:30:00.000Z",
      updatedAt: "2026-07-05T12:00:00.000Z"
    },
    {
      id: "atlas",
      name: "Team Atlas",
      title: "Climate routing engine",
      description: "Optimizes logistics around weather and emissions.",
      createdAt: "2026-07-01T10:32:00.000Z",
      updatedAt: "2026-07-05T12:00:00.000Z"
    },
    {
      id: "helios",
      name: "Team Helios",
      title: "Smart pitch coach",
      description: "Practice assistant for founders and presenters.",
      createdAt: "2026-07-01T10:35:00.000Z",
      updatedAt: "2026-07-05T12:00:00.000Z"
    }
  ],
  "science-fair-2026": [
    {
      id: "nova",
      name: "Nova Lab",
      title: "Water quality tracker",
      description: "Low-cost sensors for neighborhood monitoring.",
      createdAt: "2026-06-29T10:45:00.000Z",
      updatedAt: "2026-07-04T10:00:00.000Z"
    }
  ]
};

export const demoScorecards: Scorecard[] = [
  {
    id: "judge-1_solstice",
    eventId: "launchpad-2026",
    participantId: "solstice",
    judgeId: "judge-1",
    judgeName: "Avery Chen",
    judgeEmail: "judge1@hackweek.dev",
    scores: {
      innovation: 5,
      technical: 4,
      design: 4,
      viability: 3
    },
    totalScore: 0,
    notes: "Strong product instinct and a polished story.",
    updatedAt: "2026-07-05T14:12:00.000Z"
  },
  {
    id: "judge-1_atlas",
    eventId: "launchpad-2026",
    participantId: "atlas",
    judgeId: "judge-1",
    judgeName: "Avery Chen",
    judgeEmail: "judge1@hackweek.dev",
    scores: {
      innovation: 4,
      technical: 5,
      design: 3,
      viability: 4
    },
    totalScore: 0,
    notes: "Excellent technical depth, slightly less memorable pitch.",
    updatedAt: "2026-07-05T14:15:00.000Z"
  }
];

export function hydrateScorecards(events: Event[], cards: Scorecard[]) {
  return cards.map((card) => {
    const event = events.find((item) => item.id === card.eventId);
    if (!event) return card;
    return {
      ...card,
      totalScore: calculateTotals(event, card.scores).rawScore
    };
  });
}
