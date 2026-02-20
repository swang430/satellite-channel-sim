import { calculateLinkBudget, fitModelToData } from './src/model.js';

const mockData = [
  { rainRate: 5, measuredLoss: 10.2 },
  { rainRate: 10, measuredLoss: 16.5 },
  { rainRate: 20, measuredLoss: 29.8 },
  { rainRate: 30, measuredLoss: 45.1 },
  { rainRate: 40, measuredLoss: 62.0 },
  { rainRate: 50, measuredLoss: 78.5 }
];

const params = {
  freq: 30.0,
  elevation: 40.0,
  env: 'suburban',
  correctionFactor: 1.0
};

console.log("Without correction (k=1.0):");
mockData.forEach(d => {
  const theoretical = calculateLinkBudget({...params, rainRate: d.rainRate, correctionFactor: 1.0}).totalLoss;
  console.log(`Rain: ${d.rainRate} mm/h | Measured: ${d.measuredLoss.toFixed(2)} dB | Theoretical: ${theoretical.toFixed(2)} dB | Error: ${Math.abs(d.measuredLoss - theoretical).toFixed(2)} dB`);
});

const bestFactor = fitModelToData(mockData, params);
console.log(`\nBest Correction Factor found: ${bestFactor.toFixed(3)}`);

console.log("\nWith correction:");
mockData.forEach(d => {
  const theoretical = calculateLinkBudget({...params, rainRate: d.rainRate, correctionFactor: bestFactor}).totalLoss;
  console.log(`Rain: ${d.rainRate} mm/h | Measured: ${d.measuredLoss.toFixed(2)} dB | Theoretical: ${theoretical.toFixed(2)} dB | Error: ${Math.abs(d.measuredLoss - theoretical).toFixed(2)} dB`);
});
