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
    })) as any[];

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
      quote = (await yahooFinance.quote(symbol)) as any;
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

    try {
      const summary = (await yahooFinance.quoteSummary(symbol, {
        modules: ['assetProfile', 'financialData', 'defaultKeyStatistics', 'summaryDetail', 'earnings']
      })) as any;

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
      })) as any[];

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

    // 5. Calculate 10-Bar Scores
    // A. Revenue Growth Score (1-10)
    let revenueGrowthScore = 4;
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
      const combinedRevGrowth = (cagr * 0.7) + (revenueGrowth * 0.3);

      if (combinedRevGrowth >= 0.25) revenueGrowthScore = 10;
      else if (combinedRevGrowth >= 0.20) revenueGrowthScore = 9;
      else if (combinedRevGrowth >= 0.15) revenueGrowthScore = 8;
      else if (combinedRevGrowth >= 0.10) revenueGrowthScore = 7;
      else if (combinedRevGrowth >= 0.05) revenueGrowthScore = 6;
      else if (combinedRevGrowth >= 0.02) revenueGrowthScore = 5;
      else if (combinedRevGrowth >= 0.00) revenueGrowthScore = 4;
      else if (combinedRevGrowth >= -0.05) revenueGrowthScore = 3;
      else if (combinedRevGrowth >= -0.15) revenueGrowthScore = 2;
      else revenueGrowthScore = 1;
    } else {
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
    }

    // B. Earnings Growth Score (1-10)
    let earningsGrowthScore = 5;
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
      const combinedEarnGrowth = (cagr * 0.7) + (earningsGrowth * 0.3);

      if (combinedEarnGrowth >= 0.30) earningsGrowthScore = 10;
      else if (combinedEarnGrowth >= 0.20) earningsGrowthScore = 9;
      else if (combinedEarnGrowth >= 0.15) earningsGrowthScore = 8;
      else if (combinedEarnGrowth >= 0.10) earningsGrowthScore = 7;
      else if (combinedEarnGrowth >= 0.05) earningsGrowthScore = 6;
      else if (combinedEarnGrowth >= 0.00) earningsGrowthScore = 5;
      else if (combinedEarnGrowth >= -0.05) earningsGrowthScore = 4;
      else if (combinedEarnGrowth >= -0.15) earningsGrowthScore = 3;
      else if (combinedEarnGrowth >= -0.30) earningsGrowthScore = 2;
      else earningsGrowthScore = 1;
    } else {
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
    }

    // C. EBITDA Margin Score (1-10)
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

    // 6. Calculate Signals & Scores (Detailed Analyst report)
    let score = 0;
    const analysisBlocks: string[] = [];

    // Technical 2: Trend / SMA50 (Max 20 pts)
    if (sma50 > 0) {
      if (price > sma50) {
        score += 20;
        analysisBlocks.push(
          `Trendanalyse (mittelfristig):\nDie Aktie zeigt eine positive mittelfristige Dynamik. Der Kurs notiert mit ${price.toFixed(2)} $ über dem 50-Tage-Durchschnitt von ${sma50.toFixed(2)} $, was auf einen intakten Aufwärtstrend hindeutet.`
        );
      } else {
        score += 0;
        analysisBlocks.push(
          `Trendanalyse (mittelfristig):\nDie Aktie notiert unter dem 50-Tage-Durchschnitt von ${sma50.toFixed(2)} $, was auf eine mittelfristige Korrekturphase hindeutet.`
        );
      }
    } else {
      score += 10;
      analysisBlocks.push("Trendanalyse (mittelfristig):\nEin gleitender 50-Tage-Durchschnitt konnte aufgrund mangelnder Kursdaten nicht berechnet werden (neutral bewertet).");
    }

    // Technical 3: Trend / EMA200 (Max 20 pts)
    if (ema200 > 0) {
      if (price > ema200) {
        score += 20;
        analysisBlocks.push(
          `Trendanalyse (langfristig):\nDie Aktie befindet sich in einem übergeordneten, langfristigen Aufwärtstrend. Der Kurs notiert über der gleitenden 200-Tage-Linie von ${ema200.toFixed(2)} $, was das bullische Gesamtbild untermauert.`
        );
      } else {
        score += 0;
        analysisBlocks.push(
          `Trendanalyse (langfristig):\nDie Aktie notiert unter dem gleitenden 200-Tage-Durchschnitt von ${ema200.toFixed(2)} $, was auf ein langfristig korrigierendes Chartbild hindeutet.`
        );
      }
    } else {
      score += 10;
      analysisBlocks.push("Trendanalyse (langfristig):\nEin gleitender 200-Tage-Durchschnitt konnte aufgrund mangelnder Kursdaten nicht berechnet werden (neutral bewertet).");
    }

    // Fundamental 1: P/E Ratio (Max 20 pts)
    if (peRatio !== null) {
      if (peRatio < 15) {
        score += 20;
        analysisBlocks.push(
          `Fundamentalbewertung (KGV):\nUnter Berücksichtigung des Gewinns je Aktie ist die Bewertung mit einem KGV von ${peRatio.toFixed(1)} als fundamental günstig einzustufen, was eine hohe Sicherheitsmarge bietet.`
        );
      } else if (peRatio <= 25) {
        score += 10;
        analysisBlocks.push(
          `Fundamentalbewertung (KGV):\nMit einem KGV von ${peRatio.toFixed(1)} notiert die Aktie im Bereich des fairen historischen Durchschnitts.`
        );
      } else {
        score += 4;
        analysisBlocks.push(
          `Fundamentalbewertung (KGV):\nDie Aktie weist ein KGV von ${peRatio.toFixed(1)} auf, was auf eine anspruchsvolle Bewertung hindeutet und das kurzfristige Korrekturrisiko erhöht.`
        );
      }
    } else {
      score += 10;
      analysisBlocks.push("Fundamentalbewertung (KGV):\nEin Kurs-Gewinn-Verhältnis (KGV) liegt aktuell nicht vor (neutral gewichtet).");
    }

    // Fundamental 2: Operating Margin (Max 20 pts)
    const marginPct = (operatingMargin * 100).toFixed(1);
    if (operatingMargin > 0.15) {
      score += 20;
      analysisBlocks.push(
        `Rentabilität (Operative Marge):\nDas Unternehmen besticht durch eine exzellente operative Profitabilität. Eine Marge von ${marginPct} % belegt hohe Preismacht und Effizienz.`
      );
    } else if (operatingMargin >= 0.05) {
      score += 10;
      analysisBlocks.push(
        `Rentabilität (Operative Marge):\nDie operative Marge von ${marginPct} % ist solide und spiegelt ein durchschnittlich profitables Geschäftsmodell wider.`
      );
    } else {
      score += 4;
      analysisBlocks.push(
        `Rentabilität (Operative Marge):\nMit einer Marge von lediglich ${marginPct} % ist die operative Profitabilität gering, was die Aktie anfälliger für Kostensteigerungen macht.`
      );
    }

    // Technical 1: RSI (Max 20 pts)
    if (rsi < 35) {
      score += 20;
      analysisBlocks.push(`Marktdynamik (RSI):\nDer Relative-Strength-Index (RSI 14) liegt bei ${rsi} und signalisiert eine überverkaufte Marktlage (Gegenreaktion wahrscheinlich).`);
    } else if (rsi > 65) {
      score += 0;
      analysisBlocks.push(`Marktdynamik (RSI):\nDer Relative-Strength-Index (RSI 14) notiert bei ${rsi} im überkauften Bereich, was kurzfristig auf ein erhöhtes Rückschlagpotenzial hindeutet.`);
    } else {
      score += 10;
      analysisBlocks.push(`Marktdynamik (RSI):\nDer Relative-Strength-Index (RSI 14) liegt mit ${rsi} im neutralen Bereich.`);
    }

    // Calculate Signal
    let signal = 'HOLD';
    if (score >= 65) {
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

    // 6.5 Fetch news headlines for AI Stock Analysis
    let newsHeadlines: string[] = [];
    try {
      const searchResult = await yahooFinance.search(symbol, { newsCount: 3 });
      if (searchResult.news) {
        newsHeadlines = searchResult.news.map((n: any) => n.title).filter(Boolean);
      }
    } catch (err) {
      console.warn(`Failed to fetch headlines for stock ${symbol} during sync:`, err);
    }

    let aiAssessment: string | null = null;
    try {
      aiAssessment = await generateStockAnalysis(symbol, name, {
        price,
        peRatio,
        rsi,
        ema200
      }, newsHeadlines);
    } catch (err) {
      console.warn(`Failed to calculate AI assessment for ${symbol}:`, err);
    }

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
        signal,
        reason,
        aiAssessment,
        sector: sector || undefined,
        // Only override static fields if we actually found something
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
