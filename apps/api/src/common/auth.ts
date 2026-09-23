import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { ENV, type Env } from "../config/env.js";
import { Db } from "./db.js";
import { forbidden, unauthorized } from "./errors.js";

export type Role =
  | "PLAYER"
  | "SUPER_ADMIN"
  | "GAME_ADMIN"
  | "ECONOMY_ADMIN"
  | "SUPPORT_ADMIN"
  | "TOURNAMENT_ADMIN"
  | "CONTENT_ADMIN"
  | "FINANCE_ADMIN"
  | "FRAUD_ANALYST";

export interface AuthUser {
  id: string;
  role: Role;
}

export type AuthedRequest = FastifyRequest & { user?: AuthUser };

const IS_PUBLIC = "isPublic";
const ROLES = "roles";
/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route requires one of these roles (SUPER_ADMIN always passes). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw unauthorized();
  return req.user;
});

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async issue(user: AuthUser, now: Date): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + this.env.JWT_TTL_SEC;
    const token = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setIssuer("thoroughline")
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verify(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], issuer: "thoroughline" });
      if (typeof payload.sub !== "string") throw new Error("no subject");
      return payload.sub;
    } catch {
      throw unauthorized("Invalid or expired session");
    }
  }
}

/**
 * Global guard: every route requires a valid bearer token unless marked @Public().
 * The user's role and status are re-read from the database on every request, so a
 * suspension or role change takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const userId = await this.tokens.verify(header.slice(7));
    const user = await this.db.one<{ id: string; role: Role; status: string }>(
      "SELECT id, role, status FROM users WHERE id = $1",
      [userId],
    );
    if (!user || user.status === "DELETED") throw unauthorized();
    if (user.status === "SUSPENDED") throw forbidden("Account suspended");
    req.user = { id: user.id, role: user.role };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && user.role !== "SUPER_ADMIN" && !roles.includes(user.role)) throw forbidden();
    return true;
  }
}
