import { env } from "../../config/env";

export const abcConfig = {
  baseUrl: env.abc.baseUrl,
  clientId: env.abc.clientId,
  clientSecret: env.abc.clientSecret,
  accessToken: env.abc.accessToken,
  refreshToken: env.abc.refreshToken,
  webhookSecret: env.abc.webhookSecret,
  accountId: env.abc.accountId,
};