#!/usr/bin/env python3
"""
Scrape quarterly Sales/Revenue, Net Profit, and EPS from Screener company pages
and store them in PostgreSQL.

This script is intentionally conservative:
- one page fetch per symbol
- browser-like headers
- retry with exponential backoff + jitter
- optional freshness window to avoid repeated fetches

Example:
  python3 scripts/scrape_screener_quarterly.py --symbol RRKABEL
"""

from __future__ import annotations

import argparse
import calendar
import csv
import re
import os
import random
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence
from urllib.parse import urlparse

import psycopg
import requests
from bs4 import BeautifulSoup


DEFAULT_BASE_URL = "https://www.screener.in/company/{symbol}/"
DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_MIN_REFRESH_HOURS = 12
DEFAULT_MAX_RETRIES = 4
DEFAULT_SLEEP_SECONDS = 8.0
DEFAULT_SLEEP_JITTER_SECONDS = 4.0

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class QuarterlyRow:
    symbol: str
    company_slug: str
    period_label: str
    period_end: datetime
    sales_rs_cr: Optional[float]
    net_profit_rs_cr: Optional[float]
    eps_rs: Optional[float]
    opm_percent: Optional[float]
    source_url: str


@dataclass(frozen=True)
class SymbolTarget:
    symbol: str
    url: Optional[str] = None


@dataclass(frozen=True)
class CompanyProfileRow:
    symbol: str
    company_slug: str
    company_name: Optional[str]
    about_text: Optional[str]
    market_cap_rs_cr: Optional[float]
    sector: Optional[str]
    broad_industry: Optional[str]
    industry: Optional[str]
    source_url: str


@dataclass(frozen=True)
class ShareholdingRow:
    symbol: str
    company_slug: str
    view_type: str
    period_label: str
    period_end: datetime
    holders_category: str
    holding_percent: Optional[float]
    shareholder_count: Optional[float]
    source_url: str


@dataclass(frozen=True)
class PeerRow:
    symbol: str
    company_slug: str
    peer_symbol: Optional[str]
    peer_name: str
    peer_url: str
    source_url: str


def log(message: str) -> None:
    print(f"[screener-quarterly] {message}", flush=True)


def load_dotenv() -> None:
    root = Path(__file__).resolve().parent.parent
    for filename in (".env", ".env.local"):
        path = root / filename
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def normalize_symbol(value: str) -> str:
    symbol = str(value or "").strip().upper()
    if not symbol:
        raise ValueError("Symbol cannot be empty")
    return symbol.replace("NSE:", "").replace("BSE:", "")


def alternate_symbol(symbol: str) -> Optional[str]:
    alt = normalize_symbol(symbol).replace("_", "&")
    if alt == normalize_symbol(symbol):
        return None
    return alt


def slug_from_url(url: str) -> str:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    if "company" in parts:
        index = parts.index("company")
        if index + 1 < len(parts):
            return parts[index + 1].upper()
    raise ValueError(f"Could not determine company slug from URL: {url}")


def build_url(symbol: str, url: Optional[str]) -> str:
    if url:
        return url.strip()
    return DEFAULT_BASE_URL.format(symbol=normalize_symbol(symbol))


def build_candidate_urls(symbol: str, url: Optional[str]) -> List[str]:
    primary_url = build_url(symbol, url).rstrip("/") + "/"
    candidates = [primary_url]

    if primary_url.endswith("/consolidated/"):
        candidates.append(primary_url[: -len("consolidated/")])
    elif url is None:
        candidates.append(f"https://www.screener.in/company/{normalize_symbol(symbol)}/consolidated/")

    deduped: List[str] = []
    seen = set()
    for candidate in candidates:
        if candidate not in seen:
            deduped.append(candidate)
            seen.add(candidate)
    return deduped


def build_all_candidate_urls(symbol: str, url: Optional[str]) -> List[str]:
    candidates = build_candidate_urls(symbol, url)
    alt_symbol = alternate_symbol(symbol)
    if alt_symbol and url is None:
        candidates.extend(build_candidate_urls(alt_symbol, None))

    deduped: List[str] = []
    seen = set()
    for candidate in candidates:
        if candidate not in seen:
            deduped.append(candidate)
            seen.add(candidate)
    return deduped


