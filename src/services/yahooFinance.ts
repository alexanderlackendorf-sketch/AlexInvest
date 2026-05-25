import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import YahooFinanceClass from 'yahoo-finance2';
import prisma from './db';
import { generateGlobalMarketAnalysis, generateStockAnalysis } from './ai';

const yahooFinance = new (YahooFinanceClass as any)();

interface TechnicalIndicators {
  rsi: number;
  sma50: number;
  ema200: number;
}

/**
 * Calculates the Relative Strength Index (RSI) for a series of closing prices
 */
function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50; // Neutral default

  let gains = 0;
  let losses = 0;

  // First values
  for (let i = 1; i <= period; i++) {
    const difference = closes[i] - closes[i - 1];
    if (difference > 0) {
      gains += difference;
    } else {
      losses -= difference;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smoothed averages
  for (let i = period + 1; i < closes.length; i++) {
    const difference = closes[i] - closes[i - 1];
    const currentGain = difference > 0 ? difference : 0;
    const currentLoss = difference < 0 ? -difference : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return Math.round(rsi * 100) / 100;
}

/**
 * Calculates SMA of the last N closes
 */
function calculateSMA(closes: number[], period = 50): number {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const subset = closes.slice(-period);
  const sum = subset.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / period) * 100) / 100;
}

/**
 * Calculates EMA of the last N closes
 */
function calculateEMA(closes: number[], period = 200): number {
  if (closes.length < period) {
    if (closes.length === 0) return 0;
    const sum = closes.reduce((acc, val) => acc + val, 0);
    return sum / closes.length;
  }

  let ema = closes.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  const multiplier = 2 / (period + 1);

  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }

  return Math.round(ema * 100) / 100;
}

/**
 * Fetches historical data and calculates technical indicators
 */
async function getTechnicalIndicators(symbol: string, existingStock?: any, currentPrice = 0): Promise<TechnicalIndicators> {
  const today = new Date();
  const pastDate = new Date();
  // Fetch ~400 calendar days (roughly 275+ trading days) to calculate 200-day EMA safely
  pastDate.setDate(today.getDate() - 400);

  const fallbackPrice = currentPrice > 0 ? currentPrice : (existingStock?.price ?? 0);

  try {
    const history = (await yahooFinance.historical(symbol, {
      period1: pastDate,
      period2: today,
      interval: '1d'
    }, { validateResult: false })) as any[];

    const closes = history.map(h => h.close).filter((c): c is number => typeof c === 'number');

    if (closes.length === 0) {
      return { 
        rsi: existingStock?.rsi ?? 50, 
        sma50: fallbackPrice, 
        ema200: existingStock?.ema200 ?? fallbackPrice 
      };
    }

    const rsi = calculateRSI(closes, 14);
    const sma50 = calculateSMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);

    return { rsi, sma50, ema200 };
  } catch (error) {
    console.error(`Error calculating technicals for ${symbol}:`, error);
    return { 
      rsi: existingStock?.rsi ?? 50, 
      sma50: fallbackPrice, 
      ema200: existingStock?.ema200 ?? fallbackPrice 
    };
  }
}

/**
 * Updates a single stock in the database with the latest quote and calculated signal
 */
/**
 * Cleans Yahoo Finance stock names to get the clean official company name
 */
function cleanStockName(name: string): string {
  if (!name) return '';
  
  let clean = name;
  
  // Remove typische Zusätze wie n.v., N.V., n.v (Namensaktie)
  clean = clean.replace(/\s+n\.v\.?/gi, '');
  
  // Remove Vz., Vz (Vorzugsaktie)
  clean = clean.replace(/\s+Vz\.?/gi, '');
  clean = clean.replace(/\s+Vorzugsaktie\w*/gi, '');
  
  // Remove Class A / B / C
  clean = clean.replace(/\s+Class\s+[A-Z]/gi, '');
  clean = clean.replace(/\s+class\s+[A-Z]/gi, '');
  
  // Remove registering terms
  clean = clean.replace(/\s+-?\s*Register-Aktie\w*/gi, '');
  clean = clean.replace(/\s+-?\s*Inhaber-Aktie\w*/gi, '');

  // Strip trailing double-spaces & clean up
  clean = clean.replace(/\s+/g, ' ').trim();
  
  return clean;
}

