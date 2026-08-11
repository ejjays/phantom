import { startActivityAsync } from 'expo-intent-launcher';
import { File } from 'expo-file-system';
import {
  readAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';

const FLAG_GRANT_READ = 1;

export async function fileStillExists(uri?: string): Promise<boolean | null> {
  if (!uri) return null;
  try {
    if (new File(uri).exists) return true;
  // eslint-disable-next-line no-empty -- unsupported scheme, probe below
  } catch {
  }
  try {
    await readAsStringAsync(uri, {
      encoding: EncodingType.Base64,
      position: 0,
      length: 1,
    });
    return true;
  } catch {
    return false;
  }
}

async function openGallery(): Promise<void> {
  try {
    await startActivityAsync('android.intent.action.MAIN', {
      category: 'android.intent.category.APP_GALLERY',
    });
  } catch {
    /* no gallery app available */
  }
}

async function openMusic(): Promise<void> {
  try {
    await startActivityAsync('android.intent.action.MAIN', {
      category: 'android.intent.category.APP_MUSIC',
    });
  } catch {
    /* no music app available */
  }
}

// content uri needs read grant for the receiving player
async function openFile(uri: string, mime: string): Promise<void> {
  try {
    await startActivityAsync('android.intent.action.VIEW', {
      data: uri,
      type: mime,
      flags: FLAG_GRANT_READ,
    });
  } catch {
    /* no app for this type */
  }
}

// prefer exact file; else land in music/gallery app
export async function openSavedTarget(target: {
  isAudio: boolean;
  uri?: string;
}): Promise<void> {
  if (target.uri) {
    await openFile(target.uri, target.isAudio ? 'audio/*' : 'video/*');
  } else if (target.isAudio) {
    await openMusic();
  } else {
    await openGallery();
  }
}
