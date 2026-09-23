export interface QuestDef {
  code: string;
  chapter: number;
  title: string;
  description: string;
  reward: { credits?: number; gems?: number; reputation?: number };
}

/** Onboarding questline (GDD §41). Rewards are configuration, granted through the ledger. */
export const QUESTS: readonly QuestDef[] = [
  {
    code: "CREATE_STABLE",
    chapter: 1,
    title: "Open your stable",
    description: "Your racing operation is born.",
    reward: { credits: 200 },
  },
  {
    code: "FIRST_HORSE",
    chapter: 2,
    title: "Your first horse",
    description: "Meet your starter horse.",
    reward: { credits: 200 },
  },
  {
    code: "FIRST_TRAINING",
    chapter: 3,
    title: "Put in the work",
    description: "Complete a training session.",
    reward: { credits: 300 },
  },
  {
    code: "FIRST_RACE",
    chapter: 4,
    title: "Under starter's orders",
    description: "Run in your first race.",
    reward: { credits: 500, gems: 5 },
  },
  {
    code: "FIRST_PODIUM",
    chapter: 5,
    title: "On the podium",
    description: "Finish in the top three.",
    reward: { credits: 800, reputation: 10 },
  },
  {
    code: "FIRST_WIN",
    chapter: 5,
    title: "Winner's enclosure",
    description: "Win a race.",
    reward: { credits: 1500, gems: 10, reputation: 25 },
  },
  {
    code: "BUY_HORSE",
    chapter: 6,
    title: "Expand the string",
    description: "Buy a horse at the sales ring.",
    reward: { credits: 500 },
  },
  {
    code: "UPGRADE_STABLE",
    chapter: 6,
    title: "Bigger barns",
    description: "Upgrade your stable.",
    reward: { credits: 1000, reputation: 10 },
  },
];

export const questByCode = (code: string) => QUESTS.find((q) => q.code === code);
