import { useState, useRef, useCallback, useMemo } from 'react';
import { BACKEND_URL } from '../../lib/config';
import { useRemixStore } from '../../store/useRemixStore';
import SEO from '../../components/utils/SEO';
import {
  UploadCloud,
  Music,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Play,
  Pause,
  Download,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { motion } from 'framer-motion';
import TwinkleStars from '../../components/ui/TwinkleStars';
import ShootingStars from '../../components/ui/ShootingStars';

const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const normalizeKey = (key: string) => {
  const normalizationMap: Record<string, string> = {
    Db: 'C#',
    Eb: 'D#',
    Gb: 'F#',
    Ab: 'G#',
    Bb: 'A#',
  };
  return normalizationMap[key] || key;
};

const keyToNumberMap: Record<string, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
};

const SongHeader = () => (
  <header className="text-center mb-16">
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold tracking-widest uppercase mb-6"
    >
      <Music size={14} /> For Musicians
    </motion.div>
    <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-white mb-4">
      Song<span className="text-cyan-400 text-glow">Key</span>
    </h1>
    <p className="text-slate-400 text-lg max-w-xl mx-auto font-medium">
      Detect or transpose your tracks into any key
    </p>
  </header>
);

interface DropZoneProps {
  onFileClick: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

const DropZone = ({
  onFileClick,
  onFileChange,
  fileInputRef,
}: DropZoneProps) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    onClick={onFileClick}
    className="group relative border-2 border-dashed border-cyan-500/20 bg-cyan-500/5 hover:bg-cyan-500/10 hover:border-cyan-500/50 rounded-[2rem] p-16 transition-all cursor-pointer overflow-hidden backdrop-blur-md"
  >
    <input
      type="file"
      ref={fileInputRef}
      className="hidden"
      accept="audio/*"
      onChange={onFileChange}
    />
    <div className="relative z-10 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-cyan-500 transition-all duration-500 border border-white/5">
        <UploadCloud
          size={32}
          className="text-slate-400 group-hover:text-slate-950"
        />
      </div>
      <h3 className="text-2xl font-bold text-white mb-2">
        Drop your track here
      </h3>
      <p className="text-slate-500 font-medium">
        mp3, m4a, wav ...• Up to 100MB
      </p>
    </div>
  </motion.div>
);

const AnalysisStatus = ({ status }: { status: string }) => (
  <div className="bg-[#030014]/40 backdrop-blur-xl border border-white/10 rounded-[2rem] p-20 text-center space-y-8">
    <div className="relative inline-block">
      <Loader2 size={64} className="text-cyan-500 animate-spin" />
      <div className="absolute inset-0 blur-2xl bg-cyan-500/20 animate-pulse" />
    </div>
    <div className="space-y-2">
      <h3 className="text-2xl font-bold text-white uppercase tracking-tighter">
        {status === 'analyzing'
          ? 'Analyzing Harmonic Content'
          : 'Processing Bitstream'}
      </h3>
      <p className="text-cyan-500/60 font-mono text-sm animate-pulse italic">
        {status === 'analyzing'
          ? 'Extracting fundamental frequency...'
          : 'Applying RubberBand pitch scaling...'}
      </p>
    </div>
  </div>
);

