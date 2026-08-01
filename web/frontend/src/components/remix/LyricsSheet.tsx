import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Loader2,
  Music,
  ExternalLink,
  RefreshCw,
  ListMusic,
  Guitar,
  Copy,
  Check,
} from 'lucide-react';

interface LyricsData {
  title: string;
  artist: string;
  lyrics?: string;
  chordsSheet?: string;
  chordsLink?: string;
}

interface LyricsSheetProps {
  showLyricsSheet: boolean;
  setShowLyricsSheet: (show: boolean) => void;
  projectId: string;
  getBackendUrl: () => string;
}

const LyricsSheet = ({
  showLyricsSheet,
  setShowLyricsSheet,
  projectId,
  getBackendUrl,
}: LyricsSheetProps) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LyricsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [viewMode, setViewMode] = useState<'lyrics' | 'chords'>('lyrics');
  const [copied, setCopied] = useState(false);

  const fetchLyricsData = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setError(null);

    // handle demo files
    if (projectId.includes('demo') || projectId.startsWith('project-')) {
      setData({
        title: 'Demo / Sample Song',
        artist: 'Phantom',
        lyrics:
          'Lyrics & chord extraction is disabled for static demo files. Upload your own track to use this feature!',
        chordsSheet: '',
      });
      setHasFetched(true);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `${getBackendUrl()}/api/remix/extract/${projectId}`
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to extract data');
      }
      const jsonData = await res.json();
      setData(jsonData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHasFetched(true);
      setLoading(false);
    }
  }, [projectId, getBackendUrl]);

  useEffect(() => {
    if (showLyricsSheet && projectId && !hasFetched && !data) {
      // skipcq: JS-0098
      void fetchLyricsData();
    }
  }, [showLyricsSheet, projectId, hasFetched, data, fetchLyricsData]);

  const handleCopy = () => {
    const textToCopy = viewMode === 'lyrics' ? data?.lyrics : data?.chordsSheet;
    if (!textToCopy) return;

    // clean [ch] tags
    const cleanText =
      viewMode === 'chords'
        ? textToCopy.replace(/\[ch\]/g, '').replace(/\[\/ch\]/g, '')
        : textToCopy;

    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // parse chords
  const renderChordSheet = (text: string) => {
    if (!text) return null;

    const lines = text.split('\n');
    return (
      <div className="font-mono text-left whitespace-pre overflow-x-auto pb-4 select-text text-[14px] leading-relaxed">
        {lines.map((line, i) => {
          const lineKey = `line-${i}-${line.substring(0, 10)}`;
          // check chords
          if (line.includes('[ch]')) {
            const parts = line.split(/(\[ch\].*?\[\/ch\])/g);
            return (
              <div key={lineKey} className="min-h-[1.5em] whitespace-pre">
                {parts.map((part, j) => {
                  const partKey = `part-${j}-${part.substring(0, 5)}`;
                  if (part.startsWith('[ch]')) {
                    const chord = part.replace('[ch]', '').replace('[/ch]', '');
                    return (
                      <span
                        key={partKey}
                        className="text-cyan-400 font-bold select-all drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]"
                      >
                        {chord}
                      </span>
                    );
                  }
                  return (
                    <span key={partKey} className="text-zinc-500/50">
                      {part}
                    </span>
                  );
                })}
              </div>
            );
          }
          return (
            <div
              key={lineKey}
              className="min-h-[1.5em] text-zinc-300 select-all"
            >
              {line || ' '}
            </div>
          );
        })}
      </div>
    );
  };

  const renderContent = () => {
    if (!projectId) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-500">
          <p>No project loaded. Are you on a Demo song?</p>
        </div>
      );
    }
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 text-center">
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
          <div className="space-y-1">
            <p className="text-white font-medium">Deep Analyzing Audio...</p>
            <p className="text-zinc-500 text-xs max-w-[200px] mx-auto">
              Identifying track fingerprints and generating AI chords...
            </p>
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 text-center">
          <div className="p-4 bg-red-500/10 rounded-full text-red-400">
            <X size={32} />
          </div>
          <div className="space-y-2">
            <p className="text-red-400 font-medium">Analysis Failed</p>
            <p className="text-zinc-500 text-sm max-w-[250px]">{error}</p>
          </div>
          <button
            onClick={fetchLyricsData}
            className="mt-4 px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      );
    }
    if (!data) return null;
    return (
      <div className="space-y-8 max-w-3xl mx-auto">
        <div className="text-center space-y-1">
          <h3 className="text-2xl font-bold text-white leading-tight">
            {data.title}
          </h3>
          <p className="text-cyan-400 text-lg">{data.artist}</p>
        </div>
        {viewMode === 'lyrics' ? (
          <div className="bg-black/30 rounded-2xl p-6 border border-zinc-800/50">
            {data.lyrics ? (
              <pre className="font-sans whitespace-pre-wrap text-zinc-300 text-center leading-loose text-lg font-medium select-text">
                {data.lyrics}
              </pre>
            ) : (
              <div className="py-10 text-center">
                <p className="text-zinc-500 italic mb-4">
                  No plain lyrics found.
                </p>
                <button
                  onClick={() => setViewMode('chords')}
                  className="text-cyan-400 text-sm font-medium underline"
                >
                  Try AI Chords View
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-black/30 rounded-2xl p-6 border border-zinc-800/50">
            {data.chordsSheet ? (
              renderChordSheet(data.chordsSheet)
            ) : (
              <p className="text-center text-zinc-500 italic py-10">
                Gemini couldn&apos;t generate a chord sheet for this song.
              </p>
            )}
          </div>
        )}
        {data.chordsLink && (
          <a
            href={data.chordsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-xl text-zinc-400 transition-colors border border-zinc-700/50 text-sm"
          >
            <span>Verify on Ultimate Guitar</span>
            <ExternalLink size={14} className="opacity-70" />
          </a>
        )}
      </div>
    );
  };

  if (!showLyricsSheet) return null;

  return (
    // skipcq: JS-0415
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] transition-opacity"
        onClick={() => setShowLyricsSheet(false)}
      />

      <div
        className={`fixed bottom-0 left-0 right-0 bg-[#18181b] rounded-t-3xl z-[201] transition-transform duration-300 ease-out transform ${showLyricsSheet ? 'translate-y-0' : 'translate-y-full'} flex flex-col`}
        style={{ height: '85vh' }}
      >
        <div className="shrink-0 flex flex-col border-b border-zinc-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              <Music className="text-cyan-400 w-5 h-5" />
              <h2 className="text-lg font-bold text-white">Song Lab</h2>
            </div>
            <div className="flex items-center gap-2">
              {data && (
                <button
                  onClick={handleCopy}
                  className={`p-2 rounded-full transition-all ${copied ? 'bg-green-500/20 text-green-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                </button>
              )}
              <button
                onClick={() => setShowLyricsSheet(false)}
                className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {data && (
            <div className="flex justify-center pb-4 px-6">
              <div className="flex bg-black/40 p-1 rounded-xl border border-zinc-800 w-full max-w-sm">
                <button
                  onClick={() => setViewMode('lyrics')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${viewMode === 'lyrics' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <ListMusic size={16} /> Lyrics
                </button>
                <button
                  onClick={() => setViewMode('chords')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${viewMode === 'chords' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <Guitar size={16} /> Chords (AI)
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-none p-6 pb-20 text-white select-text">
          {renderContent()}
        </div>
      </div>
    </>
  );
};

export default LyricsSheet;
