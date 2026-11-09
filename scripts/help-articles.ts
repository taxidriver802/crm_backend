/**
 * Print the Help articles parsed from the user guide as JSON.
 *
 *   npm run help:articles [-- path/to/guide.md]
 *
 * crm_qa's one-source check runs this and compares what the panel would
 * show with its own reading of the guide. Exits 1 when the guide has
 * problems (a section with no article, a marker that disagrees with its
 * section).
 */
import { GUIDE_PATH, loadGuide } from '../src/lib/helpGuide';

const file = process.argv[2] || GUIDE_PATH;
const guide = loadGuide(file);
// Let Node flush stdout. process.exit() here drops the tail of a piped
// write once the buffer fills, so a check reading this sees broken JSON.
console.log(
  JSON.stringify({ file, articles: guide.articles, sources: guide.sources, errors: guide.errors }, null, 2)
);
if (guide.errors.length) process.exitCode = 1;