def read_symbol_file(path: str) -> List[SymbolTarget]:
    file_path = Path(path).expanduser().resolve()
    if not file_path.exists():
        raise FileNotFoundError(f"Symbol file not found: {file_path}")

    if file_path.suffix.lower() == ".csv":
        return read_symbols_from_csv(file_path)
    return read_symbols_from_text(file_path)


def read_symbols_from_text(path: Path) -> List[SymbolTarget]:
    targets: List[SymbolTarget] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        for part in line.split(","):
            symbol = normalize_symbol(part.strip())
            targets.append(SymbolTarget(symbol=symbol))
    return dedupe_targets(targets)


def read_symbols_from_csv(path: Path) -> List[SymbolTarget]:
    targets: List[SymbolTarget] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            return read_symbols_from_text(path)

        normalized_headers = {field.strip().lower(): field for field in reader.fieldnames if field}
        symbol_header = normalized_headers.get("symbol")
        url_header = normalized_headers.get("url")
        if not symbol_header:
            return read_symbols_from_text(path)

        for row in reader:
            raw_symbol = str(row.get(symbol_header, "")).strip()
            if not raw_symbol:
                continue
            raw_url = str(row.get(url_header, "")).strip() if url_header else ""
            targets.append(SymbolTarget(symbol=normalize_symbol(raw_symbol), url=raw_url or None))
    return dedupe_targets(targets)


def dedupe_targets(targets: Sequence[SymbolTarget]) -> List[SymbolTarget]:
    deduped: Dict[str, SymbolTarget] = {}
    for target in targets:
        deduped[target.symbol] = target
    return list(deduped.values())


def resolve_targets(single_symbol: Optional[str], file_path: Optional[str], url: Optional[str]) -> List[SymbolTarget]:
    if single_symbol and file_path:
        raise ValueError("Use either --symbol or --symbols-file, not both")
    if not single_symbol and not file_path:
        raise ValueError("One of --symbol or --symbols-file is required")
    if file_path and url:
        raise ValueError("--url can only be used together with --symbol")
    if single_symbol:
        return [SymbolTarget(symbol=normalize_symbol(single_symbol), url=url)]
    return read_symbol_file(file_path)


def parse_number(value: str) -> Optional[float]:
    cleaned = (
        str(value or "")
        .replace(",", "")
        .replace("\u00a0", " ")
        .replace("+", "")
        .strip()
    )
    if not cleaned or cleaned in {"-", "--", "TTM"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_percent(value: str) -> Optional[float]:
    return parse_number(str(value or "").replace("%", "").strip())


def parse_period_label(label: str) -> datetime:
    parsed = datetime.strptime(label.strip(), "%b %Y")
    last_day = calendar.monthrange(parsed.year, parsed.month)[1]
    return datetime(parsed.year, parsed.month, last_day, tzinfo=timezone.utc)


def parse_year_period_label(label: str) -> datetime:
    parsed = datetime.strptime(label.strip(), "%b %Y")
    last_day = calendar.monthrange(parsed.year, parsed.month)[1]
    return datetime(parsed.year, parsed.month, last_day, tzinfo=timezone.utc)


def requests_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.screener.in/",
        }
    )
    return session


def fetch_html(session: requests.Session, url: str, max_retries: int) -> str:
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            response = session.get(url, timeout=DEFAULT_TIMEOUT_SECONDS)
            if response.status_code == 429:
                raise requests.HTTPError("HTTP 429 Too Many Requests", response=response)
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt >= max_retries:
                break
            delay = min(30.0, (2 ** (attempt - 1)) + random.uniform(0.4, 1.6))
            log(f"Fetch failed on attempt {attempt}/{max_retries}; retrying in {delay:.1f}s")
            time.sleep(delay)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def extract_quarterly_section(soup: BeautifulSoup):
    heading = soup.find(lambda tag: tag.name in {"h2", "h3"} and "Quarterly Results" in tag.get_text(" ", strip=True))
    if not heading:
        raise RuntimeError("Could not find 'Quarterly Results' section on the page")
    table = heading.find_next("table")
    if not table:
        raise RuntimeError("Could not find the quarterly results table after the heading")
    return table


def extract_section(soap: BeautifulSoup, heading_text: str):
    heading = soap.find(lambda tag: tag.name in {"h2", "h3"} and heading_text in tag.get_text(" ", strip=True))
    if not heading:
        raise RuntimeError(f"Could not find '{heading_text}' section on the page")
    return heading


