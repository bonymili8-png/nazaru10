import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard, TokenService } from "./common/auth.js";
import { Clock } from "./common/clock.js";
import { Db } from "./common/db.js";
import { AuditService, EventsService } from "./common/events.js";
import { GameConfigService } from "./common/game-config.js";
import { LOGGER, type Logger } from "./common/logger.js";
import { RateLimitGuard } from "./common/rate-limit.js";
import { ENV, type Env } from "./config/env.js";
import { AdminController } from "./modules/admin/admin.controller.js";
import { AuthController } from "./modules/auth/auth.controller.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { LedgerService } from "./modules/economy/ledger.service.js";
import { WalletController } from "./modules/economy/wallet.controller.js";
import { HealthController } from "./modules/health/health.controller.js";
import { HorseFactory } from "./modules/horses/horse.factory.js";
import { HorsesController } from "./modules/horses/horses.controller.js";
import { HorsesService } from "./modules/horses/horses.service.js";
import { JobRunnerService } from "./modules/jobs/job-runner.service.js";
import { LeaderboardController } from "./modules/leaderboard/leaderboard.controller.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { StripeProvider, TelegramStarsProvider } from "./modules/payments/payment-provider.js";
import { PaymentsController } from "./modules/payments/payments.controller.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
import { QuestsController } from "./modules/quests/quests.controller.js";
import { QuestsService } from "./modules/quests/quests.service.js";
import { HouseService } from "./modules/races/house.service.js";
import { RaceRunnerService } from "./modules/races/race-runner.service.js";
import { RacesController } from "./modules/races/races.controller.js";
import { RacesService } from "./modules/races/races.service.js";
import { ShopController } from "./modules/shop/shop.controller.js";
import { ShopService } from "./modules/shop/shop.service.js";
import { StableController } from "./modules/stable/stable.controller.js";
import { StableService } from "./modules/stable/stable.service.js";
import { BOT_API, type BotApi } from "./modules/telegram/bot-api.js";
import { TelegramWebhookController } from "./modules/telegram/webhook.controller.js";
import { TrainingService } from "./modules/training/training.service.js";
import { MeController } from "./modules/users/me.controller.js";
import { OnboardingService } from "./modules/users/onboarding.service.js";

export interface AppDeps {
  env: Env;
  logger: Logger;
  db: Db;
  bot: BotApi;
  clock?: Clock;
}

/**
 * Modular monolith: one Nest module, domain modules separated by folder. Module boundaries
 * (services + outbox events) are the future service boundaries.
 */
@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    const infra: Provider[] = [
      { provide: ENV, useValue: deps.env },
      { provide: LOGGER, useValue: deps.logger },
      { provide: Db, useValue: deps.db },
      { provide: BOT_API, useValue: deps.bot },
      { provide: Clock, useValue: deps.clock ?? new Clock() },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_GUARD, useClass: RateLimitGuard },
    ];
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        MeController,
        WalletController,
        StableController,
        HorsesController,
        RacesController,
        ShopController,
        LeaderboardController,
        QuestsController,
        PaymentsController,
        TelegramWebhookController,
        AdminController,
      ],
      providers: [
        ...infra,
        TokenService,
        EventsService,
        AuditService,
        GameConfigService,
        LedgerService,
        QuestsService,
        HorseFactory,
        HorsesService,
        StableService,
        TrainingService,
        HouseService,
        RaceRunnerService,
        RacesService,
        ShopService,
        OnboardingService,
        AuthService,
        TelegramStarsProvider,
        StripeProvider,
        PaymentsService,
        NotificationsService,
        JobRunnerService,
      ],
    };
  }
}
