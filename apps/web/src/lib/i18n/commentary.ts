import { renderCommentary } from "@thoroughline/engine";
import type { LiveRaceDto } from "@thoroughline/contracts";
import { getLocale } from "./index";

/** A commentary line in the player's language (the server's English text as the fallback). */
export const commentaryText = (line: LiveRaceDto["commentary"][number]): string =>
  (getLocale() === "en" ? null : renderCommentary(line, getLocale())) ?? line.text;
