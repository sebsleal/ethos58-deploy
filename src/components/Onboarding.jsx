import { useRef, useState } from 'react';
import { Droplet, FileText, Activity, BarChart2, ArrowRight, CheckCircle } from 'lucide-react';
import { markOnboardingDone } from '../utils/storage';

const SLIDES = [
  {
    icon: Droplet,
    color: 'text-brand-500',
    bg: 'bg-brand-500/10',
    title: 'Blend Calculator',
    body: 'Enter your current tank level and target ethanol %. Ethos58 tells you exactly how much E85 and pump gas to add — with precision mode for accurate fills.',
  },
  {
    icon: FileText,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    title: 'Log Analyzer',
    body: 'Upload a BM3 or MHD CSV log. Get instant AFR, boost, HPFP, and timing analysis with pass/fail status and color-coded gauges.',
  },
  {
    icon: BarChart2,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    title: 'Knock & Fuel Trims',
    body: 'See knock events plotted by RPM and load, and review LTFT/STFT fuel trim by zone. Spot tuning issues before they become engine damage.',
  },
  {
    icon: Activity,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    title: 'Tune Health Score',
    body: 'Every log earns a 0–100 health score based on AFR safety, timing pull, HPFP stability, and IAT. Track it over time on your Dashboard.',
  },
];

export default function Onboarding({ onDone }) {
  const [slide, setSlide] = useState(0);
  const touchStartYRef = useRef(null);
  const [dragDelta, setDragDelta] = useState(0);

  const isLast = slide === SLIDES.length - 1;
  const { icon: Icon, color, bg, title, body } = SLIDES[slide];

  function finish() {
    markOnboardingDone();
    onDone();
  }

  const handleSwipeStart = (e) => {
    touchStartYRef.current = e.touches[0].clientY;
    setDragDelta(0);
  };

  const handleSwipeMove = (e) => {
    if (touchStartYRef.current === null) return;
    const delta = e.touches[0].clientY - touchStartYRef.current;
    setDragDelta(Math.max(0, delta));
  };

  const handleSwipeEnd = () => {
    if (dragDelta > 60) finish();
    touchStartYRef.current = null;
    setDragDelta(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-4"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div
        className="relative bg-white dark:bg-[#0f0f11] border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        style={{
          transform: dragDelta > 0 ? `translateY(${Math.min(dragDelta, 120)}px)` : 'translateY(0)',
          transition: dragDelta > 0 ? 'none' : 'transform 0.25s ease',
        }}
      >
        <div
          className="pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
          onTouchStart={handleSwipeStart}
          onTouchMove={handleSwipeMove}
          onTouchEnd={handleSwipeEnd}
        >
          <span className="h-1 w-12 rounded-full bg-gray-300 dark:bg-zinc-700" />
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 justify-center pt-4 pb-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-6 bg-brand-500' : 'w-1.5 bg-gray-300 dark:bg-zinc-700'}`}
            />
          ))}
        </div>

        {/* Slide content */}
        <div className="px-8 py-6 text-center">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl ${bg} mb-5`}>
            <Icon size={28} className={color} strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">{title}</h2>
          <p className="text-sm text-gray-600 dark:text-zinc-400 leading-relaxed">{body}</p>
        </div>

        {/* Navigation */}
        <div className="px-6 pb-6 flex gap-3">
          {!isLast && (
            <button
              onClick={finish}
              className="flex-1 py-2.5 text-sm text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={isLast ? finish : () => setSlide(s => s + 1)}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${isLast ? 'flex-1 bg-brand-500 hover:bg-brand-600 text-white' : 'flex-1 bg-brand-500/10 hover:bg-brand-500/20 text-brand-600 dark:text-brand-400'}`}
          >
            {isLast ? (
              <><CheckCircle size={16} /> Get Started</>
            ) : (
              <>Next <ArrowRight size={14} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
