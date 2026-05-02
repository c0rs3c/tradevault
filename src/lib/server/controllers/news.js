import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectNewsDB } from '@/lib/server/newsDb';
import { getWatchlistModel } from '@/lib/server/models/news/Watchlist';
import { getNewsArticleModel } from '@/lib/server/models/news/NewsArticle';
import { getWatchlistNewsMatchModel } from '@/lib/server/models/news/WatchlistNewsMatch';
import { fetchSymbolQuote } from '@/lib/server/services/marketData';

const GOOGLE_NEWS_BASE_URL = 'https://news.google.com/rss/search';
const GOOGLE_NEWS_PARAMS = {
  hl: 'en-IN',
  gl: 'IN',
  ceid: 'IN:en'
};
const NEWS_WINDOW_DAYS = 7;
const TRADINGVIEW_HOST = 'www.tradingview.com';
const COMPANY_PROFILES_PATH = path.join(process.cwd(), 'data', 'company_profiles.json');
const BLOCKED_SOURCE_DOMAINS = new Set(['fathomjournal.org', 'meyka.com']);

const companyProfilesCache = {
  loaded: false,
  profilesBySymbol: new Map()
};

const createError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const stripTags = (value) =>
  String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const decodeHtml = (value) =>
  String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getNewsModels = async () => {
  const connection = await connectNewsDB();
  return {
    connection,
    Watchlist: getWatchlistModel(connection),
    NewsArticle: getNewsArticleModel(connection),
    WatchlistNewsMatch: getWatchlistNewsMatchModel(connection)
  };
};

const loadCompanyProfiles = async () => {
  if (companyProfilesCache.loaded) {
    return companyProfilesCache.profilesBySymbol;
  }

  try {
    const raw = await readFile(COMPANY_PROFILES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const nextMap = new Map();
    Object.entries(parsed?.profiles || {}).forEach(([symbol, profile]) => {
      nextMap.set(String(symbol || '').trim().toUpperCase(), profile || {});
    });
    companyProfilesCache.profilesBySymbol = nextMap;
  } catch {
    companyProfilesCache.profilesBySymbol = new Map();
  } finally {
    companyProfilesCache.loaded = true;
  }

  return companyProfilesCache.profilesBySymbol;
};

const normalizeTradingViewUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw createError('TradingView watchlist URL is invalid', 400);
  }

  if (parsed.hostname !== TRADINGVIEW_HOST) {
    throw createError('Only public TradingView watchlist URLs are supported', 400);
  }

  const match = parsed.pathname.match(/^\/watchlists\/(\d+)\/?$/);
  if (!match) {
    throw createError('TradingView watchlist URL must match /watchlists/<id>/', 400);
  }

  return `https://${TRADINGVIEW_HOST}/watchlists/${match[1]}/`;
};

const extractWatchlistPayload = (html) => {
  const match = String(html || '').match(
    /<script type="application\/prs\.init-data\+json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw createError('TradingView page did not contain an importable watchlist payload', 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw createError('TradingView watchlist payload was invalid JSON', 502);
  }

  const sharedWatchlist = parsed?.sharedWatchlist;
  const list = sharedWatchlist?.list;
  if (!list?.id || !Array.isArray(list?.symbols)) {
    throw createError('TradingView watchlist payload did not include symbols', 502);
  }

  return {
    sourceWatchlistId: Number(list.id),
    title: String(list.name || '').trim() || `Watchlist ${list.id}`,
    description: String(list.description || '').trim(),
    color: String(list.color || '').trim(),
    rawSymbols: list.symbols.map((symbol) => String(symbol || '')),
    authorUsername: String(sharedWatchlist?.author?.username || '').trim()
  };
};

const buildTickerItem = async (rawSymbol, sectionTitle) => {
  const canonicalTicker = String(rawSymbol || '').trim().toUpperCase();
  const [exchange = '', symbolPart = ''] = canonicalTicker.split(':', 2);
  const symbol = String(symbolPart || canonicalTicker).trim().toUpperCase();
  const companyName = await resolveCompanyName(symbol);

  return {
    type: 'ticker',
    rawSymbol: canonicalTicker,
    sectionTitle,
    exchange: symbolPart ? exchange : '',
    symbol,
    canonicalTicker,
    companyName,
    normalizedCompanyName: normalizeText(companyName)
  };
};

