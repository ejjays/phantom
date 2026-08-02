'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PKG = '@nikhil-cephei/ffmpeg-kit-react-native';
const AAR = 'ffmpeg-kit-full-gpl.aar';

// module keeps Java params boxed (Double/Integer/Boolean) but codegen emits
// primitives (D/Z) — JNI can't resolve them at runtime, so derive real sigs
const JNI_TYPES = {
  Double: 'Ljava/lang/Double;',
  Integer: 'Ljava/lang/Integer;',
  Boolean: 'Ljava/lang/Boolean;',
  Long: 'Ljava/lang/Long;',
  Float: 'Ljava/lang/Float;',
  String: 'Ljava/lang/String;',
  Promise: 'Lcom/facebook/react/bridge/Promise;',
  ReadableArray: 'Lcom/facebook/react/bridge/ReadableArray;',
  ReadableMap: 'Lcom/facebook/react/bridge/ReadableMap;',
  WritableMap: 'Lcom/facebook/react/bridge/WritableMap;',
  'com.facebook.react.bridge.Promise': 'Lcom/facebook/react/bridge/Promise;',
};

function buildDescriptors(specSrc) {
  const re =
    /public abstract (?:[\w<>,.? \[\]]+|void) (\w+)\((.*?)\)\s*(?:throws [\w.,\s]+)?;/g;
  const out = new Map();
  let m;
  while ((m = re.exec(specSrc)) !== null) {
    const [, name, args] = m;
    const params = args
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) =>
        a
          .split(/\s+/)
          .filter((t) => t !== 'final' && !t.startsWith('@'))[0],
      );
    const sig = params.map((p) => JNI_TYPES[p] || p);
    out.set(name, `(${sig.join('')})V`);
  }
  return out;
}

