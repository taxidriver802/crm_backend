import { AbcClient } from "./abc.client";
import { abcConfig } from "./abc.config";

function requireAbcBaseUrl() {
  if (!abcConfig.baseUrl) {
    throw new Error("ABC integration is not configured: missing ABC_API_BASE_URL");
  }
  return abcConfig.baseUrl;
}

export function createAbcClient() {
  return new AbcClient(requireAbcBaseUrl(), abcConfig.accessToken);
}

export function getAbcIntegrationStatus() {
  return {
    provider: "abc_supply",
    configured: Boolean(abcConfig.baseUrl),
    hasAccessToken: Boolean(abcConfig.accessToken),
    hasClientId: Boolean(abcConfig.clientId),
    hasClientSecret: Boolean(abcConfig.clientSecret),
    hasWebhookSecret: Boolean(abcConfig.webhookSecret),
    accountId: abcConfig.accountId ?? null,
  };
}

export async function searchAbcAccounts(input: unknown) {
  const client = createAbcClient();
  return client.searchAccounts(input);
}

export async function searchAbcItems(input: unknown) {
  const client = createAbcClient();
  return client.searchItems(input);
}

export async function getAbcBranches() {
  const client = createAbcClient();
  return client.getBranches();
}

export async function getAbcInvoicesHistory(billToAccount: string) {
  const client = createAbcClient();
  return client.getInvoicesHistory(billToAccount);
}

export async function createAbcOrder(input: unknown) {
  const client = createAbcClient();
  return client.createOrder(input);
}