const buildWatchlistItems = async (rawSymbols) => {
  const items = [];
  let activeSectionTitle = '';

  for (const rawEntry of rawSymbols) {
    const value = String(rawEntry || '').trim();
    if (!value) continue;
    if (value.startsWith('###')) {
      activeSectionTitle = value.replace(/^###/, '').replace(/\u2064/g, '').trim();
      items.push({
        type: 'section',
        rawSymbol: value,
        sectionTitle: activeSectionTitle,
        exchange: '',
        symbol: '',
        canonicalTicker: '',
        companyName: '',
        normalizedCompanyName: ''
      });
      continue;
    }

    items.push(await buildTickerItem(value, activeSectionTitle));
  }

  return items;
};

async function resolveCompanyName(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) return '';

  const profiles = await loadCompanyProfiles();
  const profile = profiles.get(normalizedSymbol);
  if (profile?.companyName) {
    return String(profile.companyName).trim();
  }

  try {
    const quote = await fetchSymbolQuote(normalizedSymbol);
    if (quote?.companyName) {
      return String(quote.companyName).trim();
    }
  } catch {
    // Keep import resilient when remote company metadata is unavailable.
  }

  return normalizedSymbol;
}

const fetchTradingViewWatchlist = async (url) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw createError(`TradingView watchlist request failed (${response.status})`, 502);
  }

  const html = await response.text();
  return extractWatchlistPayload(html);
};

const getTickerItems = (watchlist) => (watchlist?.items || []).filter((item) => item.type === 'ticker');

const buildGoogleNewsQuery = ({ symbol, companyName }) => {
  const symbolPart = String(symbol || '').trim().toUpperCase();
  const companyPart = String(companyName || '').trim();
  if (companyPart && normalizeText(companyPart) !== normalizeText(symbolPart)) {
    return `(${symbolPart} OR "${companyPart}") when:${NEWS_WINDOW_DAYS}d`;
  }
  return `${symbolPart} when:${NEWS_WINDOW_DAYS}d`;
};

const isWithinNewsWindow = (value) => {
  const publishedAt = new Date(value);
  if (Number.isNaN(publishedAt.getTime())) return false;
  const cutoff = Date.now() - NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return publishedAt.getTime() >= cutoff;
};

const extractTag = (itemXml, tagName) => {
  const match = String(itemXml || '').match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeHtml(match[1].trim()) : '';
};

const extractSource = (itemXml) => {
  const match = String(itemXml || '').match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/i);
  return {
    sourceName: match ? decodeHtml(match[2].trim()) : '',
    sourceUrl: match ? decodeHtml(match[1] || '') : ''
  };
};

const extractGoogleNewsItems = (xml, ticker) => {
  const seenKeys = new Set();
  const matches = String(xml || '').match(/<item>([\s\S]*?)<\/item>/gi) || [];
  const query = buildGoogleNewsQuery(ticker);
  const items = [];

  for (const rawItem of matches) {
    const title = extractTag(rawItem, 'title');
    const googleNewsUrl = extractTag(rawItem, 'link');
    const guid = extractTag(rawItem, 'guid');
    const descriptionHtml = extractTag(rawItem, 'description');
    const pubDate = extractTag(rawItem, 'pubDate');
    const { sourceName, sourceUrl } = extractSource(rawItem);

    if (!title || !googleNewsUrl) continue;
    if (!isWithinNewsWindow(pubDate)) continue;

    let sourceDomain = '';
    try {
      sourceDomain = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, '') : '';
    } catch {
      sourceDomain = '';
    }
    if (!sourceDomain || /\s/.test(sourceDomain) || BLOCKED_SOURCE_DOMAINS.has(sourceDomain)) {
      continue;
    }

    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) continue;

    const itemKey = guid || `${normalizedTitle}|${pubDate}|${sourceDomain}`;
    if (seenKeys.has(itemKey)) continue;
    seenKeys.add(itemKey);

    const descriptionText = stripTags(descriptionHtml);
    const normalizedBody = normalizeText(`${title} ${descriptionText}`);
    const matchedSymbol = new RegExp(`\\b${escapeRegex(ticker.symbol)}\\b`, 'i').test(
      `${title} ${descriptionText}`
    );
    const normalizedCompanyName = normalizeText(ticker.companyName);
    const matchedCompany =
      normalizedCompanyName && normalizedCompanyName !== normalizeText(ticker.symbol)
        ? normalizedBody.includes(normalizedCompanyName)
        : false;

    items.push({
      guid,
      googleNewsUrl,
      publisherUrl: sourceUrl,
      title,
      normalizedTitle,
      sourceName,
      sourceDomain,
      publishedAt: new Date(pubDate),
      descriptionHtml,
      descriptionText,
      matchedBy: matchedSymbol && matchedCompany ? 'both' : matchedCompany ? 'companyName' : 'symbol',
      matchedQuery: query
    });
  }

  return items;
};

