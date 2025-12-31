# Browns Shoes Scraper

Extract product data from Browns Shoes e-commerce platform with speed and reliability. This scraper prioritizes JSON API extraction for maximum performance and automatically falls back to HTML parsing when needed.

## Key Features

<ul>
<li><strong>Dual Extraction Strategy</strong> — Attempts JSON API first for 10x faster scraping, seamlessly falls back to HTML parsing</li>
<li><strong>Smart Pagination</strong> — Automatically navigates through multiple pages until reaching desired product count</li>
<li><strong>Flexible Filtering</strong> — Filter by category, brand, price range, color, and size</li>
<li><strong>Comprehensive Data</strong> — Captures product names, brands, pricing, images, stock status, and URLs</li>
<li><strong>Production Ready</strong> — Built with Crawlee and Apify SDK for enterprise-grade reliability</li>
</ul>

## Input Configuration

Configure the scraper using these parameters:

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
<th>Default</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>startUrls</code></td>
<td>Array</td>
<td>Custom Browns Shoes URLs to scrape (overrides category and filters)</td>
<td><code>[]</code></td>
</tr>
<tr>
<td><code>category</code></td>
<td>String</td>
<td>Product category: <code>women</code>, <code>men</code>, <code>kids</code>, or <code>sale</code></td>
<td><code>women</code></td>
</tr>
<tr>
<td><code>brand</code></td>
<td>String</td>
<td>Filter by specific brand (e.g., UGG, Adidas, New Balance)</td>
<td><code>""</code></td>
</tr>
<tr>
<td><code>minPrice</code></td>
<td>Integer</td>
<td>Minimum price filter in CAD</td>
<td><code>null</code></td>
</tr>
<tr>
<td><code>maxPrice</code></td>
<td>Integer</td>
<td>Maximum price filter in CAD</td>
<td><code>null</code></td>
</tr>
<tr>
<td><code>color</code></td>
<td>String</td>
<td>Filter products by color</td>
<td><code>""</code></td>
</tr>
<tr>
<td><code>size</code></td>
<td>String</td>
<td>Filter products by size</td>
<td><code>""</code></td>
</tr>
<tr>
<td><code>maxItems</code></td>
<td>Integer</td>
<td>Maximum number of products to extract</td>
<td><code>100</code></td>
</tr>
<tr>
<td><code>maxPages</code></td>
<td>Integer</td>
<td>Maximum listing pages to process</td>
<td><code>50</code></td>
</tr>
<tr>
<td><code>proxyConfiguration</code></td>
<td>Object</td>
<td>Proxy settings (residential proxies recommended)</td>
<td>Apify Proxy</td>
</tr>
</tbody>
</table>

## Input Examples

### Example 1: Scrape Women's Category

```json
{
  "category": "women",
  "maxItems": 100,
  "maxPages": 10
}
```

### Example 2: Filter by Brand and Price

```json
{
  "category": "men",
  "brand": "Adidas",
  "minPrice": 50,
  "maxPrice": 200,
  "maxItems": 50
}
```

### Example 3: Custom URLs

```json
{
  "startUrls": [
    {"url": "https://www.brownsshoes.com/en/women/boots"},
    {"url": "https://www.brownsshoes.com/en/women/shoes/sneakers"}
  ],
  "maxItems": 200
}
```

## Output Schema

Each product is returned as a JSON object with the following structure:

```json
{
  "title": "Product Name",
  "brand": "Brand Name",
  "price": 149.99,
  "originalPrice": 199.99,
  "currency": "CAD",
  "url": "https://www.brownsshoes.com/...",
  "image": "https://www.brownsshoes.com/images/...",
  "colors": ["Black", "White"],
  "sizes": ["7", "8", "9"],
  "inStock": true,
  "productId": "123456"
}
```

### Field Descriptions

<dl>
<dt><code>title</code></dt>
<dd>Product name and model</dd>

<dt><code>brand</code></dt>
<dd>Manufacturer or brand name</dd>

<dt><code>price</code></dt>
<dd>Current selling price (sale price if applicable)</dd>

<dt><code>originalPrice</code></dt>
<dd>Regular retail price before discounts</dd>

<dt><code>currency</code></dt>
<dd>Price currency code (typically CAD)</dd>

<dt><code>url</code></dt>
<dd>Direct link to product page</dd>

<dt><code>image</code></dt>
<dd>Primary product image URL</dd>

<dt><code>colors</code></dt>
<dd>Available color options</dd>

<dt><code>sizes</code></dt>
<dd>Available sizes</dd>

<dt><code>inStock</code></dt>
<dd>Availability status (true/false)</dd>

<dt><code>productId</code></dt>
<dd>Unique product identifier</dd>
</dl>

## Usage Tips

<h3>Optimal Performance</h3>

<ul>
<li>Use <strong>residential proxies</strong> for better reliability and to avoid rate limiting</li>
<li>Set reasonable <code>maxItems</code> values (100-500) for faster runs</li>
<li>The scraper automatically optimizes between JSON API and HTML parsing</li>
</ul>