def section_tables(heading) -> List:
    tables = []
    current = heading
    while True:
        current = current.find_next_sibling()
        if current is None:
            break
        if getattr(current, "name", None) in {"h2", "h3"}:
            break
        if getattr(current, "name", None) == "table":
            tables.append(current)
        if getattr(current, "find_all", None):
            for table in current.find_all("table"):
                tables.append(table)

    deduped = []
    seen = set()
    for table in tables:
        marker = id(table)
        if marker not in seen:
            deduped.append(table)
            seen.add(marker)
    return deduped


def section_blocks(heading) -> List:
    blocks = []
    current = heading
    while True:
        current = current.find_next_sibling()
        if current is None:
            break
        if getattr(current, "name", None) in {"h2", "h3"}:
            break
        blocks.append(current)
    return blocks


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def extract_row_values(cells: Iterable[str]) -> List[str]:
    return [cell.replace("\u00a0", " ").strip() for cell in cells]


def parse_quarterly_rows(soup: BeautifulSoup, symbol: str, source_url: str) -> List[QuarterlyRow]:
    table = extract_quarterly_section(soup)
    rows = table.find_all("tr")
    if not rows:
        raise RuntimeError("Quarterly results table is empty")

    header_cells = [cell.get_text(" ", strip=True) for cell in rows[0].find_all(["th", "td"])]
    period_labels = header_cells[1:]
    if not period_labels:
        raise RuntimeError("Quarterly results table does not contain period columns")

    metrics: Dict[str, List[Optional[float]]] = {}
    for row in rows[1:]:
        cell_values = extract_row_values(cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"]))
        if len(cell_values) < 2:
            continue
        label = cell_values[0].lower()
        values = [parse_number(value) for value in cell_values[1:]]
        if label.startswith("sales"):
            metrics["sales"] = values
        elif label.startswith("revenue"):
            metrics["revenue"] = values
        elif label.startswith("net profit"):
            metrics["net_profit"] = values
        elif label.startswith("eps in rs"):
            metrics["eps"] = values
        elif label.startswith("opm %"):
            metrics["opm_percent"] = [parse_percent(value) for value in cell_values[1:]]

    if "sales" not in metrics and "revenue" in metrics:
        metrics["sales"] = metrics["revenue"]

    missing = [name for name in ("sales_or_revenue", "net_profit", "eps") if name == "sales_or_revenue" and "sales" not in metrics]
    missing.extend(name for name in ("net_profit", "eps") if name not in metrics)
    if missing:
        raise RuntimeError(
            "Quarterly results table is missing rows: "
            + ", ".join("sales/revenue" if name == "sales_or_revenue" else name for name in missing)
        )

    company_slug = slug_from_url(source_url)
    parsed_rows: List[QuarterlyRow] = []
    for index, period_label in enumerate(period_labels):
        parsed_rows.append(
            QuarterlyRow(
                symbol=normalize_symbol(symbol),
                company_slug=company_slug,
                period_label=period_label,
                period_end=parse_period_label(period_label),
                sales_rs_cr=metrics["sales"][index] if index < len(metrics["sales"]) else None,
                net_profit_rs_cr=metrics["net_profit"][index] if index < len(metrics["net_profit"]) else None,
                eps_rs=metrics["eps"][index] if index < len(metrics["eps"]) else None,
                opm_percent=metrics.get("opm_percent", [None] * len(period_labels))[index]
                if index < len(metrics.get("opm_percent", []))
                else None,
                source_url=source_url,
            )
        )
    return parsed_rows


def parse_market_cap(soup: BeautifulSoup) -> Optional[float]:
    for tag in soup.find_all(["li", "div", "tr"]):
        text = normalize_whitespace(tag.get_text(" ", strip=True))
        if not text:
            continue
        match = re.search(r"Market\s+Cap\s+₹\s*([\d,]+(?:\.\d+)?)\s*Cr\.?", text, re.IGNORECASE)
        if match:
            return parse_number(match.group(1))

    page_text = normalize_whitespace(soup.get_text(" ", strip=True))
    match = re.search(r"Market\s+Cap\s+₹\s*([\d,]+(?:\.\d+)?)\s*Cr\.?", page_text, re.IGNORECASE)
    if match:
        return parse_number(match.group(1))
    return None


def parse_classification(soup: BeautifulSoup) -> tuple[Optional[str], Optional[str], Optional[str]]:
    try:
        heading = extract_section(soup, "Peer comparison")
    except RuntimeError:
        return None, None, None

    classification_links: List[str] = []
    for block in section_blocks(heading):
        block_text = normalize_whitespace(block.get_text(" ", strip=True))
        if not block_text:
            continue
        if block_text.startswith("Part of") or "Detailed Comparison with:" in block_text:
            break

        links = [normalize_whitespace(link.get_text(" ", strip=True)) for link in block.find_all("a")]
        links = [link for link in links if link and link != "Edit Columns"]
        if links:
            classification_links = links
            break

    if not classification_links:
        return None, None, None

    sector = classification_links[0] if len(classification_links) > 0 else None
    broad_industry = classification_links[1] if len(classification_links) > 1 else None
    industry = classification_links[2] if len(classification_links) > 2 else None
    return sector, broad_industry, industry


def parse_company_profile(soup: BeautifulSoup, symbol: str, source_url: str) -> CompanyProfileRow:
    title = soup.find("h1")
    about_heading = soup.find(lambda tag: tag.get_text(" ", strip=True) == "About")
    about_text = None
    if about_heading:
        about_parts = []
        for current in section_blocks(about_heading):
            text = current.get_text(" ", strip=True)
            if text:
                about_parts.append(text)
        if about_parts:
            about_text = " ".join(about_parts)
        else:
            next_text_parts = []
            for text in about_heading.next_strings:
                cleaned = str(text).strip()
                if not cleaned or cleaned == "About":
                    continue
                if cleaned in {"Key Points", "Read More", "Pros", "Cons"}:
                    break
                next_text_parts.append(cleaned)
                if len(" ".join(next_text_parts)) >= 400:
                    break
            if next_text_parts:
                about_text = " ".join(next_text_parts)

    sector, broad_industry, industry = parse_classification(soup)

    return CompanyProfileRow(
        symbol=normalize_symbol(symbol),
        company_slug=slug_from_url(source_url),
        company_name=title.get_text(" ", strip=True) if title else None,
        about_text=about_text,
        market_cap_rs_cr=parse_market_cap(soup),
        sector=sector,
        broad_industry=broad_industry,
        industry=industry,
        source_url=source_url,
    )


def parse_shareholding_rows(soup: BeautifulSoup, symbol: str, source_url: str) -> List[ShareholdingRow]:
    heading = extract_section(soup, "Shareholding Pattern")
    tables = section_tables(heading)
    rows_out: List[ShareholdingRow] = []
    company_slug = slug_from_url(source_url)

    quarterly_tables = tables[:1]
    for table in quarterly_tables:
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [cell.get_text(" ", strip=True) for cell in rows[0].find_all(["th", "td"])]
        period_labels = header_cells[1:]
        if not period_labels:
            continue

        for row in rows[1:]:
            cell_values = extract_row_values(cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"]))
            if len(cell_values) < 2:
                continue
            category = cell_values[0]
            for col_index, period_label in enumerate(period_labels, start=1):
                raw_value = cell_values[col_index] if col_index < len(cell_values) else ""
                if not raw_value:
                    continue
                parsed_date = parse_period_label(period_label)
                if category.lower().startswith("no. of shareholders"):
                    rows_out.append(
                        ShareholdingRow(
                            symbol=normalize_symbol(symbol),
                            company_slug=company_slug,
                            view_type="quarterly",
                            period_label=period_label,
                            period_end=parsed_date,
                            holders_category="No. of Shareholders",
                            holding_percent=None,
                            shareholder_count=parse_number(raw_value),
                            source_url=source_url,
                        )
                    )
                else:
                    rows_out.append(
                        ShareholdingRow(
                            symbol=normalize_symbol(symbol),
                            company_slug=company_slug,
                            view_type="quarterly",
                            period_label=period_label,
                            period_end=parsed_date,
                            holders_category=category,
                            holding_percent=parse_percent(raw_value),
                            shareholder_count=None,
                            source_url=source_url,
                        )
                    )
    if rows_out:
        return rows_out

    full_page_text = normalize_whitespace(soup.get_text(" ", strip=True))
    section_match = re.search(r"Shareholding Pattern(.*?)Documents", full_page_text, re.IGNORECASE)
    section_text = normalize_whitespace(section_match.group(1)) if section_match else ""
    if not section_text:
        return []

    quarter_header_match = re.search(
        r"(?:Trades\s+)?((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+){3,}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})",
        section_text,
    )
    if not quarter_header_match:
        return []

    period_labels = re.findall(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}", quarter_header_match.group(1))
    if not period_labels:
        return []

    tail_text = section_text[quarter_header_match.end() :]
    yearly_header_match = re.search(
        r"((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+){3,}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})",
        tail_text,
    )
    quarterly_text = tail_text[: yearly_header_match.start()] if yearly_header_match else tail_text

    for category in ("Promoters", "FIIs", "DIIs", "Government", "Public", "No. of Shareholders"):
        pattern = re.compile(
            rf"{re.escape(category)}\s*\+?\s*((?:\d[\d,]*\.?\d*%?\s+){{{len(period_labels) - 1},}}\d[\d,]*\.?\d*%?)"
        )
        match = pattern.search(quarterly_text)
        if not match:
            continue
        values = re.findall(r"\d[\d,]*\.?\d*%?", match.group(1))
        if len(values) < len(period_labels):
            continue
        for period_label, raw_value in zip(period_labels, values[:len(period_labels)]):
            parsed_date = parse_period_label(period_label)
            if category == "No. of Shareholders":
                rows_out.append(
                    ShareholdingRow(
                        symbol=normalize_symbol(symbol),
                        company_slug=company_slug,
                        view_type="quarterly",
                        period_label=period_label,
                        period_end=parsed_date,
                        holders_category=category,
                        holding_percent=None,
                        shareholder_count=parse_number(raw_value),
                        source_url=source_url,
                    )
                )
            else:
                rows_out.append(
                    ShareholdingRow(
                        symbol=normalize_symbol(symbol),
                        company_slug=company_slug,
                        view_type="quarterly",
                        period_label=period_label,
                        period_end=parsed_date,
                        holders_category=category,
                        holding_percent=parse_percent(raw_value),
                        shareholder_count=None,
                        source_url=source_url,
                    )
                )
    return rows_out


def parse_peer_rows(soup: BeautifulSoup, symbol: str, source_url: str) -> List[PeerRow]:
    heading = extract_section(soup, "Peer comparison")
    company_slug = slug_from_url(source_url)
    peers: List[PeerRow] = []

    peer_table = None
    for table in section_tables(heading):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [
            normalize_whitespace(cell.get_text(" ", strip=True)).lower()
            for cell in rows[0].find_all(["th", "td"])
        ]
        if "name" in header_cells and len(rows) > 1:
            peer_table = table
            break

    if peer_table is None:
        return []

    rows = peer_table.find_all("tr")
    header_cells = [
        normalize_whitespace(cell.get_text(" ", strip=True)).lower()
        for cell in rows[0].find_all(["th", "td"])
    ]
    name_index = header_cells.index("name")
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) <= name_index:
            continue
        name_cell = cells[name_index]
        link = name_cell.find("a", href=True)
        if link is None:
            continue
        href = link["href"].strip()
        if "/company/" not in href:
            continue
        peer_name = normalize_whitespace(link.get_text(" ", strip=True))
        if not peer_name:
            continue
        full_peer_url = href if href.startswith("http") else f"https://www.screener.in{href}"
        match = re.search(r"/company/([^/]+)/", full_peer_url)
        peer_symbol = match.group(1).upper() if match else None
        peers.append(
            PeerRow(
                symbol=normalize_symbol(symbol),
                company_slug=company_slug,
                peer_symbol=peer_symbol,
                peer_name=peer_name,
                peer_url=full_peer_url,
                source_url=source_url,
            )
        )
    deduped: List[PeerRow] = []
    seen = set()
    for peer in peers:
        key = (peer.symbol, peer.peer_symbol, peer.peer_name, peer.peer_url)
        if key not in seen:
            deduped.append(peer)
            seen.add(key)
    return deduped


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS screener_quarterly_results (
                symbol TEXT NOT NULL,
                company_slug TEXT NOT NULL,
                period_label TEXT NOT NULL,
                period_end DATE NOT NULL,
                sales_rs_cr NUMERIC,
                net_profit_rs_cr NUMERIC,
                eps_rs NUMERIC,
                opm_percent NUMERIC,
                source_url TEXT NOT NULL,
                scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (symbol, period_end)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS screener_fetch_log (
                symbol TEXT PRIMARY KEY,
                source_url TEXT NOT NULL,
                last_scraped_at TIMESTAMPTZ NOT NULL,
                status TEXT NOT NULL,
                row_count INTEGER NOT NULL DEFAULT 0,
                error_message TEXT
            )
            """
        )
        cur.execute("ALTER TABLE screener_quarterly_results ADD COLUMN IF NOT EXISTS opm_percent NUMERIC")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS screener_company_profiles (
                symbol TEXT PRIMARY KEY,
                company_slug TEXT NOT NULL,
                company_name TEXT,
                about_text TEXT,
                market_cap_rs_cr NUMERIC,
                sector TEXT,
                broad_industry TEXT,
                industry TEXT,
                source_url TEXT NOT NULL,
                scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("ALTER TABLE screener_company_profiles ADD COLUMN IF NOT EXISTS market_cap_rs_cr NUMERIC")
        cur.execute("ALTER TABLE screener_company_profiles ADD COLUMN IF NOT EXISTS sector TEXT")
        cur.execute("ALTER TABLE screener_company_profiles ADD COLUMN IF NOT EXISTS broad_industry TEXT")
        cur.execute("ALTER TABLE screener_company_profiles ADD COLUMN IF NOT EXISTS industry TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS screener_shareholding_pattern (
                symbol TEXT NOT NULL,
                company_slug TEXT NOT NULL,
                view_type TEXT NOT NULL,
                period_label TEXT NOT NULL,
                period_end DATE NOT NULL,
                holders_category TEXT NOT NULL,
                holding_percent NUMERIC,
                shareholder_count NUMERIC,
                source_url TEXT NOT NULL,
                scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (symbol, view_type, period_end, holders_category)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS screener_earnings_dates (
                symbol TEXT NOT NULL,
                company_name TEXT,
                period_label TEXT NOT NULL,
                period_end DATE NOT NULL,
                earnings_date DATE NOT NULL,
                source_file TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (symbol, period_end)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS screener_peer_comparison (
                symbol TEXT NOT NULL,
                company_slug TEXT NOT NULL,
                peer_symbol TEXT,
                peer_name TEXT NOT NULL,
                peer_url TEXT NOT NULL,
                source_url TEXT NOT NULL,
                scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (symbol, peer_url)
            )
            """
        )
    conn.commit()


def last_fetch_is_fresh(conn: psycopg.Connection, symbol: str, min_refresh_hours: int) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT last_scraped_at
            FROM screener_fetch_log
            WHERE symbol = %s
              AND status = 'success'
            """,
            (symbol,),
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(hours=min_refresh_hours)
    return row[0] >= cutoff


def upsert_rows(conn: psycopg.Connection, rows: List[QuarterlyRow]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO screener_quarterly_results (
                symbol,
                company_slug,
                period_label,
                period_end,
                sales_rs_cr,
                net_profit_rs_cr,
                eps_rs,
                opm_percent,
                source_url,
                scraped_at,
                updated_at
            )
            VALUES (
                %(symbol)s,
                %(company_slug)s,
                %(period_label)s,
                %(period_end)s,
                %(sales_rs_cr)s,
                %(net_profit_rs_cr)s,
                %(eps_rs)s,
                %(opm_percent)s,
                %(source_url)s,
                NOW(),
                NOW()
            )
            ON CONFLICT (symbol, period_end) DO UPDATE SET
                company_slug = EXCLUDED.company_slug,
                period_label = EXCLUDED.period_label,
                sales_rs_cr = EXCLUDED.sales_rs_cr,
                net_profit_rs_cr = EXCLUDED.net_profit_rs_cr,
                eps_rs = EXCLUDED.eps_rs,
                opm_percent = EXCLUDED.opm_percent,
                source_url = EXCLUDED.source_url,
                scraped_at = NOW(),
                updated_at = NOW()
            """,
            [row.__dict__ for row in rows],
        )
    conn.commit()


