import asyncio
from playwright.async_api import async_playwright

BASE_URL = "https://blweb.fremont.gov/PrimeWeb/Search/Index/BusinessLicense"

async def debug():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # visible so you can see what happens
        page = await browser.new_page()
        await page.goto(BASE_URL)
        await page.select_option("select[name='SelectedSearchType']", "Business Type")
        await page.select_option("select[name='BusinessTypeId']", "82")
        await page.click("input[name='submitButton']")
        await page.wait_for_load_state("networkidle")

        # Print page URL and all text content
        print("URL after submit:", page.url)
        num_tables = await page.locator("table").count()
        print("Tables found:", num_tables)

        for i in range(num_tables):
            t = page.locator("table").nth(i)
            text = await t.inner_text()
            print(f"\n--- TABLE {i} ---")
            print(text[:500])

        print("\nAll links:")
        for a in await page.locator("a").all():
            print(" ", await a.inner_text(), "|", await a.get_attribute("href"))

        await browser.close()

asyncio.run(debug())