const KeySelector = ({
  label,
  value,
  onChange,
  icon: Icon,
  highlight = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ElementType;
  highlight?: boolean;
}) => (
  <div className="space-y-4">
    <label
      className={`text-[10px] font-black uppercase tracking-[0.25em] ml-2 ${highlight ? 'text-cyan-500' : 'text-slate-500'}`}
    >
      {label}
    </label>
    <div className="relative group">
      <select
        className={`w-full border border-white/10 rounded-2xl px-6 py-5 font-black text-2xl appearance-none cursor-pointer focus:border-cyan-500/50 outline-none transition-all ${highlight ? 'bg-cyan-500/10 text-cyan-400 shadow-[0_0_40px_rgba(6,182,212,0.1)]' : 'bg-white/5 text-white hover:bg-white/[0.08]'}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {keys.map((keyItem) => (
          <option
            key={keyItem}
            value={keyItem}
            className="bg-[#030014] text-cyan-400 font-sans"
          >
            {keyItem}
          </option>
        ))}
      </select>
      <div
        className={`absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${highlight ? 'text-cyan-500' : 'text-slate-600 group-hover:text-cyan-400'}`}
      >
        <Icon size={18} />
      </div>
    </div>
  </div>
);

interface ReadyStateProps {
  file: File | null;
  detectedInfo: { key?: string; chords?: string[] } | null;
  reset: () => void;
  originalKey: string;
  setOriginalKey: (v: string) => void;
  targetKey: string;
  setTargetKey: (v: string) => void;
  semitones: number;
  startConversion: () => void;
}

interface ResultStateProps {
  file: File | null;
  originalKey: string;
  targetKey: string;
  downloadUrl: string;
  audioProgress: number;
  isPlaying: boolean;
  togglePlayback: () => void;
  handleTimeUpdate: () => void;
  reset: () => void;
  resultAudioRef: React.RefObject<HTMLAudioElement | null>;
}

const AudioPlayer = ({
  isPlaying,
  togglePlayback,
}: {
  isPlaying: boolean;
  togglePlayback: () => void;
}) => (
  <div className="relative group">
    <div className="w-40 h-40 rounded-[2.5rem] bg-[#030014]/80 flex items-center justify-center overflow-hidden border border-white/5 relative shadow-2xl">
      <Music size={48} className="text-slate-700" />
      <button
        onClick={togglePlayback}
        className="absolute inset-0 bg-cyan-500/90 text-slate-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 scale-90 group-hover:scale-100"
      >
        {isPlaying ? (
          <Pause size={40} fill="currentColor" />
        ) : (
          <Play size={40} fill="currentColor" className="ml-2" />
        )}
      </button>
    </div>
  </div>
);

const StatusHeader = ({
  name,
  keyInfo,
  onReset,
}: {
  name?: string;
  keyInfo?: string;
  onReset: () => void;
}) => (
  // skipcq: JS-0415
  <div className="flex items-center justify-between mb-12">
    <div className="flex items-center gap-5">
      <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
        <Music size={28} />
      </div>
      <div className="min-w-0">
        <h4 className="font-bold text-white truncate max-w-[200px] sm:max-w-[300px] text-lg">
          {name}
        </h4>
        <div className="flex items-center gap-2 mt-1">
          <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 text-[10px] font-black uppercase tracking-wider border border-cyan-500/20">
            AI Detected
          </span>
          <span className="text-slate-400 text-sm font-bold">{keyInfo}</span>
        </div>
      </div>
    </div>
    <button
      onClick={onReset}
      className="p-3 hover:bg-white/5 rounded-2xl text-slate-500 transition-all hover:text-white border border-transparent hover:border-white/10"
    >
      <XCircle size={24} />
    </button>
  </div>
);

const ResultContent = ({
  name,
  originalKey,
  targetKey,
  downloadUrl,
  audioProgress,
  isPlaying,
  togglePlayback,
  reset,
}: {
  name?: string;
  originalKey: string;
  targetKey: string;
  downloadUrl: string;
  audioProgress: number;
  isPlaying: boolean;
  togglePlayback: () => void;
  reset: () => void;
}) => (
  // skipcq: JS-0415
  <div className="flex flex-col md:flex-row items-center gap-10">
    <AudioPlayer isPlaying={isPlaying} togglePlayback={togglePlayback} />

    <div className="flex-1 w-full text-center md:text-left">
      <div className="inline-block px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-[10px] font-black uppercase tracking-widest mb-4">
        Master Rendered
      </div>
      <h3 className="text-3xl font-black text-white mb-2 truncate max-w-sm">
        {name}
      </h3>
      <div className="flex items-center justify-center md:justify-start gap-4 text-slate-400 font-bold mb-8">
        <span>{originalKey}</span>
        <ArrowRight size={14} />
        <span className="text-cyan-400">{targetKey}</span>
      </div>

      <div className="space-y-4">
        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-cyan-500"
            style={{ width: `${audioProgress}%` }}
          />
        </div>
        <div className="flex gap-4">
          <a
            href={downloadUrl}
            download
            className="flex-1 py-4 bg-white text-slate-950 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors"
          >
            <Download size={18} /> Download
          </a>
          <button
            onClick={reset}
            className="p-4 bg-white/5 text-white rounded-2xl hover:bg-white/10 transition-colors border border-white/10"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
    </div>
  </div>
);

const ResultState = ({
  file,
  originalKey,
  targetKey,
  downloadUrl,
  audioProgress,
  isPlaying,
  togglePlayback,
  handleTimeUpdate,
  reset,
  resultAudioRef,
}: ResultStateProps) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-[#030014]/60 border border-cyan-500/30 rounded-[2.5rem] p-10 shadow-2xl overflow-hidden relative backdrop-blur-xl"
  >
    <div className="absolute top-0 right-0 p-8">
      <CheckCircle2 size={32} className="text-cyan-500 opacity-20" />
    </div>

    <ResultContent
      name={file?.name}
      originalKey={originalKey}
      targetKey={targetKey}
      downloadUrl={downloadUrl}
      audioProgress={audioProgress}
      isPlaying={isPlaying}
      togglePlayback={togglePlayback}
      reset={reset}
    />

    <audio
      ref={resultAudioRef}
      src={downloadUrl}
      onTimeUpdate={handleTimeUpdate}
      onEnded={() => togglePlayback()}
      className="hidden"
    />
  </motion.div>
);

const KeyGrid = ({
  originalKey,
  setOriginalKey,
  targetKey,
  setTargetKey,
  semitones,
}: {
  originalKey: string;
  setOriginalKey: (v: string) => void;
  targetKey: string;
  setTargetKey: (v: string) => void;
  semitones: number;
}) => (
  <div className="relative grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] items-center gap-6 mb-12">
    <KeySelector
      label="Source Key"
      value={originalKey}
      onChange={setOriginalKey}
      icon={RefreshCw}
    />

    <div className="flex flex-col items-center gap-2 py-4">
      <div className="w-12 h-12 rounded-full bg-cyan-500 flex items-center justify-center text-slate-950 shadow-[0_0_30px_rgba(6,182,212,0.4)] z-10">
        <ArrowRight size={24} strokeWidth={3} />
      </div>
      <div className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
        <span className="text-xs font-black text-cyan-400 font-mono">
          {semitones > 0 ? `+${semitones}` : semitones} ST
        </span>
      </div>
    </div>

    <KeySelector
      label="Target Key"
      value={targetKey}
      onChange={setTargetKey}
      icon={Music}
      highlight
    />
  </div>
);

const ReadyState = ({
  file,
  detectedInfo,
  reset,
  originalKey,
  setOriginalKey,
  targetKey,
  setTargetKey,
  semitones,
  startConversion,
}: ReadyStateProps) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="w-full bg-[#030014]/60 border border-white/10 rounded-[2.5rem] shadow-2xl backdrop-blur-2xl overflow-hidden p-8"
  >
    <StatusHeader
      name={file?.name}
      keyInfo={detectedInfo?.key}
      onReset={reset}
    />

    <KeyGrid
      originalKey={originalKey}
      setOriginalKey={setOriginalKey}
      targetKey={targetKey}
      setTargetKey={setTargetKey}
      semitones={semitones}
    />

    <button
      onClick={startConversion}
      className="w-full py-6 rounded-2xl bg-white text-slate-950 font-black text-xl tracking-tighter hover:scale-[1.01] active:scale-[0.99] transition-all shadow-[0_20px_50px_-10px_rgba(255,255,255,0.3)] flex items-center justify-center gap-3 group"
    >
      <span>Process Audio</span>
      <ArrowRight
        size={20}
        className="group-hover:translate-x-1 transition-transform"
      />
    </button>
  </motion.div>
);

const BackgroundEffects = () => (
  <>
    <TwinkleStars />
    <ShootingStars starColor="#22d3ee" />

    <div className="fixed rounded-full blur-[120px] -z-10 opacity-20 animate-float w-[300px] h-[300px] sm:w-[500px] sm:h-[500px] bg-purple-900 -top-12 -left-12 sm:-top-24 sm:-left-24 pointer-events-none"></div>
    <div
      className="fixed rounded-full blur-[120px] -z-10 opacity-20 animate-float w-[350px] h-[350px] sm:w-[600px] sm:h-[600px] bg-blue-950 -bottom-20 -right-20 sm:-bottom-36 sm:-right-36 pointer-events-none"
      style={{ animationDelay: '-5s' }}
    ></div>
  </>
);

const SongKeyChanger = () => {
  const storeBackendUrl = useRemixStore((state) => state.backendUrl);
  const activeBackendUrl = storeBackendUrl || BACKEND_URL;

  const [file, setFile] = useState<File | null>(null);
  const [originalKey, setOriginalKey] = useState('C');
  const [targetKey, setTargetKey] = useState('G');
  const [status, setStatus] = useState('idle');
  const [detectedInfo, setDetectedInfo] = useState<{
    key?: string;
    chords?: string[];
  } | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultAudioRef = useRef<HTMLAudioElement>(null);

  const semitones = useMemo(() => {
    const diff =
      (keyToNumberMap[targetKey] - keyToNumberMap[originalKey] + 12) % 12;
    return diff > 6 ? diff - 12 : diff;
  }, [originalKey, targetKey]);

  const togglePlayback = useCallback(() => {
    if (resultAudioRef.current) {
      if (isPlaying) resultAudioRef.current.pause();
      else resultAudioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleTimeUpdate = useCallback(() => {
    if (resultAudioRef.current) {
      setAudioProgress(
        (resultAudioRef.current.currentTime / resultAudioRef.current.duration) *
          100
      );
    }
  }, []);

  const analyzeFile = useCallback(
    async (selectedFile: File): Promise<void> => {
      setStatus('analyzing');
      setError(null);
      const formData = new FormData();
      formData.append('song', selectedFile);

      try {
        const response = await fetch(
          `${activeBackendUrl}/api/key-changer/detect`,
          {
            method: 'POST',
            body: formData,
          }
        );
        const data: {
          key: string;
          scale: string;
          chords: string[];
          error?: string;
        } = await response.json();
        if (!response.ok)
          throw new Error(data.error || `Analysis failed: ${response.status}`);

        const normalized = normalizeKey(data.key);
        setOriginalKey(normalized);
        setDetectedInfo({
          key: `${data.key} ${data.scale}`,
          chords: data.chords || [],
        });
        setStatus('ready');
      } catch (err: unknown) {
        const analysisError = err instanceof Error ? err.message : String(err);
        setError(analysisError);
        setStatus('error');
      }
    },
    [activeBackendUrl]
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      if (selectedFile) {
        setFile(selectedFile);
        setDownloadUrl(null);
        // skipcq: JS-0098
        void analyzeFile(selectedFile);
      }
    },
    [analyzeFile]
  );

  const startConversion = useCallback(async () => {
    if (!file) return;
    setStatus('processing');
    const formData = new FormData();
    formData.append('song', file);
    formData.append('originalKey', originalKey);
    formData.append('targetKey', targetKey);

    try {
      const response = await fetch(
        `${activeBackendUrl}/api/key-changer/convert`,
        {
          method: 'POST',
          body: formData,
        }
      );
      const data: { filename: string; error?: string } = await response.json();
      if (!response.ok)
        throw new Error(data.error || `Conversion failed: ${response.status}`);
      setDownloadUrl(
        `${activeBackendUrl}/api/key-changer/download/${data.filename}`
      );
      setStatus('completed');
    } catch (err: unknown) {
      const conversionError = err instanceof Error ? err.message : String(err);
      setError(conversionError);
      setStatus('error');
    }
  }, [activeBackendUrl, file, originalKey, targetKey]);

  const reset = useCallback(() => {
    setFile(null);
    setStatus('idle');
    setDownloadUrl(null);
    setDetectedInfo(null);
    setError(null);
  }, []);

  return (
    <div className="flex flex-col min-h-screen w-full relative overflow-hidden text-slate-200 font-sans selection:bg-cyan-500/30">
      <SEO
        title="Song Key Changer — Detect Key & Transpose Audio"
        description="Free song key changer. Detect the musical key of any audio and transpose it to any other key without quality loss. Built for singers and musicians."
        canonicalUrl="/tools/key-changer"
        schema={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'Phantom Song Key Changer',
          operatingSystem: 'All',
          applicationCategory: 'MultimediaApplication',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          description:
            'Detect or transpose your tracks into any key with high-quality audio processing.',
        }}
      />
      <BackgroundEffects />

      <main className="container mx-auto px-6 py-20 max-w-4xl relative z-10 flex flex-col justify-center grow">
        <SongHeader />

        <div className="space-y-8">
          {status === 'idle' && (
            <DropZone
              onFileClick={() => fileInputRef.current?.click()}
              onFileChange={handleFileChange}
              fileInputRef={fileInputRef}
            />
          )}

          {(status === 'analyzing' || status === 'processing') && (
            <AnalysisStatus status={status} />
          )}

          {status === 'ready' && (
            <ReadyState
              file={file}
              detectedInfo={detectedInfo}
              reset={reset}
              originalKey={originalKey}
              setOriginalKey={setOriginalKey}
              targetKey={targetKey}
              setTargetKey={setTargetKey}
              semitones={semitones}
              startConversion={startConversion}
            />
          )}

          {status === 'completed' && downloadUrl && (
            <ResultState
              file={file}
              originalKey={originalKey}
              targetKey={targetKey}
              downloadUrl={downloadUrl}
              audioProgress={audioProgress}
              isPlaying={isPlaying}
              togglePlayback={togglePlayback}
              handleTimeUpdate={handleTimeUpdate}
              reset={reset}
              resultAudioRef={resultAudioRef}
            />
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-center font-bold backdrop-blur-md"
            >
              {error}
              <button
                onClick={reset}
                className="block mx-auto mt-4 text-xs underline uppercase tracking-widest opacity-60"
              >
                Try again
              </button>
            </motion.div>
          )}
        </div>
      </main>

      <style>
        {`
        .text-glow {
          text-shadow: 0 0 30px rgba(34, 211, 238, 0.5);
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
      `}
      </style>
    </div>
  );
};

export default SongKeyChanger;
