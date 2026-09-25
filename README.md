## What does Browns Shoes Scraper do?

Browns Shoes Scraper collects product listings from Browns Shoes categories and collections. Choose a category such as women, men, kids, or sale, or provide one or more Browns Shoes collection URLs. The dataset includes product names, brands, current and original prices, images, colors, sizes, availability, product links, and descriptions for retail research and price monitoring.

## Why use Browns Shoes Scraper?

- **Product research** - Review Browns Shoes products and brands without copying listings by hand.
- **Price monitoring** - Compare current prices with original prices when a discount is listed.
- **Inventory checks** - Track whether products have at least one available variant.
- **Repeatable collection** - Set result limits, page depth, brand filters, and optional proxy settings, then run on demand or schedule through Apify.

## What data can you extract from Browns Shoes?

| Field           | Type           | Description                                             |
| --------------- | -------------- | ------------------------------------------------------- |
| `title`         | String         | Product name and model                                  |
| `brand`         | String         | Product brand                                           |
| `price`         | Number or null | Lowest current variant price                            |
| `originalPrice` | Number or null | Highest listed compare-at price above the current price |
| `currency`      | String         | Store currency, reported as CAD                         |
| `url`           | String         | Canonical product page URL                              |
| `image`         | String or null | Primary product image URL                               |
| `images`        | Array          | Product image URLs                                      |
| `colors`        | Array          | Product color values                                    |
| `sizes`         | Array          | Product size values                                     |
| `inStock`       | Boolean        | Whether any product variant is available                |
| `productId`     | String or null | Browns product ID when available                        |
| `description`   | String or null | Product description text                                |

## How to use Browns Shoes Scraper

1. Choose a category or enter one or more collection URLs.
2. Set the maximum number of products and pages to collect.
3. Optionally filter the results by brand or configure a proxy.
4. Run the Actor and review the dataset.
5. Export results as JSON, CSV, Excel, XML, or connect the dataset to another Apify integration.

## Input Parameters

| Parameter        | Type    | Required | Default | Description                                                                                                                                                                                                         |
| ---------------- | ------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startUrls`      | Array   | No       | `[]`    | Browns Shoes collection URLs. When supplied, these take precedence over `category`. Use URLs such as `https://www.brownsshoes.com/collections/womens-boots`. A French collection can use a `/fr/collections/` path. |
| `category`       | String  | No       | `women` | Category to collect when `startUrls` is empty: `women`, `men`, `kids`, or `sale`.                                                                                                                                   |
| `brand`          | String  | No       | -       | Optional case-insensitive brand filter, such as `UGG` or `Adidas`.                                                                                                                                                  |
| `results_wanted` | Integer | No       | `20`    | Maximum number of products to save across all selected collections.                                                                                                                                                 |
| `maxPages`       | Integer | No       | `5`     | Maximum number of collection pages to read for each target.                                                                                                                                                         |

| `proxyConfiguration` | Object | No | Disabled | Optional Apify Proxy or custom proxy settings. |

## Usage Examples

### Collect women's products

Collect up to 50 products from the default women's collection:

```json
{
    "category": "women",
    "results_wanted": 50
}
```

### Collect from specific collections

Use current Browns Shoes collection links to target subcategories:

```json
{
    "startUrls": [
        { "url": "https://www.brownsshoes.com/collections/womens-boots" },
        { "url": "https://www.brownsshoes.com/collections/mens-sneakers" }
    ],
    "results_wanted": 100,
    "maxPages": 5
}
```

### Filter by brand

Collect Adidas products from the men's category. Increase `maxPages` if the brand is not present near the beginning of the collection:

```json
{
    "category": "men",
    "brand": "Adidas",
    "results_wanted": 100,
    "maxPages": 25
}
```

## Sample Output

