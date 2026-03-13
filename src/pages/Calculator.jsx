import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { calculateBlend, calculateResultingOctane, reverseCalculateBlend } from '../utils/blendMath';
import { saveActiveBlend, getBlendProfiles, saveBlendProfile, deleteBlendProfile, getSettings, saveSetting } from '../utils/storage';
import { trackEvent, trackError } from '../utils/telemetry';
import { hapticSuccess, hapticWarning, hapticError, hapticLight } from '../utils/haptics';
import { Droplet, Settings2, AlertTriangle, ListOrdered, BookmarkPlus, Bookmark, Trash2, RotateCcw, MapPin, Star, ChevronDown } from 'lucide-react';

const LITERS_PER_GALLON = 3.78541;

function roundTo(value, decimals = 2) {
  if (value === '' || value === null || value === undefined || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

const Calculator = () => {
  const [mode, setMode] = useState('blend'); // 'blend' | 'refuel'
  const [formData, setFormData] = useState({
    currentFuel: 5.0,
    currentE: 10,
    targetE: 40,
    tankSize: 13.7,
  });
  const [precisionMode, setPrecisionMode] = useState(false);
  const [pumpOctane, setPumpOctane] = useState(93);
  const [pumpEthanol, setPumpEthanol] = useState(0);
  const [volumeUnit, setVolumeUnit] = useState(() => (getSettings().units === 'Metric' ? 'L' : 'gal'));
  const [resultVolumeUnit, setResultVolumeUnit] = useState(() => {
    const settings = getSettings();
    if (settings.blendResultUnit === 'L' || settings.blendResultUnit === 'gal') return settings.blendResultUnit;
    return settings.units === 'Metric' ? 'L' : 'gal';
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Saved profiles
  const [profiles, setProfiles] = useState(getBlendProfiles);
  const [profileName, setProfileName] = useState('');
  const [showProfileSave, setShowProfileSave] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Refuel planner
  const [refuelGallons, setRefuelGallons] = useState(5.0);
  const [refuelPumpEthanol, setRefuelPumpEthanol] = useState(0);
  const [refuelResult, setRefuelResult] = useState(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let willShowListener = null;
    let didShowListener = null;

    const scrollActiveFieldIntoView = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
      window.setTimeout(() => {
        active.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }, 80);
    };

    import('@capacitor/keyboard')
      .then(async ({ Keyboard }) => {
        willShowListener = await Keyboard.addListener('keyboardWillShow', scrollActiveFieldIntoView);
        didShowListener = await Keyboard.addListener('keyboardDidShow', scrollActiveFieldIntoView);
      })
      .catch(() => {
        // ignore when keyboard plugin is not available
      });

    return () => {
      if (willShowListener?.remove) willShowListener.remove();
      if (didShowListener?.remove) didShowListener.remove();
    };
  }, []);

  const toDisplayVolume = (gallons) => {
    if (gallons === '' || gallons === null || gallons === undefined) return '';
    if (volumeUnit === 'L') return roundTo(Number(gallons) * LITERS_PER_GALLON, 2);
    return gallons;
  };

  const fromDisplayVolume = (value) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return '';
    if (volumeUnit === 'L') return parsed / LITERS_PER_GALLON;
    return parsed;
  };

  const formatResultVolume = (gallons) => {
    if (gallons === null || gallons === undefined || Number.isNaN(Number(gallons))) return '—';
    if (resultVolumeUnit === 'L') return roundTo(Number(gallons) * LITERS_PER_GALLON, 2);
    return gallons;
  };

  const volumeLabel = volumeUnit === 'L' ? 'L' : 'gal';
  const resultVolumeLabel = resultVolumeUnit === 'L' ? 'L' : 'gal';

  const handleVolumeUnitChange = (unit) => {
    setVolumeUnit(unit);
    saveSetting('units', unit === 'L' ? 'Metric' : 'US');
  };

  const handleResultVolumeUnitChange = (unit) => {
    setResultVolumeUnit(unit);
    saveSetting('blendResultUnit', unit);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'currentFuel' || name === 'tankSize') {
      setFormData(prev => ({ ...prev, [name]: fromDisplayVolume(value) }));
      return;
    }
    const parsed = parseFloat(value);
    setFormData(prev => ({ ...prev, [name]: Number.isNaN(parsed) ? '' : parsed }));
  };

  const calculate = () => {
    setError(null);
    try {
      const data = calculateBlend({
        current_gallons:         formData.currentFuel,
        current_ethanol_percent: formData.currentE,
        target_ethanol_percent:  formData.targetE,
        tank_size:               formData.tankSize,
        pump_ethanol_percent:    pumpEthanol,
        precision_mode:          precisionMode,
      });
      const octane = calculateResultingOctane({
        e85Gallons:  data.gallons_of_e85_to_add,
        pumpGallons: data.gallons_of_93_to_add,
        pumpOctane,
      });
      const mapped = {
        e85Gallons:          data.gallons_of_e85_to_add,
        pumpGallons:         data.gallons_of_93_to_add,
        pumpOctane,
        pumpEthanol,
        resultingBlend:      data.resulting_percent,
        resultingOctane:     octane,
        precisionModeActive: data.precision_mode,
        fillSteps:           data.fill_steps   ?? null,
        precisionNote:       data.precision_note ?? null,
        warnings:            data.warnings,
      };
      saveActiveBlend(mapped);
      setResult(mapped);
      // Haptic feedback based on result severity
      if (mapped.warnings?.length > 0) {
        hapticWarning();
      } else {
        hapticSuccess();
      }
      trackEvent('blend_calculation_succeeded', {
        current_fuel: formData.currentFuel,
        current_e: formData.currentE,
        target_e: formData.targetE,
        tank_size: formData.tankSize,
        resulting_e: mapped.resultingBlend,
      });
    } catch (err) {
      setError(err.message);
      hapticError();
      trackError('blend_calculation_failed', err, { current_fuel: formData.currentFuel, target_e: formData.targetE });
    }
  };

  const calcRefuel = () => {
    const blend = reverseCalculateBlend({
      currentE: formData.currentE,
      currentGallons: formData.currentFuel,
      addGallons: refuelGallons,
      pumpEthanol: refuelPumpEthanol,
    });
    setRefuelResult(blend);
    hapticLight();
  };

  const handleSaveProfile = () => {
    if (!profileName.trim()) return;
    saveBlendProfile(profileName.trim(), { formData, pumpOctane, pumpEthanol, precisionMode });
    setProfiles(getBlendProfiles());
    setProfileName('');
    setShowProfileSave(false);
  };

  const handleLoadProfile = (name) => {
    const p = profiles[name];
    if (!p) return;
    if (p.formData)      setFormData(p.formData);
    if (p.pumpOctane  !== undefined) setPumpOctane(p.pumpOctane);
    if (p.pumpEthanol !== undefined) setPumpEthanol(p.pumpEthanol);
    if (p.precisionMode !== undefined) setPrecisionMode(p.precisionMode);
    setResult(null);
    setShowProfileMenu(false);
  };

  const handleDeleteProfile = (name) => {
    deleteBlendProfile(name);
    setProfiles(getBlendProfiles());
  };

  const profileNames = Object.keys(profiles);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-gray-100 flex items-center gap-3">
            <Droplet className="text-brand-500" size={26} />
            Ethanol Blend Calculator
          </h1>
          <p className="text-slate-500 dark:text-gray-400 mt-1.5 text-sm">Dial in your precise E-mix for your B58 tune.</p>
        </div>

        {/* Profile controls */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
            <button
              onClick={() => handleVolumeUnitChange('gal')}
              className={`px-3 py-2 text-xs font-bold transition-colors ${volumeUnit === 'gal' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
            >
              Gallons
            </button>
            <button
              onClick={() => handleVolumeUnitChange('L')}
              className={`px-3 py-2 text-xs font-bold transition-colors ${volumeUnit === 'L' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-900 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
            >
              Litres
            </button>
          </div>
          {profileNames.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(v => !v)}
                className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-slate-700 dark:text-gray-300 hover:border-brand-400 transition-colors"
              >
                <Bookmark size={14} className="text-brand-500" /> Profiles <ChevronDown size={12} />
              </button>
              {showProfileMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-lg py-1 overflow-hidden">
                  {profileNames.map(name => (
                    <div key={name} className="flex items-center group px-3 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800">
                      <button onClick={() => handleLoadProfile(name)} className="flex-1 text-left text-sm text-slate-700 dark:text-gray-200 truncate">{name}</button>
                      <button onClick={() => handleDeleteProfile(name)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all p-0.5">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setShowProfileSave(v => !v)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-slate-700 dark:text-gray-300 hover:border-brand-400 transition-colors"
          >
            <BookmarkPlus size={14} className="text-brand-500" /> Save Profile
          </button>
        </div>
      </header>

      {showProfileSave && (
        <div className="flex items-center gap-2 p-3 bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 rounded-xl animate-fade-in">
          <Star size={14} className="text-brand-500 shrink-0" />
          <input
            type="text" placeholder="Profile name (e.g. Summer E40)" value={profileName}
            onChange={e => setProfileName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-gray-200 outline-none placeholder-slate-400 dark:placeholder-gray-600"
          />
          <button onClick={handleSaveProfile} className="text-xs font-bold text-brand-600 dark:text-brand-400 hover:text-brand-700 px-2 py-1 rounded-md bg-brand-100 dark:bg-brand-500/20 transition-colors">Save</button>
          <button onClick={() => setShowProfileSave(false)} className="text-slate-400 hover:text-slate-600 text-xs px-1">✕</button>
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-white/5 rounded-xl w-fit">
        {['blend', 'refuel'].map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${mode === m ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700'}`}
          >
            {m === 'blend' ? 'Blend Calculator' : 'Refuel Planner'}
          </button>
        ))}
      </div>

      {mode === 'blend' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Inputs */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-white/5 pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-gray-100">Parameters</h2>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">Precision Mode</span>
                  {precisionMode && <span className="text-[10px] text-brand-500 font-bold uppercase tracking-wider">staged fill</span>}
                </div>
                <button onClick={() => setPrecisionMode(!precisionMode)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${precisionMode ? 'bg-brand-500' : 'bg-slate-200 dark:bg-zinc-700'}`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform shadow-sm ${precisionMode ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Pump Octane</span>
              <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                {[91, 93].map(oct => (
                  <button key={oct} onClick={() => setPumpOctane(oct)}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors ${pumpOctane === oct ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
                  >{oct}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Pump Ethanol Content</span>
                {pumpEthanol > 0 && <span className="ml-2 text-[10px] font-bold text-amber-500 uppercase tracking-wider">affects calc</span>}
              </div>
              <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                {[0, 10].map(e => (
                  <button key={e} onClick={() => setPumpEthanol(e)}
                    className={`px-4 py-1.5 text-xs font-bold transition-colors ${pumpEthanol === e ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
                  >E{e}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mb-6">
              <span className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Result Display Unit</span>
              <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
                <button
                  onClick={() => handleResultVolumeUnitChange('gal')}
                  className={`px-4 py-1.5 text-xs font-bold transition-colors ${resultVolumeUnit === 'gal' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
                >
                  Gallons
                </button>
                <button
                  onClick={() => handleResultVolumeUnitChange('L')}
                  className={`px-4 py-1.5 text-xs font-bold transition-colors ${resultVolumeUnit === 'L' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
                >
                  Litres
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <InputGroup label={`Current Fuel in Tank (${volumeLabel})`} name="currentFuel" value={toDisplayVolume(formData.currentFuel)} onChange={handleChange} step="0.1" />
              <InputGroup label="Current Ethanol %" name="currentE" value={formData.currentE} onChange={handleChange} step="1" />
              <InputGroup label="Target Ethanol %" name="targetE" value={formData.targetE} onChange={handleChange} step="1" />
              <InputGroup label={`Tank Capacity (${volumeLabel})`} name="tankSize" value={toDisplayVolume(formData.tankSize)} onChange={handleChange} step="0.1" />
            </div>

            <button onClick={calculate}
              className="w-full mt-8 bg-slate-900 dark:bg-brand-500 hover:bg-slate-800 dark:hover:bg-brand-400 text-white py-3 rounded-xl font-bold tracking-wide transition-all flex justify-center items-center gap-2 shadow-sm"
            >
              CALCULATE BLEND
            </button>

            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-500 dark:text-red-400 mt-0.5 shrink-0" />
                <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Results */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none flex flex-col">
            <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-6 border-b border-slate-100 dark:border-white/5 pb-4">Mix Instructions</h2>

            {result ? (
              <div className="flex-1 flex flex-col justify-center space-y-4">
                <div className="bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 p-5 rounded-2xl flex justify-between items-center group hover:border-brand-300 transition-colors">
                  <div>
                    <p className="text-brand-600 dark:text-brand-400 text-xs uppercase tracking-wider font-bold mb-1">Add E85</p>
                    <p className="text-3xl font-bold text-brand-600 dark:text-brand-400">{formatResultVolume(result.e85Gallons)} <span className="text-base text-slate-400 dark:text-gray-500 font-medium">{resultVolumeLabel}</span></p>
                  </div>
                  <Droplet size={36} className="text-brand-300 dark:text-brand-500/30" />
                </div>

                <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 p-5 rounded-2xl flex justify-between items-center group hover:border-slate-300 transition-colors">
                  <div>
                    <p className="text-slate-500 dark:text-gray-400 text-xs uppercase tracking-wider font-bold mb-1">
                      Add {pumpOctane} Oct {result.pumpEthanol > 0 ? `(E${result.pumpEthanol})` : '(E0)'}
                    </p>
                    <p className="text-3xl font-bold text-slate-800 dark:text-gray-100">{formatResultVolume(result.pumpGallons)} <span className="text-base text-slate-400 font-medium">{resultVolumeLabel}</span></p>
                  </div>
                  <Droplet size={36} className="text-slate-300 dark:text-gray-700" />
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-white/5 grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-slate-400 dark:text-gray-500 mb-1">Resulting Blend</p>
                    <p className="text-slate-900 dark:text-gray-100 font-bold text-2xl">E{result.resultingBlend}</p>
                  </div>
                  {result.resultingOctane && (
                    <div className="text-center border-l border-slate-100 dark:border-white/5">
                      <p className="text-xs text-slate-400 dark:text-gray-500 mb-1">Est. Octane (AKI)</p>
                      <p className="text-slate-900 dark:text-gray-100 font-bold text-2xl">{result.resultingOctane}</p>
                    </div>
                  )}
                </div>

                {result.precisionModeActive && result.fillSteps && (
                  <div className="bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 rounded-2xl p-4">
                    <p className="text-brand-600 dark:text-brand-400 text-sm font-bold flex items-center gap-2 mb-3"><ListOrdered size={15} /> Staged Fill Steps</p>
                    <div className="space-y-3">
                      {result.fillSteps.map(step => (
                        <div key={step.step} className="flex gap-3 items-start">
                          <span className="w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-500/20 text-brand-600 dark:text-brand-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{step.step}</span>
                          <p className="text-slate-600 dark:text-gray-300 text-sm leading-relaxed">{step.note}</p>
                        </div>
                      ))}
                    </div>
                    {resultVolumeUnit === 'L' && <p className="text-slate-400 dark:text-gray-500 text-xs mt-3">Staged fill notes are shown in gallons.</p>}
                    {result.precisionNote && <p className="text-slate-400 dark:text-gray-500 text-xs mt-4 italic">{result.precisionNote}</p>}
                  </div>
                )}

                {result.warnings?.length > 0 && (
                  <div className="space-y-2">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-xl text-yellow-700 dark:text-yellow-500 text-sm">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />{w}
                      </div>
                    ))}
                  </div>
                )}

                <a href="https://www.e85prices.com" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2 rounded-xl border border-slate-200 dark:border-white/5 text-slate-500 dark:text-gray-400 hover:text-brand-500 hover:border-brand-300 transition-colors text-xs font-medium"
                >
                  <MapPin size={13} /> Find E85 near me
                </a>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-gray-600 space-y-4 py-12">
                <Settings2 size={44} className="opacity-40" />
                <p className="text-sm text-slate-400 dark:text-gray-500">Enter parameters and calculate to see mix instructions.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'refuel' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none">
            <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-4 border-b border-slate-100 dark:border-white/5 pb-4">Refuel Planner</h2>
            <p className="text-sm text-slate-500 dark:text-gray-400 mb-6">"I'm adding X gallons at the pump — what will my blend be?"</p>
            <div className="space-y-5">
              <InputGroup label={`Current Fuel in Tank (${volumeLabel})`} name="currentFuel" value={toDisplayVolume(formData.currentFuel)} onChange={handleChange} step="0.1" />
              <InputGroup label="Current Ethanol %" name="currentE" value={formData.currentE} onChange={handleChange} step="1" />
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{volumeUnit === 'L' ? 'Litres Being Added' : 'Gallons Being Added'}</label>
                <input type="number" value={toDisplayVolume(refuelGallons)} onChange={e => {
                  const next = fromDisplayVolume(e.target.value);
                  setRefuelGallons(next === '' ? 0 : next);
                }} step="0.5"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-white/10 focus:border-brand-400 rounded-xl px-4 py-2.5 text-slate-900 dark:text-gray-100 text-sm outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Pump Ethanol %</label>
                <div className="flex gap-2 flex-wrap">
                  {[0, 10, 85].map(e => (
                    <button key={e} onClick={() => setRefuelPumpEthanol(e)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${refuelPumpEthanol === e ? 'bg-slate-900 dark:bg-brand-500 text-white border-transparent' : 'bg-white dark:bg-zinc-950 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400'}`}
                    >E{e}</button>
                  ))}
                  <input type="number" value={refuelPumpEthanol} onChange={e => setRefuelPumpEthanol(parseFloat(e.target.value) || 0)} min="0" max="85" step="5"
                    className="w-20 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-white/10 focus:border-brand-400 rounded-xl px-3 py-1.5 text-slate-900 dark:text-gray-100 text-xs outline-none"
                    placeholder="Custom"
                  />
                </div>
              </div>
            </div>
            <button onClick={calcRefuel}
              className="w-full mt-8 bg-slate-900 dark:bg-brand-500 hover:bg-slate-800 dark:hover:bg-brand-400 text-white py-3 rounded-xl font-bold tracking-wide transition-all flex justify-center items-center gap-2"
            >
              <RotateCcw size={16} /> CALCULATE RESULT
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 shadow-sm dark:shadow-none flex flex-col">
            <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-6 border-b border-slate-100 dark:border-white/5 pb-4">Resulting Blend</h2>
            {refuelResult !== null ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-36 h-36 rounded-full border-4 border-brand-500/20 bg-brand-50 dark:bg-brand-500/5 flex flex-col items-center justify-center mb-6">
                  <p className="text-4xl font-black text-brand-600 dark:text-brand-400">E{refuelResult}</p>
                  <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">resulting blend</p>
                </div>
                <p className="text-sm text-slate-500 dark:text-gray-400 text-center">
                  Adding {toDisplayVolume(refuelGallons)} {volumeLabel} of E{refuelPumpEthanol} to {toDisplayVolume(formData.currentFuel)} {volumeLabel} of E{formData.currentE}
                </p>
                <a href="https://www.e85prices.com" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 mt-6 py-2 px-4 rounded-xl border border-slate-200 dark:border-white/5 text-slate-500 dark:text-gray-400 hover:text-brand-500 hover:border-brand-300 transition-colors text-xs font-medium"
                >
                  <MapPin size={13} /> Find E85 stations near me
                </a>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-gray-600 space-y-4 py-12">
                <RotateCcw size={44} className="opacity-40" />
                <p className="text-sm text-slate-400 dark:text-gray-500">Enter fill details to see resulting blend.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const InputGroup = ({ label, name, value, onChange, step }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{label}</label>
    <input
      type="number" name={name} value={value} onChange={onChange} step={step}
      className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-white/10 focus:border-brand-400 dark:focus:border-brand-500 focus:ring-1 focus:ring-brand-400/30 rounded-xl px-4 py-2.5 text-slate-900 dark:text-gray-100 text-sm outline-none transition-all placeholder-slate-300 dark:placeholder-gray-600"
      placeholder="0.0"
    />
  </div>
);

export default Calculator;
