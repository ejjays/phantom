import multer from 'multer';
import { logger } from '../utils/infra/logger.util.js';
import ffmpeg from 'fluent-ffmpeg';
import { dirname, join, extname, basename } from 'node:path';
import { resolveWithin } from '../utils/network/security.util.js';
import { existsSync, mkdirSync, readFileSync, unlink } from 'node:fs';
import wav from 'wav-decoder';
import { fileURLToPath } from 'node:url';
import { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMP_DIR = join(__dirname, '../../temp');
const uploadDir = join(TEMP_DIR, 'uploads');
const processedDir = join(TEMP_DIR, 'processed');

import { ChordsResult } from '../types/index.js';

interface EssentiaVector {
  delete: () => void;
}

interface EssentiaPCVVector extends EssentiaVector {
  push_back: (val: EssentiaVector) => void;
}

interface EssentiaInstance {
  arrayToVector: (arr: Float32Array) => EssentiaVector;
  vectorToArray: (vec: EssentiaVector) => string[] | number[];
  KeyExtractor: (vec: EssentiaVector) => { key: string; scale: string };
  Windowing: (vec: EssentiaVector) => { frame: EssentiaVector };
  Spectrum: (vec: EssentiaVector) => { spectrum: EssentiaVector };
  SpectralPeaks: (vec: EssentiaVector) => {
    frequencies: EssentiaVector;
    magnitudes: EssentiaVector;
  };
  HPCP: (
    freqs: EssentiaVector,
    mags: EssentiaVector
  ) => { hpcp: EssentiaVector };
  ChordsDetection: (vec: EssentiaPCVVector) => { chords: EssentiaVector };
  module: {
    VectorVectorFloat: new () => EssentiaPCVVector;
  };
}

let essentia: EssentiaInstance | null = null;

async function getEssentia(): Promise<EssentiaInstance | null> {
  if (essentia) return essentia;
  try {
    const { default: EssentiaModule } =
      await (import('essentia.js') as unknown as {
        default: {
          Essentia: new (wasm: unknown) => EssentiaInstance;
          EssentiaWASM: unknown;
        };
      });
    essentia = new EssentiaModule.Essentia(EssentiaModule.EssentiaWASM);
    return essentia;
  } catch (error: unknown) {
    logger.error('❌ Essentia WASM failed', (error as Error).message);
    return null;
  }
}

[uploadDir, processedDir].forEach((dir) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDir);
  },
  filename: (_req, file, callback) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/gu, '_');
    callback(null, `${Date.now()}-${safeName}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // max 100mb
});

const keyMap: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

const _generateChords = (
  essentiaInstance: EssentiaInstance,
  signal: Float32Array
) => {
  const frameSize = 4096;
  const hopSize = 2048;
  const pcpVector = new essentiaInstance.module.VectorVectorFloat();

  for (let i = 0; i < Math.min(signal.length, 44100 * 30); i += hopSize) {
    if (i + frameSize > signal.length) break;
    const frame = signal.slice(i, i + frameSize);
    const frameVec = essentiaInstance.arrayToVector(frame);
    const windowed = essentiaInstance.Windowing(frameVec).frame;
    const spectrum = essentiaInstance.Spectrum(windowed).spectrum;
    const peaks = essentiaInstance.SpectralPeaks(spectrum);
    const hpcp = essentiaInstance.HPCP(
      peaks.frequencies,
      peaks.magnitudes
    ).hpcp;
    pcpVector.push_back(hpcp);
    frameVec.delete();
  }

  const chordsResult = essentiaInstance.ChordsDetection(pcpVector);
  const uniqueChords: string[] = [];

  if (chordsResult?.chords) {
    const chordsArray = essentiaInstance.vectorToArray(
      chordsResult.chords
    ) as string[];
    chordsArray.forEach((chord: string) => {
      if (uniqueChords[uniqueChords.length - 1] !== chord) {
        uniqueChords.push(chord);
      }
    });
  }

  pcpVector.delete();
  return uniqueChords;
};

const _handleAudioDecoding = (
  essentiaInstance: EssentiaInstance,
  buffer: Buffer,
  tempWavPath: string,
  resolve: (value: ChordsResult | PromiseLike<ChordsResult>) => void,
  reject: (reason?: unknown) => void
) => {
  wav
    .decode(buffer)
    .then((audioData: { channelData: Float32Array[] }) => {
      const signal = audioData.channelData[0];
      const audioVector = essentiaInstance.arrayToVector(signal);
      const keyResult = essentiaInstance.KeyExtractor(audioVector);

      const uniqueChords = _generateChords(essentiaInstance, signal);

      audioVector.delete();
      unlink(tempWavPath, (_error) => {});

      resolve({
        key: keyResult.key,
        scale: keyResult.scale,
        chords: uniqueChords.filter((chord) => chord !== 'N').slice(0, 12),
      });
    })
    .catch((error: Error) => {
      unlink(tempWavPath, (_error) => {});
      reject(error);
    });
};

const detectKeyFromFile = async (filePath: string): Promise<ChordsResult> => {
  const essentiaInstance = await getEssentia();
  if (!essentiaInstance) throw new Error('Essentia engine not available');

  return new Promise((resolve, reject) => {
    const randomId = randomBytes(4).toString('hex');
    const tempWavPath = join(uploadDir, `temp-${Date.now()}-${randomId}.wav`);

    ffmpeg(filePath)
      .toFormat('wav')
      .audioChannels(1)
      .audioFrequency(44100)
      .on('end', () => {
        const buffer = readFileSync(tempWavPath);
        _handleAudioDecoding(
          essentiaInstance,
          buffer,
          tempWavPath,
          resolve,
          reject
        );
      })
      .on('error', (error: Error) => {
        unlink(tempWavPath, (_error) => {});
        reject(error);
      })
      .save(tempWavPath);
  });
};

export const detectKey = async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  try {
    const result = await detectKeyFromFile(req.file.path);
    res.json(result);
  } catch (error) {
    logger.error('[KeyChanger] Detection Error:', error);
    res.status(500).json({ error: 'Audio analysis failed' });
  } finally {
    unlink(req.file.path, (_error) => {});
  }
};

export const detectProcessedKey = async (
  req: Request,
  res: Response
): Promise<void> => {
  const filename = String(req.params.filename);
  const filePath = resolveWithin(processedDir, filename);

  if (!filePath) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    const result = await detectKeyFromFile(filePath);
    res.json(result);
  } catch (error) {
    logger.error('[KeyChanger] Processed Detection Error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
};

export const convertKey = (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { originalKey, targetKey } = req.body;

  if (
    !originalKey ||
    !targetKey ||
    keyMap[originalKey] === undefined ||
    keyMap[targetKey] === undefined
  ) {
    unlink(req.file.path, (_error) => {});
    res.status(400).json({ error: 'Invalid keys provided' });
    return;
  }

  const originalVal = keyMap[originalKey];
  const targetVal = keyMap[targetKey];
  let semitones = targetVal - originalVal;
  if (semitones > 6) semitones -= 12;
  if (semitones < -6) semitones += 12;

  const pitchScale = Math.pow(2, semitones / 12);
  const inputPath = req.file.path;
  const extension = extname(req.file.originalname);
  const baseNamePart = basename(req.file.originalname, extension).replace(
    /[^a-zA-Z0-9\s.-]/gu,
    '_'
  );
  const outputFilename = `${Date.now()}__${targetKey}__${baseNamePart}${extension}`;
  const outputPath = join(processedDir, outputFilename);

  ffmpeg(inputPath)
    .audioFilters(`rubberband=pitch=${pitchScale}`)
    .on('end', () => {
      const protocol =
        (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const host = req.headers.host;
      res.json({
        success: true,
        filename: outputFilename,
        downloadUrl: `${protocol}://${host}/api/key-changer/download/${outputFilename}`,
      });
      unlink(inputPath, (_error) => {});
    })
    .on('error', (error: unknown) => {
      const errorObj = error as Error;
      logger.error('[KeyChanger] Conversion Error:', errorObj.message);
      if (!res.headersSent)
        res
          .status(500)
          .json({ error: 'Conversion failed.', details: errorObj.message });
      unlink(inputPath, (_error) => {});
    })
    .save(outputPath);
};

export const downloadFile = (req: Request, res: Response): void => {
  const filename = String(req.params.filename);
  const filePath = resolveWithin(processedDir, filename);

  if (!filePath) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (existsSync(filePath)) {
    let prettyName = filename;
    const parts = filename.split('__');
    if (parts.length >= 3) {
      const key = parts[1];
      const nameWithExt = parts.slice(2).join('__');
      const extension = extname(nameWithExt);
      const baseNamePart = basename(nameWithExt, extension);
      const cleanName = baseNamePart.replace(/_+/gu, ' ').trim();
      prettyName = `(${key}) ${cleanName}${extension}`;
    }

    res.download(filePath, prettyName, (error) => {
      if (error) {
        const errorWithCode = error as Error & { code?: string };
        if (
          errorWithCode.code === 'ECONNABORTED' ||
          errorWithCode.code === 'EPIPE'
        ) {
          return;
        }
        logger.error('[KeyChanger] Download Error:', error);
      }
    });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
};
