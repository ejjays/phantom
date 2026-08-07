// preset cartoon avatars grouped by show. each avatar id is stored in the
// profile as `preset:<id>` (see avatars.logic). ids must be unique across all
// categories. to add a set: import its images, then push a new category below.
import baljeet from '../../assets/avatars/baljeet.webp';
import jake from '../../assets/avatars/jake.webp';
import princessBubblegum from '../../assets/avatars/princess-bubblegum.webp';
import marceline from '../../assets/avatars/marceline.webp';
import bmo from '../../assets/avatars/bmo.webp';
import iceKing from '../../assets/avatars/ice-king.webp';
import lumpySpacePrincess from '../../assets/avatars/lumpy-space-princess.webp';
import flamePrincess from '../../assets/avatars/flame-princess.webp';
import phineas from '../../assets/avatars/phineas.webp';
import ferb from '../../assets/avatars/ferb.webp';
import perry from '../../assets/avatars/perry.webp';
import candace from '../../assets/avatars/candace.webp';
import doofenshmirtz from '../../assets/avatars/doofenshmirtz.webp';
import isabella from '../../assets/avatars/isabella.webp';
import buford from '../../assets/avatars/buford.webp';
import finn from '../../assets/avatars/finn.webp';
import oggy from '../../assets/avatars/oggy.webp';
import jack from '../../assets/avatars/jack.webp';
import joey from '../../assets/avatars/joey-roach.webp';
import marky from '../../assets/avatars/marky-roach.webp';
import deedee from '../../assets/avatars/deedee-roach.webp';
import bob from '../../assets/avatars/bob.webp';
import olivia from '../../assets/avatars/olivia.webp';
import monica from '../../assets/avatars/monica.webp';
import linny from '../../assets/avatars/linny.webp';
import izzy from '../../assets/avatars/izzy.webp';
import tuck from '../../assets/avatars/tuck.webp';
import tate from '../../assets/avatars/tate.webp';
import mingMing from '../../assets/avatars/ming-ming.webp';
import ollie from '../../assets/avatars/ollie.webp';
import zuri from '../../assets/avatars/zuri.webp';
import { presetIdOf, presetMarker } from './avatars.logic';

export { presetMarker, isPresetMarker, presetIdOf } from './avatars.logic';

type AvatarPreset = { id: string; name: string; source: number };
export type AvatarCategory = {
  id: string;
  title: string;
  avatars: AvatarPreset[];
};

export const AVATAR_CATEGORIES: readonly AvatarCategory[] = [
  {
    id: 'adventure-time',
    title: 'Adventure Time',
    avatars: [
      { id: 'finn', name: 'Finn', source: finn },
      { id: 'jake', name: 'Jake', source: jake },
      {
        id: 'princess-bubblegum',
        name: 'Princess Bubblegum',
        source: princessBubblegum,
      },
      { id: 'marceline', name: 'Marceline', source: marceline },
      { id: 'bmo', name: 'BMO', source: bmo },
      { id: 'ice-king', name: 'Ice King', source: iceKing },
      {
        id: 'lumpy-space-princess',
        name: 'Lumpy Space Princess',
        source: lumpySpacePrincess,
      },
      { id: 'flame-princess', name: 'Flame Princess', source: flamePrincess },
    ],
  },
  {
    id: 'phineas-and-ferb',
    title: 'Phineas & Ferb',
    avatars: [
      { id: 'phineas', name: 'Phineas', source: phineas },
      { id: 'ferb', name: 'Ferb', source: ferb },
      { id: 'baljeet', name: 'Baljeet', source: baljeet },
      { id: 'perry', name: 'Perry the Platypus', source: perry },
      { id: 'candace', name: 'Candace', source: candace },
      {
        id: 'doofenshmirtz',
        name: 'Dr. Doofenshmirtz',
        source: doofenshmirtz,
      },
      { id: 'isabella', name: 'Isabella', source: isabella },
      { id: 'buford', name: 'Buford', source: buford },
    ],
  },
  {
    id: 'oggy-and-the-cockroaches',
    title: 'Oggy and the Cockroaches',
    avatars: [
      { id: 'oggy', name: 'Oggy', source: oggy },
      { id: 'jack', name: 'Jack', source: jack },
      { id: 'joey', name: 'Joey', source: joey },
      { id: 'marky', name: 'Marky', source: marky },
      { id: 'deedee', name: 'Dee Dee', source: deedee },
      { id: 'bob', name: 'Bob', source: bob },
      { id: 'olivia', name: 'Olivia', source: olivia },
      { id: 'monica', name: 'Monica', source: monica },
    ],
  },
  {
    id: 'wonder-pets',
    title: 'Wonder Pets',
    avatars: [
      { id: 'linny', name: 'Linny', source: linny },
      { id: 'izzy', name: 'Izzy', source: izzy },
      { id: 'tuck', name: 'Tuck', source: tuck },
      { id: 'tate', name: 'Tate', source: tate },
      { id: 'ming-ming', name: 'Ming-Ming', source: mingMing },
      { id: 'ollie', name: 'Ollie', source: ollie },
      { id: 'zuri', name: 'Zuri', source: zuri },
    ],
  },
];

const ALL_PRESETS: readonly AvatarPreset[] = AVATAR_CATEGORIES.flatMap(
  (category) => category.avatars
);

export function presetSource(value: string | null | undefined): number | null {
  const id = presetIdOf(value);
  if (id == null) return null;
  return ALL_PRESETS.find((preset) => preset.id === id)?.source ?? null;
}

export function randomPresetMarker(): string {
  const max = 0xffffffff - (0xffffffff % ALL_PRESETS.length);
  let value = 0;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= max);
  return presetMarker(ALL_PRESETS[value % ALL_PRESETS.length].id);
}