export const fetchGoogleNewsRssForTicker = async ({ symbol, companyName }) => {
  const query = buildGoogleNewsQuery({ symbol, companyName });
  const url = new URL(GOOGLE_NEWS_BASE_URL);
  url.searchParams.set('q', query);
  Object.entries(GOOGLE_NEWS_PARAMS).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw createError(`Google News request failed (${response.status})`, 502);
  }

  return response.text();
};

const buildArticleKey = (item) =>
  item.guid ||
  crypto
    .createHash('sha256')
    .update(`${item.googleNewsUrl}|${item.normalizedTitle}|${item.publishedAt.toISOString()}`)
    .digest('hex');

export const importTradingViewWatchlist = async ({ ownerUsername, url }) => {
  const normalizedUrl = normalizeTradingViewUrl(url);
  const payload = await fetchTradingViewWatchlist(normalizedUrl);
  const items = await buildWatchlistItems(payload.rawSymbols);
  const { Watchlist } = await getNewsModels();
  const now = new Date();

  const watchlist = await Watchlist.findOneAndUpdate(
    {
      ownerUsername,
      source: 'tradingview',
      sourceWatchlistId: payload.sourceWatchlistId
    },
    {
      $set: {
        ownerUsername,
        source: 'tradingview',
        sourceWatchlistId: payload.sourceWatchlistId,
        sourceUrl: normalizedUrl,
        title: payload.title,
        description: payload.description,
        authorUsername: payload.authorUsername,
        color: payload.color,
        rawSymbols: payload.rawSymbols,
        items,
        lastImportedAt: now
      },
      $setOnInsert: {
        syncStatus: 'idle',
        syncError: ''
      }
    },
    { new: true, upsert: true }
  ).lean();

  return formatWatchlistListItem(watchlist, 0);
};

const formatWatchlistListItem = (watchlist, articleCount) => ({
  id: String(watchlist._id),
  title: watchlist.title,
  sourceUrl: watchlist.sourceUrl,
  sourceWatchlistId: watchlist.sourceWatchlistId,
  tickerCount: getTickerItems(watchlist).length,
  articleCount,
  lastImportedAt: watchlist.lastImportedAt,
  lastSyncedAt: watchlist.lastSyncedAt,
  syncStatus: watchlist.syncStatus,
  syncError: watchlist.syncError
});

export const listWatchlists = async ({ ownerUsername }) => {
  const { Watchlist, WatchlistNewsMatch } = await getNewsModels();
  const watchlists = await Watchlist.find({ ownerUsername }).sort({ updatedAt: -1, createdAt: -1 }).lean();

  const results = await Promise.all(
    watchlists.map(async (watchlist) => {
      const articleCount = await WatchlistNewsMatch.countDocuments({
        ownerUsername,
        watchlistId: watchlist._id
      });
      return formatWatchlistListItem(watchlist, articleCount);
    })
  );

  return { watchlists: results };
};

const getOwnedWatchlist = async ({ ownerUsername, watchlistId }) => {
  if (!mongoose.isValidObjectId(watchlistId)) {
    throw createError('Watchlist not found', 404);
  }
  const { Watchlist } = await getNewsModels();
  const watchlist = await Watchlist.findOne({ _id: watchlistId, ownerUsername }).lean();
  if (!watchlist) {
    throw createError('Watchlist not found', 404);
  }
  return watchlist;
};

