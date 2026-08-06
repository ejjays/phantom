import { DEMO_SONGS } from '../../components/remix/DemoSongsConfig';
import { useNavigate, useLocation } from 'react-router';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import MixerControls from '../../components/remix/MixerControls';
import PlayerControls from '../../components/remix/PlayerControls';
import MetronomeSheet from '../../components/remix/MetronomeSheet';
import LyricsSheet from '../../components/remix/LyricsSheet';
import UploadScreen from '../../components/remix/UploadScreen';
import ChordDisplay from '../../components/remix/ChordDisplay';
import SEO from '../../components/utils/SEO';
import ErudaLoader from '../../components/utils/ErudaLoader';
import { RemixProvider } from '../../context/RemixContext';
import { useRemixContext } from '../../hooks/useRemixContext';
import { Chord, RemixProject } from '../../types/remix';
import { useRemixStore } from '../../store/useRemixStore';

const getBackendUrl = () => {
  return useRemixStore.getState().backendUrl;
};

const LabHeader = ({
  songName,
  onBack,
}: {
  songName: string;
  onBack: () => void;
}) => (
  <header className="flex items-center justify-between p-4 px-6 shrink-0 relative">
    <button
      onClick={onBack}
      className="active:scale-90 flex items-center gap-2 text-zinc-400 hover:text-white"
    >
      <ChevronDown size={28} className="rotate-90" />
      <span className="text-sm font-medium hidden sm:block">
        Back to Library
      </span>
    </button>
    <h1 className="text-lg font-bold truncate max-w-[50%] absolute left-1/2 -translate-x-1/2">
      {songName}
    </h1>
  </header>
);

