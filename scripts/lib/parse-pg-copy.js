/**
 * Parses PostgreSQL pg_dump COPY blocks from a .sql file.
 */

function parseCopyLine(line) {
  const values = [];
  let current = '';
  let i = 0;

  while (i < line.length) {
    if (line[i] === '\\' && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === 'N') {
        values.push(null);
        current = '';
        i += 2;
        if (line[i] === '\t') i += 1;
        continue;
      }
      if (next === 't') {
        current += '\t';
        i += 2;
        continue;
      }
      if (next === 'n') {
        current += '\n';
        i += 2;
        continue;
      }
      if (next === 'r') {
        current += '\r';
        i += 2;
        continue;
      }
      if (next === '\\') {
        current += '\\';
        i += 2;
        continue;
      }
    }

    if (line[i] === '\t') {
      values.push(current);
      current = '';
      i += 1;
      continue;
    }

    current += line[i];
    i += 1;
  }

  values.push(current);
  return values;
}

function parsePgCopyBlocks(sqlText) {
  const blocks = {};
  const lines = sqlText.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(/^COPY public\.(\w+) \((.+)\) FROM stdin;$/);
    if (!header) continue;

    const table = header[1];
    const columns = header[2].split(',').map((column) => column.trim());
    const rowLines = [];

    i += 1;
    while (i < lines.length && lines[i] !== '\\.') {
      if (lines[i].length > 0) {
        rowLines.push(lines[i]);
      }
      i += 1;
    }

    blocks[table] = rowLines.map((line) => {
      const values = parseCopyLine(line);
      return Object.fromEntries(
        columns.map((column, index) => [column, values[index] ?? null])
      );
    });
  }

  return blocks;
}

module.exports = {
  parseCopyLine,
  parsePgCopyBlocks,
};