def upsert_company_profile(conn: psycopg.Connection, row: CompanyProfileRow) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO screener_company_profiles (
                symbol,
                company_slug,
                company_name,
                about_text,
                market_cap_rs_cr,
                sector,
                broad_industry,
                industry,
                source_url,
                scraped_at,
                updated_at
            )
            VALUES (
                %(symbol)s,
                %(company_slug)s,
                %(company_name)s,
                %(about_text)s,
                %(market_cap_rs_cr)s,
                %(sector)s,
                %(broad_industry)s,
                %(industry)s,
                %(source_url)s,
                NOW(),
                NOW()
            )
            ON CONFLICT (symbol) DO UPDATE SET
                company_slug = EXCLUDED.company_slug,
                company_name = EXCLUDED.company_name,
                about_text = EXCLUDED.about_text,
                market_cap_rs_cr = EXCLUDED.market_cap_rs_cr,
                sector = EXCLUDED.sector,
                broad_industry = EXCLUDED.broad_industry,
                industry = EXCLUDED.industry,
                source_url = EXCLUDED.source_url,
                scraped_at = NOW(),
                updated_at = NOW()
            """,
            row.__dict__,
        )
    conn.commit()


def replace_symbol_dataset(conn: psycopg.Connection, table_name: str, symbol: str, rows: Sequence[dict], sql: str) -> None:
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {table_name} WHERE symbol = %s", (symbol,))
        if rows:
            cur.executemany(sql, rows)
    conn.commit()


def replace_shareholding_rows(conn: psycopg.Connection, symbol: str, rows: List[ShareholdingRow]) -> None:
    replace_symbol_dataset(
        conn,
        "screener_shareholding_pattern",
        symbol,
        [row.__dict__ for row in rows],
        """
        INSERT INTO screener_shareholding_pattern (
            symbol, company_slug, view_type, period_label, period_end, holders_category,
            holding_percent, shareholder_count, source_url, scraped_at, updated_at
        )
        VALUES (
            %(symbol)s, %(company_slug)s, %(view_type)s, %(period_label)s, %(period_end)s, %(holders_category)s,
            %(holding_percent)s, %(shareholder_count)s, %(source_url)s, NOW(), NOW()
        )
        """,
    )


def replace_peer_rows(conn: psycopg.Connection, symbol: str, rows: List[PeerRow]) -> None:
    replace_symbol_dataset(
        conn,
        "screener_peer_comparison",
        symbol,
        [row.__dict__ for row in rows],
        """
        INSERT INTO screener_peer_comparison (
            symbol, company_slug, peer_symbol, peer_name, peer_url, source_url, scraped_at, updated_at
        )
        VALUES (
            %(symbol)s, %(company_slug)s, %(peer_symbol)s, %(peer_name)s, %(peer_url)s, %(source_url)s, NOW(), NOW()
        )
        """,
    )


def record_fetch_status(
    conn: psycopg.Connection,
    symbol: str,
    source_url: str,
    status: str,
    row_count: int,
    error_message: Optional[str] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO screener_fetch_log (
                symbol,
                source_url,
                last_scraped_at,
                status,
                row_count,
                error_message
            )
            VALUES (%s, %s, NOW(), %s, %s, %s)
            ON CONFLICT (symbol) DO UPDATE SET
                source_url = EXCLUDED.source_url,
                last_scraped_at = EXCLUDED.last_scraped_at,
                status = EXCLUDED.status,
                row_count = EXCLUDED.row_count,
                error_message = EXCLUDED.error_message
            """,
            (symbol, source_url, status, row_count, error_message),
        )
    conn.commit()