// plugin hardcodes flatDir at `$rootDir/../node_modules/<pkg>/android/libs`
// (rootDir = app/android), i.e. mobile/node_modules/<pkg>/android/libs —
// aar must live there or gradle can't find it.

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function findRealPackage() {
  const candidates = [
    path.join(process.cwd(), 'node_modules', PKG),
    path.join(process.cwd(), '..', 'node_modules', PKG),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return null;
}

const realPkgDir = findRealPackage();
if (!realPkgDir) {
  console.warn('[ensure-ffmpeg-aar] package not found, skipping');
  process.exit(0);
}

const setup = path.join(realPkgDir, 'scripts', 'setup.js');
if (fs.existsSync(setup)) {
  run(process.execPath, [setup]);
} else {
  console.warn(`[ensure-ffmpeg-aar] no setup.js at ${realPkgDir}`);
}

// RN 0.85 never schedules per-module codegen for this pkg (naming drift in the
// new-arch sources), so vendor the generated spec into the module's source set.
// Run with RN's own codegen CLIs so it matches the RN in the build.
const codegenRoot = [path.join(process.cwd(), '..'), process.cwd()];
const combineCli = require.resolve(
  '@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js',
  { paths: codegenRoot },
);
const generateCli = require.resolve(
  '@react-native/codegen/lib/cli/generators/generate-all.js',
  { paths: codegenRoot },
);

const specDest = path.join(
  realPkgDir,
  'android',
  'src',
  'main',
  'java',
  'com',
  'arthenica',
  'ffmpegkit',
  'reactnative',
  'NativeFFmpegKitReactNativeModuleSpec.java',
);

// autolinking's add_subdirectory() includes this jni dir (codegenConfig in
// package.json) but build.gradle never schedules its tasks — vendor output.
const jniDest = path.join(
  realPkgDir,
  'android',
  'build',
  'generated',
  'source',
  'codegen',
  'jni',
);

if (!fs.existsSync(specDest) || !fs.existsSync(path.join(jniDest, 'CMakeLists.txt'))) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-codegen-'));
  try {
    const schema = path.join(tmp, 'schema.json');
    run(process.execPath, [
      combineCli,
      schema,
      '--platform',
      'android',
      path.join(realPkgDir, 'src', 'NativeFFmpegKit.js'),
      '--libraryName',
      'FFmpegKitReactNativeSpec',
    ]);
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    run(process.execPath, [
      generateCli,
      schema,
      'FFmpegKitReactNativeSpec',
      outDir,
      'com.arthenica.ffmpegkit.reactnative',
      'false',
    ]);
    const generated = path.join(
      outDir,
      'java',
      'com',
      'arthenica',
      'ffmpegkit',
      'reactnative',
      'NativeFFmpegKitSpec.java',
    );
    let src = fs.readFileSync(generated, 'utf8');
    src = src.replaceAll('NativeFFmpegKitSpec', 'NativeFFmpegKitReactNativeModuleSpec');
    const typePatches = [
      ['double sessionId', 'Double sessionId'],
      ['double waitTimeout', 'Double waitTimeout'],
      ['double signalValue', 'Double signalValue'],
      ['double level', 'Double level'],
      ['double sessionHistorySize', 'Double sessionHistorySize'],
      ['double sessionState', 'Double sessionState'],
      ['double logRedirectionStrategy', 'Double logRedirectionStrategy'],
      ['removeListeners(double count)', 'removeListeners(Integer count)'],
      ['boolean writable', 'Boolean writable'],
    ];
    for (const [from, to] of typePatches) {
      src = src.replaceAll(from, to);
    }
    fs.mkdirSync(path.dirname(specDest), { recursive: true });
    fs.writeFileSync(specDest, src);
    console.log(`[ensure-ffmpeg-aar] vendored native spec at ${specDest}`);

    const generatedJni = path.join(outDir, 'jni');
    if (fs.existsSync(generatedJni)) {
      fs.rmSync(jniDest, { recursive: true, force: true });
      fs.cpSync(generatedJni, jniDest, { recursive: true });
      console.log(`[ensure-ffmpeg-aar] vendored codegen jni at ${jniDest}`);
      const cppPath = path.join(jniDest, 'FFmpegKitReactNativeSpec-generated.cpp');
      const descriptors = buildDescriptors(src);
      let cpp = fs.readFileSync(cppPath, 'utf8');
      for (const [name, desc] of descriptors) {
        cpp = cpp.replace(
          new RegExp(`(invokeJavaMethod\\(rt, \\w+Kind, "${name}", *)"[^"]*"`),
          `$1"${desc}"`,
        );
      }
      fs.writeFileSync(cppPath, cpp);
      console.log(
        `[ensure-ffmpeg-aar] corrected ${descriptors.size} jni descriptors`,
      );
    } else {
      console.warn('[ensure-ffmpeg-aar] codegen jni output missing');
    }
  } catch (err) {
    console.warn(`[ensure-ffmpeg-aar] native spec generation failed: ${err.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else {
  console.log(`[ensure-ffmpeg-aar] native spec already vendored at ${specDest}`);
}

// expose installed pkg (and its aar) under mobile/node_modules so the plugin's
// fixed flatDir resolves; a pkg-json-less dir there would shadow autolinking &
// drop the module, so remove and relink it.
const appPkg = path.join(process.cwd(), 'node_modules', PKG);
if (fs.existsSync(appPkg) && !fs.existsSync(path.join(appPkg, 'package.json'))) {
  fs.rmSync(appPkg, { recursive: true, force: true });
  console.log(`[ensure-ffmpeg-aar] removed stale shadow at ${appPkg}`);
}

if (!fs.existsSync(appPkg)) {
  fs.mkdirSync(path.dirname(appPkg), { recursive: true });
  fs.symlinkSync(realPkgDir, appPkg, 'dir');
  console.log(`[ensure-ffmpeg-aar] linked ${realPkgDir} -> ${appPkg}`);
}

const aarFile = path.join(appPkg, 'android', 'libs', AAR);
if (fs.existsSync(aarFile)) {
  console.log(`[ensure-ffmpeg-aar] aar ready at ${aarFile} (${fs.statSync(aarFile).size} B)`);
} else {
  console.warn(`[ensure-ffmpeg-aar] aar NOT at ${aarFile}`);
  process.exitCode = 1;
}