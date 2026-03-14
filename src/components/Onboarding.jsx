import { useEffect, useRef, useState } from 'react';
import { Droplet, FileText, Activity, BarChart2, ArrowRight, CheckCircle } from 'lucide-react';
import { markOnboardingDone } from '../utils/storage';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

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
  const dialogRef = useRef(null);

  const isLast = slide === SLIDES.length - 1;
  const { icon: Icon, color, bg, title, body } = SLIDES[slide];

  function finish() {
    markOnboardingDone();
    onDone();
  }

  const { dragDelta, swipeBind } = useSwipeDismiss(finish);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const focusable = dialog.querySelector('button');
    focusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const nodes = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const focusableNodes = Array.from(nodes).filter((node) => !node.hasAttribute('disabled'));
      if (!focusableNodes.length) return;
      const first = focusableNodes[0];
      const last = focusableNodes[focusableNodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm px-4 py-4"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div
        ref={dialogRef}
        className="surface-panel animate-modal-in relative w-full max-w-md overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Ethos58 onboarding"
        style={{
          transform: dragDelta > 0 ? `translateY(${Math.min(dragDelta, 120)}px)` : 'translateY(0)',
          transition: dragDelta > 0 ? 'none' : 'transform 0.25s ease',
        }}
      >
        <div
          className="pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
          {...swipeBind}
        >
          <span className="h-1 w-12 rounded-full bg-slate-300/90 dark:bg-white/12" />
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 justify-center pt-4 pb-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className={`h-[3px] rounded-[2px] transition-all ${i === slide ? 'w-5 bg-brand-400' : 'w-[5px] bg-white/12'}`}
              aria-label={`Go to onboarding slide ${i + 1}`}
              aria-pressed={i === slide}
            />
          ))}
        </div>

        {/* Slide content */}
        <div className="px-8 py-8 text-center">
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-lg border border-[var(--app-border)] ${bg} mb-5`}>
            <Icon size={28} className={color} strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-semibold app-heading mb-3">{title}</h2>
          <p className="text-sm leading-relaxed app-muted">{body}</p>
        </div>

        {/* Navigation */}
        <div className="px-6 pb-6 flex gap-3">
          {!isLast && (
            <button
              onClick={finish}
              className="flex-1 rounded py-2.5 text-sm app-muted transition-colors hover:text-[var(--app-heading)]"
            >
              Skip
            </button>
          )}
          <button
            onClick={isLast ? finish : () => setSlide(s => s + 1)}
            className={`flex items-center justify-center gap-2 rounded py-2.5 text-sm font-semibold transition-colors ${isLast ? 'flex-1 bg-brand-500 hover:bg-brand-600 text-white' : 'flex-1 border border-brand-500/18 bg-brand-500/8 text-brand-600 hover:bg-brand-500/14 dark:text-brand-300'}`}
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