def scrape_symbol(
    conn: psycopg.Connection,
    session: requests.Session,
    symbol: str,
    url: Optional[str],
    min_refresh_hours: int,
    max_retries: int,
    force: bool,
) -> int:
    normalized_symbol = normalize_symbol(symbol)
    candidate_urls = build_all_candidate_urls(normalized_symbol, url)
    source_url = candidate_urls[0]

    if not force and min_refresh_hours > 0 and last_fetch_is_fresh(conn, normalized_symbol, min_refresh_hours):
        log(f"Skipping {normalized_symbol}: last successful scrape is newer than {min_refresh_hours}h")
        return 0

    last_error: Optional[Exception] = None
    for attempt_url in candidate_urls:
        log(f"Fetching {normalized_symbol} from {attempt_url}")
        try:
            html = fetch_html(session, attempt_url, max_retries=max_retries)
            soup = BeautifulSoup(html, "html.parser")
            company_profile = parse_company_profile(soup, normalized_symbol, attempt_url)
            quarterly_rows = parse_quarterly_rows(soup, normalized_symbol, attempt_url)
            shareholding_rows = parse_shareholding_rows(soup, normalized_symbol, attempt_url)
            peer_rows = parse_peer_rows(soup, normalized_symbol, attempt_url)

            upsert_company_profile(conn, company_profile)
            upsert_rows(conn, quarterly_rows)
            replace_shareholding_rows(conn, normalized_symbol, shareholding_rows)
            replace_peer_rows(conn, normalized_symbol, peer_rows)
            record_fetch_status(conn, normalized_symbol, attempt_url, "success", len(quarterly_rows))
            log(
                f"Stored {len(quarterly_rows)} quarterly rows, "
                f"{len(shareholding_rows)} shareholding rows, {len(peer_rows)} peer rows for {normalized_symbol}"
            )
            return len(quarterly_rows)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            log(f"Fetch/parse failed for {normalized_symbol} at {attempt_url}: {exc}")

    record_fetch_status(conn, normalized_symbol, source_url, "error", 0, str(last_error)[:1000] if last_error else None)
    raise RuntimeError(
        f"All URL variants failed for {normalized_symbol}: {', '.join(candidate_urls)}"
    ) from last_error


