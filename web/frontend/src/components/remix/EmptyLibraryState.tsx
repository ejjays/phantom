import React from 'react';
import Lottie from 'lottie-react';
import tigerHappyLottie from '../../assets/lottie/tiger-happy.json';
import TwinkleStars from '../ui/TwinkleStars';
import ShootingStars from '../ui/ShootingStars';

const EmptyLibraryState = () => {
  return (
    <div className="flex flex-col flex-1 pb-10">
      <div className="relative overflow-hidden flex flex-col items-center justify-center py-12 text-zinc-500 gap-4 mb-4 border border-dashed border-zinc-800/50 bg-[#141414]/50 rounded-2xl">
        <div className="absolute inset-0 pointer-events-none opacity-40">
          <TwinkleStars className="absolute" showBackground={false} />
          <ShootingStars className="absolute" starColor="#22d3ee" />
        </div>
        <div className="relative z-10 w-48 h-48 sm:w-64 sm:h-64 opacity-80 pointer-events-none mt-4">
          <Lottie animationData={tigerHappyLottie} loop />
        </div>
        <p className="relative z-10 text-xl font-medium text-zinc-300 mb-2">
          Your library is empty.
        </p>
      </div>
    </div>
  );
};

export default EmptyLibraryState;
