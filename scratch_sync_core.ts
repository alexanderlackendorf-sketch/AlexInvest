import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { syncStockSignal } from './src/services/yahooFinance';

const coreTickers = [
  'SAP.DE', 'SIE.DE', 'ALV.DE', 'DTE.DE', 'MBG.DE', 'BMW.DE', 'BAS.DE', 'BAYN.DE', 'DBK.DE', 'ADS.DE',
  'MUV2.DE', 'IFX.DE', 'EOAN.DE', 'CON.DE', 'DHL.DE', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META',
  'GOOGL', 'TSLA', 'JPM', 'V', 'LLY', 'AVGO', 'XOM', 'WMT', 'UNH', 'HD'
];

async function run() {
  console.log(`Starting sync for ${coreTickers.length} core stocks...`);
  for (const symbol of coreTickers) {
    try {
      console.log(`Syncing ${symbol}...`);
      await syncStockSignal(symbol);
    } catch (e: any) {
      console.error(`Failed to sync ${symbol}:`, e.message || e);
    }
    // Briefly sleep to be polite
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  console.log('Core sync completed.');
}

run();
