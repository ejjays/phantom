import { Pressable, Text, View } from 'react-native';
import tw from '../../lib/tw';
import type { DownloadState } from '../../lib/download/format';
import type { WatchDownloadJob } from '../../lib/watchHandoff';
import CyanButton from '../ui/CyanButton';
import VisualSheet from './VisualSheet';

type Props = {
  job: WatchDownloadJob | null;
  state: DownloadState | null;
  onClose: () => void;
  onDownload: () => void;
};

export default function WatchDownloadSheet({
  job,
  state,
  onClose,
  onDownload,
}: Props) {
  if (!job) return null;
  const active =
    state?.status === 'downloading' ||
    state?.status === 'muxing' ||
    state?.status === 'saving';
  const saved = state?.status === 'saved';
  const failed = state?.status === 'error';
  const progress = Math.max(0, Math.min(100, state?.progress ?? 0));
  const quality = job.quality ?? (job.height ? `${job.height}p` : 'Auto');

  return (
    <VisualSheet visible onClose={onClose} overlayContent={false} stars>
      <Text
        style={tw`text-center text-[22px] leading-8 font-sans-bold text-white`}
      >
        Download from Phantom Watch
      </Text>
      <Text
        numberOfLines={2}
        style={tw`mt-2 text-center text-[17px] leading-6 font-sans-semibold text-white`}
      >
        {job.title}
      </Text>
      <Text style={tw`mt-1 text-center text-[14px] font-sans text-slate-300`}>
        {quality}
        {job.season !== null && job.episode !== null
          ? ` · S${job.season} E${job.episode}`
          : ''}
        {' · '}
        {job.subtitles.length > 0
          ? 'English subtitle included'
          : job.isHls
            ? 'English subtitle if the stream provides one'
            : 'No separate English subtitle'}
      </Text>

      {active ? (
        <View style={tw`mt-5`}>
          <View style={tw`h-2 overflow-hidden rounded-full bg-white/10`}>
            <View
              style={[
                tw`h-full rounded-full bg-[#22d3ee]`,
                { width: `${progress}%` },
              ]}
            />
          </View>
          <Text
            style={tw`mt-2 text-center text-[13px] font-mono text-slate-300`}
          >
            {state?.status === 'saving' ? 'Saving' : 'Downloading'} {progress}%
          </Text>
        </View>
      ) : null}

      {saved ? (
        <Text style={tw`mt-5 text-center text-[14px] font-sans text-[#34d399]`}>
          Saved to Movies/{job.saveSubdir}
        </Text>
      ) : null}
      {failed ? (
        <Text style={tw`mt-5 text-center text-[14px] font-sans text-[#f87171]`}>
          Download failed. Check the notification or try again.
        </Text>
      ) : null}

      <View style={tw`mt-5`}>
        <CyanButton
          label={
            saved
              ? 'Done'
              : failed
                ? 'Try again'
                : active
                  ? 'Downloading'
                  : 'Start download'
          }
          loading={active}
          onPress={saved ? onClose : onDownload}
        />
      </View>
      {!saved ? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [
            tw`mt-1 w-full items-center justify-center py-3`,
            pressed && tw`opacity-60`,
          ]}
        >
          <Text style={tw`text-[15px] font-sans-medium text-white/70`}>
            {active ? 'Hide' : 'Cancel'}
          </Text>
        </Pressable>
      ) : null}
    </VisualSheet>
  );
}
