const base = import.meta.env.BASE_URL;

export const DEMO_SONGS = [
  {
    id: 'demo-1',
    name: 'Salamat Salamat by Malayang Pilipino (Medley)',
    isDemo: true,
    thumbnail: `${base}demo_songs/demo1/thumbnail.jpg`,
    stems: {
      vocals: `${base}demo_songs/demo1/vocals.ogg`,
      drums: `${base}demo_songs/demo1/drums.ogg`,
      bass: `${base}demo_songs/demo1/bass.ogg`,
      other: `${base}demo_songs/demo1/other.ogg`,
      guitar: `${base}demo_songs/demo1/guitar.ogg`,
      piano: `${base}demo_songs/demo1/piano.ogg`,
    },
    chordsPath: `${base}demo_songs/demo1/project.json`,
  },
];