def sleep_between_requests(base_seconds: float, jitter_seconds: float) -> None:
    if base_seconds <= 0 and jitter_seconds <= 0:
        return
    delay = max(0.0, base_seconds) + random.uniform(0.0, max(0.0, jitter_seconds))
    log(f"Sleeping {delay:.1f}s before next request")
    time.sleep(delay)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape Screener quarterly Sales, Net Profit, and EPS into PostgreSQL"
    )
    parser.add_argument("--symbol", help="Single NSE/BSE symbol, for example RRKABEL")
    parser.add_argument(
        "--symbols-file",
        help="Path to a text file or CSV. Text format: one symbol per line. CSV format: required 'symbol' column, optional 'url' column.",
    )
    parser.add_argument(
        "--url",
        help="Optional direct Screener URL. Defaults to https://www.screener.in/company/<SYMBOL>/ with /consolidated/ as fallback.",
    )
    parser.add_argument(
        "--db-url",
        default=os.getenv("SCREENER_PG_DSN") or os.getenv("DATABASE_URL"),
        help="PostgreSQL connection string. Defaults to SCREENER_PG_DSN or DATABASE_URL from env.",
    )
    parser.add_argument(
        "--min-refresh-hours",
        type=int,
        default=DEFAULT_MIN_REFRESH_HOURS,
        help="Skip re-fetch if a successful scrape happened more recently than this many hours.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_MAX_RETRIES,
        help="Maximum HTTP retries with backoff.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore freshness checks and fetch immediately.",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=DEFAULT_SLEEP_SECONDS,
        help="Base delay between symbols to keep scraping conservative.",
    )
    parser.add_argument(
        "--sleep-jitter-seconds",
        type=float,
        default=DEFAULT_SLEEP_JITTER_SECONDS,
        help="Extra random delay added between symbols.",
    )
    return parser.parse_args()