const LabMain = ({
  stems,
  chords,
  beats,
  gridShift,
  setShowLyricsSheet,
  isProcessing,
  stemMode,
  setStemMode,
  engineMode,
  setEngineMode,
  apiUrl,
  setApiUrl,
  setSessionId,
  handleUpload,
  history,
  onHistorySelect,
  handleExport,
  handleDelete,
  handleRename,
  onExit,
}: {
  stems: Record<string, string> | null;
  chords: Chord[];
  beats: number[];
  gridShift: number;
  setShowLyricsSheet: (show: boolean) => void;
  isProcessing: boolean;
  stemMode: string;
  setStemMode: (val: string) => void;
  engineMode: string;
  setEngineMode: (val: string) => void;
  apiUrl: string;
  setApiUrl: (val: string) => void;
  setSessionId: (val: string) => void;
  handleUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  history: RemixProject[];
  onHistorySelect: (project: RemixProject) => void;
  handleExport: (item: { id: string; name?: string }) => void;
  handleDelete: (id: string) => Promise<void>;
  handleRename: (
    id: string,
    oldName: string,
    nextName: string
  ) => Promise<void>;
  onExit: () => void;
}) => {
  if (!stems) {
    return (
      <UploadScreen
        isProcessing={isProcessing}
        stemMode={stemMode}
        setStemMode={setStemMode}
        engineMode={engineMode}
        setEngineMode={setEngineMode}
        apiUrl={apiUrl}
        setApiUrl={setApiUrl}
        setSessionId={setSessionId}
        getBackendUrl={getBackendUrl}
        handleUpload={handleUpload}
        history={history}
        onSelectHistory={onHistorySelect}
        onExportHistory={handleExport}
        onDeleteHistory={handleDelete}
        onRenameHistory={handleRename}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="flex-1 w-full flex flex-col items-center justify-between min-h-0 overflow-hidden">
      <ChordDisplay chords={chords} beats={beats} gridShift={gridShift} />
      <div className="w-full flex-1 flex justify-center px-4 py-4 overflow-y-auto scrollbar-none">
        <MixerControls />
      </div>
      <PlayerControls setShowLyricsSheet={setShowLyricsSheet} />
    </div>
  );
};

const RemixLabContent = ({ onExit }: { onExit: () => void }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    stems,
    setStems,
    chords,
    setChords,
    beats,
    setBeats,
    setTempo,
    songName,
    setSongName,
    gridShift,
    loadAudioSources,
    stopAll,
    togglePlay,
    handleSeek,
    resetProject,
    resumeAudioContext,
  } = useRemixContext();

  const duration = useRemixStore((state) => state.duration);

  const [apiUrl, setApiUrl] = useState(
    () => localStorage.getItem('remix_lab_api_url') || ''
  );
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem('remix_session_id') || ''
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [stemMode, setStemMode] = useState('4 Stems');
  const [engineMode, setEngineMode] = useState('Demucs (Fast / Balanced)');
  const [history, setHistory] = useState<RemixProject[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [showLyricsSheet, setShowLyricsSheet] = useState(false);

  const lastLoadedProjectRef = useRef<string | null>(null);
  const timeRef = useRef({ currentTime: 0, duration });
  useEffect(() => {
    timeRef.current.duration = duration;
  }, [duration]);
  useEffect(
    () =>
      useRemixStore.subscribe(
        (s) => s.currentTime,
        (t) => {
          timeRef.current.currentTime = t;
        }
      ),
    []
  );

  const handleApiUrlChange = useCallback((newUrl: string) => {
    setApiUrl(newUrl);
    localStorage.setItem('remix_lab_api_url', newUrl);

    // setup session
    if (!localStorage.getItem('remix_session_id')) {
      const newSid = `manual-${Date.now()}`;
      setSessionId(newSid);
      localStorage.setItem('remix_session_id', newSid);
    }
  }, []);

  useEffect(() => {
    if (apiUrl?.startsWith('http') && sessionId) {
      fetch(`${getBackendUrl()}/api/remix/register-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: apiUrl, session_id: sessionId }),
      }).catch(() => {
        // ignore register error
      });
    }
  }, [apiUrl, sessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' &&
        (target as HTMLInputElement).type !== 'range'
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        resumeAudioContext();
        togglePlay();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        handleSeek(Math.max(0, timeRef.current.currentTime - 5));
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        handleSeek(
          Math.min(timeRef.current.duration, timeRef.current.currentTime + 5)
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, handleSeek, resumeAudioContext]);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`${getBackendUrl()}/api/remix/history`);
      const data = await response.json();
      const formatted = data.map((item: RemixProject) => {
        const fullStems: Record<string, string> = {};
        Object.keys(item.stems).forEach((key) => {
          const stemVal = item.stems[key];
          if (stemVal.startsWith('http')) {
            fullStems[key] = stemVal;
          } else {
            fullStems[key] = `${getBackendUrl()}${stemVal}`;
          }
        });
        return { ...item, stems: fullStems };
      });
      setHistory(formatted);
    } catch (_err: unknown) {
      // ignore fetch error
    } finally {
      setIsHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const projectIdParam = params.get('project');
    if (!projectIdParam) {
      if (lastLoadedProjectRef.current !== null) {
        lastLoadedProjectRef.current = null;
        resetProject();
      }
      return;
    }
    if (projectIdParam && lastLoadedProjectRef.current !== projectIdParam) {
      const demo = DEMO_SONGS?.find((d) => d.id === projectIdParam);
      if (demo) {
        lastLoadedProjectRef.current = projectIdParam;
        fetch(demo.chordsPath)
          .then((res) => res.json())
          .then((data) => {
            setSongName(demo.name);
            setStems(demo.stems);
            const demoChords: Chord[] = (data.chords || []).map(
              (chordItem: string | Chord) =>
                typeof chordItem === 'string'
                  ? { time: 0, chord: chordItem }
                  : chordItem
            );
            setChords(demoChords);
            setBeats(data.beats || []);
            setTempo(data.tempo || 0);
            loadAudioSources(demo.stems);
          })
          .catch((err) => {
            console.error('[RemixLab] Failed to load demo chords:', err);
            setChords([]);
            setBeats([]);
            setTempo(0);
          });
        return;
      }
      if (history.length > 0) {
        const project = history.find((proj) => proj.id === projectIdParam);
        if (project) {
          lastLoadedProjectRef.current = projectIdParam;
          setSongName(project.name);
          setStems(project.stems);
          setChords(project.chords || []);
          setBeats(project.beats || []);
          setTempo(project.tempo || 0);
          loadAudioSources(project.stems);
        }
      }
    }
  }, [
    location.search,
    history,
    loadAudioSources,
    resetProject,
    setBeats,
    setChords,
    setSongName,
    setStems,
    setTempo,
  ]);

  const projectId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('project');
  }, [location.search]);

  useEffect(() => {
    if (!projectId || stems) return;

    // validate project
    const isDemo = DEMO_SONGS?.some((demoItem) => demoItem.id === projectId);
    const projectNotInHistory =
      isHistoryLoaded && !history.some((proj) => proj.id === projectId);

    if (!isDemo && projectNotInHistory) {
      console.error('Project not found in library.');
      navigate('/tools/remix-lab', { replace: true });
    }
  }, [projectId, stems, history, isHistoryLoaded, navigate]);

  useEffect(() => {
    return () => {
      stopAll();
    };
  }, [stopAll]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile || !apiUrl) return;
    const newSongName =
      selectedFile.name
        .replace(/\.[^/.]+$/, '')
        .replace(/^\.+/, '')
        .trim() || 'Untitled Song';
    setSongName(newSongName);
    resetProject();
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('engine', engineMode);
      formData.append('stems', stemMode);

      if (sessionId) formData.append('session_id', sessionId);

      const response = await fetch(`${getBackendUrl()}/api/remix/process`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error(`bridge error: ${response.status}`);
      const data = await response.json();
      if (data.status === 'error') throw new Error(data.message);
      const { metadata, stems: rawStems } = data;

      if (!metadata) {
        throw new Error(
          'Missing metadata. Please stop and restart the backend server to apply the recent schema fixes.'
        );
      }

      const newId = `${Date.now()}-lab`;
      const saveRes = await fetch(`${getBackendUrl()}/api/remix/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          name: newSongName,
          stems: rawStems,
          chords: metadata.chords,
          beats: metadata.beats,
          tempo: metadata.tempo,
          engine: engineMode.includes('Demucs') ? 'Demucs' : 'RoFormer',
        }),
      });
      const { localStems } = await saveRes.json();
      const finalStems: Record<string, string> = {};
      Object.keys(localStems).forEach((key) => {
        finalStems[key] = `${getBackendUrl()}${localStems[key]}`;
      });
      setStems(finalStems);
      setChords(metadata.chords);
      setBeats(metadata.beats);
      setTempo(metadata.tempo);
      loadAudioSources(finalStems);
      // skipcq: JS-0098
      void fetchHistory();
      setIsProcessing(false);
      navigate(`/tools/remix-lab?project=${newId}`, { replace: true });
    } catch (err: unknown) {
      console.error('nitro error:', err);
      setIsProcessing(false);
    }
  };

  const handleExport = useCallback((item: { id: string; name?: string }) => {
    const downloadUrl = `${getBackendUrl()}/api/remix/export/${item.id}`;
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = `${item.name || item.id}.zip`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/remix/delete/${id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          // skipcq: JS-0098
          void fetchHistory();
        }
      } catch (err: unknown) {
        console.error('Delete error:', err);
      }
    },
    [fetchHistory]
  );

  const handleRename = useCallback(
    async (id: string, oldName: string, newName: string) => {
      if (!newName || oldName === newName) return;
      try {
        const res = await fetch(`${getBackendUrl()}/api/remix/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name: newName }),
        });
        if (res.ok) fetchHistory();
      } catch (err: unknown) {
        console.error('Rename error:', err);
      }
    },
    [fetchHistory]
  );

  const isInitializing = useMemo(() => {
    return Boolean(projectId && !stems);
  }, [projectId, stems]);

  if (isInitializing)
    return <div className="fixed inset-0 bg-[#000000] z-[100]"></div>;

  return (
    <div className="fixed inset-0 bg-[#000000] text-white flex flex-col z-[100] font-sans overflow-hidden">
      <SEO
        title="Remix Lab — AI Stem Separation & Chord Detection"
        description="Separate vocals, bass, drums, and other instruments from any song. Detect chord progressions and musical key. Free, runs in your browser, no signup."
      />
      <ErudaLoader />
      {stems && (
        <LabHeader
          songName={songName}
          onBack={() => navigate('/tools/remix-lab')}
        />
      )}
      <main className="flex-1 flex flex-col items-center min-h-0 overflow-hidden relative">
        <LabMain
          stems={stems}
          chords={chords}
          beats={beats}
          gridShift={gridShift}
          setShowLyricsSheet={setShowLyricsSheet}
          isProcessing={isProcessing}
          stemMode={stemMode}
          setStemMode={setStemMode}
          engineMode={engineMode}
          setEngineMode={setEngineMode}
          apiUrl={apiUrl}
          setApiUrl={handleApiUrlChange}
          setSessionId={setSessionId}
          handleUpload={handleUpload}
          history={history}
          onHistorySelect={(item) =>
            navigate(`/tools/remix-lab?project=${item.id}`)
          }
          handleExport={handleExport}
          handleDelete={handleDelete}
          handleRename={handleRename}
          onExit={onExit}
        />
      </main>
      <LyricsSheet
        showLyricsSheet={showLyricsSheet}
        setShowLyricsSheet={setShowLyricsSheet}
        projectId={projectId || ''}
        getBackendUrl={getBackendUrl}
      />
      <MetronomeSheet />
    </div>
  );
};

const RemixLab = (props: { onExit: () => void }) => (
  <RemixProvider>
    <RemixLabContent {...props} />
  </RemixProvider>
);

export default RemixLab;
