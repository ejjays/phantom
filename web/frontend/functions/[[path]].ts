interface Metadata {
  title: string;
  description: string;
  image?: string;
  schema?: Record<string, unknown>;
}

const SITE_CONFIG = {
  name: 'Panther',
  defaultDescription:
    'A simple tool for high-quality YouTube and Spotify media extraction. Supports 4K video and MP3 downloads from various social platforms.',
  defaultImage: '/og-image.webp',
};

const PAGE_METADATA: Record<string, Metadata> = {
  '/tools/key-changer': {
    title: 'Song Key Changer | Detect & Transpose Audio',
    description:
      'A utility to detect the key of a song and adjust its pitch or tempo without losing audio quality.',
  },
  '/tools/remix-lab': {
    title: 'Remix Lab | Stem Separation & Analysis',
    description:
      'Tools for isolating vocals, drums, and instruments from any track using AI-assisted processing.',
  },
  '/resources/story': {
    title: 'Our Story | The Panther Mission',
    description:
      'The background of Panther and our goal to provide clean, accessible media tools for everyone.',
  },
  '/resources/architecture': {
    title: 'Technical Architecture | Media Orchestration Core',
    description:
      'A look into how Panther handles media processing and high-fidelity extraction.',
  },
  '/resources/stack': {
    title: 'Tech Stack | The Tools Behind the Magic',
    description:
      'A list of the technologies we use to build and maintain Panther.',
  },
  '/resources/audio-guide': {
    title: 'Audio Guide | Mastering MP3 Extraction',
    description:
      'Tips on getting the best audio results when downloading music through Panther.',
  },
  '/resources/video-guide': {
    title: 'Video Guide | 4K & HDR Downloads',
    description:
      'Information on how to save high-resolution videos while maintaining their original quality.',
  },
  '/resources/security': {
    title: 'Security & Privacy | Our Commitment',
    description:
      'How we protect your privacy by keeping the platform ad-free and tracking-free.',
  },
  '/resources/remix-guide': {
    title: 'Remix Guide | AI Audio Separation',
    description:
      'A quick walkthrough on using our AI tools to isolate individual tracks for your projects.',
  },
};

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  const response = await context.next();

  // check path
  if (
    !PAGE_METADATA[path] ||
    !response.headers.get('content-type')?.includes('text/html')
  ) {
    return response;
  }

  const metadata = PAGE_METADATA[path];
  const finalTitle = `${SITE_CONFIG.name} | ${metadata.title}`;
  const finalDescription = metadata.description;
  const finalImage = metadata.image || SITE_CONFIG.defaultImage;

  // htmlrewriter stream transformation
  return new HTMLRewriter()
    .on('title', {
      element(e) {
        e.setInnerContent(finalTitle);
      },
    })
    .on('meta[name="description"]', {
      element(e) {
        e.setAttribute('content', finalDescription);
      },
    })
    .on('link[rel="canonical"]', {
      element(e) {
        e.setAttribute('href', url.href);
      },
    })
    .on('meta[property^="og:"]', {
      element(e) {
        const prop = e.getAttribute('property');
        if (prop === 'og:title') e.setAttribute('content', finalTitle);
        if (prop === 'og:description')
          e.setAttribute('content', finalDescription);
        if (prop === 'og:url') e.setAttribute('content', url.href);
        if (prop === 'og:image') e.setAttribute('content', finalImage);
      },
    })
    .on('meta[property^="twitter:"]', {
      element(e) {
        const prop = e.getAttribute('property');
        if (prop === 'twitter:title') e.setAttribute('content', finalTitle);
        if (prop === 'twitter:description')
          e.setAttribute('content', finalDescription);
        if (prop === 'twitter:image') e.setAttribute('content', finalImage);
      },
    })
    .on('script#global-schema', {
      element(e) {
        // update schema
        if (metadata.schema) {
          e.setInnerContent(JSON.stringify(metadata.schema), { html: true });
        }
      },
    })
    .transform(response);
};
