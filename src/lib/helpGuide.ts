/**
 * The user guide (docs/guide/using-the-crm.md) is the only copy of the help
 * words. This module reads that file and turns its marked sections into the
 * articles the in-app Help panel shows, so the guide and the panel cannot
 * drift: there is nothing else to edit.
 *
 * A section becomes an article when the line under its heading is a marker:
 *
 *   ### Record a payment
 *   <!-- help: id=record-a-payment; roles=owner,admin,agent; group=Money; screen=/invoices; screen-label=Invoices; keywords=pay, check -->
 *
 * `<!-- help: none -->` marks a heading that is deliberately not an article
 * (a part title, the closing skip list). Every level-2 and level-3 heading
 * outside an article must carry one or the other; `validateGuide` reports
 * any that do not, and any marker whose words disagree with it.
 *
 * Pure functions over a string: no database, no Express. Inline markdown
 * (bold, code, links) is left in the text; the frontend renders it.
 */

import fs from 'fs';
import path from 'path';

export const HELP_ROLES = ['owner', 'admin', 'agent'] as const;
export type HelpRole = (typeof HELP_ROLES)[number];
export type HelpKind = 'about' | 'start' | 'task' | 'reference';
const KINDS: HelpKind[] = ['about', 'start', 'task', 'reference'];

export type HelpBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

export type HelpArticleSummary = {
  id: string;
  title: string;
  kind: HelpKind;
  group: string | null;
  roles: HelpRole[];
  screen: { href: string; label: string } | null;
  keywords: string[];
};

export type HelpArticle = HelpArticleSummary & { blocks: HelpBlock[] };

export type GuideHeading = {
  level: number;
  title: string;
  slug: string;
  line: number;
  marker: 'article' | 'none' | null;
  /** True when the heading sits inside an article (a step heading). */
  insideArticle: boolean;
};

export type ParsedGuide = {
  articles: HelpArticle[];
  headings: GuideHeading[];
  /** Raw markdown body of each article, keyed by id (for the one-source check). */
  sources: Record<string, string>;
  errors: string[];
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const MARKER_RE = /^<!--\s*help:\s*(.*?)\s*-->\s*$/;

/** GitHub's heading anchor, which is also the article id. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

function parseMarker(body: string): Record<string, string> | 'none' {
  if (body.trim() === 'none') return 'none';
  const fields: Record<string, string> = {};
  for (const part of body.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return fields;
}

const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** Markdown body → blocks. Paragraphs, bullet and numbered lists, sub-headings. */
export function parseBlocks(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const lines = body.split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      // A blank line ends a list only if the next line is not an item; lists
      // in the guide are written tight, so ending here is correct.
      flushList();
      continue;
    }
    if (MARKER_RE.test(line.trim())) continue;
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', text: heading[2] });
      continue;
    }
    const item = LIST_ITEM_RE.exec(line);
    if (item && !item[1]) {
      flushPara();
      const ordered = /\d/.test(item[2]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[3].trim());
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // Continuation of the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** The words of a block list, without markup, for comparing with the source. */
export function blocksText(blocks: HelpBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'list') parts.push(...block.items);
    else parts.push(block.text);
  }
  return parts.join(' ');
}

const WHO_RE = /^\*\*Who (?:can do this|this is for):\*\*\s*(.*)$/m;

function rolesNamedIn(sentence: string): HelpRole[] {
  const lower = sentence.toLowerCase();
  return HELP_ROLES.filter((role) => new RegExp(`\\b${role}s?\\b`).test(lower));
}

