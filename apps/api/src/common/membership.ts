/**
 * SQL predicate: the user in column `userCol` has Owners' Circle benefits at time `$nowParam`
 * (subscription active, or cancelled but still paid up).
 */
export const memberSql = (userCol: string, nowParam: string) =>
  `EXISTS (SELECT 1 FROM subscriptions sb WHERE sb.user_id = ${userCol} AND sb.status <> 'EXPIRED' AND sb.period_end > ${nowParam})`;