const buildGroupedNews = async ({ ownerUsername, watchlist }) => {
  const { NewsArticle, WatchlistNewsMatch } = await getNewsModels();
  const tickerItems = getTickerItems(watchlist);
  const matches = await WatchlistNewsMatch.find({
    ownerUsername,
    watchlistId: watchlist._id
  })
    .sort({ publishedAt: -1, createdAt: -1 })
    .lean();

  const articleIds = [...new Set(matches.map((match) => String(match.articleId)))];
  const articles = await NewsArticle.find({ _id: { $in: articleIds } }).lean();
  const articlesById = new Map(articles.map((article) => [String(article._id), article]));

  const groupedByTicker = new Map();
  tickerItems.forEach((item) => {
    groupedByTicker.set(item.canonicalTicker, {
      canonicalTicker: item.canonicalTicker,
      symbol: item.symbol,
      exchange: item.exchange,
      companyName: item.companyName,
      sectionTitle: item.sectionTitle,
      articles: []
    });
  });

  matches.forEach((match) => {
    const group = groupedByTicker.get(match.canonicalTicker);
    const article = articlesById.get(String(match.articleId));
    if (!group || !article) return;
    group.articles.push({
      id: String(article._id),
      title: article.title,
      googleNewsUrl: article.googleNewsUrl,
      publisherUrl: article.publisherUrl,
      sourceName: article.sourceName,
      sourceDomain: article.sourceDomain,
      publishedAt: article.publishedAt,
      descriptionText: article.descriptionText,
      matchedBy: match.matchedBy
    });
  });

  const tickerGroups = tickerItems
    .map((item) => groupedByTicker.get(item.canonicalTicker))
    .filter(Boolean)
    .map((group) => ({
      ...group,
      articles: group.articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    }));

  return {
    id: String(watchlist._id),
    title: watchlist.title,
    sourceUrl: watchlist.sourceUrl,
    sourceWatchlistId: watchlist.sourceWatchlistId,
    authorUsername: watchlist.authorUsername,
    color: watchlist.color,
    description: watchlist.description,
    lastImportedAt: watchlist.lastImportedAt,
    lastSyncedAt: watchlist.lastSyncedAt,
    syncStatus: watchlist.syncStatus,
    syncError: watchlist.syncError,
    tickerCount: tickerItems.length,
    tickerGroups
  };
};

export const getWatchlistDetails = async ({ ownerUsername, watchlistId }) => {
  const watchlist = await getOwnedWatchlist({ ownerUsername, watchlistId });
  return buildGroupedNews({ ownerUsername, watchlist });
};

export const upsertArticlesAndMatches = async ({ ownerUsername, watchlist, ticker, feedItems }) => {
  const { NewsArticle, WatchlistNewsMatch } = await getNewsModels();
  const syncedAt = new Date();
  const keptArticleIds = [];
  let insertedArticles = 0;
  let insertedMatches = 0;

  for (const item of feedItems) {
    const articleKey = buildArticleKey(item);
    const existingArticle = await NewsArticle.findOne({ articleKey }).select('_id');
    const article = await NewsArticle.findOneAndUpdate(
      { articleKey },
      {
        $set: {
          guid: item.guid || '',
          articleKey,
          googleNewsUrl: item.googleNewsUrl,
          publisherUrl: item.publisherUrl || '',
          title: item.title,
          normalizedTitle: item.normalizedTitle,
          sourceName: item.sourceName,
          sourceDomain: item.sourceDomain,
          publishedAt: item.publishedAt,
          descriptionHtml: item.descriptionHtml,
          descriptionText: item.descriptionText,
          fetchedAt: syncedAt,
          queryWindowDays: NEWS_WINDOW_DAYS
        }
      },
      { new: true, upsert: true }
    );

    const articleId = article?._id;
    if (!articleId) continue;
    keptArticleIds.push(articleId);
    if (!existingArticle) {
      insertedArticles += 1;
    }

    const existingMatch = await WatchlistNewsMatch.findOne({
      watchlistId: watchlist._id,
      canonicalTicker: ticker.canonicalTicker,
      articleId
    }).select('_id');

    await WatchlistNewsMatch.updateOne(
      {
        watchlistId: watchlist._id,
        canonicalTicker: ticker.canonicalTicker,
        articleId
      },
      {
        $set: {
          ownerUsername,
          watchlistId: watchlist._id,
          canonicalTicker: ticker.canonicalTicker,
          symbol: ticker.symbol,
          companyName: ticker.companyName,
          articleId,
          matchedBy: item.matchedBy,
          matchedQuery: item.matchedQuery,
          publishedAt: item.publishedAt,
          syncedAt
        }
      },
      { upsert: true }
    );

    if (!existingMatch) {
      insertedMatches += 1;
    }
  }

  const staleFilter = {
    ownerUsername,
    watchlistId: watchlist._id,
    canonicalTicker: ticker.canonicalTicker
  };
  if (keptArticleIds.length) {
    staleFilter.articleId = { $nin: keptArticleIds };
  }
  const staleDeleteResult = await WatchlistNewsMatch.deleteMany(staleFilter);

  return {
    insertedArticles,
    insertedMatches,
    removedMatches: staleDeleteResult.deletedCount || 0,
    keptArticleIds
  };
};