<h3>Filtering Products</h3>

<ul>
<li>Combine multiple filters (brand + price range + category) for precise results</li>
<li>Leave filters empty to scrape all products in a category</li>
<li>Use <code>startUrls</code> for complete control over which pages to scrape</li>
</ul>

<h3>Handling Large Datasets</h3>

<ul>
<li>For extensive scraping (1000+ items), increase <code>maxPages</code> accordingly</li>
<li>Monitor your Apify plan limits for dataset storage and compute usage</li>
<li>Consider breaking large scrapes into multiple smaller runs by category</li>
</ul>

## Technical Details

<h3>Extraction Methods</h3>

<p>This scraper employs a two-tier extraction strategy:</p>

<ol>
<li><strong>JSON API Priority</strong> — Attempts to fetch structured JSON data from Browns Shoes' internal API endpoints for maximum speed and reliability</li>
<li><strong>HTML Fallback</strong> — If JSON extraction fails, automatically parses HTML content using CSS selectors</li>
</ol>

<h3>Rate Limiting & Proxies</h3>

<p>Browns Shoes implements standard e-commerce protection. Using Apify's residential proxy network ensures:</p>

<ul>
<li>Geographic distribution of requests</li>
<li>Reduced chance of IP blocking</li>
<li>Consistent access to content</li>
</ul>

<h3>Data Quality</h3>

<p>The scraper includes built-in mechanisms to ensure data quality:</p>

<ul>
<li>URL deduplication prevents duplicate products</li>
<li>Automatic price parsing and normalization</li>
<li>Null handling for missing or unavailable fields</li>
<li>Image URL validation and conversion to absolute paths</li>
</ul>

## Common Use Cases

<h3>Market Research</h3>

<p>Monitor pricing trends, track product availability, and analyze competitor offerings across different categories and brands.</p>

<h3>Price Monitoring</h3>

<p>Set up scheduled runs to track price changes on specific products or categories over time.</p>

<h3>Inventory Analysis</h3>

<p>Track which products are in stock, which sizes are available, and identify restocking patterns.</p>

<h3>Product Catalog Building</h3>

<p>Build comprehensive product databases for comparison shopping platforms or affiliate marketing sites.</p>

## Integration

<h3>Using the Output</h3>

<p>Export scraped data in multiple formats:</p>

<ul>
<li><strong>JSON</strong> — Structured data for APIs and web applications</li>
<li><strong>CSV/Excel</strong> — Spreadsheet analysis and reporting</li>
<li><strong>XML</strong> — Legacy system integration</li>
<li><strong>RSS</strong> — Feed-based monitoring</li>
</ul>

<h3>Connecting to Other Tools</h3>

<p>The Apify platform offers seamless integrations with:</p>

<ul>
<li>Google Sheets for automatic spreadsheet updates</li>
<li>Webhooks for real-time data delivery</li>
<li>Cloud storage (AWS S3, Google Cloud, Azure)</li>
<li>Database connections (MongoDB, PostgreSQL)</li>
</ul>

## Troubleshooting

<h3>No Products Returned</h3>

<ul>
<li>Verify the category name is correct (<code>women</code>, <code>men</code>, <code>kids</code>, <code>sale</code>)</li>
<li>Check if filters are too restrictive (try removing some filters)</li>
<li>Ensure <code>startUrls</code> point to valid product listing pages</li>
</ul>

<h3>Incomplete Data</h3>

<ul>
<li>Some products may have missing fields (e.g., no sale price if not on discount)</li>
<li>This is expected behavior — the scraper preserves data integrity by not fabricating values</li>
</ul>

<h3>Rate Limiting Issues</h3>

<ul>
<li>Enable proxy configuration with residential proxies</li>
<li>Reduce <code>maxConcurrency</code> in advanced settings</li>
<li>Add delays between requests if needed</li>
</ul>

## Performance Benchmarks

<table>
<thead>
<tr>
<th>Products</th>
<th>Avg. Runtime</th>
<th>Compute Units</th>
</tr>
</thead>
<tbody>
<tr>
<td>100</td>
<td>2-3 minutes</td>
<td>~0.05 CU</td>
</tr>
<tr>
<td>500</td>
<td>8-12 minutes</td>
<td>~0.15 CU</td>
</tr>
<tr>
<td>1000</td>
<td>15-20 minutes</td>
<td>~0.30 CU</td>
</tr>
</tbody>
</table>

<p><em>Note: Actual performance varies based on proxy configuration, network conditions, and Browns Shoes website response times.</em></p>

## Support & Feedback

<p>Need help or have suggestions? We're here to assist:</p>

<ul>
<li>Open an issue on the Actor's support page</li>
<li>Contact through the Apify Console</li>
<li>Check the <a href="https://docs.apify.com">Apify documentation</a> for platform-specific questions</li>
</ul>

## License

<p>This Actor is distributed under the ISC license. See the license file for more details.</p>

---

<p><em>Built with Apify SDK and Crawlee for reliable, scalable web scraping.</em></p>