export function parseGuide(markdown: string): ParsedGuide {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const headings: GuideHeading[] = [];
  const errors: string[] = [];

  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line);
    if (!match) return;
    const next = MARKER_RE.exec((lines[index + 1] || '').trim());
    let marker: GuideHeading['marker'] = null;
    if (next) marker = parseMarker(next[1]) === 'none' ? 'none' : 'article';
    headings.push({
      level: match[1].length,
      title: match[2],
      slug: slugify(match[2]),
      line: index,
      marker,
      insideArticle: false,
    });
  });

  const articles: HelpArticle[] = [];
  const sources: Record<string, string> = {};
  const seen = new Set<string>();

  headings.forEach((heading, i) => {
    if (heading.marker !== 'article') return;
    // The article runs to the next heading at its level or above.
    let end = lines.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= heading.level) {
        end = headings[j].line;
        break;
      }
      headings[j].insideArticle = true;
    }
    const fields = parseMarker(MARKER_RE.exec(lines[heading.line + 1].trim())![1]) as Record<string, string>;
    const where = `"${heading.title}" (line ${heading.line + 1})`;
    const id = fields.id || '';
    const body = lines.slice(heading.line + 2, end).join('\n').trim();

    if (!id) errors.push(`${where}: marker has no id`);
    else if (id !== heading.slug) errors.push(`${where}: id "${id}" is not the heading's anchor "${heading.slug}"`);
    if (seen.has(id)) errors.push(`${where}: duplicate id "${id}"`);
    seen.add(id);

    const roles = (fields.roles || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    const badRoles = roles.filter((r) => !(HELP_ROLES as readonly string[]).includes(r));
    if (!roles.length) errors.push(`${where}: marker names no roles`);
    if (badRoles.length) errors.push(`${where}: unknown roles ${badRoles.join(', ')}`);

    const kind = (fields.kind || 'task') as HelpKind;
    if (!KINDS.includes(kind)) errors.push(`${where}: unknown kind "${fields.kind}"`);

    const screenHref = fields.screen || '';
    if (screenHref && !screenHref.startsWith('/')) errors.push(`${where}: screen must be an app path`);

    if (kind === 'task' || kind === 'reference') {
      const who = WHO_RE.exec(body);
      if (!who) {
        errors.push(`${where}: no "**Who can do this:**" line`);
      } else {
        const firstSentence = who[1].split('.')[0];
        const named = rolesNamedIn(firstSentence).sort().join(',');
        const marked = [...roles].sort().join(',');
        if (named !== marked) {
          errors.push(`${where}: the Who line names ${named || 'no role'} but the marker says ${marked}`);
        }
      }
      if (!/^\*\*Where:\*\*/m.test(body)) errors.push(`${where}: no "**Where:**" line`);
      if (kind === 'task' && !/^\*\*When it worked:\*\*/m.test(body)) {
        errors.push(`${where}: no "**When it worked:**" line`);
      }
    }

    sources[id] = body;
    articles.push({
      id,
      title: heading.title,
      kind,
      group: fields.group || null,
      roles: roles.filter((r): r is HelpRole => (HELP_ROLES as readonly string[]).includes(r)),
      screen: screenHref ? { href: screenHref, label: fields['screen-label'] || heading.title } : null,
      keywords: (fields.keywords || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      blocks: parseBlocks(body),
    });
  });

  for (const heading of headings) {
    if (heading.level < 2 || heading.level > 3 || heading.insideArticle) continue;
    if (heading.marker === null) {
      errors.push(`"${heading.title}" (line ${heading.line + 1}): guide section has no article (add a help marker, or <!-- help: none -->)`);
    }
  }

  return { articles, headings, sources, errors };
}

export function summarize(article: HelpArticle): HelpArticleSummary {
  const { blocks: _blocks, ...summary } = article;
  return summary;
}

export function canRead(article: HelpArticleSummary, role: string | undefined): boolean {
  return Boolean(role) && (article.roles as string[]).includes(role as string);
}

// ---------------------------------------------------------------------------
// The file on disk, re-read when it changes.
// ---------------------------------------------------------------------------

export const GUIDE_PATH = path.resolve(__dirname, '../../docs/guide/using-the-crm.md');

let cache: { mtimeMs: number; guide: ParsedGuide } | null = null;

export function loadGuide(file: string = GUIDE_PATH): ParsedGuide {
  const stat = fs.statSync(file);
  if (file === GUIDE_PATH && cache && cache.mtimeMs === stat.mtimeMs) return cache.guide;
  const guide = parseGuide(fs.readFileSync(file, 'utf8'));
  if (guide.errors.length) {
    console.warn(`[help] ${guide.errors.length} problem(s) in the user guide:\n  ${guide.errors.join('\n  ')}`);
  }
  if (file === GUIDE_PATH) cache = { mtimeMs: stat.mtimeMs, guide };
  return guide;
}
