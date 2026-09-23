import { Injectable, type OnModuleInit } from "@nestjs/common";
import { defaultConfig, type GameConfig, mergeConfig } from "@thoroughline/engine";
import { Db } from "./db.js";

/**
 * Current game configuration = engine defaults deep-merged with the latest admin override
 * (`game_config` table). Cached and refreshed periodically so live-ops changes apply
 * without a deploy.
 */
@Injectable()
export class GameConfigService implements OnModuleInit {
  private current: GameConfig = defaultConfig;
  private version = 0;
  private loadedAt = 0;

  constructor(private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  get(): GameConfig {
    if (Date.now() - this.loadedAt > 30_000) void this.refresh().catch(() => undefined);
    return this.current;
  }

  get currentVersion(): number {
    return this.version;
  }

  async refresh(): Promise<void> {
    const row = await this.db.one<{ version: number; config: unknown }>(
      "SELECT version, config FROM game_config ORDER BY version DESC LIMIT 1",
    );
    this.current = row ? mergeConfig(defaultConfig, row.config) : defaultConfig;
    this.version = row?.version ?? 0;
    this.loadedAt = Date.now();
  }
}