```json
{
    "title": "NEW BALANCE | 327 | TAUPE | WOMEN",
    "brand": "NEW BALANCE",
    "price": 109.98,
    "originalPrice": 130,
    "currency": "CAD",
    "url": "https://www.brownsshoes.com/products/new-balance-327-angora-silver-metallic-women",
    "image": "https://cdn.shopify.com/s/files/1/0840/2350/9228/files/282799_1.jpg?v=1790240795",
    "images": [
        "https://cdn.shopify.com/s/files/1/0840/2350/9228/files/282799_1.jpg?v=1790240795",
        "https://cdn.shopify.com/s/files/1/0840/2350/9228/files/282799_5.jpg?v=1790240795"
    ],
    "colors": ["ANGORA/SILVER METALLIC"],
    "sizes": ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "11", "12"],
    "inStock": true,
    "productId": "282799",
    "description": "Taking inspiration from the 70s era, the 327 is a re-energized silhouette that boldly reshapes classic elements for a thoroughly contemporary look. Featuring angular reworking, this runner has an asymmetrically placed letter N branding and wraparound trail-inspired lug outsole for extra grip."
}
```

## Tips for Best Results

- Start with a modest `results_wanted` value to review the dataset before larger runs.
- Use a current `/collections/{handle}` URL for a specific subcategory.
- Use `maxPages` to allow more results when filtering for a brand that appears later in a collection.
- The `brand` filter matches the product's brand name and is not a Shopify collection URL filter.
- Product prices, availability, color, size, and descriptions reflect the listing data available when the Actor runs. A product may have no `originalPrice` if the store does not list a compare-at price.
- Use Apify schedules to repeat collection runs, and export datasets as JSON, CSV, Excel, or XML for further analysis.

## Integrations

- **Google Sheets** - Review and compare product data in a spreadsheet.
- **Airtable** - Maintain a product catalog for research or monitoring.
- **Webhooks** - Send run results to downstream systems.
- **Make** - Automate follow-up workflows with collected products.
- **Dataset API** - Retrieve completed run data programmatically.

## Frequently Asked Questions

### Can I collect sale products?

Yes. Set `category` to `sale` or use a Browns Shoes collection URL for a sale collection.

### Can I collect products from more than one collection?

Yes. Add multiple collection URLs to `startUrls`. The `results_wanted` limit applies to the total number of products saved across those collections.

### Can I filter by more than one brand?

The `brand` input accepts one brand name per run. Run the Actor separately for each brand if you need multiple brand-specific datasets.

### Can I use French collection pages?

Yes. Use a current Browns Shoes URL that includes `/fr/collections/`. French collection requests can return localized product titles; product links use the canonical product URL.

### Why are some fields empty?

Some products may not have a compare-at price, description, images, or variant data in the current listing. Missing source values are returned as null or an empty array where appropriate.

### Can I export results to CSV or Excel?

Yes. Apify datasets can be downloaded in CSV, Excel, JSON, XML, and other supported formats.

### Is this Actor suitable for scheduled collection runs?

Yes. Create an Apify schedule to run the Actor hourly, daily, weekly, or on another interval.

### Is it legal to collect Browns Shoes product data?

Users are responsible for complying with applicable laws and Browns Shoes website terms. Use collected data responsibly.

## Related Actors

- [Myntra Product Scraper 🛍️](https://apify.com/shahidirfan/myntra-product-scraper) - Collect fashion product listings, prices, sizes, and availability for catalog and price research.
- [Shein Product Scraper](https://apify.com/shahidirfan/shein-product-scraper) - Gather apparel product prices, images, sizes, and discounts for fashion market monitoring.
- [Flipkart Product Scraper 🛒](https://apify.com/shahidirfan/flipkart-product-scraper) - Collect marketplace product listings, prices, ratings, and availability for ecommerce analysis.

## Support

For issues or feature requests, contact support through the Apify Console.

## Legal Notice

This Actor is designed for legitimate data collection from publicly available sources. Users are responsible for using the data responsibly and complying with applicable laws and website terms.
