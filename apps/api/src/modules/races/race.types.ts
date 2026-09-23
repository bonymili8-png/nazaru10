import type {
  Aptitudes,
  Attributes,
  Condition,
  RaceClass,
  RaceEvent,
  RaceFrames,
  RaceResultRow,
  Strategy,
  Surface,
  Traits,
  Weather,
  Wetness,
} from "@thoroughline/engine";

export interface RaceRow {
  id: string;
  name: string;
  class: RaceClass;
  track_code: string;
  surface: Surface;
  distance: number;
  weather: Weather;
  wetness: Wetness;
  going: string;
  status: "OPEN" | "LOCKED" | "RUNNING" | "COMPLETED" | "CANCELLED";
  entry_fee: number;
  purse: number;
  min_rating: number | null;
  max_rating: number | null;
  maiden_only: boolean;
  min_field: number;
  max_field: number;
  locks_at: Date;
  starts_at: Date;
  results_at: Date | null;
  completed_at: Date | null;
  seed_hash: string;
  seed: string | null;
  is_special: boolean;
  tournament_id: string | null;
  stage: "HEAT" | "FINAL" | null;
  created_at: Date;
}

/** Everything the simulation and settlement need, frozen when the race locks. */
export interface EntrySnapshot {
  name: string;
  ownerName: string | null;
  attributes: Attributes;
  traits: Traits;
  aptitudes: Aptitudes;
  raceIntelligence: number;
  injurySusceptibility: number;
  condition: Condition;
  abilityRating: number;
  raceRating: number;
  jockey: { id: string; name: string; skill: number };
}

export interface EntryRow {
  id: string;
  race_id: string;
  horse_id: string;
  owner_id: string | null;
  is_house: boolean;
  jockey_id: string | null;
  gate: number | null;
  strategy: Strategy;
  weight_kg: number;
  entry_fee: number;
  status: "ENTERED" | "WITHDRAWN" | "RAN" | "SCRATCHED";
  snapshot: EntrySnapshot | null;
  position: number | null;
  finish_time: number | null;
  lengths_behind: number | null;
  prize: number | null;
  rating_before: number | null;
  rating_after: number | null;
}

export interface ResultRow {
  race_id: string;
  results: RaceResultRow[];
  events: RaceEvent[];
  commentary: { t: number; text: string }[];
  frames: RaceFrames;
  winning_time: number;
}

export const CLASS_LABEL: Record<RaceClass, string> = {
  MAIDEN: "Maiden Stakes",
  CLASS_5: "Class 5 Stakes",
  CLASS_4: "Class 4 Stakes",
  CLASS_3: "Class 3 Stakes",
  CLASS_2: "Class 2 Cup",
  CLASS_1: "Class 1 Championship",
};
