import prisma from '../src/services/db';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

const manualMetadata: Record<string, { wkn: string; isin: string; country: string }> = {
  'SAP.DE': { isin: 'DE0007164600', wkn: '716460', country: 'Deutschland' },
  'SIE.DE': { isin: 'DE0007236101', wkn: '723610', country: 'Deutschland' },
  'ALV.DE': { isin: 'DE0008404005', wkn: '840400', country: 'Deutschland' },
  'DTE.DE': { isin: 'DE0005557508', wkn: '555750', country: 'Deutschland' },
  'MBG.DE': { isin: 'DE0007100000', wkn: '710000', country: 'Deutschland' },
  'BMW.DE': { isin: 'DE0005190003', wkn: '519000', country: 'Deutschland' },
  'BAS.DE': { isin: 'DE000BASF111', wkn: 'BASF11', country: 'Deutschland' },
  'BAYN.DE': { isin: 'DE000BAY0017', wkn: 'BAY001', country: 'Deutschland' },
  'DBK.DE': { isin: 'DE0005140008', wkn: '514000', country: 'Deutschland' },
  'ADS.DE': { isin: 'DE000A1EWWW0', wkn: 'A1EWWW', country: 'Deutschland' },
  'MUV2.DE': { isin: 'DE0008430026', wkn: '843002', country: 'Deutschland' },
  'IFX.DE': { isin: 'DE0006231004', wkn: '623100', country: 'Deutschland' },
  'EOAN.DE': { isin: 'DE000ENAG999', wkn: 'ENAG99', country: 'Deutschland' },
  'CON.DE': { isin: 'DE0005439004', wkn: '543900', country: 'Deutschland' },
  'DHL.DE': { isin: 'DE0005552004', wkn: '555200', country: 'Deutschland' },
  'AAPL': { isin: 'US0378331005', wkn: '865985', country: 'USA' },
  'MSFT': { isin: 'US5949181045', wkn: '870747', country: 'USA' },
  'NVDA': { isin: 'US67066G1040', wkn: '918422', country: 'USA' },
  'AMZN': { isin: 'US0231351067', wkn: '906866', country: 'USA' },
  'META': { isin: 'US30303M1027', wkn: 'A1JWVX', country: 'USA' },
  'GOOGL': { isin: 'US02079K3059', wkn: 'A14Y6H', country: 'USA' },
  'TSLA': { isin: 'US88160R1014', wkn: 'A1CX3T', country: 'USA' },
  'JPM': { isin: 'US46625H1005', wkn: '850628', country: 'USA' },
  'V': { isin: 'US92826C8394', wkn: 'A0NC7B', country: 'USA' },
  'LLY': { isin: 'US5324571083', wkn: '858567', country: 'USA' },
  'AVGO': { isin: 'US11135F1012', wkn: 'A2JG9Z', country: 'USA' },
  'XOM': { isin: 'US30231G1022', wkn: '852549', country: 'USA' },
  'WMT': { isin: 'US9311421039', wkn: '860853', country: 'USA' },
  'UNH': { isin: 'US91324P1021', wkn: '869561', country: 'USA' },
  'HD': { isin: 'US4370761029', wkn: '866953', country: 'USA' },
};

