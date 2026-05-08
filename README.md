# Browns Shoes Scraper

Extract comprehensive product data from Browns Shoes with ease. Collect detailed listings including brands, pricing, images, and availability at scale. Perfect for retail research, price monitoring, and competitive analysis.

---

## Features

- **Comprehensive Data** — Capture product names, brands, prices, images, colors, and stock status.
- **Flexible Filtering** — Narrow down results by category, brand, and custom start URLs.
- **Smart Pagination** — Automatically navigates through result pages to reach your desired count.
- **High Performance** — Optimized for speed and efficiency using direct data sources.
- **Global Reach** — Supports both English and French versions of the Browns Shoes platform.

---

## Use Cases

### Retail Market Intelligence
Analyze shoe assortments, track brand presence, and monitor new arrivals across different categories. Understand market trends and product variety in real-time.

### Competitive Price Monitoring
Track price fluctuations, original vs. sale prices, and discount patterns. Build datasets for price comparison and benchmarking against other retailers.

### Inventory and Availability Tracking
Monitor stock levels and size availability for specific brands or categories. Identify popular items and restocking patterns across the entire catalog.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | Array | No | `[]` | Optional Browns category URLs to scrape. |
| `category` | String | No | `"women"` | Category to scrape: `women`, `men`, `kids`, or `sale`. |
| `brand` | String | No | — | Optional brand filter (e.g., "UGG", "Adidas"). |
| `maxItems` | Integer | No | `20` | Maximum number of products to save. |
| `maxPages` | Integer | No | `5` | Maximum number of result pages to process per category. |
| `pageSize` | Integer | No | `20` | Number of products fetched per request (max 200). |
| `proxyConfiguration` | Object | No | — | Optional proxy settings for reliable extraction. |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Product name and model |
| `brand` | String | Manufacturer or brand name |
| `price` | Number | Current selling price |
| `originalPrice` | Number | Regular price before discounts |
| `currency` | String | Price currency (e.g., CAD) |
| `url` | String | Direct link to the product page |
| `image` | String | Primary product image URL |
| `images` | Array | List of all available product image URLs |
| `colors` | Array | Available color options |
| `sizes` | Array | Available size options |
| `inStock` | Boolean | Availability status |
| `productId` | String | Unique product identifier |
| `description` | String | Short product description |

---

## Usage Examples

### Basic Category Scrape

Extract the latest products from the Women's category:

```json
{
    "category": "women",
    "maxItems": 50
}
```

### Brand-Specific Extraction

Collect products from a specific brand with custom pagination:

```json
{
    "category": "men",
    "brand": "Adidas",
    "maxItems": 100,
    "pageSize": 50
}
```

### Multiple Categories via URLs

Scrape multiple specific categories using direct URLs:

```json
{
    "startUrls": [
        { "url": "https://www.brownsshoes.com/en/women/shoes/boots" },
        { "url": "https://www.brownsshoes.com/en/men/shoes/sneakers" }
    ],
    "maxItems": 200
}
```

---

## Sample Output

```json
{
    "title": "CLASSIC ULTRA MINI",
    "brand": "UGG",
    "price": 175,
    "originalPrice": null,
    "currency": "CAD",
    "url": "https://www.brownsshoes.com/en/women/shoes/boots/277259.html",
    "image": "https://www.brownsshoes.com/dw/image/v2/BFTX_PRD/on/demandware.static/-/Sites-BrownsShoes-Master/default/dw1578e94d/images/277259_1.jpg",
    "images": [
        "https://www.brownsshoes.com/dw/image/v2/BFTX_PRD/on/demandware.static/-/Sites-BrownsShoes-Master/default/dw1578e94d/images/277259_1.jpg",
        "https://www.brownsshoes.com/dw/image/v2/BFTX_PRD/on/demandware.static/-/Sites-BrownsShoes-Master/default/dw7695349e/images/277259_2.jpg"
    ],
    "colors": [
        "Chestnut",
        "Black",
        "Grey"
    ],
    "sizes": [
        "5",
        "6",
        "7",
        "8",
        "9",
        "10"
    ],
    "inStock": true,
    "productId": "277259",
    "description": "The Classic Ultra Mini updates our most iconic silhouette with a lower shaft height, adding easy on-off and enhanced versatility."
}
```

---

## Tips for Best Results

### Use Residential Proxies
- Residential proxies are recommended for high-volume scraping to ensure reliability.
- They help avoid rate limits and ensure consistent access to data.

### Optimize Result Count
- Start with a small `maxItems` (e.g., 20-50) for testing.
- Increase the count once you've verified the output meets your needs.

### Leveraging Start URLs
- Use `startUrls` when you want to scrape specific sub-categories or filtered pages.
- The scraper automatically detects the category and locale from the URL.

---

## Integrations

Connect your data with:

- **Google Sheets** — Export for analysis
- **Airtable** — Build searchable databases
- **Slack** — Get notifications
- **Webhooks** — Send to custom endpoints
- **Make** — Create automated workflows

### Export Formats

- **JSON** — For developers and APIs
- **CSV** — For spreadsheet analysis
- **Excel** — For business reporting
- **XML** — For system integrations

---

## Frequently Asked Questions

### How many products can I collect?
You can collect as many products as are available on the website. Use `maxItems` to control the total number of results.

### Does it support sale items?
Yes, you can specifically target the "Sale" category or see discounted prices in any category scrape.

### Can I filter by multiple brands?
Currently, the brand filter supports one brand at a time. To scrape multiple brands, you can use `startUrls` pointing to filtered pages.

### Is the data updated in real-time?
The scraper fetches the current data available on the website at the time of the run.

### Does it handle different languages?
Yes, the scraper supports both English and French URLs and data.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.
