import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { syncStockSignal } from './src/services/yahooFinance';

async function test() {
  console.log('Testing sync for AAPL...');
  try {
    await syncStockSignal('AAPL');
    console.log('AAPL sync completed successfully!');
  } catch (err: any) {
    console.error('Error syncing AAPL:', err.message || err);
    if (err.stack) console.error(err.stack);
  }

  console.log('Testing sync for SAP.DE...');
  try {
    await syncStockSignal('SAP.DE');
    console.log('SAP.DE sync completed successfully!');
  } catch (err: any) {
    console.error('Error syncing SAP.DE:', err.message || err);
    if (err.stack) console.error(err.stack);
  }
}

test();