export const syncWatchlistNews = async ({ ownerUsername, watchlistId }) => {
  const { Watchlist } = await getNewsModels();
  const watchlist = await getOwnedWatchlist({ ownerUsername, watchlistId });
  const tickers = getTickerItems(watchlist);

  await Watchlist.updateOne(
    { _id: watchlist._id },
    { $set: { syncStatus: 'syncing', syncError: '' } }
  );

  let tickerCount = 0;
  let importedArticles = 0;
  let importedMatches = 0;
  let removedMatches = 0;
  const errors = [];

  try {
    for (const ticker of tickers) {
      tickerCount += 1;
      try {
        const xml = await fetchGoogleNewsRssForTicker({
          symbol: ticker.symbol,
          companyName: ticker.companyName
        });
        const feedItems = extractGoogleNewsItems(xml, ticker);
        const result = await upsertArticlesAndMatches({
          ownerUsername,
          watchlist,
          ticker,
          feedItems
        });
        importedArticles += result.insertedArticles;
        importedMatches += result.insertedMatches;
        removedMatches += result.removedMatches;
      } catch (error) {
        errors.push(`${ticker.symbol}: ${error.message}`);
      }
    }

    await Watchlist.updateOne(
      { _id: watchlist._id },
      {
        $set: {
          lastSyncedAt: new Date(),
          syncStatus: errors.length ? 'error' : 'success',
          syncError: errors.join(' | ')
        }
      }
    );
  } catch (error) {
    await Watchlist.updateOne(
      { _id: watchlist._id },
      {
        $set: {
          syncStatus: 'error',
          syncError: error.message
        }
      }
    );
    throw error;
  }

  return {
    watchlistId: String(watchlist._id),
    watchlistTitle: watchlist.title,
    tickersScanned: tickerCount,
    articlesInserted: importedArticles,
    matchesInserted: importedMatches,
    matchesRemoved: removedMatches,
    errors
  };
};

export const syncAllWatchlistsNews = async ({ ownerUsername }) => {
  const { Watchlist } = await getNewsModels();
  const watchlists = await Watchlist.find({ ownerUsername }).select('_id title').lean();

  const summary = {
    watchlistsScanned: watchlists.length,
    tickersScanned: 0,
    articlesInserted: 0,
    matchesInserted: 0,
    matchesRemoved: 0,
    failures: []
  };

  for (const watchlist of watchlists) {
    try {
      const result = await syncWatchlistNews({ ownerUsername, watchlistId: String(watchlist._id) });
      summary.tickersScanned += result.tickersScanned;
      summary.articlesInserted += result.articlesInserted;
      summary.matchesInserted += result.matchesInserted;
      summary.matchesRemoved += result.matchesRemoved;
      if (result.errors.length) {
        summary.failures.push({ watchlistId: String(watchlist._id), title: watchlist.title, errors: result.errors });
      }
    } catch (error) {
      summary.failures.push({
        watchlistId: String(watchlist._id),
        title: watchlist.title,
        errors: [error.message]
      });
    }
  }

  return summary;
};

export const syncAllOwnersWatchlistsNews = async () => {
  const { Watchlist } = await getNewsModels();
  const owners = await Watchlist.distinct('ownerUsername', { ownerUsername: { $ne: '' } });
  const summary = {
    ownersScanned: owners.length,
    watchlistsScanned: 0,
    tickersScanned: 0,
    articlesInserted: 0,
    matchesInserted: 0,
    matchesRemoved: 0,
    failures: []
  };

  for (const ownerUsername of owners) {
    const result = await syncAllWatchlistsNews({ ownerUsername });
    summary.watchlistsScanned += result.watchlistsScanned;
    summary.tickersScanned += result.tickersScanned;
    summary.articlesInserted += result.articlesInserted;
    summary.matchesInserted += result.matchesInserted;
    summary.matchesRemoved += result.matchesRemoved;
    if (result.failures.length) {
      summary.failures.push({ ownerUsername, watchlists: result.failures });
    }
  }

  return summary;
};
