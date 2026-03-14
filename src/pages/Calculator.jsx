import { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { calculateBlend, calculateResultingOctane, reverseCalculateBlend, calibratePumpEthanol, estimateBlendFillCost, planEthanolOverTanks } from '../utils/blendMath';
import {
  saveActiveBlend,
  getBlendProfiles,
  saveBlendProfile,
  deleteBlendProfile,
  getSettings,
  saveSetting,
  getStationPresets,
  saveStationPreset,
  deleteStationPreset,
  getFuelPlannerDefaults,
  saveFuelPlannerDefaults,
} from '../utils/storage';
import { trackEvent, trackError } from '../utils/telemetry';
import { hapticSuccess, hapticWarning, hapticError, hapticLight } from '../utils/haptics';
import { Droplet, AlertTriangle, BookmarkPlus, Bookmark, Trash2, RotateCcw, MapPin, Star, ChevronDown, Calculator as CalculatorIcon, Route } from 'lucide-react';
import { PageHeader } from '../components/ui';

const LITERS_PER_GALLON = 3.78541;

function roundTo(value, decimals = 2) {
  if (value === '' || value === null || value === undefined || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

const Calculator = () => {
  const [settings] = useState(getSettings);
  const [plannerDefaults] = useState(getFuelPlannerDefaults);
  const [mode, setMode] = useState('blend'); // 'blend' | 'refuel' | 'planner'
  const [formData, setFormData] = useState({
    currentFuel: 5.0,
    currentE: 10,
    targetE: 40,
    tankSize: 13.7,
  });
  const [precisionMode, setPrecisionMode] = useState(false);
  const [pumpOctane, setPumpOctane] = useState(93);
  const [pumpEthanol, setPumpEthanol] = useState(0);
  const [volumeUnit, setVolumeUnit] = useState(() => (settings.units === 'Metric' ? 'L' : 'gal'));
  const [tankCapacityUnit, setTankCapacityUnit] = useState(() => {
    if (plannerDefaults.tankCapacityUnit === 'L' || plannerDefaults.tankCapacityUnit === 'gal') {
      return plannerDefaults.tankCapacityUnit;
    }
    return settings.units === 'Metric' ? 'L' : 'gal';
  });
  const [resultVolumeUnit, setResultVolumeUnit] = useState(() => {
    if (settings.blendResultUnit === 'L' || settings.blendResultUnit === 'gal') return settings.blendResultUnit;
    return settings.units === 'Metric' ? 'L' : 'gal';
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [profiles, setProfiles] = useState(getBlendProfiles);
  const [profileName, setProfileName] = useState('');
  const [showProfileSave, setShowProfileSave] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [refuelGallons, setRefuelGallons] = useState(5.0);
  const [refuelPumpEthanol, setRefuelPumpEthanol] = useState(0);
  const [refuelResult, setRefuelResult] = useState(null);
  const [refuelAddUnit, setRefuelAddUnit] = useState(() => {
    if (settings.refuelAddUnit === 'L' || settings.refuelAddUnit === 'gal') return settings.refuelAddUnit;
    return settings.units === 'Metric' ? 'L' : 'gal';
  });

  // fuel planner state
  const [calibrationInput, setCalibrationInput] = useState(plannerDefaults.calibrationReadings || '');
  const [calibratedPumpE, setCalibratedPumpE] = useState(plannerDefaults.calibratedPumpE || null);
  const [stationPresets, setStationPresets] = useState(getStationPresets);
  const [stationName, setStationName] = useState('');
  const [stationE85Price, setStationE85Price] = useState(plannerDefaults.e85Price || 3.2);
  const [stationPumpPrice, setStationPumpPrice] = useState(plannerDefaults.pumpPrice || 4.2);
  const [selectedStation, setSelectedStation] = useState('');
  const [fillCostResult, setFillCostResult] = useState(null);
  const [tankCount, setTankCount] = useState(plannerDefaults.tankCount || 3);
  const [tripPlan, setTripPlan] = useState([]);
  const profileMenuRef = useRef(null);

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

  useEffect(() => {
    saveFuelPlannerDefaults({
      calibrationReadings: calibrationInput,
      calibratedPumpE,
      e85Price: stationE85Price,
      pumpPrice: stationPumpPrice,
      tankCount,
      tankCapacityUnit,
    });
  }, [calibrationInput, calibratedPumpE, stationE85Price, stationPumpPrice, tankCount, tankCapacityUnit]);

  useEffect(() => {
    if (!showProfileMenu) return undefined;

    const handlePointerDown = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showProfileMenu]);

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

  const toDisplayTankCapacity = (gallons) => {
    if (gallons === '' || gallons === null || gallons === undefined) return '';
    if (tankCapacityUnit === 'L') return roundTo(Number(gallons) * LITERS_PER_GALLON, 2);
    return gallons;
  };

  const fromDisplayTankCapacity = (value) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return '';
    if (tankCapacityUnit === 'L') return parsed / LITERS_PER_GALLON;
    return parsed;
  };

  const formatResultVolume = (gallons) => {
    if (gallons === null || gallons === undefined || Number.isNaN(Number(gallons))) return '—';
    if (resultVolumeUnit === 'L') return roundTo(Number(gallons) * LITERS_PER_GALLON, 2);
    return gallons;
  };

  const toDisplayRefuelVolume = (gallons) => {
    if (gallons === '' || gallons === null || gallons === undefined) return '';
    if (refuelAddUnit === 'L') return roundTo(Number(gallons) * LITERS_PER_GALLON, 2);
    return gallons;
  };

  const fromDisplayRefuelVolume = (value) => {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed)) return '';
    if (refuelAddUnit === 'L') return parsed / LITERS_PER_GALLON;
    return parsed;
  };

  const volumeLabel = volumeUnit === 'L' ? 'L' : 'gal';
  const tankCapacityLabel = tankCapacityUnit === 'L' ? 'L' : 'gal';
  const resultVolumeLabel = resultVolumeUnit === 'L' ? 'L' : 'gal';
  const refuelAddLabel = refuelAddUnit === 'L' ? 'L' : 'gal';

  const handleVolumeUnitChange = (unit) => {
    setVolumeUnit(unit);
    saveSetting('units', unit === 'L' ? 'Metric' : 'US');
  };

  const handleResultVolumeUnitChange = (unit) => {
    setResultVolumeUnit(unit);
    saveSetting('blendResultUnit', unit);
  };

  const handleTankCapacityUnitChange = (unit) => {
    setTankCapacityUnit(unit);
  };

  const handleRefuelAddUnitChange = (unit) => {
    setRefuelAddUnit(unit);
    saveSetting('refuelAddUnit', unit);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'currentFuel') {
      setFormData(prev => ({ ...prev, [name]: fromDisplayVolume(value) }));
      return;
    }
    if (name === 'tankSize') {
      setFormData(prev => ({ ...prev, [name]: fromDisplayTankCapacity(value) }));
      return;
    }
    const parsed = parseFloat(value);
    setFormData(prev => ({ ...prev, [name]: Number.isNaN(parsed) ? '' : parsed }));
  };

  const calculate = () => {
    setError(null);
    try {
      const data = calculateBlend({
        current_gallons: formData.currentFuel,
        current_ethanol_percent: formData.currentE,
        target_ethanol_percent: formData.targetE,
        tank_size: formData.tankSize,
        pump_ethanol_percent: pumpEthanol,
        precision_mode: precisionMode,
      });
      const octane = calculateResultingOctane({
        e85Gallons: data.gallons_of_e85_to_add,
        pumpGallons: data.gallons_of_93_to_add,
        pumpOctane,
      });
      const mapped = {
        e85Gallons: data.gallons_of_e85_to_add,
        pumpGallons: data.gallons_of_93_to_add,
        pumpOctane,
        pumpEthanol,
        resultingBlend: data.resulting_percent,
        resultingOctane: octane,
        precisionModeActive: data.precision_mode,
        fillSteps: data.fill_steps ?? null,
        precisionNote: data.precision_note ?? null,
        warnings: data.warnings,
      };
      saveActiveBlend(mapped);
      setResult(mapped);
      if (mapped.warnings?.length) hapticWarning();
      else hapticSuccess();
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
    if (p.formData) setFormData(p.formData);
    if (p.pumpOctane !== undefined) setPumpOctane(p.pumpOctane);
    if (p.pumpEthanol !== undefined) setPumpEthanol(p.pumpEthanol);
    if (p.precisionMode !== undefined) setPrecisionMode(p.precisionMode);
    setResult(null);
    setShowProfileMenu(false);
  };

  const handleDeleteProfile = (name) => {
    if (!window.confirm(`Delete the saved profile "${name}"?`)) return;
    deleteBlendProfile(name);
    setProfiles(getBlendProfiles());
  };

  const profileNames = Object.keys(profiles);
  const stationNames = Object.keys(stationPresets);

  const handleCalibratePump = () => {
    const readings = calibrationInput
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
    const calibrated = calibratePumpEthanol(readings);
    setCalibratedPumpE(calibrated);
    if (calibrated !== null) {
      setPumpEthanol(calibrated);
      setRefuelPumpEthanol(calibrated);
    }
  };

  const handleSaveStation = () => {
    if (!stationName.trim()) return;
    saveStationPreset(stationName.trim(), {
      e85Price: stationE85Price,
      pumpPrice: stationPumpPrice,
      pumpEthanol: calibratedPumpE ?? pumpEthanol,
    });
    setStationPresets(getStationPresets());
    setStationName('');
  };

  const handleSelectStation = (name) => {
    setSelectedStation(name);
    const preset = stationPresets[name];
    if (!preset) return;
    setStationE85Price(preset.e85Price);
    setStationPumpPrice(preset.pumpPrice);
    if (preset.pumpEthanol !== undefined && preset.pumpEthanol !== null) {
      setPumpEthanol(preset.pumpEthanol);
      setRefuelPumpEthanol(preset.pumpEthanol);
      setCalibratedPumpE(preset.pumpEthanol);
    }
  };

  const runCostOptimization = () => {
    const options = stationNames.map(name => {
      const preset = stationPresets[name];
      return {
        name,
        ...estimateBlendFillCost({
          currentGallons: formData.currentFuel,
          currentE: formData.currentE,
          targetE: formData.targetE,
          tankSize: formData.tankSize,
          pumpEthanol: preset.pumpEthanol ?? calibratedPumpE ?? pumpEthanol,
          e85Price: preset.e85Price,
          pumpPrice: preset.pumpPrice,
        }),
      };
    });

    const manual = {
      name: 'Current prices',
      ...estimateBlendFillCost({
        currentGallons: formData.currentFuel,
        currentE: formData.currentE,
        targetE: formData.targetE,
        tankSize: formData.tankSize,
        pumpEthanol: calibratedPumpE ?? pumpEthanol,
        e85Price: stationE85Price,
        pumpPrice: stationPumpPrice,
      }),
    };

    const allOptions = [...options, manual].sort((a, b) => a.totalCost - b.totalCost);
    setFillCostResult(allOptions);
  };

  const runTripPlan = () => {
    const plan = planEthanolOverTanks({
      tanks: tankCount,
      startGallons: formData.currentFuel,
      startE: formData.currentE,
      tankSize: formData.tankSize,
      targetE: formData.targetE,
      pumpEthanol: calibratedPumpE ?? pumpEthanol,
    });
    setTripPlan(plan);
  };

  const tripSummary = useMemo(() => {
    if (!tripPlan.length) return null;
    const totalE85 = roundTo(tripPlan.reduce((sum, item) => sum + item.e85Gallons, 0), 2);
    return { totalE85 };
  }, [tripPlan]);

  const plannerPumpEthanol = calibratedPumpE ?? pumpEthanol;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Fuel"
        title="Ethanol Blend Calculator"
        description="Dial in your blend, refuel predictions, and multi-tank planning with the same layered control system used across the rest of the app."
        action={(
        <div className="flex flex-wrap items-center gap-2">
          <div className="app-toggle-group">
            <button
              onClick={() => handleVolumeUnitChange('gal')}
              className={volumeUnit === 'gal' ? 'app-toggle-option app-toggle-option-active px-3 py-2 text-xs font-bold' : 'app-toggle-option px-3 py-2 text-xs font-bold'}
              aria-pressed={volumeUnit === 'gal'}
            >
              Gallons
            </button>
            <button
              onClick={() => handleVolumeUnitChange('L')}
              className={volumeUnit === 'L' ? 'app-toggle-option app-toggle-option-active px-3 py-2 text-xs font-bold' : 'app-toggle-option px-3 py-2 text-xs font-bold'}
              aria-pressed={volumeUnit === 'L'}
            >
              Litres
            </button>
          </div>
          {profileNames.length > 0 && (
            <div className="relative" ref={profileMenuRef}>
              <button
                onClick={() => setShowProfileMenu(v => !v)}
                className="app-button-secondary flex items-center gap-2 px-3 py-2 text-xs font-semibold"
                aria-expanded={showProfileMenu}
                aria-haspopup="menu"
              >
                <Bookmark size={14} className="text-brand-500" /> Profiles <ChevronDown size={12} />
              </button>
              {showProfileMenu && (
                <div className="surface-card absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden py-1" role="menu">
                  {profileNames.map(name => (
                    <div key={name} className="group flex items-center px-3 py-2 hover:bg-[var(--app-card-inset)]/70">
                      <button onClick={() => handleLoadProfile(name)} className="app-heading flex-1 truncate text-left text-sm" role="menuitem">{name}</button>
                      <button onClick={() => handleDeleteProfile(name)} className="p-0.5 text-red-400 opacity-0 transition-all group-hover:opacity-100 hover:text-red-600" aria-label={`Delete profile ${name}`}>
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
            className="app-button-secondary flex items-center gap-2 px-3 py-2 text-xs font-semibold"
            aria-pressed={showProfileSave}
          >
            <BookmarkPlus size={14} className="text-brand-500" /> Save Profile
          </button>
        </div>
        )}
      />

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
          <button onClick={() => setShowProfileSave(false)} className="text-slate-400 hover:text-slate-600 text-xs px-1" aria-label="Close save profile panel">✕</button>
        </div>
      )}

      <div className="app-toggle-group w-fit">
        {[
          { key: 'blend', label: 'Blend Calculator' },
          { key: 'refuel', label: 'Refuel Planner' },
          { key: 'planner', label: 'Fuel Planner' },
        ].map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={mode === m.key ? 'app-toggle-option app-toggle-option-active px-4 py-1.5 text-xs font-bold' : 'app-toggle-option px-4 py-1.5 text-xs font-bold'}
            aria-pressed={mode === m.key}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'blend' && (
        <BlendPane
          precisionMode={precisionMode}
          setPrecisionMode={setPrecisionMode}
          pumpOctane={pumpOctane}
          setPumpOctane={setPumpOctane}
          pumpEthanol={pumpEthanol}
          setPumpEthanol={setPumpEthanol}
          resultVolumeUnit={resultVolumeUnit}
          handleResultVolumeUnitChange={handleResultVolumeUnitChange}
          volumeLabel={volumeLabel}
          tankCapacityLabel={tankCapacityLabel}
          formData={formData}
          toDisplayVolume={toDisplayVolume}
          toDisplayTankCapacity={toDisplayTankCapacity}
          handleChange={handleChange}
          handleTankCapacityUnitChange={handleTankCapacityUnitChange}
          tankCapacityUnit={tankCapacityUnit}
          calculate={calculate}
          error={error}
          result={result}
          formatResultVolume={formatResultVolume}
          resultVolumeLabel={resultVolumeLabel}
        />
      )}

      {mode === 'refuel' && (
        <RefuelPane
          volumeLabel={volumeLabel}
          formData={formData}
          toDisplayVolume={toDisplayVolume}
          handleChange={handleChange}
          refuelGallons={refuelGallons}
          setRefuelGallons={setRefuelGallons}
          refuelAddLabel={refuelAddLabel}
          refuelAddUnit={refuelAddUnit}
          handleRefuelAddUnitChange={handleRefuelAddUnitChange}
          toDisplayRefuelVolume={toDisplayRefuelVolume}
          fromDisplayRefuelVolume={fromDisplayRefuelVolume}
          refuelPumpEthanol={refuelPumpEthanol}
          setRefuelPumpEthanol={setRefuelPumpEthanol}
          calcRefuel={calcRefuel}
          refuelResult={refuelResult}
        />
      )}

      {mode === 'planner' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="surface-card p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-1">Planner Inputs</h2>
              <p className="text-sm text-slate-500 dark:text-gray-400">These are the core values Fuel Planner uses. Set them here first so cost comparisons and trip plans are based on the right tank state.</p>
              <div className="mt-4 rounded-2xl border border-brand-200/70 dark:border-brand-500/20 bg-brand-50/70 dark:bg-brand-500/5 p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InputGroup label={`Fuel Currently In Tank (${volumeLabel})`} name="currentFuel" value={toDisplayVolume(formData.currentFuel)} onChange={handleChange} step="0.1" helpText="How much fuel is in the car right now before you start filling." />
                  <InputGroup label="Current Ethanol %" name="currentE" value={formData.currentE} onChange={handleChange} step="1" helpText="Use the blend you estimate is currently in the tank, like E10 or E30." />
                  <InputGroup label="Target Ethanol %" name="targetE" value={formData.targetE} onChange={handleChange} step="1" helpText="The final blend you want to end up with after the fill." />
                  <TankCapacityInput
                    value={toDisplayTankCapacity(formData.tankSize)}
                    onChange={handleChange}
                    unit={tankCapacityUnit}
                    onUnitChange={handleTankCapacityUnitChange}
                    unitLabel={tankCapacityLabel}
                    helpText="Total usable tank capacity. You can enter this in gallons or litres independently."
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600 dark:text-gray-300">
                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-zinc-950/60 px-3 py-2">
                    Cost compare uses: current tank state above, target blend, pump ethanol, and station prices.
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-zinc-950/60 px-3 py-2">
                    Trip plan uses: current tank state above, target blend, pump ethanol, and number of future tanks.
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-1">Pump Ethanol Calibration</h2>
              <p className="text-sm text-slate-500 dark:text-gray-400">Optional. If you tested the pump with a vial, paste 2-4 readings and Ethos will average them. If you skip this, the planner uses the Pump Ethanol setting from Blend Calculator.</p>
              <div className="flex gap-2 mt-3">
                <input type="text" value={calibrationInput} onChange={e => setCalibrationInput(e.target.value)} className="app-input flex-1 px-3 py-2 text-sm" placeholder="72, 75, 73" />
                <button onClick={handleCalibratePump} className="app-button-primary px-3 py-2 text-xs font-bold">Calibrate</button>
              </div>
              {calibratedPumpE !== null
                ? <p className="text-xs mt-2 text-brand-500 font-semibold">Using calibrated pump ethanol: E{calibratedPumpE}</p>
                : <p className="text-xs mt-2 text-slate-500 dark:text-gray-400">No calibration saved yet. Planner will currently use E{pumpEthanol} from Blend Calculator.</p>}
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-1">Station Presets</h2>
              <p className="text-sm text-slate-500 dark:text-gray-400">Optional. Save a station name plus current E85 and pump-gas prices so the planner can compare fill cost across locations.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                <input type="text" placeholder="Station name" value={stationName} onChange={e => setStationName(e.target.value)} className="app-input px-3 py-2 text-sm" />
                <input type="number" step="0.01" placeholder="E85 $/gal" value={stationE85Price} onChange={e => setStationE85Price(parseFloat(e.target.value) || 0)} className="app-input px-3 py-2 text-sm" />
                <input type="number" step="0.01" placeholder="Pump $/gal" value={stationPumpPrice} onChange={e => setStationPumpPrice(parseFloat(e.target.value) || 0)} className="app-input px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleSaveStation} className="app-button-primary px-3 py-2 text-xs font-bold">Save Station</button>
                <button onClick={runCostOptimization} className="app-button-secondary px-3 py-2 text-xs font-bold">Compare Fill Cost</button>
              </div>
              {stationNames.length > 0 && (
                <div className="mt-3 space-y-2">
                  {stationNames.map(name => (
                    <div key={name} className="surface-inset flex items-center justify-between px-3 py-2">
                      <button onClick={() => handleSelectStation(name)} className="text-sm app-heading">{name}</button>
                      <button
                        onClick={() => {
                          if (!window.confirm(`Delete the station preset "${name}"?`)) return;
                          deleteStationPreset(name);
                          setStationPresets(getStationPresets());
                        }}
                        className="text-red-500"
                        aria-label={`Delete station preset ${name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {selectedStation && <p className="text-xs mt-2 text-slate-500">Using preset: {selectedStation}</p>}
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-1">Trip Planner</h2>
              <p className="text-sm text-slate-500 dark:text-gray-400">Required input: how many future tanks you want to plan. Ethos will use the planner inputs above and the current pump ethanol value to estimate each fill.</p>
              <div className="flex gap-2 mt-3">
                <input type="number" min="1" max="20" value={tankCount} onChange={e => setTankCount(parseInt(e.target.value, 10) || 1)} className="app-input w-24 px-3 py-2 text-sm" />
                <button onClick={runTripPlan} className="app-button-secondary px-3 py-2 text-xs font-bold">Build Plan</button>
              </div>
            </div>
          </div>

          <div className="surface-card p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-gray-100">Fuel Planner Output</h2>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400">Result Unit</span>
                <div className="app-toggle-group">
                  <button
                    onClick={() => handleResultVolumeUnitChange('gal')}
                    className={resultVolumeUnit === 'gal' ? 'app-toggle-option app-toggle-option-active px-3 py-1.5 text-xs font-bold' : 'app-toggle-option px-3 py-1.5 text-xs font-bold'}
                    aria-pressed={resultVolumeUnit === 'gal'}
                  >
                    Gallons
                  </button>
                  <button
                    onClick={() => handleResultVolumeUnitChange('L')}
                    className={resultVolumeUnit === 'L' ? 'app-toggle-option app-toggle-option-active px-3 py-1.5 text-xs font-bold' : 'app-toggle-option px-3 py-1.5 text-xs font-bold'}
                    aria-pressed={resultVolumeUnit === 'L'}
                  >
                    Litres
                  </button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-slate-600 dark:text-gray-300">Current tank: {toDisplayVolume(formData.currentFuel)} {volumeLabel} at E{formData.currentE}</div>
              <div className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-slate-600 dark:text-gray-300">Target / tank size: E{formData.targetE} in a {toDisplayTankCapacity(formData.tankSize)} {tankCapacityLabel} tank</div>
              <div className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-slate-600 dark:text-gray-300">Pump ethanol used: E{plannerPumpEthanol}</div>
              <div className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-slate-600 dark:text-gray-300">Trip length: {tankCount} tank{tankCount === 1 ? '' : 's'}</div>
            </div>
            {fillCostResult?.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400 mb-2 flex items-center gap-1"><CalculatorIcon size={13} /> Cost per Fill</h3>
                <div className="space-y-2">
                  {fillCostResult.map((item, idx) => (
                    <div key={item.name} className={`rounded-xl border px-3 py-2 ${idx === 0 ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-white/10'}`}>
                      <div className="flex justify-between text-sm"><span>{item.name}</span><span className="font-bold">${item.totalCost}</span></div>
                      <p className="text-xs text-slate-500 dark:text-gray-400">E85 {formatResultVolume(item.gallons_of_e85_to_add)} {resultVolumeLabel} + Pump {formatResultVolume(item.gallons_of_93_to_add)} {resultVolumeLabel}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tripPlan.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-gray-400 mb-2 flex items-center gap-1"><Route size={13} /> Next {tankCount} Tanks</h3>
                <div className="space-y-2">
                  {tripPlan.map(item => (
                    <div key={item.tank} className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-sm">
                      <p className="font-semibold">Tank {item.tank}: Add {item.e85Gallons} {resultVolumeLabel} E85</p>
                      <p className="text-xs text-slate-500 dark:text-gray-400">Top off with {item.pumpGallons} {resultVolumeLabel}, resulting ~E{item.resultingE}</p>
                    </div>
                  ))}
                </div>
                {tripSummary && <p className="mt-3 text-sm font-semibold text-brand-500">Total E85 needed: {formatResultVolume(tripSummary.totalE85)} {resultVolumeLabel}</p>}
              </div>
            )}

            {!fillCostResult?.length && !tripPlan.length && (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 py-10 px-6 text-slate-500 dark:text-gray-400">
                <p className="text-sm font-semibold text-slate-700 dark:text-gray-200 mb-3">How to use Fuel Planner</p>
                <ol className="space-y-2 text-sm list-decimal list-inside">
                  <li>Set your current fuel, current ethanol, target ethanol, and tank capacity in Planner Inputs.</li>
                  <li>Optionally calibrate pump ethanol if you tested the fuel.</li>
                  <li>Add station prices if you want a fill-cost comparison.</li>
                  <li>Use Build Plan for upcoming tanks or Compare Fill Cost for station pricing.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const BlendPane = ({ precisionMode, setPrecisionMode, pumpOctane, setPumpOctane, pumpEthanol, setPumpEthanol, resultVolumeUnit, handleResultVolumeUnitChange, volumeLabel, tankCapacityLabel, formData, toDisplayVolume, toDisplayTankCapacity, handleChange, handleTankCapacityUnitChange, tankCapacityUnit, calculate, error, result, formatResultVolume, resultVolumeLabel }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div className="surface-card p-6">
      <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-white/5 pb-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-gray-100">Parameters</h2>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs font-semibold text-slate-500 dark:text-gray-400 block">Precision Mode</span>
            {precisionMode && <span className="text-[10px] text-brand-500 font-bold uppercase tracking-wider">staged fill</span>}
          </div>
          <button
            onClick={() => setPrecisionMode(!precisionMode)}
            className={`relative h-5 w-10 rounded-full transition-colors ${precisionMode ? 'bg-brand-500' : 'bg-slate-200 dark:bg-zinc-700'}`}
            role="switch"
            aria-checked={precisionMode}
            aria-label="Toggle precision mode"
          >
            <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform shadow-sm ${precisionMode ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Pump Octane</span>
        <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
          {[91, 93].map(oct => (
            <button key={oct} onClick={() => setPumpOctane(oct)} className={`px-4 py-1.5 text-xs font-bold transition-colors ${pumpOctane === oct ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`} aria-pressed={pumpOctane === oct}>{oct}</button>
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
            <button key={e} onClick={() => setPumpEthanol(e)} className={`px-4 py-1.5 text-xs font-bold transition-colors ${pumpEthanol === e ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`} aria-pressed={pumpEthanol === e}>E{e}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between mb-6">
        <span className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Result Display Unit</span>
        <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
          <button onClick={() => handleResultVolumeUnitChange('gal')} className={`px-4 py-1.5 text-xs font-bold transition-colors ${resultVolumeUnit === 'gal' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`} aria-pressed={resultVolumeUnit === 'gal'}>Gallons</button>
          <button onClick={() => handleResultVolumeUnitChange('L')} className={`px-4 py-1.5 text-xs font-bold transition-colors ${resultVolumeUnit === 'L' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`} aria-pressed={resultVolumeUnit === 'L'}>Litres</button>
        </div>
      </div>
      <div className="space-y-5">
        <InputGroup label={`Current Fuel in Tank (${volumeLabel})`} name="currentFuel" value={toDisplayVolume(formData.currentFuel)} onChange={handleChange} step="0.1" />
        <InputGroup label="Current Ethanol %" name="currentE" value={formData.currentE} onChange={handleChange} step="1" />
        <InputGroup label="Target Ethanol %" name="targetE" value={formData.targetE} onChange={handleChange} step="1" />
        <TankCapacityInput
          value={toDisplayTankCapacity(formData.tankSize)}
          onChange={handleChange}
          unit={tankCapacityUnit}
          onUnitChange={handleTankCapacityUnitChange}
          unitLabel={tankCapacityLabel}
        />
      </div>
      <button onClick={calculate} className="w-full mt-8 bg-slate-900 dark:bg-brand-500 hover:bg-slate-800 dark:hover:bg-brand-400 text-white py-3 rounded-xl font-bold tracking-wide transition-all flex justify-center items-center gap-2 shadow-sm">CALCULATE BLEND</button>
      {error && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl flex items-start gap-2">
          <AlertTriangle size={14} className="text-red-500 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-300 font-medium">{error}</p>
        </div>
      )}
    </div>

    <div className="surface-card p-6 flex flex-col">
      <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-6 border-b border-slate-100 dark:border-white/5 pb-4">Blend Result</h2>
      {result ? (
        <div className="space-y-5">
          <div className="rounded-xl bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/20 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-gray-400">Add E85</p>
            <p className="text-2xl font-black text-brand-600 dark:text-brand-400">{formatResultVolume(result.e85Gallons)} {resultVolumeLabel}</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-gray-400">Top-off pump gas</p>
            <p className="text-xl font-bold text-slate-800 dark:text-gray-100">{formatResultVolume(result.pumpGallons)} {resultVolumeLabel}</p>
          </div>
          <p className="text-sm text-slate-600 dark:text-gray-300">Resulting blend: <span className="font-bold">E{result.resultingBlend}</span> · Estimated octane: <span className="font-bold">{result.resultingOctane ?? '—'}</span></p>
          {result.warnings?.length > 0 && result.warnings.map(w => <p key={w} className="text-xs text-amber-600 dark:text-amber-400">⚠ {w}</p>)}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-gray-500 text-sm">Enter parameters and calculate to see mix instructions.</div>
      )}
    </div>
  </div>
);

const RefuelPane = ({ volumeLabel, formData, toDisplayVolume, handleChange, refuelGallons, setRefuelGallons, refuelAddLabel, refuelAddUnit, handleRefuelAddUnitChange, toDisplayRefuelVolume, fromDisplayRefuelVolume, refuelPumpEthanol, setRefuelPumpEthanol, calcRefuel, refuelResult }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div className="surface-card p-6">
      <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-4 border-b border-slate-100 dark:border-white/5 pb-4">Refuel Planner</h2>
      <p className="text-sm text-slate-500 dark:text-gray-400 mb-6">"I'm adding X gallons at the pump — what will my blend be?"</p>
      <div className="space-y-5">
        <InputGroup label={`Current Fuel in Tank (${volumeLabel})`} name="currentFuel" value={toDisplayVolume(formData.currentFuel)} onChange={handleChange} step="0.1" />
        <InputGroup label="Current Ethanol %" name="currentE" value={formData.currentE} onChange={handleChange} step="1" />
        <div>
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">{refuelAddUnit === 'L' ? 'Litres Being Added' : 'Gallons Being Added'}</label>
            <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => handleRefuelAddUnitChange('gal')}
                className={`px-3 py-1 text-[11px] font-bold transition-colors ${refuelAddUnit === 'gal' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
                aria-pressed={refuelAddUnit === 'gal'}
              >
                Gallons
              </button>
              <button
                type="button"
                onClick={() => handleRefuelAddUnitChange('L')}
                className={`px-3 py-1 text-[11px] font-bold transition-colors ${refuelAddUnit === 'L' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
                aria-pressed={refuelAddUnit === 'L'}
              >
                Litres
              </button>
            </div>
          </div>
          <input type="number" value={toDisplayRefuelVolume(refuelGallons)} onChange={e => {
            const next = fromDisplayRefuelVolume(e.target.value);
            setRefuelGallons(next === '' ? 0 : next);
          }} step="0.5" className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-white/10 focus:border-brand-400 rounded-xl px-4 py-2.5 text-slate-900 dark:text-gray-100 text-sm outline-none transition-all" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Pump Ethanol %</label>
          <div className="flex gap-2 flex-wrap">
            {[0, 10, 85].map(e => (
              <button key={e} onClick={() => setRefuelPumpEthanol(e)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${refuelPumpEthanol === e ? 'bg-slate-900 dark:bg-brand-500 text-white border-transparent' : 'bg-white dark:bg-zinc-950 border-slate-200 dark:border-white/10 text-slate-500 dark:text-gray-400'}`} aria-pressed={refuelPumpEthanol === e}>E{e}</button>
            ))}
            <input type="number" value={refuelPumpEthanol} onChange={e => setRefuelPumpEthanol(parseFloat(e.target.value) || 0)} min="0" max="85" step="5" className="w-20 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-white/10 focus:border-brand-400 rounded-xl px-3 py-1.5 text-slate-900 dark:text-gray-100 text-xs outline-none" placeholder="Custom" />
          </div>
        </div>
      </div>
      <button onClick={calcRefuel} className="w-full mt-8 bg-slate-900 dark:bg-brand-500 hover:bg-slate-800 dark:hover:bg-brand-400 text-white py-3 rounded-xl font-bold tracking-wide transition-all flex justify-center items-center gap-2"><RotateCcw size={16} /> CALCULATE RESULT</button>
    </div>

    <div className="surface-card p-6 flex flex-col">
      <h2 className="text-base font-bold text-slate-900 dark:text-gray-100 mb-6 border-b border-slate-100 dark:border-white/5 pb-4">Resulting Blend</h2>
      {refuelResult !== null ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-36 h-36 rounded-full border-4 border-brand-500/20 bg-brand-50 dark:bg-brand-500/5 flex flex-col items-center justify-center mb-6">
            <p className="text-4xl font-black text-brand-600 dark:text-brand-400">E{refuelResult}</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">resulting blend</p>
          </div>
          <p className="text-sm text-slate-500 dark:text-gray-400 text-center">Adding {toDisplayRefuelVolume(refuelGallons)} {refuelAddLabel} of E{refuelPumpEthanol} to {toDisplayVolume(formData.currentFuel)} {volumeLabel} of E{formData.currentE}</p>
          <a href="https://www.e85prices.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 mt-6 py-2 px-4 rounded-xl border border-slate-200 dark:border-white/5 text-slate-500 dark:text-gray-400 hover:text-brand-500 hover:border-brand-300 transition-colors text-xs font-medium"><MapPin size={13} /> Find E85 stations near me</a>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-gray-600 space-y-4 py-12"><RotateCcw size={44} className="opacity-40" /><p className="text-sm text-slate-400 dark:text-gray-500">Enter fill details to see resulting blend.</p></div>
      )}
    </div>
  </div>
);

const InputGroup = ({ label, name, value, onChange, step, helpText = null }) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{label}</label>
    <input type="number" name={name} value={value} onChange={onChange} step={step} className="app-input w-full px-4 py-2.5 text-sm" placeholder="0.0" />
    {helpText && <p className="mt-1.5 text-xs text-slate-500 dark:text-gray-400">{helpText}</p>}
  </div>
);

const TankCapacityInput = ({ value, onChange, unit, onUnitChange, unitLabel, helpText = null }) => (
  <div>
    <div className="flex items-center justify-between gap-3 mb-1.5">
      <label className="block text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Tank Capacity ({unitLabel})</label>
      <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
        <button
          type="button"
          onClick={() => onUnitChange('gal')}
          className={`px-3 py-1 text-[11px] font-bold transition-colors ${unit === 'gal' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
          aria-pressed={unit === 'gal'}
        >
          Gallons
        </button>
        <button
          type="button"
          onClick={() => onUnitChange('L')}
          className={`px-3 py-1 text-[11px] font-bold transition-colors ${unit === 'L' ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-white dark:bg-zinc-950 text-slate-500 dark:text-gray-400 hover:bg-slate-50'}`}
          aria-pressed={unit === 'L'}
        >
          Litres
        </button>
      </div>
    </div>
    <input type="number" name="tankSize" value={value} onChange={onChange} step="0.1" className="app-input w-full px-4 py-2.5 text-sm" placeholder="0.0" />
    {helpText && <p className="mt-1.5 text-xs text-slate-500 dark:text-gray-400">{helpText}</p>}
  </div>
);

export default Calculator;