export async function syncStockSignal(symbol: string): Promise<void> {
  try {
    const existingStock = await prisma.stock.findUnique({
      where: { symbol }
    });

    // 1. Fetch Quote from Yahoo
    let quote: any = null;
    try {
      quote = (await yahooFinance.quote(symbol, {}, { validateResult: false })) as any;
    } catch (quoteErr) {
      console.warn(`Failed to fetch quote for ${symbol}, using database fallback:`, quoteErr);
    }

    if (!quote && !existingStock) {
      throw new Error(`No quote data and no existing database record for ${symbol}`);
    }

    const rawName = quote?.shortName ?? quote?.longName ?? existingStock?.name ?? symbol;
    const name = cleanStockName(rawName);
    const price = quote?.regularMarketPrice ?? existingStock?.price ?? 0;
    const change = quote?.regularMarketChange ?? existingStock?.change ?? 0;
    const changePercent = quote?.regularMarketChangePercent ?? existingStock?.changePercent ?? 0;
    const peRatio = quote?.trailingPE ?? quote?.forwardPE ?? existingStock?.peRatio ?? null;

    // 2. Fetch Detailed Financials & Summary Metadata
    let sector: string | null = null;
    let country: string | null = null;
    let website: string | null = null;
    let dividendYield: number | null = null;
    let eps: number | null = null;
    let marketCap: number | null = null;
    let operatingMargin = 0.10;
    let revenueGrowth = 0;
    let earningsGrowth = 0;
    let ebitdaMargins = 0;
    let yearlyEarnings: any[] = [];

    // Analyst target fields
    let analystTargetLow: number | null = null;
    let analystTargetHigh: number | null = null;
    let analystTargetMean: number | null = null;
    let analystTargetMedian: number | null = null;
    let analystRecommendation: string | null = null;
    let analystCount: number | null = null;

    // New metrics for professional quantitative model
    let returnOnEquity: number | null = null;
    let returnOnAssets: number | null = null;
    let pegRatio: number | null = null;
    let priceToBook: number | null = null;
    let priceToSales: number | null = null;
    let recommendationMean: number | null = null;
    let fiftyTwoWeekHigh: number | null = null;

    try {
      const summary = (await yahooFinance.quoteSummary(symbol, {
        modules: ['assetProfile', 'financialData', 'defaultKeyStatistics', 'summaryDetail', 'earnings']
      }, { validateResult: false })) as any;

      if (summary) {
        sector = summary.assetProfile?.sector ?? null;
        country = summary.assetProfile?.country ?? null;
        website = summary.assetProfile?.website ?? null;
        dividendYield = summary.summaryDetail?.dividendYield ?? null;
        eps = summary.defaultKeyStatistics?.trailingEps ?? null;
        marketCap = summary.summaryDetail?.marketCap ?? null;
        
        if (summary.financialData) {
          operatingMargin = summary.financialData.operatingMargins ?? 0.10;
          revenueGrowth = summary.financialData.revenueGrowth ?? 0;
          earningsGrowth = summary.financialData.earningsGrowth ?? 0;
          ebitdaMargins = summary.financialData.ebitdaMargins ?? 0;

          analystTargetLow = summary.financialData.targetLowPrice ?? null;
          analystTargetHigh = summary.financialData.targetHighPrice ?? null;
          analystTargetMean = summary.financialData.targetMeanPrice ?? null;
          analystTargetMedian = summary.financialData.targetMedianPrice ?? null;
          analystRecommendation = summary.financialData.recommendationKey ?? null;
          analystCount = summary.financialData.numberOfAnalystOpinions ?? null;

          // New metrics
          returnOnEquity = summary.financialData.returnOnEquity ?? null;
          returnOnAssets = summary.financialData.returnOnAssets ?? null;
          recommendationMean = summary.financialData.recommendationMean ?? null;
        }

        if (summary.defaultKeyStatistics) {
          pegRatio = summary.defaultKeyStatistics.pegRatio ?? null;
          priceToBook = summary.defaultKeyStatistics.priceToBook ?? null;
        }

        if (summary.summaryDetail) {
          fiftyTwoWeekHigh = summary.summaryDetail.fiftyTwoWeekHigh ?? null;
          priceToSales = summary.summaryDetail.priceToSalesTrailing12Months ?? null;
        }
        
        // Fallback for fiftyTwoWeekHigh from quote if summaryDetail is missing
        if (!fiftyTwoWeekHigh && quote?.fiftyTwoWeekHigh) {
          fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh;
        }

        if (summary.earnings?.financialsChart?.yearly) {
          yearlyEarnings = summary.earnings.financialsChart.yearly;
        }
      }
    } catch (err) {
      console.warn(`Could not fetch details summary for ${symbol}:`, err);
    }
    // 3. Fetch Technicals
    const technicals = await getTechnicalIndicators(symbol, existingStock, price);
    const rsi = technicals.rsi;
    const sma50 = technicals.sma50;
    const ema200 = technicals.ema200;

    // 4. Calculate 1-Year Performance
    let yearPerformance = 0;
    try {
      const today = new Date();
      const pastDate = new Date();
      pastDate.setDate(today.getDate() - 380); // Fetch ~380 days to safely cover 252 trading days

      const history = (await yahooFinance.historical(symbol, {
        period1: pastDate,
        period2: today,
        interval: '1d'
      }, { validateResult: false })) as any[];

      const validCloses = history
        .map(h => h.close)
        .filter((c): c is number => typeof c === 'number');

      if (validCloses.length >= 2) {
        const currentPrice = price > 0 ? price : validCloses[validCloses.length - 1];
        const oneYearAgoIndex = Math.max(0, validCloses.length - 252);
        const priceOneYearAgo = validCloses[oneYearAgoIndex] || validCloses[0];
        if (priceOneYearAgo > 0) {
          yearPerformance = ((currentPrice - priceOneYearAgo) / priceOneYearAgo) * 100;
        }
      }
    } catch (err) {
      console.warn(`Could not calculate year performance for ${symbol}:`, err);
    }

    // 5. Calculate 10-Bar Scores (for compatibility with existing model fields)
    let revenueGrowthScore = 4;
    if (revenueGrowth >= 0.25) revenueGrowthScore = 10;
    else if (revenueGrowth >= 0.20) revenueGrowthScore = 9;
    else if (revenueGrowth >= 0.15) revenueGrowthScore = 8;
    else if (revenueGrowth >= 0.10) revenueGrowthScore = 7;
    else if (revenueGrowth >= 0.05) revenueGrowthScore = 6;
    else if (revenueGrowth >= 0.02) revenueGrowthScore = 5;
    else if (revenueGrowth >= 0.00) revenueGrowthScore = 4;
    else if (revenueGrowth >= -0.05) revenueGrowthScore = 3;
    else if (revenueGrowth >= -0.15) revenueGrowthScore = 2;
    else revenueGrowthScore = 1;

    let earningsGrowthScore = 5;
    if (earningsGrowth >= 0.30) earningsGrowthScore = 10;
    else if (earningsGrowth >= 0.20) earningsGrowthScore = 9;
    else if (earningsGrowth >= 0.15) earningsGrowthScore = 8;
    else if (earningsGrowth >= 0.10) earningsGrowthScore = 7;
    else if (earningsGrowth >= 0.05) earningsGrowthScore = 6;
    else if (earningsGrowth >= 0.00) earningsGrowthScore = 5;
    else if (earningsGrowth >= -0.05) earningsGrowthScore = 4;
    else if (earningsGrowth >= -0.15) earningsGrowthScore = 3;
    else if (earningsGrowth >= -0.30) earningsGrowthScore = 2;
    else earningsGrowthScore = 1;

    let ebitdaMarginScore = 5;
    if (ebitdaMargins >= 0.35) ebitdaMarginScore = 10;
    else if (ebitdaMargins >= 0.30) ebitdaMarginScore = 9;
    else if (ebitdaMargins >= 0.25) ebitdaMarginScore = 8;
    else if (ebitdaMargins >= 0.20) ebitdaMarginScore = 7;
    else if (ebitdaMargins >= 0.15) ebitdaMarginScore = 6;
    else if (ebitdaMargins >= 0.10) ebitdaMarginScore = 5;
    else if (ebitdaMargins >= 0.05) ebitdaMarginScore = 4;
    else if (ebitdaMargins >= 0.02) ebitdaMarginScore = 3;
    else if (ebitdaMargins >= 0.00) ebitdaMarginScore = 2;
    else ebitdaMarginScore = 1;

    // 6. Calculate Signals & Scores (Professional-Grade 4-Pillar Model)
    const sign = (symbol.endsWith('.DE') || symbol.endsWith('.SG')) ? '€' : '$';
    const analysisBlocks: string[] = [];

    // --- Pillar 1: Momentum & Trend (Max 25 pts) ---
    let technicalScore = 0;
    const techAnalysis: string[] = [];
    
    // SMA50 & EMA200 Alignment (Max 12 pts)
    if (sma50 > 0 && ema200 > 0) {
      if (price > sma50 && sma50 > ema200) {
        technicalScore += 12;
        techAnalysis.push(`Die Aktie befindet sich in einem starken, etablierten Aufwärtstrend. Der Kurs notiert über der 50-Tage-Linie (${sma50.toFixed(2)} ${sign}), welche wiederum über der 200-Tage-Linie (${ema200.toFixed(2)} ${sign}) verläuft (bullische Ausrichtung).`);
      } else if (price > ema200) {
        technicalScore += 8;
        techAnalysis.push(`Der Kurs notiert über dem langfristigen 200-Tage-Durchschnitt (${ema200.toFixed(2)} ${sign}), was einen übergeordneten Aufwärtstrend bestätigt, wenngleich kurzfristige Dynamik-Abschwächungen vorliegen.`);
      } else if (price > sma50) {
        technicalScore += 4;
        techAnalysis.push(`Die Aktie notiert über der kurzfristigen 50-Tage-Linie (${sma50.toFixed(2)} ${sign}), befindet sich jedoch unter der langfristigen 200-Tage-Linie. Dies deutet auf eine potenzielle kurzfristige Bodenbildung hin.`);
      } else {
        technicalScore += 0;
        techAnalysis.push(`Die Aktie befindet sich in einem etablierten Abwärtstrend. Der Kurs notiert sowohl unter dem 50-Tage- (${sma50.toFixed(2)} ${sign}) als auch unter dem 200-Tage-Durchschnitt (${ema200.toFixed(2)} ${sign}) (bärische Ausrichtung).`);
      }
    } else {
      technicalScore += 6;
      techAnalysis.push(`Aufgrund unzureichender historischer Kursdaten konnte kein vollständiger Gleitender Durchschnitt berechnet werden.`);
    }

    // RSI (Max 6 pts)
    if (rsi !== null) {
      if (rsi < 30) {
        technicalScore += 6;
        techAnalysis.push(`Der Relative-Strength-Index (RSI 14) liegt im überverkauften Bereich (${rsi.toFixed(1)}), was kurzfristig Rebound-Potenzial signalisiert.`);
      } else if (rsi >= 30 && rsi < 45) {
        technicalScore += 4;
        techAnalysis.push(`Der RSI (14) signalisiert mit einem Wert von ${rsi.toFixed(1)} eine gesunde Abkühlung und nähert sich dem überverkauften Zustand.`);
      } else if (rsi >= 45 && rsi <= 70) {
        technicalScore += 5;
        techAnalysis.push(`Mit einem RSI von ${rsi.toFixed(1)} zeigt die Aktie ein stabiles, neutral-bullisches Momentum.`);
      } else {
        technicalScore += 1;
        techAnalysis.push(`Der RSI liegt bei ${rsi.toFixed(1)} im überkauften Bereich, was die Gefahr eines kurzfristigen Rücksetzers erhöht.`);
      }
    } else {
      technicalScore += 4;
    }

    // Distance to 52-Week High (Max 7 pts)
    if (fiftyTwoWeekHigh && fiftyTwoWeekHigh > 0) {
      const distToHigh = (fiftyTwoWeekHigh - price) / fiftyTwoWeekHigh;
      if (distToHigh <= 0.08) {
        technicalScore += 7;
        techAnalysis.push(`Mit nur ${(distToHigh * 100).toFixed(1)}% Abstand zum 52-Wochen-Hoch (${fiftyTwoWeekHigh.toFixed(2)} ${sign}) zeigt die Aktie eine hervorragende relative Stärke und starkes Momentum.`);
      } else if (distToHigh <= 0.20) {
        technicalScore += 5;
        techAnalysis.push(`Die Aktie notiert moderat unter ihrem 52-Wochen-Hoch (Abstand: ${(distToHigh * 100).toFixed(1)}%).`);
      } else if (distToHigh <= 0.40) {
        technicalScore += 3;
        techAnalysis.push(`Der Kurs liegt deutlich unter dem 52-Wochen-Hoch (Abstand: ${(distToHigh * 100).toFixed(1)}%), was auf eine stärkere Korrektur hindeutet.`);
      } else {
        technicalScore += 1;
        techAnalysis.push(`Die Aktie hat über 40% an Wert vom 52-Wochen-Hoch verloren, was auf einen schwer beschädigten Trend hindeutet.`);
      }
    } else {
      technicalScore += 4;
    }
    analysisBlocks.push(`Trend & Momentum (Score: ${technicalScore}/25):\n${techAnalysis.join(' ')}`);

    // --- Pillar 2: Growth & Quality (Max 25 pts) ---
    let growthScore = 0;
    const growthAnalysis: string[] = [];

    // ROE & ROA (Max 8 pts)
    let roeScore = 4;
    if (returnOnEquity !== null || returnOnAssets !== null) {
      const roe = returnOnEquity ?? 0;
      const roa = returnOnAssets ?? 0;
      if (roe > 0.18 || roa > 0.10) {
        roeScore = 8;
        growthAnalysis.push(`Das Unternehmen weist eine hervorragende Kapitalrendite auf (Eigenkapitalrendite: ${(roe * 100).toFixed(1)}%, Gesamtkapitalrendite: ${(roa * 100).toFixed(1)}%), was auf eine hohe operative Qualität und Kapitaleffizienz hindeutet.`);
      } else if (roe > 0.10 || roa > 0.06) {
        roeScore = 6;
        growthAnalysis.push(`Die Rentabilität liegt auf einem soliden, überdurchschnittlichen Niveau (Eigenkapitalrendite: ${(roe * 100).toFixed(1)}%).`);
      } else if (roe > 0.05 || roa > 0.03) {
        roeScore = 4;
        growthAnalysis.push(`Die Rentabilitätskennzahlen sind moderat (Eigenkapitalrendite: ${(roe * 100).toFixed(1)}%).`);
      } else if (roe > 0.00) {
        roeScore = 2;
        growthAnalysis.push(`Das Unternehmen ist knapp profitabel, zeigt aber eine geringe Rentabilität des eingesetzten Kapitals.`);
      } else {
        roeScore = 0;
        growthAnalysis.push(`Das Unternehmen verzeichnet eine negative Eigenkapitalrendite (${(roe * 100).toFixed(1)}%), was auf Verluste hindeutet.`);
      }
    } else {
      growthAnalysis.push(`Keine ausreichenden Daten zur Kapitalrendite (ROE/ROA) vorhanden.`);
    }
    growthScore += roeScore;

    // EBITDA / Operating Margin (Max 7 pts)
    let marginScore = 3;
    if (ebitdaMargins > 0 || operatingMargin > 0) {
      if (ebitdaMargins > 0.25 || operatingMargin > 0.20) {
        marginScore = 7;
        growthAnalysis.push(`Die operativen Margen sind exzellent (EBITDA-Marge: ${(ebitdaMargins * 100).toFixed(1)}%, operative Marge: ${(operatingMargin * 100).toFixed(1)}%), was für eine starke Preissetzungsmacht spricht.`);
      } else if (ebitdaMargins > 0.15 || operatingMargin > 0.12) {
        marginScore = 5;
        growthAnalysis.push(`Die operativen Margen sind mit einer EBITDA-Marge von ${(ebitdaMargins * 100).toFixed(1)}% auf einem gesunden Niveau.`);
      } else if (ebitdaMargins > 0.08 || operatingMargin > 0.05) {
        marginScore = 3;
        growthAnalysis.push(`Die Margen sind moderat (EBITDA-Marge: ${(ebitdaMargins * 100).toFixed(1)}%).`);
      } else if (ebitdaMargins > 0.00) {
        marginScore = 1;
        growthAnalysis.push(`Die Marge ist sehr dünn, was das Unternehmen anfällig für Kostensteigerungen macht.`);
      } else {
        marginScore = 0;
        growthAnalysis.push(`Das Unternehmen operiert mit einer negativen Marge (EBITDA-Marge: ${(ebitdaMargins * 100).toFixed(1)}%).`);
      }
    } else {
      growthAnalysis.push(`Keine ausreichenden Margendaten verfügbar.`);
    }
    growthScore += marginScore;

    // Revenue Growth (Max 5 pts)
    let revScore = 2;
    if (yearlyEarnings.length >= 2) {
      let sumGrowth = 0;
      let countGrowth = 0;
      for (let i = 1; i < yearlyEarnings.length; i++) {
        const prev = yearlyEarnings[i - 1].revenue;
        const curr = yearlyEarnings[i].revenue;
        if (prev > 0) {
          sumGrowth += (curr - prev) / prev;
          countGrowth++;
        }
      }
      const cagr = countGrowth > 0 ? (sumGrowth / countGrowth) : 0;
      const combinedRevGrowth = (cagr * 0.5) + (revenueGrowth * 0.5);

      if (combinedRevGrowth >= 0.15) revScore = 5;
      else if (combinedRevGrowth >= 0.07) revScore = 4;
      else if (combinedRevGrowth >= 0.02) revScore = 2;
      else if (combinedRevGrowth >= 0.00) revScore = 1;
      else revScore = 0;
      
      growthAnalysis.push(`Das kombinierte Umsatzwachstum liegt bei ${(combinedRevGrowth * 100).toFixed(1)}% p.a.`);
    } else {
      if (revenueGrowth >= 0.15) revScore = 5;
      else if (revenueGrowth >= 0.07) revScore = 4;
      else if (revenueGrowth >= 0.02) revScore = 2;
      else if (revenueGrowth >= 0.00) revScore = 1;
      else revScore = 0;
      
      growthAnalysis.push(`Das aktuelle Umsatzwachstum liegt bei ${(revenueGrowth * 100).toFixed(1)}%.`);
    }
    growthScore += revScore;

    // Earnings Growth (Max 5 pts)
    let earnScore = 2;
    if (yearlyEarnings.length >= 2) {
      let sumGrowth = 0;
      let countGrowth = 0;
      for (let i = 1; i < yearlyEarnings.length; i++) {
        const prev = yearlyEarnings[i - 1].earnings;
        const curr = yearlyEarnings[i].earnings;
        if (prev > 0) {
          sumGrowth += (curr - prev) / prev;
          countGrowth++;
        }
      }
      const cagr = countGrowth > 0 ? (sumGrowth / countGrowth) : 0;
      const combinedEarnGrowth = (cagr * 0.5) + (earningsGrowth * 0.5);

      if (combinedEarnGrowth >= 0.20) earnScore = 5;
      else if (combinedEarnGrowth >= 0.08) earnScore = 4;
      else if (combinedEarnGrowth >= 0.00) earnScore = 2;
      else earnScore = 0;

      growthAnalysis.push(`Das Gewinnwachstum beträgt ${(combinedEarnGrowth * 100).toFixed(1)}% p.a.`);
    } else {
      if (earningsGrowth >= 0.20) earnScore = 5;
      else if (earningsGrowth >= 0.08) earnScore = 4;
      else if (earningsGrowth >= 0.00) earnScore = 2;
      else earnScore = 0;

      growthAnalysis.push(`Das aktuelle Gewinnwachstum beträgt ${(earningsGrowth * 100).toFixed(1)}%.`);
    }
    growthScore += earnScore;

    analysisBlocks.push(`Wachstum & Qualität (Score: ${growthScore}/25):\n${growthAnalysis.join(' ')}`);

    // --- Pillar 3: Valuation & Value (Max 25 pts) ---
    let valuationScore = 0;
    const valAnalysis: string[] = [];
    let isScaleEnabled = false;

    // P/E and Forward P/E (Max 10 pts)
    let peScore = 0;
    if (peRatio === null || peRatio <= 0) {
      // Unprofitable or missing P/E - Fallback to P/S or P/B (Growth stock friendly)
      const ps = priceToSales ?? 0;
      const pb = priceToBook ?? 0;
      if ((ps > 0 && ps < 2.0) || (pb > 0 && pb < 2.0)) {
        peScore = 6;
        valAnalysis.push(`Aufgrund negativer Erträge liegt kein KGV vor. Die Aktie ist jedoch auf Basis des Umsatzes/Buchwertes moderat bewertet (KUV/KBV < 2).`);
      } else if ((ps > 0 && ps < 5.0) || (pb > 0 && pb < 5.0)) {
        peScore = 4;
        valAnalysis.push(`Kein KGV vorhanden. Die Bewertung bezogen auf Umsatz/Buchwert liegt im moderaten Rahmen (KUV/KBV < 5).`);
      } else {
        peScore = 1;
        valAnalysis.push(`Kein KGV vorhanden und die Bewertung bezogen auf KUV/KBV ist hoch, was auf eine Wachstumsprämie hindeutet.`);
      }
    } else {
      const fwdPe = quote?.forwardPE ?? peRatio;
      if (peRatio < 15 || fwdPe < 12) {
        peScore = 10;
        valAnalysis.push(`Die Aktie ist mit einem KGV von ${peRatio.toFixed(1)} (bzw. Forward-KGV von ${fwdPe.toFixed(1)}) fundamental sehr günstig bewertet (Value-Profil).`);
      } else if (peRatio <= 25 || fwdPe <= 20) {
        peScore = 7;
        valAnalysis.push(`Das KGV von ${peRatio.toFixed(1)} liegt auf einem fairen, marktüblichen Niveau.`);
      } else if (peRatio <= 40 || fwdPe <= 30) {
        peScore = 4;
        valAnalysis.push(`Mit einem KGV von ${peRatio.toFixed(1)} ist die Aktie bereits ambitioniert bewertet.`);
      } else {
        peScore = 1;
        valAnalysis.push(`Die Aktie ist mit einem KGV von ${peRatio.toFixed(1)} sehr teuer bewertet.`);
      }
    }
    valuationScore += peScore;

    // PEG Ratio (Max 8 pts) with Dynamic Scaling if missing
    let pegScore = 0;
    if (pegRatio !== null && pegRatio > 0) {
      if (pegRatio < 1.0) {
        pegScore = 8;
        valAnalysis.push(`Das PEG-Verhältnis (KGV/Wachstum) ist mit ${pegRatio.toFixed(2)} hervorragend (< 1.0), was die Bewertung durch das Wachstum rechtfertigt.`);
      } else if (pegRatio <= 1.5) {
        pegScore = 6;
        valAnalysis.push(`Das PEG-Verhältnis von ${pegRatio.toFixed(2)} ist solide und zeigt eine angemessene Wachstumsbewertung.`);
      } else if (pegRatio <= 2.5) {
        pegScore = 3;
        valAnalysis.push(`Das PEG-Verhältnis von ${pegRatio.toFixed(2)} ist erhöht, das Wachstum deckt die Bewertung nur teilweise.`);
      } else {
        pegScore = 1;
        valAnalysis.push(`Mit einem PEG-Verhältnis von ${pegRatio.toFixed(2)} ist die Aktie gemessen am Wachstum überbewertet.`);
      }
      valuationScore += pegScore;
    } else {
      isScaleEnabled = true;
      valAnalysis.push(`Ein PEG-Verhältnis liegt für dieses Wertpapier nicht vor.`);
    }

    // Dividend / Cash Flow Yield (Max 7 pts)
    let divScore = 0;
    if (dividendYield && dividendYield > 0) {
      if (dividendYield > 0.04) {
        divScore = 7;
        valAnalysis.push(`Die Dividendenrendite ist mit ${(dividendYield * 100).toFixed(1)}% sehr attraktiv und bietet einen starken Puffer.`);
      } else if (dividendYield >= 0.02) {
        divScore = 5;
        valAnalysis.push(`Die Dividendenrendite ist mit ${(dividendYield * 100).toFixed(1)}% auf einem soliden Niveau.`);
      } else {
        divScore = 3;
        valAnalysis.push(`Das Unternehmen zahlt eine geringe Dividende von ${(dividendYield * 100).toFixed(1)}%.`);
      }
    } else {
      if (operatingMargin > 0.15) {
        divScore = 4;
        valAnalysis.push(`Es wird keine Dividende gezahlt, jedoch belegt die hohe operative Marge von ${(operatingMargin * 100).toFixed(1)}%, dass das Unternehmen erhebliche Mittel generiert und reinvestiert.`);
      } else {
        divScore = 0;
        valAnalysis.push(`Es wird keine Dividende gezahlt und die Cashflow-Generierung ist gering.`);
      }
    }
    valuationScore += divScore;

    // Apply Dynamic Scaling if PEG was missing (to reach max 25 points fairly)
    if (isScaleEnabled) {
      const scaledPE = Math.min(15, peScore * 1.5);
      const scaledDiv = Math.min(10, divScore * 1.4);
      valuationScore = Math.round(scaledPE + scaledDiv);
      valAnalysis.push(`(Aufgrund fehlender PEG-Daten wurden KGV und Dividendenstärke gewichtet hochskaliert)`);
    }

    analysisBlocks.push(`Bewertung & Dividende (Score: ${valuationScore}/25):\n${valAnalysis.join(' ')}`);

    // --- Pillar 4: Analyst Sentiment (Max 25 pts) ---
    let analystScore = 0;
    const analystAnalysis: string[] = [];

    // Target Upside (Max 12 pts)
    let upsideScore = 6;
    if (analystTargetMean && analystTargetMean > 0 && price > 0) {
      const upside = (analystTargetMean - price) / price;
      if (upside >= 0.25) {
        upsideScore = 12;
        analystAnalysis.push(`Die Konsens-Schätzung der Experten impliziert ein überragendes Kurspotenzial von +${(upside * 100).toFixed(1)}% bis zum mittleren Kursziel (${analystTargetMean.toFixed(2)} ${sign}).`);
      } else if (upside >= 0.10) {
        upsideScore = 9;
        analystAnalysis.push(`Die Experten prognostizieren ein solides Aufwärtspotenzial von +${(upside * 100).toFixed(1)}% bis zum mittleren Kursziel (${analystTargetMean.toFixed(2)} ${sign}).`);
      } else if (upside >= 0.00) {
        upsideScore = 6;
        analystAnalysis.push(`Der Kurs notiert nahe am Konsensziel der Analysten (Kurspotenzial: +${(upside * 100).toFixed(1)}%).`);
      } else if (upside >= -0.10) {
        upsideScore = 3;
        analystAnalysis.push(`Der Kurs ist dem Analysten-Konsens leicht vorausgeeilt (Potenzial: ${(upside * 100).toFixed(1)}%). Korrekturen sind kurzfristig möglich.`);
      } else {
        upsideScore = 0;
        analystAnalysis.push(`Der Kurs notiert deutlich über dem Expertenziel (Abwärtspotenzial: ${(upside * 100).toFixed(1)}%). Die Aktie wird von Analysten als überbewertet eingestuft.`);
      }
    } else {
      analystAnalysis.push(`Es liegen keine Analysten-Kursziele vor.`);
    }
    analystScore += upsideScore;

    // Recommendation Mean Score (Max 8 pts)
    let recScore = 4;
    if (recommendationMean !== null && recommendationMean > 0) {
      if (recommendationMean <= 2.0) {
        recScore = 8;
        analystAnalysis.push(`Das aggregierte Experten-Votum lautet auf KAUFEN (Rating: ${recommendationMean.toFixed(2)}/5).`);
      } else if (recommendationMean <= 2.7) {
        recScore = 6;
        analystAnalysis.push(`Die Analysten stufen die Aktie mehrheitlich positiv ein (Rating: ${recommendationMean.toFixed(2)}/5).`);
      } else if (recommendationMean <= 3.3) {
        recScore = 4;
        analystAnalysis.push(`Der Analysten-Konsens lautet auf HALTEN (Rating: ${recommendationMean.toFixed(2)}/5).`);
      } else if (recommendationMean <= 4.0) {
        recScore = 1;
        analystAnalysis.push(`Die Experten stufen die Aktie als unterdurchschnittlich ein (Rating: ${recommendationMean.toFixed(2)}/5).`);
      } else {
        recScore = 0;
        analystAnalysis.push(`Die Experten raten mehrheitlich zum VERKAUF (Rating: ${recommendationMean.toFixed(2)}/5).`);
      }
    } else if (analystRecommendation) {
      const rec = analystRecommendation.toLowerCase();
      if (['strong_buy', 'strong buy'].some(k => rec.includes(k))) {
        recScore = 8;
        analystAnalysis.push(`Das aggregierte Experten-Votum lautet auf "Strong Buy".`);
      } else if (['buy', 'outperform'].some(k => rec.includes(k))) {
        recScore = 6;
        analystAnalysis.push(`Die Analystengemeinschaft empfiehlt die Aktie zum Kauf ("Buy").`);
      } else if (rec.includes('hold')) {
        recScore = 4;
        analystAnalysis.push(`Der Konsens lautet auf "Hold" (Halten).`);
      } else if (rec.includes('underperform')) {
        recScore = 1;
        analystAnalysis.push(`Die Experten stufen die Aktie als "Underperform" ein.`);
      } else {
        recScore = 0;
        analystAnalysis.push(`Der Konsens rät zum Verkauf ("Sell").`);
      }
    } else {
      analystAnalysis.push(`Es liegen keine Konsensempfehlungen vor.`);
    }
    analystScore += recScore;

    // Analyst Coverage / Count (Max 5 pts)
    let coverageScore = 0;
    if (analystCount !== null && analystCount > 0) {
      if (analystCount >= 12) {
        coverageScore = 5;
        analystAnalysis.push(`Die Aktie wird von sehr vielen Analysten (${analystCount}) gecovert, was eine hohe Verlässlichkeit der Konsensschätzung bedeutet.`);
      } else if (analystCount >= 4) {
        coverageScore = 3;
        analystAnalysis.push(`Mit ${analystCount} Analystenschätzungen ist die Abdeckung solide.`);
      } else {
        coverageScore = 1;
        analystAnalysis.push(`Die Aktie wird nur von wenigen Analysten (${analystCount}) beobachtet.`);
      }
    } else {
      analystAnalysis.push(`Es liegt keine Analystenabdeckung vor.`);
    }
    analystScore += coverageScore;

    analysisBlocks.push(`Experten-Konsens & Stimmung (Score: ${analystScore}/25):\n${analystAnalysis.join(' ')}`);

    // --- Final Score & Signal calculation ---
    const score = Math.min(100, Math.max(0, technicalScore + growthScore + valuationScore + analystScore));
    let signal = 'HOLD';
    if (score >= 60) {
      signal = 'BUY';
    } else if (score < 40) {
      signal = 'SELL';
    }

    // Conclusion paragraph
    let conclusion = '';
    if (signal === 'BUY') {
      conclusion = `Gesamtbewertung:\nIn der Gesamtschau ergibt sich aufgrund des intakten Aufwärtstrends und der überzeugenden fundamentalen Qualität ein klares Kaufsignal (BUY) mit einem Pro Score von ${score} von 100 Punkten.`;
    } else if (signal === 'SELL') {
      conclusion = `Gesamtbewertung:\nAufgrund charttechnischer Schwäche und/oder einer unzureichenden operativen Ertragslage bzw. Überbewertung ergibt sich ein Verkaufssignal (SELL) mit einem Pro Score von lediglich ${score} Punkten.`;
    } else {
      conclusion = `Gesamtbewertung:\nDie Aktie zeigt ein ausgeglichenes Profil aus Chancen und Risiken. Sowohl die Bewertung als auch der Trend rechtfertigen derzeit eine Halte-Empfehlung (HOLD) mit einem Pro Score von ${score} Punkten.`;
    }
    analysisBlocks.push(conclusion);

    const reason = analysisBlocks.join('\n\n');

    // 7. Save to Stock Database (preserving pre-seeded metadata if null)
    await prisma.stock.update({
      where: { symbol },
      data: {
        name,
        price,
        change,
        changePercent,
        peRatio,
        rsi,
        ema200,
        score,
        scoreTrend: technicalScore,
        scoreGrowth: growthScore,
        scoreValuation: valuationScore,
        scoreSentiment: analystScore,
        signal,
        reason,
        analystTargetLow,
        analystTargetHigh,
        analystTargetMean,
        analystTargetMedian,
        analystRecommendation,
        analystCount,
        sector: sector || undefined,
        country: country ? country : undefined, 
        eps,
        dividendYield,
        marketCap,
        yearPerformance,
        revenueGrowthScore,
        earningsGrowthScore,
        ebitdaMarginScore,
        website: website || undefined
      }
    });

    // 8. Append to history if signal changed or no history exists for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingHistory = await prisma.signalHistory.findFirst({
      where: {
        symbol,
        date: {
          gte: today
        }
      }
    });

    if (!existingHistory) {
      const lastHistory = await prisma.signalHistory.findFirst({
        where: { symbol },
        orderBy: { date: 'desc' }
      });

      if (!lastHistory || lastHistory.signal !== signal) {
        await prisma.signalHistory.create({
          data: {
            symbol,
            signal,
            score
          }
        });
      }
    }
  } catch (error) {
    console.error(`Failed to sync stock ${symbol}:`, error);
    throw error;
  }
}

