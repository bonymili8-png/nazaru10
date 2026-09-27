import { MEMBER_COLORS, type SilkColor } from "@thoroughline/contracts";

/** Owners' Circle colours are shown to everyone but only members can pick them. */
export const memberLocked = (colour: SilkColor, member: boolean): boolean =>
  !member && MEMBER_COLORS.includes(colour);
