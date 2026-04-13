import crypto from 'crypto';
import { pool } from '../db';

export class QuickBooksNotConnectedError extends Error {
  constructor(message = 'QuickBooks is not connected') {
    super(message);
    this.name = 'QuickBooksNotConnectedError';
  }
}

export class QuickBooksConfigError extends Error {
  constructor(message = 'QuickBooks configuration is incomplete') {
    super(message);
    this.name = 'QuickBooksConfigError';
  }
}

const PROVIDER = 'quickbooks';

function encrypt(text: string): string {
  const key = process.env.ENCRYPTION_KEY || 'default-dev-key-32chars-padded!!';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(key.padEnd(32, '0').slice(0, 32)),
    iv
  );
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string): string {
  const key = process.env.ENCRYPTION_KEY || 'default-dev-key-32chars-padded!!';
  const [ivHex, encrypted] = data.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(key.padEnd(32, '0').slice(0, 32)),
    Buffer.from(ivHex, 'hex')
  );
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function getConnectionStatus(userId: string) {
  const result = await pool.query(
    `SELECT * FROM supplier_connections WHERE user_id = $1 AND provider = $2 LIMIT 1`,
    [userId, PROVIDER]
  );

  if (result.rowCount === 0) {
    return {
      connected: false,
      status: 'disconnected',
      company_name: null,
      realm_id: null,
      token_expires_at: null,
      configured: false,
      hasClientId: !!process.env.QB_CLIENT_ID,
      hasClientSecret: !!process.env.QB_CLIENT_SECRET,
    };
  }

  const row = result.rows[0];
  return {
    connected: row.status === 'connected',
    status: row.status,
    company_name: row.account_identifier,
    realm_id: row.api_base_url,
    token_expires_at: row.token_expires_at,
    configured: true,
    hasClientId: !!process.env.QB_CLIENT_ID,
    hasClientSecret: !!process.env.QB_CLIENT_SECRET,
  };
}

export function buildAuthUrl(userId: string): string {
  const clientId = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new QuickBooksConfigError(
      'QB_CLIENT_ID and QB_REDIRECT_URI must be set'
    );
  }

  const state = Buffer.from(
    JSON.stringify({ userId, ts: Date.now() })
  ).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state,
  });

  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

export async function handleOAuthCallback(
  userId: string,
  code: string,
  realmId: string
) {
  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri = process.env.QB_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new QuickBooksConfigError();
  }

  const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const tokens = await response.json();

  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);

  await pool.query(
    `INSERT INTO supplier_connections (
       user_id, provider, status, api_base_url, account_identifier,
       encrypted_access_token, encrypted_refresh_token, token_expires_at
     ) VALUES ($1, $2, 'connected', $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
       status = 'connected',
       api_base_url = $3,
       account_identifier = $4,
       encrypted_access_token = $5,
       encrypted_refresh_token = $6,
       token_expires_at = $7,
       updated_at = CURRENT_TIMESTAMP`,
    [
      userId,
      PROVIDER,
      realmId,
      realmId,
      encrypt(tokens.access_token),
      tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt,
    ]
  );

  return { connected: true, realm_id: realmId };
}

export async function disconnect(userId: string) {
  await pool.query(
    `DELETE FROM supplier_connections WHERE user_id = $1 AND provider = $2`,
    [userId, PROVIDER]
  );
  return { connected: false };
}

async function getAccessToken(userId: string): Promise<{
  token: string;
  realmId: string;
}> {
  const result = await pool.query(
    `SELECT * FROM supplier_connections WHERE user_id = $1 AND provider = $2 AND status = 'connected' LIMIT 1`,
    [userId, PROVIDER]
  );

  if (result.rowCount === 0) throw new QuickBooksNotConnectedError();
  const row = result.rows[0];

  if (!row.encrypted_access_token) {
    throw new QuickBooksNotConnectedError('No access token stored');
  }

  const needsRefresh =
    row.token_expires_at && new Date(row.token_expires_at) < new Date();

  if (needsRefresh && row.encrypted_refresh_token) {
    return refreshAccessToken(userId, row);
  }

  return {
    token: decrypt(row.encrypted_access_token),
    realmId: row.api_base_url,
  };
}

async function refreshAccessToken(
  userId: string,
  row: any
): Promise<{ token: string; realmId: string }> {
  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;

  if (!clientId || !clientSecret) throw new QuickBooksConfigError();

  const refreshToken = decrypt(row.encrypted_refresh_token);

  const response = await fetch(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:
          'Basic ' +
          Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    }
  );

  if (!response.ok) {
    await pool.query(
      `UPDATE supplier_connections SET status = 'disconnected', updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND provider = $2`,
      [userId, PROVIDER]
    );
    throw new QuickBooksNotConnectedError(
      'Token refresh failed — please reconnect'
    );
  }

  const tokens = await response.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);

  await pool.query(
    `UPDATE supplier_connections SET
       encrypted_access_token = $3,
       encrypted_refresh_token = COALESCE($4, encrypted_refresh_token),
       token_expires_at = $5,
       updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND provider = $2`,
    [
      userId,
      PROVIDER,
      encrypt(tokens.access_token),
      tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt,
    ]
  );

  return { token: tokens.access_token, realmId: row.api_base_url };
}

// ─── INVOICE SYNC ──────────────────────────────────────

type InvoiceSyncInput = {
  invoice_number: string;
  customer_name: string;
  line_items: {
    name: string;
    description: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  due_date: string | null;
  grand_total: number;
  notes: string | null;
};

export async function syncInvoiceToQuickBooks(
  userId: string,
  input: InvoiceSyncInput
) {
  const { token, realmId } = await getAccessToken(userId);

  const qbInvoice = {
    DocNumber: input.invoice_number,
    DueDate: input.due_date
      ? new Date(input.due_date).toISOString().split('T')[0]
      : undefined,
    PrivateNote: input.notes || undefined,
    Line: input.line_items.map((li, idx) => ({
      DetailType: 'SalesItemLineDetail',
      Amount: li.line_total,
      Description: `${li.name}${li.description ? ' - ' + li.description : ''}`,
      SalesItemLineDetail: {
        Qty: li.quantity,
        UnitPrice: li.unit_price,
      },
      LineNum: idx + 1,
    })),
    CustomerRef: {
      value: '1',
      name: input.customer_name,
    },
    TotalAmt: input.grand_total,
  };

  const baseUrl =
    process.env.QB_API_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

  const response = await fetch(
    `${baseUrl}/v3/company/${realmId}/invoice?minorversion=73`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(qbInvoice),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `QuickBooks invoice sync failed: ${response.status} ${text}`
    );
  }

  const data = await response.json();
  return {
    qb_invoice_id: data.Invoice?.Id,
    qb_doc_number: data.Invoice?.DocNumber,
    sync_status: 'synced',
  };
}

export async function getPaymentStatus(userId: string, qbInvoiceId: string) {
  const { token, realmId } = await getAccessToken(userId);

  const baseUrl =
    process.env.QB_API_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

  const response = await fetch(
    `${baseUrl}/v3/company/${realmId}/invoice/${qbInvoiceId}?minorversion=73`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch QB invoice: ${response.status}`);
  }

  const data = await response.json();
  const inv = data.Invoice;

  return {
    qb_invoice_id: inv?.Id,
    balance: Number(inv?.Balance ?? 0),
    total: Number(inv?.TotalAmt ?? 0),
    is_paid: Number(inv?.Balance ?? 1) === 0,
    status: Number(inv?.Balance ?? 1) === 0 ? 'Paid' : 'Open',
  };
}
