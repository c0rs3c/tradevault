import { normalizeScreenerSymbol, queryScreenerPostgres } from '@/lib/server/postgres';

export const getSymbolOverview = async ({ symbol }) => {
  const normalizedSymbol = normalizeScreenerSymbol(symbol);

  const result = await queryScreenerPostgres(
    `
      SELECT
        symbol,
        company_name,
        about_text,
        sector,
        broad_industry,
        industry,
        updated_at
      FROM screener_company_profiles
      WHERE symbol = $1
      LIMIT 1
    `,
    [normalizedSymbol]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      symbol: normalizedSymbol,
      companyName: '',
      aboutText: '',
      sector: '',
      broadIndustry: '',
      industry: '',
      updatedAt: '',
      found: false
    };
  }

  return {
    symbol: row.symbol || normalizedSymbol,
    companyName: row.company_name || '',
    aboutText: row.about_text || '',
    sector: row.sector || '',
    broadIndustry: row.broad_industry || '',
    industry: row.industry || '',
    updatedAt: row.updated_at || '',
    found: true
  };
};
