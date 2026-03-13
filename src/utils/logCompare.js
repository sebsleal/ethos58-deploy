export function mergeCompareChartData(analysis, compareAnalysis) {
  if (!analysis || !compareAnalysis) return analysis?.chartData || [];

  const baseMap = {};
  (analysis.chartData || []).forEach(pt => {
    baseMap[pt.time] = { ...pt };
  });

  (compareAnalysis.chartData || []).forEach(pt => {
    if (!baseMap[pt.time]) baseMap[pt.time] = { time: pt.time };
    baseMap[pt.time].afrActual_b = pt.afrActual;
    baseMap[pt.time].boost_b = pt.boost;
  });

  return Object.values(baseMap).sort((a, b) => Number(a.time) - Number(b.time));
}