/**
 * Syncs all stocks in the database
 */
export async function syncAllStocks(): Promise<void> {
  const stocks = await prisma.stock.findMany({ select: { symbol: true } });
  console.log(`Starting sync for ${stocks.length} stocks...`);
  
  // Fetch in batches to be gentle on Yahoo Finance API
  const batchSize = 3;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batch = stocks.slice(i, i + batchSize);
    await Promise.all(
      batch.map(stock => 
        syncStockSignal(stock.symbol).catch(e => {
          console.error(`Failed batch sync for ${stock.symbol}:`, e.message);
        })
      )
    );
    // Pause briefly between batches
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  console.log('Stock sync finished.');
}

export async function syncGlobalMarketAnalysis(): Promise<void> {
  try {
    console.log('Starting sync for global market AI analysis...');
    // 1. Fetch VIX index
    let vixValue: number | null = null;
    try {
      const vixQuote = await yahooFinance.quote('^VIX') as any;
      if (vixQuote && vixQuote.regularMarketPrice) {
        vixValue = vixQuote.regularMarketPrice;
      } else {
        vixValue = 16.42; // Realistischer VIX-Mittelwert als Fallback
      }
    } catch (vixErr) {
      console.warn('Failed to fetch VIX price, using fallback:', vixErr);
      vixValue = 16.42; // Realistischer VIX-Mittelwert als Fallback
    }

    // 2. Fetch some general headlines from SPY search
    let headlines: string[] = [];
    try {
      const searchResult = await yahooFinance.search('SPY', { newsCount: 10 });
      if (searchResult.news && searchResult.news.length > 0) {
        headlines = searchResult.news.map((item: any) => item.title).filter(Boolean);
      }
    } catch (newsErr) {
      console.warn('Failed to fetch general market news headlines:', newsErr);
    }

    // 3. Call Gemini
    const analysis = await generateGlobalMarketAnalysis(vixValue, headlines);

    // 4. Save to DB (overwrite existing or create first)
    const existing = await prisma.marketAnalysis.findFirst();
    if (existing) {
      await prisma.marketAnalysis.update({
        where: { id: existing.id },
        data: {
          sentiment: analysis.sentiment,
          riskScore: analysis.riskScore,
          topFactors: JSON.stringify(analysis.topFactors),
          summary: analysis.summary,
          vixValue: vixValue
        }
      });
    } else {
      await prisma.marketAnalysis.create({
        data: {
          sentiment: analysis.sentiment,
          riskScore: analysis.riskScore,
          topFactors: JSON.stringify(analysis.topFactors),
          summary: analysis.summary,
          vixValue: vixValue
        }
      });
    }
    console.log('Global market AI analysis updated.');
  } catch (error) {
    console.error('Failed to sync global market AI analysis:', error);
  }
}