def main() -> int:
    load_dotenv()
    args = parse_args()
    if not args.db_url:
        print("Missing PostgreSQL DSN. Set SCREENER_PG_DSN or DATABASE_URL, or pass --db-url.", file=sys.stderr)
        return 2
    try:
        targets = resolve_targets(args.symbol, args.symbols_file, args.url)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 2
    if not targets:
        print("No symbols found to process.", file=sys.stderr)
        return 2

    with psycopg.connect(args.db_url) as conn:
        ensure_schema(conn)
        session = requests_session()
        success_count = 0
        skipped_count = 0
        error_count = 0
        total_rows = 0

        for index, target in enumerate(targets, start=1):
            log(f"{index}/{len(targets)} : {target.symbol}")
            try:
                row_count = scrape_symbol(
                    conn=conn,
                    session=session,
                    symbol=target.symbol,
                    url=target.url,
                    min_refresh_hours=max(0, args.min_refresh_hours),
                    max_retries=max(1, args.max_retries),
                    force=bool(args.force),
                )
                total_rows += row_count
                if row_count == 0:
                    skipped_count += 1
                else:
                    success_count += 1
            except Exception as exc:  # noqa: BLE001
                error_count += 1
                log(f"Error for {target.symbol}: {exc}")

            if index < len(targets):
                sleep_between_requests(args.sleep_seconds, args.sleep_jitter_seconds)

        log(
            "Done. "
            f"symbols={len(targets)} success={success_count} skipped={skipped_count} "
            f"errors={error_count} rows_inserted_or_updated={total_rows}"
        )
    return 1 if error_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
