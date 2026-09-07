import { pool } from '../db';
import {
  calculateLineItem,
  normalizeMoney,
} from './estimateCalculations';

export class EstimateTemplateNotFoundError extends Error {
  constructor(message = 'Estimate template not found') {
    super(message);
    this.name = 'EstimateTemplateNotFoundError';
  }
}

export class EstimateTemplateLineItemNotFoundError extends Error {
  constructor(message = 'Estimate template line item not found') {
    super(message);
    this.name = 'EstimateTemplateLineItemNotFoundError';
  }
}

export class EstimateTemplateNameTakenError extends Error {
  constructor(message = 'A template with that name already exists') {
    super(message);
    this.name = 'EstimateTemplateNameTakenError';
  }
}

export type CreateEstimateTemplateInput = {
  name: string;
  description?: string | null;
};

export type UpdateEstimateTemplateInput = Partial<CreateEstimateTemplateInput>;

export type CreateTemplateLineItemInput = {
  name: string;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  sort_order?: number | null;
};

export type UpdateTemplateLineItemInput = Partial<CreateTemplateLineItemInput>;

function mapLineItem(row: any) {
  return {
    id: row.id,
    template_id: row.template_id,
    name: row.name,
    description: row.description,
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTemplate(row: any, lineItems: any[] = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    line_items: lineItems.map(mapLineItem),
  };
}

async function getLineItems(templateId: number) {
  const result = await pool.query(
    `
    SELECT *
    FROM estimate_template_line_items
    WHERE template_id = $1
    ORDER BY sort_order ASC, id ASC
    `,
    [templateId]
  );
  return result.rows;
}

export async function listEstimateTemplates() {
  const result = await pool.query(
    `
    SELECT *
    FROM estimate_templates
    ORDER BY name ASC, id ASC
    `
  );

  const templates = [];
  for (const row of result.rows) {
    const lines = await getLineItems(row.id);
    templates.push(mapTemplate(row, lines));
  }
  return templates;
}

export async function getEstimateTemplateById(id: number) {
  const result = await pool.query(
    `SELECT * FROM estimate_templates WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (result.rowCount === 0) {
    throw new EstimateTemplateNotFoundError();
  }
  const lines = await getLineItems(id);
  return mapTemplate(result.rows[0], lines);
}

export async function createEstimateTemplate(input: CreateEstimateTemplateInput) {
  try {
    const result = await pool.query(
      `
      INSERT INTO estimate_templates (name, description)
      VALUES ($1, $2)
      RETURNING *
      `,
      [input.name, input.description ?? null]
    );
    return mapTemplate(result.rows[0], []);
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new EstimateTemplateNameTakenError();
    }
    throw error;
  }
}

export async function updateEstimateTemplate(
  id: number,
  updates: UpdateEstimateTemplateInput
) {
  await getEstimateTemplateById(id);

  const keys = Object.keys(updates) as (keyof UpdateEstimateTemplateInput)[];
  if (keys.length === 0) {
    return getEstimateTemplateById(id);
  }

  const setParts: string[] = [];
  const values: any[] = [id];
  for (const key of keys) {
    values.push(updates[key] ?? null);
    setParts.push(`${key} = $${values.length}`);
  }
  setParts.push(`updated_at = CURRENT_TIMESTAMP`);

  try {
    await pool.query(
      `
      UPDATE estimate_templates
      SET ${setParts.join(', ')}
      WHERE id = $1
      `,
      values
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new EstimateTemplateNameTakenError();
    }
    throw error;
  }

  return getEstimateTemplateById(id);
}

export async function deleteEstimateTemplate(id: number) {
  const result = await pool.query(
    `DELETE FROM estimate_templates WHERE id = $1 RETURNING id`,
    [id]
  );
  if (result.rowCount === 0) {
    throw new EstimateTemplateNotFoundError();
  }
  return id;
}

export async function addTemplateLineItem(
  templateId: number,
  input: CreateTemplateLineItemInput
) {
  await getEstimateTemplateById(templateId);
  const { quantity, unit_price } = calculateLineItem({
    quantity: input.quantity,
    unit_price: input.unit_price,
  });

  await pool.query(
    `
    INSERT INTO estimate_template_line_items (
      template_id, name, description, quantity, unit_price, sort_order
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      templateId,
      input.name,
      input.description ?? null,
      quantity,
      unit_price,
      input.sort_order ?? 0,
    ]
  );

  await pool.query(
    `UPDATE estimate_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [templateId]
  );

  return getEstimateTemplateById(templateId);
}

export async function updateTemplateLineItem(
  templateId: number,
  lineItemId: number,
  updates: UpdateTemplateLineItemInput
) {
  const existingRes = await pool.query(
    `
    SELECT *
    FROM estimate_template_line_items
    WHERE id = $1 AND template_id = $2
    LIMIT 1
    `,
    [lineItemId, templateId]
  );
  if (existingRes.rowCount === 0) {
    throw new EstimateTemplateLineItemNotFoundError();
  }
  const existing = existingRes.rows[0];

  const nextQuantity =
    'quantity' in updates ? updates.quantity : existing.quantity;
  const nextUnitPrice =
    'unit_price' in updates ? updates.unit_price : existing.unit_price;
  const { quantity, unit_price } = calculateLineItem({
    quantity: nextQuantity,
    unit_price: nextUnitPrice,
  });

  const setParts: string[] = [];
  const values: any[] = [lineItemId, templateId];

  if ('name' in updates) {
    values.push(updates.name ?? existing.name);
    setParts.push(`name = $${values.length}`);
  }
  if ('description' in updates) {
    values.push(updates.description ?? null);
    setParts.push(`description = $${values.length}`);
  }
  if ('quantity' in updates) {
    values.push(quantity);
    setParts.push(`quantity = $${values.length}`);
  }
  if ('unit_price' in updates) {
    values.push(unit_price);
    setParts.push(`unit_price = $${values.length}`);
  }
  if ('sort_order' in updates) {
    values.push(updates.sort_order ?? 0);
    setParts.push(`sort_order = $${values.length}`);
  }

  if (setParts.length > 0) {
    setParts.push(`updated_at = CURRENT_TIMESTAMP`);
    await pool.query(
      `
      UPDATE estimate_template_line_items
      SET ${setParts.join(', ')}
      WHERE id = $1 AND template_id = $2
      `,
      values
    );
  }

  await pool.query(
    `UPDATE estimate_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [templateId]
  );

  return getEstimateTemplateById(templateId);
}

export async function deleteTemplateLineItem(
  templateId: number,
  lineItemId: number
) {
  const result = await pool.query(
    `
    DELETE FROM estimate_template_line_items
    WHERE id = $1 AND template_id = $2
    RETURNING id
    `,
    [lineItemId, templateId]
  );
  if (result.rowCount === 0) {
    throw new EstimateTemplateLineItemNotFoundError();
  }

  await pool.query(
    `UPDATE estimate_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [templateId]
  );

  return getEstimateTemplateById(templateId);
}

export { normalizeMoney };
