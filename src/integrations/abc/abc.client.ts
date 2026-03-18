export class AbcClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string
  ) {}

  private async request(path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
      throw new Error(`ABC API error ${res.status}: ${text}`);
    }

    return body;
  }

  searchAccounts(payload: unknown) {
    return this.request("/search/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  searchItems(payload: unknown) {
    return this.request("/search/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  createOrder(payload: unknown) {
    return this.request("/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getBranches() {
    return this.request("/branches");
  }

  getInvoicesHistory(billToAccount: string) {
    return this.request(`/invoice/v1/invoices/history/${billToAccount}`);
  }
}