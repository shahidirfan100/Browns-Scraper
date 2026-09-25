# Browns Shoes API Discovery

**Checked:** 2026-09-25  
**Purpose:** Replace the retired Salesforce Commerce Cloud token/search flow while preserving the supported search inputs and 13-field product dataset contract.

## Failure and baseline

The reported Apify run failed in `src/main.js` with `Failed to obtain guest token: HTTP 404`. The implementation requested a Salesforce SLAS guest token at `/mobify/slas/.../oauth2/token` before calling the related `/mobify/proxy/api/search/.../product-search` endpoint. That flow is no longer usable on the current storefront. The actor's existing local baseline also could not start because project dependencies were not installed (`ERR_MODULE_NOT_FOUND` for `apify`).

The old `/en/women/shoes/boots` storefront route returned 404. The current storefront uses Shopify collection routes such as `/collections/women` and exposes collection products as JSON.

## Selected API

- **Endpoint:** `https://www.brownsshoes.com/{locale-prefix}/collections/{collection-handle}/products.json?limit=20&page={page}`; omit `{locale-prefix}` for English and use `/fr` for French.
- **Method:** GET.
- **Authentication:** None observed. No cookies, guest token, API key, or authorization header was required in direct tests.
- **Pagination:** Shopify `page` parameter, starting at 1; the actor requests 20 products per page internally. This batch size is fixed and is not a public input. Requests for pages 1 and 2 returned distinct items for the tested collections.
- **Response marker:** JSON object with a `products` array.
- **Categories verified:** `women`, `men`, `kids`, and `sale` returned HTTP 200 product arrays. `womens-boots` and `mens-sneakers` were also verified as specific collection handles.
- **French route:** `/fr/collections/women/products.json` returned HTTP 200 with French product titles. `/fr/collections/femmes/products.json` returned an empty `products` array, so the English collection handle is retained in the French route.
- **Product fields available:** Shopify product `id`, `title`, `handle`, `body_html`, `vendor`, `tags`, `variants`, `images`, and `options`. Variants include `price`, `compare_at_price`, `available`, and size titles. Tags include `Color: ...` and Browns `Product ID: ...` values.
- **Fields mapped to the existing dataset:** `title`, `brand`, `price`, `originalPrice`, `currency`, `url`, `image`, `images`, `colors`, `sizes`, `inStock`, `productId`, and `description`. No public output fields were added or renamed.
- **Plain HTTP:** Direct Node.js `fetch` requests returned usable JSON without endpoint-specific headers. The actor uses one reusable Impit Chrome-profile client; it does not invent browser fingerprint headers.
- **Proxy/session:** Direct checks used no proxy. No sticky session, country selection, cookies, or proxy rotation was evidenced as necessary. When a proxy is configured by the actor user, one generated proxy URL is reused for the run.
- **HTTP version:** No HTTP version override was required or tested.

## Evidence matrix

| Candidate                                                       | Test/profile                                 | Status and body marker                                                                     | Fields / pagination                                                                        | Decision                                                                           |
| --------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Shopify women collection                                        | Direct Node `fetch`, no custom headers       | HTTP 200; JSON `products` array                                                            | Product, variant, image, option, and tag fields; pages 1 and 2 returned different products | Selected                                                                           |
| Shopify men, kids, and sale collections                         | Direct Node `fetch`, no custom headers       | HTTP 200; JSON `products` arrays                                                           | Same product schema; pages 1 and 2 returned different products                             | Selected category handles                                                          |
| Shopify `womens-boots` collection                               | Direct Node `fetch`, no custom headers       | HTTP 200; JSON `products` array                                                            | Same product fields; pages 1 and 2 returned different products                             | Supported for explicit collection URLs                                             |
| Shopify `mens-sneakers` collection                              | Direct Node `fetch`, no custom headers       | HTTP 200; JSON `products` array                                                            | Same product fields                                                                        | Supported for explicit collection URLs                                             |
| Shopify `vendor=UGG` query parameter                            | Direct Node `fetch` against women collection | HTTP 200; response product IDs/vendors matched the unfiltered first page, including ADIDAS | Query does not filter the returned products                                                | Rejected as a brand-filter mechanism; brand filter is applied locally while paging |
| Shopify `/collections/{handle}/{vendor}/products.json`          | Direct Node `fetch`                          | Did not return valid JSON                                                                  | No usable product payload                                                                  | Rejected                                                                           |
| Shopify `/products/{handle}.json`                               | Direct Node `fetch`                          | HTTP 200; JSON `product` object                                                            | Product details available, but unnecessary for collection extraction                       | Not selected; collection feed already has required fields                          |
| Shopify `/fr/collections/femmes`                                | Direct Node `fetch`                          | HTTP 200; empty `products` array                                                           | No products                                                                                | Rejected; French uses `/fr/collections/women`                                      |
| Legacy `/en/women/shoes/boots` route                            | Live storefront check                        | HTTP 404                                                                                   | No product data                                                                            | Rejected as an obsolete URL format                                                 |
| Salesforce SLAS guest token and product search                  | Failed Apify run log                         | Token request returned HTTP 404 before search could run                                    | No usable response                                                                         | Rejected as retired flow                                                           |
| iOS Safari, Android app/API, URLScan, and Playwright candidates | Not tested                                   | Not needed after the public collection JSON feed returned the required fields              | No additional candidate evidence gathered                                                  | Not pursued                                                                        |

## Filtering and URL behavior

Shopify's public collection endpoint did not honor `vendor=UGG`; the actor therefore compares the `vendor` value case-insensitively in each fetched page and continues through the configured `maxPages` limit. `startUrls` accepts Browns Shoes collection URLs. A URL under `/collections/{handle}` selects that collection directly; recognized older gender/category routes resolve to the corresponding current category collection. French collection requests retain the `/fr` prefix for localized product titles. Product URLs in the output use the canonical `/products/{handle}` path.

The legacy category IDs `1`, `2`, `4`, and `sale` are mapped to the verified current collection handles for old URLs that still supply those values. Arbitrary Salesforce category IDs are not mapped.

## Retry and response handling

The actor retries only network failures, HTTP 429, and HTTP 5xx responses, with a finite three-attempt budget. It honors a valid `Retry-After` value up to a 10-second cap, then uses bounded backoff. Other non-2xx statuses, non-JSON responses, malformed JSON, and unexpected response shapes fail with a concise error. Successful responses are pushed to the dataset page by page.
