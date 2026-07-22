from __future__ import annotations
import asyncio
import pandas as pd
from pathlib import Path
from playwright.async_api import async_playwright

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

BASE_URL = "https://blweb.fremont.gov/PrimeWeb/Search/Index/BusinessLicense"

FOOD_TYPE_IDS = {
    "82": "Restaurant",
}


async def scrape_type(page, type_id: str, type_name: str) -> list[dict]:
    print(f"Scraping: {type_name} (id={type_id})")
    await page.goto(BASE_URL)

    # Select "Business Type" search mode
    await page.select_option("select[name='SelectedSearchType']", "Business Type")
    await page.select_option("select[name='BusinessTypeId']", type_id)
    await page.click("input[name='submitButton']")
    await page.wait_for_load_state("networkidle")

    rows = await extract_table(page)
    print(f"  {len(rows)} records")
    return rows


async def extract_table(page) -> list[dict]:
    rows = []
    # Results are always in the 3rd table (index 2); first two are the search form
    tables = page.locator("table")
    if await tables.count() < 3:
        return rows

    table = tables.nth(2)
    headers = [await th.inner_text() for th in await table.locator("th").all()]
    headers = [h.strip() for h in headers]

    for tr in await table.locator("tr").all():
        cells = [await td.inner_text() for td in await tr.locator("td").all()]
        if cells and len(cells) == len(headers):
            rows.append(dict(zip(headers, [c.strip() for c in cells])))

    return rows


async def run_async() -> pd.DataFrame:
    all_records = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        for type_id, type_name in FOOD_TYPE_IDS.items():
            records = await scrape_type(page, type_id, type_name)
            for r in records:
                r["business_type"] = type_name
            all_records.extend(records)

        await browser.close()

    df = pd.DataFrame(all_records)
    df.to_csv(RAW_DIR / "fremont_licenses_raw.csv", index=False)
    print(f"\nTotal records scraped: {len(df)}")
    return df


def run() -> pd.DataFrame:
    return asyncio.run(run_async())


if __name__ == "__main__":
    run()
