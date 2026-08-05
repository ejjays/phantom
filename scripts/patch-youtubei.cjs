// idempotent patch for youtubei.js dist:
// 1) getParserByName throws for renderers the lib hasn't caught up with
//    (autonavEndpoint, maybeHistoryEndpoint, ...), killing the whole watch-page
//    parse via VideoInfo .as() on null — instead register a generic YTNode
//    subclass (same static type) so nested renderer lists resolve; top-level
//    unknown renderers keep the typed JIT path.
// 2) VideoInfo casts watch-next contents to TwoColumnWatchNextResults
//    unconditionally — YouTube serves singleColumnWatchNextResults on the web
//    client, which crashes the constructor. tolerate both (metadata enrichment
//    skips, formats/streaming data unaffected).
const fs = require('fs');
const path = require('path');

const parserTarget = path.resolve(
  __dirname,
  '../node_modules/youtubei.js/dist/src/parser/parser.js'
);
const videoInfoTarget = path.resolve(
  __dirname,
  '../node_modules/youtubei.js/dist/src/parser/youtube/VideoInfo.js'
);

const PARSER_MARKER = '// phantom: generic fallback for unknown renderers';
const VIDEOINFO_MARKER = '// phantom: tolerate singleColumnWatchNextResults';

const OLD_IMPORT = "import { Memo, observe, SuperParsedResult } from './helpers.js';";
const NEW_IMPORT = "import { Memo, observe, SuperParsedResult, YTNode } from './helpers.js';";

const OLD_FN = `export function getParserByName(classname) {
    const ParserConstructor = RUNTIME_NODES.get(classname);
    if (!ParserConstructor) {
        const error = new Error(\`Module not found: \${classname}\`);
        error.code = 'MODULE_NOT_FOUND';
        throw error;
    }
    return ParserConstructor;
}`;

const NEW_FN = `${PARSER_MARKER}
export function getParserByName(classname) {
    let ParserConstructor = RUNTIME_NODES.get(classname);
    if (!ParserConstructor) {
        ParserConstructor = class extends YTNode {
            static type = classname;
        };
        addRuntimeParser(classname, ParserConstructor);
    }
    return ParserConstructor;
}`;

const OLD_CAST = 'const two_col = next?.contents?.item().as(TwoColumnWatchNextResults);';
const NEW_CAST = `${VIDEOINFO_MARKER}
        const __contents = next?.contents?.item();
        const two_col = __contents?.is(TwoColumnWatchNextResults) ? __contents : undefined;`;

let src = fs.readFileSync(parserTarget, 'utf8');

if (src.includes(PARSER_MARKER)) {
  console.log('youtubei.js parser patch already applied — nothing to do');
} else {
  if (!src.includes(OLD_FN)) {
    console.error('youtubei.js parser patch FAILED — expected source block not found');
    process.exit(1);
  }

  if (src.includes(OLD_IMPORT)) {
    src = src.split(OLD_IMPORT).join(NEW_IMPORT);
  } else if (!src.includes('YTNode } from')) {
    console.error('youtubei.js parser patch FAILED — helpers import not found');
    process.exit(1);
  }

  src = src.split(OLD_FN).join(NEW_FN);
  fs.writeFileSync(parserTarget, src);
  console.log('youtubei.js parser patch applied');
}

let videoInfo = fs.readFileSync(videoInfoTarget, 'utf8');

if (videoInfo.includes(VIDEOINFO_MARKER)) {
  console.log('youtubei.js VideoInfo patch already applied — nothing to do');
} else {
  if (!videoInfo.includes(OLD_CAST)) {
    console.error('youtubei.js VideoInfo patch FAILED — expected cast line not found');
    process.exit(1);
  }
  videoInfo = videoInfo.split(OLD_CAST).join(NEW_CAST);
  fs.writeFileSync(videoInfoTarget, videoInfo);
  console.log('youtubei.js VideoInfo patch applied');
}
