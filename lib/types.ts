export type Role = "judge" | "organizer" | "developer" | "guest";
export type StoredRole = Role | "admin" | string;
export type EventStatus = "draft" | "active" | "completed";
export type GradingType = "rubric" | "manual";

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role: StoredRole;
  createdAt: string;
  updatedAt?: string;
}

export interface RubricLevel {
  points: number;
  label: string;
  description?: string;
}

export interface Criterion {
  id: string;
  name: string;
  description?: string;
  maxPoints: number;
  weight: number;
  rubricLevels?: RubricLevel[];
}

export interface Event {
  id: string;
  name: string;
  description?: string;
  status: EventStatus;
  gradingType: GradingType;
  ownerId: string;
  ownerEmail: string;
  criteria: Criterion[];
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: string;
  name: string;
  title?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Scorecard {
  id: string;
  eventId: string;
  participantId: string;
  judgeId: string;
  judgeName: string;
  judgeEmail: string;
  scores: Record<string, number>;
  totalScore: number;
  notes?: string;
  updatedAt: string;
}

export interface LeaderboardRow {
  participant: Participant;
  scorecardCount: number;
  averageScore: number;
  rawScore: number;
  maxScore: number;
  criteriaAverages: Record<string, number>;
}
