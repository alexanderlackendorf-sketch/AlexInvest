type GlobalMarketAnalysis = {
  sentiment: string;
  riskScore: number;
  topFactors: string[];
  summary: string;
};

/**
 * Direct HTTPS caller for Gemini Pro API
 */
async function callGeminiAPI(prompt: string, expectJson = false): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload: any = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };

  if (expectJson) {
    payload.generationConfig = {
      responseMimeType: 'application/json'
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Gemini API returned an empty response');
  }

  return textResponse.trim();
}

/**
 * Generates global market sentiment and risk analysis
 */
export async function generateGlobalMarketAnalysis(
  vixValue: number | null,
  headlines: string[]
): Promise<GlobalMarketAnalysis> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('Gemini API-Key fehlt. Generiere globale Markt-Mockdaten...');
      return getGlobalMockData(vixValue);
    }

    const vixStr = vixValue !== null ? `${vixValue.toFixed(2)}` : 'unbekannt (VIX Daten fehlen)';
    const headlinesStr = headlines.length > 0 ? headlines.join('\n- ') : 'Keine aktuellen Schlagzeilen verfügbar';

    const prompt = `Analysiere die aktuelle Stimmung und das Risiko an den globalen Finanzmärkten (DAX & S&P 500).
Nutze dafür den aktuellen Volatilitätsindex (VIX-Stand: ${vixStr}) und die folgenden aktuellen Nachrichten-Schlagzeilen:
- ${headlinesStr}

Erstelle eine professionelle Markt-Einschätzung für Profianleger auf Deutsch.
Gib das Ergebnis EXKLUSIV im folgendem JSON-Format zurück (keine Markdown-Formatierung um das JSON herum, kein \`\`\`json):
{
  "sentiment": "Prägnante Stimmung (z.B. Vorsichtig Optimistisch, Risk-On, Risk-Off, Wachsame Konsolidierung)",
  "riskScore": 45, // Eine Zahl von 0 bis 100 für das akute Crash- oder Korrekturrisiko
  "topFactors": ["Faktor 1 (z.B. Geopolitik)", "Faktor 2", "Faktor 3"], // Maximal 3 kurze Stichpunkte
  "summary": "Zusammenfassung auf Deutsch (3-4 prägnante Sätze, sachlicher Analystenstil)"
}`;

    const jsonResponse = await callGeminiAPI(prompt, true);
    const parsed = JSON.parse(jsonResponse) as GlobalMarketAnalysis;
    return {
      sentiment: parsed.sentiment || 'Wachsame Konsolidierung',
      riskScore: typeof parsed.riskScore === 'number' ? parsed.riskScore : 40,
      topFactors: Array.isArray(parsed.topFactors) ? parsed.topFactors : ['Geopolitische Unsicherheiten'],
      summary: parsed.summary || 'Die globalen Indizes konsolidieren auf hohem Niveau.'
    };
  } catch (error) {
    console.error('Failed to generate global AI market analysis, falling back to mock:', error);
    return getGlobalMockData(vixValue);
  }
}

/**
 * Generates stock-specific geopolitical & macroeconomic risk assessment
 */
export async function generateStockAnalysis(
  symbol: string,
  name: string,
  metrics: { price: number; peRatio: number | null; rsi: number | null; ema200: number | null },
  headlines: string[]
): Promise<string> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return getStockMockData(symbol, name);
    }

    const headlinesStr = headlines.length > 0 ? headlines.slice(0, 3).join('\n- ') : 'Keine aktuellen News-Schlagzeilen';
    const metricsStr = `Kurs: ${metrics.price.toFixed(2)} $, KGV: ${metrics.peRatio ?? 'N/A'}, RSI(14): ${metrics.rsi ?? 'N/A'}, EMA200: ${metrics.ema200 ?? 'N/A'}`;

    const prompt = `Analysiere das Unternehmen ${symbol} (${name}) im Hinblick auf aktuelle geopolitische und makroökonomische Risiken (z.B. Handelszölle, globale Konflikte, Zinsentscheidungen, Inflation, Lieferketten).
Kennzahlen: ${metricsStr}
Aktuelle News:
- ${headlinesStr}

Erstelle eine professionelle Risikoeinschätzung (AI Assessment) auf Deutsch für professionelle Investoren.
Halte dich streng an folgende Vorgaben:
- Maximal 3 Sätze.
- Gehe direkt und konkret auf ${symbol} ein.
- Sachlich, analytisch, frei von allgemeinem Werbetext.
- Gib NUR den fertigen Text ohne Einleitung oder Begrüßung zurück.`;

    return await callGeminiAPI(prompt, false);
  } catch (error) {
    console.error(`Failed to generate stock AI analysis for ${symbol}, falling back to mock:`, error);
    return getStockMockData(symbol, name);
  }
}

function getGlobalMockData(vixValue: number | null): GlobalMarketAnalysis {
  let vixDesc = 'stabilen Bereich';
  let riskScore = 32;
  let sentiment = 'Optimistische Konsolidierung (Risk-On)';

  if (vixValue !== null && vixValue > 20) {
    vixDesc = 'erhöhten Bereich';
    riskScore = 55;
    sentiment = 'Erhöhte Wachsamkeit (Risk-Off)';
  } else if (vixValue !== null && vixValue > 30) {
    vixDesc = 'kritischen Angst-Bereich';
    riskScore = 78;
    sentiment = 'Ausgeprägte Risikoaversion (Panic)';
  }

  return {
    sentiment,
    riskScore,
    topFactors: [
      'Geopolitische Verunsicherung & Handelsrestriktionen',
      'Unsicherheit bezüglich zukünftiger Notenbank-Zinsschritte',
      `Volatilitätsindex (VIX) im ${vixDesc}`
    ],
    summary: `Die globalen Aktienmärkte befinden sich in einer Phase der Konsolidierung. Die Anleger wägen robuste Konjunkturdaten gegen geopolitische Unsicherheiten ab. Die Notenbank-Zinspolitik bleibt der primäre Treiber für die mittelfristige Marktrichtung, während derivative Absicherungsgeschäfte das Abwärtsrisiko vorerst abfedern.`
  };
}

function getStockMockData(symbol: string, name: string): string {
  return `Für ${name} (${symbol}) ergibt sich aus makroökonomischer Sicht ein stabiles Risikoprofil. Mögliche Belastungen durch globale Lieferkettenunterbrechungen oder Wechselkursschwankungen werden durch die starke Marktposition und robuste Preismacht des Unternehmens abgefedert. Langfristig besteht eine hohe fundamentale Widerstandsfähigkeit gegenüber inflationären Tendenzen.`;
}
