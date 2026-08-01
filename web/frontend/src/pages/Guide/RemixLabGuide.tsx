import React, { useEffect } from 'react';
import {
  Server,
  Cloud,
  Cpu,
  Play,
  Link as LinkIcon,
  FlaskConical,
  AlertTriangle,
} from 'lucide-react';
import { GlassCard } from '../../components/ui/GlassCard';
import SEO from '../../components/utils/SEO';

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
  placeholder: string;
}

const StepContent = ({ step }: { step: Step }) => (
  <div className="flex-1 space-y-4">
    <div className="flex items-center gap-4 mb-2">
      <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
        {step.icon}
      </div>
      <h2 className="text-2xl font-bold text-white">{step.title}</h2>
    </div>
    <p className="text-gray-400 leading-relaxed text-lg">{step.description}</p>
  </div>
);

const StepPlaceholder = ({ placeholder }: { placeholder: string }) => (
  <div className="w-full lg:w-1/2 aspect-video bg-black/50 border border-white/10 rounded-2xl flex flex-col items-center justify-center p-6 text-center shadow-inner relative overflow-hidden group">
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
    <div className="text-gray-500 font-mono text-sm border border-gray-600 border-dashed p-4 rounded-xl">
      {placeholder}
    </div>
  </div>
);

const GuideStep = ({ step }: { step: Step }) => (
  <GlassCard key={step.title} className="overflow-hidden">
    <div className="p-8 flex flex-col lg:flex-row gap-8 items-start">
      <StepContent step={step} />
      <StepPlaceholder placeholder={step.placeholder} />
    </div>
  </GlassCard>
);

const RemixLabGuide = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const steps: Step[] = [
    {
      icon: <Server className="text-purple-400" size={24} />,
      title: 'Step 1: Get the Engine Core',
      description:
        'First, you need the Remix Lab Python backend script. This script contains everything needed to orchestrate the AI models.',
      placeholder:
        '[Image Placeholder: Show where to copy the Python script from the Github repo]',
    },
    {
      icon: <Cloud className="text-cyan-400" size={24} />,
      title: 'Step 2: Create a Kaggle Notebook',
      description:
        'Head over to Kaggle.com, create a free account, and create a new Notebook. Clear any existing code in the first cell.',
      placeholder:
        '[Image Placeholder: Show Kaggle &apos;New Notebook&apos; button]',
    },
    {
      icon: <Cpu className="text-emerald-400" size={24} />,
      title: 'Step 3: Enable the Dual GPUs',
      description:
        'On the right-hand sidebar in Kaggle, expand &apos;Session Options&apos;, go to &apos;Accelerator&apos;, and select &apos;GPU T4 x2&apos;. This gives you two free GPUs to process your songs ultra-fast.',
      placeholder: '[Image Placeholder: Show GPU T4 x2 selection dropdown]',
    },
    {
      icon: <Play className="text-rose-400" size={24} />,
      title: 'Step 4: Paste & Run',
      description:
        'Paste the Python script you copied in Step 1 into the empty cell. Click the &apos;Play&apos; button on the left of the cell to start the engine. It will install the dependencies and boot up.',
      placeholder:
        '[Image Placeholder: Show cell with code and play button running]',
    },
    {
      icon: <LinkIcon className="text-amber-400" size={24} />,
      title: 'Step 5: Connect to Phantom',
      description:
        'Once it finishes booting, it will output a public URL at the bottom (e.g., https://xxxx.gradio.live). Copy this URL, head back to the Remix Lab in Phantom, and paste it into the &apos;Kaggle Endpoint URL&apos; box.',

      placeholder:
        '[Image Placeholder: Show Gradio public URL in Kaggle output]',
    },
  ];

  return (
    <div className="w-full flex flex-col gap-12 pb-12">
      <SEO
        title="Remix Lab Guide — Stems, Chords & Key Detection"
        description="How to use the Remix Lab: separate songs into stems, detect chords and musical key, shift pitch. AI-powered analysis, runs free in your browser."
        canonicalUrl="/resources/remix-guide"
      />

      <header className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-black uppercase tracking-[0.2em] mb-4">
          <FlaskConical size={12} /> Decentralized Compute
        </div>
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter text-white">
          Remix Lab <span className="text-purple-400">Setup Guide</span>
        </h1>
        <p className="text-gray-400 text-lg font-medium max-w-2xl mx-auto">
          High-end AI models require expensive GPUs. Learn how to utilize
          Kaggle&apos;s incredible free tier to host your own backend and
          process your music for $0.
        </p>
      </header>

      <div className="bg-amber-500/10 border border-amber-500/20 p-6 rounded-3xl flex flex-col sm:flex-row gap-6 items-start">
        <div className="bg-amber-500/20 p-3 rounded-full shrink-0">
          <AlertTriangle className="text-amber-400" size={24} />
        </div>
        <div>
          <h3 className="text-white font-bold text-lg mb-2">
            Why do we do this?
          </h3>
          <p className="text-gray-400 text-sm leading-relaxed">
            Running State-of-the-Art (SOTA) models like BS-RoFormer and Demucs
            takes massive computing power. Most companies charge $15-$30/month
            because renting dedicated GPUs is incredibly expensive, and as an
            independent developer, I simply can&apos;t afford to host a massive
            GPU farm for everyone to use.
            <br />
            <br />
            Instead of locking this tool behind a paywall, this guide shows you
            how to run the open-source backend yourself utilizing Kaggle&apos;s
            generous free GPU instances. You get enterprise-grade separation for
            free while getting introduced to an amazing platform for data
            science and machine learning.
          </p>
        </div>
      </div>

      <div className="space-y-8">
        {steps.map((step) => (
          <GuideStep key={step.title} step={step} />
        ))}
      </div>

      <footer className="flex flex-col items-center gap-8 mt-4">
        <button
          onClick={() => (window.location.href = '/tools/remix-lab')}
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-10 py-4 rounded-full hover:bg-cyan-500/20 hover:border-cyan-400 transition-all duration-300 font-black shadow-[0_0_20px_rgba(34,211,238,0.1)]"
        >
          Launch Remix Lab
        </button>
      </footer>
    </div>
  );
};

export default RemixLabGuide;