// Hardcoded correct DAX Ticker symbols and names to prevent column-swapping bugs
const daxConstituents = [
  { symbol: 'ADS.DE', name: 'Adidas AG', sector: 'Bekleidung & Luxusgüter' },
  { symbol: 'AIR.DE', name: 'Airbus SE', sector: 'Luft- & Raumfahrt' },
  { symbol: 'ALV.DE', name: 'Allianz SE', sector: 'Versicherungen' },
  { symbol: 'BAS.DE', name: 'BASF SE', sector: 'Chemie' },
  { symbol: 'BAYN.DE', name: 'Bayer AG', sector: 'Pharma & Chemie' },
  { symbol: 'BEI.DE', name: 'Beiersdorf AG', sector: 'Konsumgüter' },
  { symbol: 'BMW.DE', name: 'Bayerische Motoren Werke AG', sector: 'Automobilhersteller' },
  { symbol: 'BNR.DE', name: 'Brenntag SE', sector: 'Chemievertrieb' },
  { symbol: 'CBK.DE', name: 'Commerzbank AG', sector: 'Banken' },
  { symbol: 'CON.DE', name: 'Continental AG', sector: 'Automobilzulieferer' },
  { symbol: 'DTG.DE', name: 'Daimler Truck Holding AG', sector: 'Nutzfahrzeuge' },
  { symbol: 'DBK.DE', name: 'Deutsche Bank AG', sector: 'Banken' },
  { symbol: 'DB1.DE', name: 'Deutsche Börse AG', sector: 'Finanzdienstleistungen' },
  { symbol: 'DHL.DE', name: 'DHL Group', sector: 'Logistik' },
  { symbol: 'DTE.DE', name: 'Deutsche Telekom AG', sector: 'Telekommunikation' },
  { symbol: 'EOAN.DE', name: 'E.ON SE', sector: 'Versorger' },
  { symbol: 'FRE.DE', name: 'Fresenius SE & Co. KGaA', sector: 'Gesundheitswesen' },
  { symbol: 'FME.DE', name: 'Fresenius Medical Care AG', sector: 'Gesundheitswesen' },
  { symbol: 'G1A.DE', name: 'GEA Group AG', sector: 'Maschinenbau' },
  { symbol: 'HNR1.DE', name: 'Hannover Rück SE', sector: 'Rückversicherungen' },
  { symbol: 'HEI.DE', name: 'Heidelberg Materials AG', sector: 'Baustoffe' },
  { symbol: 'HEN3.DE', name: 'Henkel AG & Co. KGaA', sector: 'Konsumgüter' },
  { symbol: 'IFX.DE', name: 'Infineon Technologies AG', sector: 'Halbleiter' },
  { symbol: 'MBG.DE', name: 'Mercedes-Benz Group AG', sector: 'Automobilhersteller' },
  { symbol: 'MRK.DE', name: 'Merck KGaA', sector: 'Pharma & Chemie' },
  { symbol: 'MTX.DE', name: 'MTU Aero Engines AG', sector: 'Luftfahrtantriebe' },
  { symbol: 'MUV2.DE', name: 'Münchener Rückversicherungs-Gesellschaft AG', sector: 'Versicherungen' },
  { symbol: 'PAH3.DE', name: 'Porsche Automobil Holding SE', sector: 'Automobilholding' },
  { symbol: 'P911.DE', name: 'Dr. Ing. h.c. F. Porsche AG', sector: 'Automobilhersteller' },
  { symbol: 'QIA.DE', name: 'Qiagen N.V.', sector: 'Biotechnologie' },
  { symbol: 'RHM.DE', name: 'Rheinmetall AG', sector: 'Rüstung & Automobil' },
  { symbol: 'RWE.DE', name: 'RWE AG', sector: 'Versorger' },
  { symbol: 'SAP.DE', name: 'SAP SE', sector: 'Software' },
  { symbol: 'G24.DE', name: 'Scout24 SE', sector: 'Online-Marktplätze' },
  { symbol: 'SIE.DE', name: 'Siemens AG', sector: 'Mischkonzern' },
  { symbol: 'ENR.DE', name: 'Siemens Energy AG', sector: 'Energieanlagen' },
  { symbol: 'SHL.DE', name: 'Siemens Healthineers AG', sector: 'Medizintechnik' },
  { symbol: 'SY1.DE', name: 'Symrise AG', sector: 'Duftstoffe & Aromen' },
  { symbol: 'VOW3.DE', name: 'Volkswagen AG', sector: 'Automobilhersteller' },
  { symbol: 'VNA.DE', name: 'Vonovia SE', sector: 'Immobilien' },
  { symbol: 'ZAL.DE', name: 'Zalando SE', sector: 'Online-Handel' }
];

async function main() {
  // Clear existing data to avoid unique constraint violations
  await prisma.watchlistItem.deleteMany({});
  await prisma.stock.deleteMany({});
  await prisma.signalHistory.deleteMany({});
  await prisma.user.deleteMany({});

  // Seed Admin user
  const adminPassword = 'admin123!';
  const passwordHash = hashPassword(adminPassword);
  await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      mustChangePassword: true,
    }
  });
  console.log('Admin user created successfully.');

  // Load S&P 500 constituents from constituents.json
  const constituentsPath = path.resolve(__dirname, 'constituents.json');
  if (!fs.existsSync(constituentsPath)) {
    throw new Error(`Constituents file not found at: ${constituentsPath}`);
  }
  const rawData = fs.readFileSync(constituentsPath, 'utf8');
  const constituents = JSON.parse(rawData);

  // Map DAX (using the hardcoded, corrected list)
  const daxStocks = daxConstituents.map((s: any) => ({
    symbol: s.symbol,
    name: s.name,
    index: 'DAX',
    wkn: manualMetadata[s.symbol]?.wkn || null,
    isin: manualMetadata[s.symbol]?.isin || null,
    country: manualMetadata[s.symbol]?.country || 'Deutschland',
    sector: s.sector || null,
  }));

  // Map S&P 500
  const spStocks = constituents.sp500.map((s: any) => ({
    symbol: s.symbol,
    name: s.name,
    index: 'SP500',
    wkn: manualMetadata[s.symbol]?.wkn || null,
    isin: manualMetadata[s.symbol]?.isin || null,
    country: manualMetadata[s.symbol]?.country || 'USA',
    sector: s.sector || null,
  }));

  const allStocks = [...daxStocks, ...spStocks];
  
  // Deduplicate by symbol just in case
  const uniqueStocks = [];
  const seen = new Set();
  for (const stock of allStocks) {
    if (!seen.has(stock.symbol)) {
      seen.add(stock.symbol);
      uniqueStocks.push(stock);
    }
  }

  console.log(`Seeding ${uniqueStocks.length} stocks...`);

  // Insert all stocks in batches of 50 to optimize SQLite insert speed
  const batchSize = 50;
  for (let i = 0; i < uniqueStocks.length; i += batchSize) {
    const batch = uniqueStocks.slice(i, i + batchSize);
    await Promise.all(
      batch.map(stock => 
        prisma.stock.create({
          data: {
            symbol: stock.symbol,
            name: stock.name,
            index: stock.index,
            price: 0,
            change: 0,
            changePercent: 0,
            peRatio: null,
            rsi: null,
            score: 0,
            signal: 'HOLD',
            reason: 'Seeded. Awaiting first calculation.',
            wkn: stock.wkn,
            isin: stock.isin,
            country: stock.country,
            sector: stock.sector,
          }
        })
      )
    );
  }

  console.log(`Seeded ${uniqueStocks.length} stocks successfully.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
