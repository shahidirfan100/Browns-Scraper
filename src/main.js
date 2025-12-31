import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';
import { load } from 'cheerio';

const BASE_URL = 'https://www.brownsshoes.com';
const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_PAGE_SIZE = 20;

const headerGenerator = new HeaderGenerator({
    browsers: [{ name: 'chrome', minVersion: 114 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos', 'linux'],
});

const proxyState = {
    disabled: false,
    reason: null,
    authFailed: false,
};

const toAbs = (href) => {
    try {
        return new URL(href, BASE_URL).href;
    } catch {
        return null;
    }
};

const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(String(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(num) ? num : null;
};

const uniqStrings = (values) => [...new Set(values.filter(Boolean))];

const getSessionHeaders = (session) => {
    if (!session) return headerGenerator.getHeaders();
    if (!session.userData.headers) {
        session.userData.headers = headerGenerator.getHeaders();
    }
    return session.userData.headers;
};

const isProxyAuthError = (message) => {
    if (!message) return false;
    const text = message.toString();
    return (
        text.includes('UPSTREAM407') ||
        text.includes('Proxy responded with 597') ||
        /proxy/i.test(text) && /407|597/.test(text)
    );
};

const disableProxy = (reason, logger) => {
    if (proxyState.disabled) return;
    proxyState.disabled = true;
    proxyState.reason = reason || 'Proxy authentication failed';
    logger?.warning?.(`Proxy disabled for this run: ${proxyState.reason}`);
};

const resolveProxyUrl = async ({ proxyConfiguration, session, logger }) => {
    if (!proxyConfiguration || proxyState.disabled) return undefined;
    try {
        return await proxyConfiguration.newUrl(session?.id);
    } catch (err) {
        disableProxy(`Proxy configuration error: ${err?.message || err}`, logger);
        return undefined;
    }
};

const extractJsonObject = (text, startIndex) => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIndex; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return text.slice(startIndex, i + 1);
            }
        }
    }
    return null;
};

const extractJsonAfterToken = (html, token) => {
    const tokenIndex = html.indexOf(token);
    if (tokenIndex === -1) return null;
    const separatorIndex = html.indexOf(':', tokenIndex + token.length);
    const assignIndex = html.indexOf('=', tokenIndex + token.length);
    const pivot = separatorIndex !== -1 ? separatorIndex : assignIndex;
    if (pivot === -1) return null;
    const startIndex = html.indexOf('{', pivot);
    if (startIndex === -1) return null;
    const raw = extractJsonObject(html, startIndex);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const extractPreloadedState = (html) => {
    return (
        extractJsonAfterToken(html, '"__PRELOADED_STATE__"') ||
        extractJsonAfterToken(html, '__PRELOADED_STATE__')
    );
};

const extractProductSearchFromState = (state) => {
    const queries = state?.__reactQuery?.queries;
    if (!Array.isArray(queries)) return null;

    for (const query of queries) {
        const key = query?.queryKey;
        if (!Array.isArray(key)) continue;
        if (!key.some((part) => String(part).includes('product-search'))) continue;

        const params = key[key.length - 1] && typeof key[key.length - 1] === 'object' ? key[key.length - 1] : {};
        const data = query?.state?.data;
        const pages = Array.isArray(data?.pages) ? data.pages : [];
        const hits = pages.flatMap((page) => (Array.isArray(page?.hits) ? page.hits : []));
        const meta = pages[0] || {};
        return {
            hits,
            total: meta.total ?? null,
            limit: meta.limit ?? null,
            offset: meta.offset ?? 0,
            params,
        };
    }
    return null;
};

const extractBootstrapConfig = (html) => {
    const shortCode = html.match(/shortCode"?:\"([^\"]+)"/)?.[1] || null;
    const clientId = html.match(/clientId"?:\"([^\"]+)"/)?.[1] || null;
    const organizationId = html.match(/organizationId"?:\"([^\"]+)"/)?.[1] || null;
    const siteId = html.match(/siteId"?:\"([^\"]+)"/)?.[1] || null;
    const preloadedState = extractPreloadedState(html);
    const productSearch = preloadedState ? extractProductSearchFromState(preloadedState) : null;

    return {
        shortCode,
        clientId,
        organizationId,
        siteId,
        productSearch,
    };
};

const buildSearchParams = ({ params, offset, limit, brand }) => {
    const searchParams = new URLSearchParams();

    if (params?.siteId) searchParams.set('siteId', params.siteId);
    if (params?.clientId) searchParams.set('clientId', params.clientId);
    if (params?.locale) searchParams.set('locale', params.locale);

    if (Array.isArray(params?.refine)) {
        for (const refine of params.refine) {
            searchParams.append('refine', refine);
        }
    }

    if (brand) {
        searchParams.append('refine', `c_brand=${brand}`);
    }

    if (Array.isArray(params?.expand)) {
        for (const expand of params.expand) {
            searchParams.append('expand', expand);
        }
    }

    if (params?.allImages !== undefined) searchParams.set('allImages', String(params.allImages));
    if (params?.perPricebook !== undefined) searchParams.set('perPricebook', String(params.perPricebook));
    if (params?.allVariationProperties !== undefined) {
        searchParams.set('allVariationProperties', String(params.allVariationProperties));
    }

    searchParams.set('offset', String(offset));
    searchParams.set('limit', String(limit));

    return searchParams;
};

const buildApiEndpoints = ({ shortCode, organizationId }) => {
    if (!shortCode || !organizationId) return [];
    return [
        `https://${shortCode}.api.commercecloud.salesforce.com/shopper-search/v1/organizations/${organizationId}/product-search`,
        `https://${shortCode}.api.commercecloud.salesforce.com/search/v1/organizations/${organizationId}/product-search`,
    ];
};

const fetchJson = async ({ url, session, proxyConfiguration, logger }) => {
    try {
        const proxyUrl = await resolveProxyUrl({ proxyConfiguration, session, logger });
        const response = await gotScraping({
            url,
            proxyUrl,
            responseType: 'json',
            throwHttpErrors: false,
            timeout: { request: 30000 },
            retry: { limit: 2 },
            headers: {
                ...getSessionHeaders(session),
                Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
            },
            cookieJar: session?.cookieJar,
        });

        if (response.statusCode >= 200 && response.statusCode < 300 && response.body) {
            return response.body;
        }

        logger?.debug?.(`JSON request failed (${response.statusCode}) ${url}`);
        return null;
    } catch (err) {
        const message = err?.message || String(err);
        if (isProxyAuthError(message)) {
            proxyState.authFailed = true;
            disableProxy('Proxy authentication failed', logger);
        }
        logger?.debug?.(`JSON request error: ${message}`);
        return null;
    }
};

const mapVariationValues = (variationAttributes, ids) => {
    const values = [];
    for (const attr of variationAttributes || []) {
        if (!attr || !attr.id) continue;
        if (!ids.includes(String(attr.id).toLowerCase())) continue;
        const attrValues = Array.isArray(attr.values) ? attr.values : [];
        for (const entry of attrValues) {
            if (entry?.name && typeof entry.name === 'string') values.push(entry.name);
            if (entry?.name?.en) values.push(entry.name.en);
            if (entry?.value && typeof entry.value === 'string') values.push(entry.value);
        }
    }
    return uniqStrings(values);
};

const mapSearchHit = (hit) => {
    if (!hit || typeof hit !== 'object') return null;
    const variationAttributes = hit.c_variationAttributes || hit.variationAttributes || [];
    const colors = mapVariationValues(variationAttributes, ['color', 'colour']);
    const sizes = mapVariationValues(variationAttributes, ['size']);
    const image =
        hit?.image?.link ||
        hit?.image?.src ||
        hit?.imageGroups?.[0]?.images?.[0]?.link ||
        hit?.imageGroups?.[0]?.images?.[0]?.src;
    const price = toNumber(hit.price ?? hit.pricePerUnit ?? hit.priceMin ?? hit.pricePerUnitMin);
    const priceMax = toNumber(hit.priceMax ?? hit.pricePerUnitMax);
    const originalPrice = priceMax && price && priceMax > price ? priceMax : null;

    const productUrl = hit.c_productUrl || hit.productUrl || hit.url || hit.link;
    const represented = hit.representedProduct || {};
    const images = Array.isArray(hit.imageGroups)
        ? uniqStrings(
            hit.imageGroups
                .flatMap((group) => group?.images || [])
                .map((img) => img?.link || img?.src)
                .filter(Boolean)
        )
        : [];
    const categories = uniqStrings([
        ...(Array.isArray(hit.c_productCategories) ? hit.c_productCategories : []),
        ...(Array.isArray(represented.c_primaryCategories) ? represented.c_primaryCategories : []),
    ]);

    return {
        title: hit.productName || hit.name || null,
        brand: hit.c_brand || hit.brand?.name || hit.brand || null,
        price,
        originalPrice,
        currency: hit.currency || 'CAD',
        url: productUrl ? toAbs(productUrl) : null,
        image: image ? toAbs(image) : null,
        images: images.map((link) => toAbs(link)),
        colors,
        sizes,
        inStock: hit.orderable ?? (hit.representedProduct?.c_qtyInStock > 0),
        productId: hit.productId || hit.representedProduct?.id || null,
        description: represented.c_productDescription || null,
        features: Array.isArray(represented.c_productFeatures) ? represented.c_productFeatures : [],
        attributes: Array.isArray(represented.c_productAttributesDisplay) ? represented.c_productAttributesDisplay : [],
        categories,
        gender: Array.isArray(represented.c_gender) ? represented.c_gender : [],
        materials: Array.isArray(represented.c_material) ? represented.c_material : [],
        colorName: represented.c_colorname || null,
    };
};

const extractJsonLdProducts = ($) => {
    const products = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim();
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            const nodes = Array.isArray(data) ? data : [data];
            for (const node of nodes) {
                if (!node) continue;
                if (node['@type'] === 'Product') {
                    products.push(node);
                }
                if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
                    for (const item of node.itemListElement) {
                        if (item?.item?.['@type'] === 'Product') {
                            products.push(item.item);
                        }
                    }
                }
            }
        } catch {
            return;
        }
    });

    return products.map((product) => {
        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        return {
            title: product.name || null,
            brand: product.brand?.name || product.brand || null,
            price: toNumber(offers?.price),
            originalPrice: null,
            currency: offers?.priceCurrency || 'CAD',
            url: product.url ? toAbs(product.url) : null,
            image: Array.isArray(product.image) ? toAbs(product.image[0]) : toAbs(product.image),
            images: Array.isArray(product.image) ? product.image.map((img) => toAbs(img)) : [],
            colors: [],
            sizes: [],
            inStock: String(offers?.availability || '').toLowerCase().includes('instock'),
            productId: product.sku || null,
            description: product.description || null,
        };
    });
};

const extractProductsFromHtml = ($) => {
    const products = [];
    const seenLinks = new Set();

    $('a[href*="/product/"]').each((_, el) => {
        const href = $(el).attr('href');
        const url = href ? toAbs(href) : null;
        if (!url || seenLinks.has(url)) return;

        const title = $(el).attr('aria-label') || $(el).find('img').attr('alt') || null;
        const card = $(el).closest('article, li, div');
        const priceText =
            card.find('[class*="price"], [data-testid*="price"], [class*="Price"]').first().text() || '';
        const price = toNumber(priceText);
        const image = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || null;

        products.push({
            title: title ? title.trim() : null,
            brand: null,
            price,
            originalPrice: null,
            currency: 'CAD',
            url,
            image: image ? toAbs(image) : null,
            colors: [],
            sizes: [],
            inStock: true,
            productId: null,
        });

        seenLinks.add(url);
    });

    return products;
};

const findNextPage = ($, currentUrl, pageSize) => {
    const relNext = $('link[rel="next"]').attr('href') || $('a[rel="next"]').attr('href');
    if (relNext) return toAbs(relNext);

    const nextLink = $('a[aria-label*="Next"], a[title*="Next"], a.next').first();
    if (nextLink.length) {
        const href = nextLink.attr('href');
        return href ? toAbs(href) : null;
    }

    try {
        const url = new URL(currentUrl);
        if (url.searchParams.has('start')) {
            const start = Number(url.searchParams.get('start') || 0);
            const size = Number(url.searchParams.get('sz') || pageSize || DEFAULT_PAGE_SIZE);
            url.searchParams.set('start', String(start + size));
            if (!url.searchParams.has('sz')) url.searchParams.set('sz', String(size));
            return url.href;
        }
        if (url.searchParams.has('page')) {
            const page = Number(url.searchParams.get('page') || 1);
            url.searchParams.set('page', String(page + 1));
            return url.href;
        }
    } catch {
        return null;
    }

    return null;
};

const parseSitemapXml = (xml) => {
    const $ = load(xml, { xmlMode: true });
    const sitemapUrls = $('sitemap > loc')
        .map((_, el) => $(el).text().trim())
        .get();
    const urlEntries = $('url > loc')
        .map((_, el) => $(el).text().trim())
        .get();
    return { sitemapUrls, urlEntries };
};

const fetchSitemapUrls = async ({ proxyConfiguration, session, logger }) => {
    const candidates = [
        `${BASE_URL}/sitemap.xml`,
        `${BASE_URL}/sitemap_index.xml`,
        `${BASE_URL}/sitemap-index.xml`,
    ];

    for (const candidate of candidates) {
        const proxyUrl = await resolveProxyUrl({ proxyConfiguration, session, logger });
        const response = await gotScraping({
            url: candidate,
            proxyUrl,
            responseType: 'text',
            throwHttpErrors: false,
            timeout: { request: 30000 },
            retry: { limit: 1 },
            headers: getSessionHeaders(session),
            cookieJar: session?.cookieJar,
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            continue;
        }

        const { sitemapUrls, urlEntries } = parseSitemapXml(response.body || '');
        if (urlEntries.length) {
            return urlEntries;
        }

        if (sitemapUrls.length) {
            const nestedUrls = [];
            for (const sitemapUrl of sitemapUrls.slice(0, 10)) {
                const nestedProxyUrl = await resolveProxyUrl({ proxyConfiguration, session, logger });
                const nested = await gotScraping({
                    url: sitemapUrl,
                    proxyUrl: nestedProxyUrl,
                    responseType: 'text',
                    throwHttpErrors: false,
                    timeout: { request: 30000 },
                    retry: { limit: 1 },
                    headers: getSessionHeaders(session),
                    cookieJar: session?.cookieJar,
                });
                if (nested.statusCode < 200 || nested.statusCode >= 300) continue;
                const parsed = parseSitemapXml(nested.body || '');
                nestedUrls.push(...parsed.urlEntries);
            }
            if (nestedUrls.length) return nestedUrls;
        }

        logger?.debug?.(`No sitemap URLs found in ${candidate}`);
    }

    return [];
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const startUrlsInput = Array.isArray(input.startUrls)
        ? input.startUrls.map((item) => (typeof item === 'string' ? item : item?.url)).filter(Boolean)
        : [];

    const category = typeof input.category === 'string' ? input.category : 'women';
    const maxItems = Number.isFinite(Number(input.maxItems)) ? Number(input.maxItems) : DEFAULT_MAX_ITEMS;
    const maxPages = Number.isFinite(Number(input.maxPages)) ? Number(input.maxPages) : DEFAULT_MAX_PAGES;
    const brand = typeof input.brand === 'string' ? input.brand.trim() : '';
    const color = typeof input.color === 'string' ? input.color.trim() : '';
    const size = typeof input.size === 'string' ? input.size.trim() : '';
    const minPrice = Number.isFinite(Number(input.minPrice)) ? Number(input.minPrice) : null;
    const maxPrice = Number.isFinite(Number(input.maxPrice)) ? Number(input.maxPrice) : null;

    const scrapeDetails = input.scrapeDetails !== false; // Default to true

    const MAX_ITEMS = maxItems > 0 ? maxItems : DEFAULT_MAX_ITEMS;
    const MAX_PAGES = maxPages > 0 ? maxPages : DEFAULT_MAX_PAGES;

    const buildStartUrls = () => {
        if (startUrlsInput.length) return startUrlsInput;

        const url = new URL(`${BASE_URL}/en/${category}`);
        let refineIndex = 1;

        if (brand) {
            url.searchParams.set(`prefn${refineIndex}`, 'brand');
            url.searchParams.set(`prefv${refineIndex}`, brand);
            refineIndex += 1;
        }
        if (color) {
            url.searchParams.set(`prefn${refineIndex}`, 'color');
            url.searchParams.set(`prefv${refineIndex}`, color);
            refineIndex += 1;
        }
        if (size) {
            url.searchParams.set(`prefn${refineIndex}`, 'size');
            url.searchParams.set(`prefv${refineIndex}`, size);
            refineIndex += 1;
        }
        if (minPrice !== null) url.searchParams.set('pmin', String(minPrice));
        if (maxPrice !== null) url.searchParams.set('pmax', String(maxPrice));

        return [url.href];
    };

    let proxyConfiguration;
    if (input.proxyConfiguration) {
        try {
            proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
        } catch (err) {
            log.warning(`Invalid proxy configuration, running without proxy. ${err?.message || err}`);
            proxyConfiguration = undefined;
        }
    }

    let requestQueue = await Actor.openRequestQueue();

    let itemsEnqueued = 0;
    let itemsSaved = 0;
    let anyItems = false;
    let sitemapQueued = false;
    const seenKeys = new Set();
    const detailQueued = new Set();
    const savedProductIds = new Set();

    const passesFilters = (item) => {
        if (!item) return false;
        if (brand && item.brand && !String(item.brand).toLowerCase().includes(brand.toLowerCase())) return false;
        if (minPrice !== null && item.price !== null && item.price < minPrice) return false;
        if (maxPrice !== null && item.price !== null && item.price > maxPrice) return false;
        if (color && Array.isArray(item.colors)) {
            const match = item.colors.some((entry) => String(entry).toLowerCase().includes(color.toLowerCase()));
            if (!match && item.colors.length) return false;
        }
        if (size && Array.isArray(item.sizes)) {
            const match = item.sizes.some((entry) => String(entry).toLowerCase().includes(size.toLowerCase()));
            if (!match && item.sizes.length) return false;
        }
        return true;
    };

    const normalizeItem = (item) => {
        if (!item || typeof item !== 'object') return null;
        return {
            title: item.title || null,
            brand: item.brand || null,
            price: item.price !== undefined ? item.price : null,
            originalPrice: item.originalPrice !== undefined ? item.originalPrice : null,
            currency: item.currency || 'CAD',
            url: item.url || null,
            image: item.image || null,
            images: Array.isArray(item.images) ? item.images : [],
            colors: Array.isArray(item.colors) ? item.colors : [],
            sizes: Array.isArray(item.sizes) ? item.sizes : [],
            inStock: item.inStock ?? true,
            productId: item.productId || null,
            description: item.description || null,
            features: item.features || [],
            materials: item.materials || [],
        };
    };

    const saveItems = async (items, logger) => {
        if (!Array.isArray(items) || !items.length) return;
        if (itemsSaved >= MAX_ITEMS) return;

        const filtered = [];
        for (const raw of items) {
            const item = normalizeItem(raw);
            if (!item) continue;

            // Deduplication logic - strict ID check or URL check
            const key = item.productId || item.url;
            if (!key) continue;

            // If we already saved this exact product ID, skip
            if (item.productId && savedProductIds.has(item.productId)) continue;
            // Fallback to URL if no ID
            if (!item.productId && item.url && seenKeys.has(item.url)) continue;

            if (!passesFilters(item)) continue;

            filtered.push(item);
            if (item.productId) savedProductIds.add(item.productId);
            if (item.url) seenKeys.add(item.url);

            if (itemsSaved + filtered.length >= MAX_ITEMS) break;
        }

        if (filtered.length) {
            await Actor.pushData(filtered);
            itemsSaved += filtered.length;
            anyItems = true;
            logger?.info?.(`Saved ${filtered.length} items (total ${itemsSaved}/${MAX_ITEMS})`);
        }
    };

    const enqueueOrSaveDetails = async (products, logger) => {
        if (!products || !products.length) return;

        // First, save what we have immediately
        await saveItems(products, logger);

        if (!scrapeDetails) return;

        for (const product of products) {
            if (itemsEnqueued >= MAX_ITEMS) break;
            const url = product?.url ? toAbs(product.url) : null;
            if (!url || detailQueued.has(url)) continue;

            // Only queue if we really need to (optimization could go here, but user wants robustness)
            // If we already have description, we might skip, but let's follow user wish for "deep review"

            await requestQueue.addRequest({
                url,
                userData: { label: 'DETAIL', base: product },
            });
            detailQueued.add(url);
            itemsEnqueued++;
            logger?.debug?.(`Queued detail: ${url}`);
        }
    };

    const tryProductSearchApi = async ({ bootstrap, offset, limit, session, logger }) => {
        const apiParams = {
            siteId: bootstrap.siteId,
            clientId: bootstrap.clientId,
            locale: bootstrap.productSearch?.params?.locale,
            refine: bootstrap.productSearch?.params?.refine,
            expand: bootstrap.productSearch?.params?.expand,
            allImages: bootstrap.productSearch?.params?.allImages,
            perPricebook: bootstrap.productSearch?.params?.perPricebook,
            allVariationProperties: bootstrap.productSearch?.params?.allVariationProperties,
        };

        const endpoints = buildApiEndpoints(bootstrap);
        if (!endpoints.length || !apiParams.clientId || !apiParams.siteId) return null;
        if (!Array.isArray(apiParams.refine) || apiParams.refine.length === 0) return null;

        for (const base of endpoints) {
            const params = buildSearchParams({
                params: apiParams,
                offset,
                limit,
                brand: brand || null,
            });
            const url = `${base}?${params.toString()}`;
            logger?.debug?.(`Attempting JSON API: ${url}`);
            const data = await fetchJson({ url, session, proxyConfiguration, logger });
            if (data && Array.isArray(data.hits)) return data;
        }

        return null;
    };

    const enqueueSitemapFallback = async (session, logger) => {
        if (sitemapQueued) return;
        sitemapQueued = true;
        logger.info('Attempting sitemap fallback');

        const urls = await fetchSitemapUrls({ proxyConfiguration, session, logger });
        const productUrls = uniqStrings(urls.filter((url) => url.includes('/product/'))).slice(0, MAX_ITEMS * 3);
        if (!productUrls.length) {
            logger.warning('No product URLs found in sitemap');
            return;
        }

        for (const url of productUrls) {
            await requestQueue.addRequest({
                url,
                userData: { label: 'PRODUCT' },
            });
        }
        logger.info(`Queued ${productUrls.length} product URLs from sitemap`);
    };

    const runCrawler = async () => {
        const crawler = new CheerioCrawler({
            requestQueue,
            proxyConfiguration,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 50,
                sessionOptions: { maxUsageCount: 50 },
            },
            maxConcurrency: 10,
            minConcurrency: 1,
            requestHandlerTimeoutSecs: 120,
            preNavigationHooks: [
                async ({ request, session }) => {
                    request.headers = {
                        ...getSessionHeaders(session),
                        ...request.headers,
                    };
                },
            ],
            async requestHandler({ request, response, $, session, log: crawlerLog }) {
                if (response && [403, 407, 429, 597].includes(response.statusCode)) {
                    if ([407, 597].includes(response.statusCode)) {
                        proxyState.authFailed = true;
                        disableProxy(`Proxy authentication failed (${response.statusCode})`, crawlerLog);
                    }
                    session?.markBad();
                    crawlerLog.warning(`Blocked (${response.statusCode}) ${request.url}`);
                    return;
                }

                if (itemsSaved >= MAX_ITEMS) {
                    crawlerLog.info(`Reached max items limit (${MAX_ITEMS})`);
                    return;
                }

                if (request.userData?.label === 'DETAIL') {
                    const base = request.userData?.base || {};
                    const detailProducts = extractJsonLdProducts($);
                    const detail = detailProducts.length ? detailProducts[0] : null;
                    let merged = {
                        ...base,
                        ...detail,
                        url: base.url || detail?.url || request.url,
                        image: base.image || detail?.image || null,
                        images: detail?.images?.length ? detail.images : base.images || [],
                    };

                    if (!detail) {
                        const htmlProducts = extractProductsFromHtml($);
                        const match =
                            htmlProducts.find((p) => p.url === merged.url) ||
                            htmlProducts.find((p) => p.title === merged.title) ||
                            htmlProducts[0];
                        if (match) {
                            merged = {
                                ...merged,
                                ...match,
                                url: merged.url || match.url,
                                image: merged.image || match.image,
                            };
                        }
                    }

                    await saveItems([merged], crawlerLog);
                    return;
                }

                const html = $.root().html() || '';
                const bootstrap = extractBootstrapConfig(html);

                const pageSize = bootstrap.productSearch?.limit || DEFAULT_PAGE_SIZE;
                const startOffset = request.userData?.offset ?? bootstrap.productSearch?.offset ?? 0;
                const startPage = request.userData?.pageNum ?? 1;

                let usedApi = false;

                if (bootstrap.shortCode && bootstrap.clientId && bootstrap.organizationId && bootstrap.siteId) {
                    let apiData = await tryProductSearchApi({
                        bootstrap,
                        offset: startOffset,
                        limit: pageSize,
                        session,
                        logger: crawlerLog,
                    });

                    // Fallback to preloaded data if API returned nothing (or failed) but preloaded exists
                    if ((!apiData || !apiData.hits || !apiData.hits.length) && bootstrap.productSearch?.hits?.length) {
                        apiData = {
                            hits: bootstrap.productSearch.hits,
                            total: bootstrap.productSearch.total || null,
                            limit: bootstrap.productSearch.limit || pageSize,
                            offset: bootstrap.productSearch.offset || 0
                        };
                        crawlerLog.info('Using preloaded product-search data');
                    }

                    if (apiData?.hits?.length) {
                        usedApi = true;
                        const mapped = apiData.hits.map(mapSearchHit).filter(Boolean);

                        // Critical fix: Save items immediately and manage queue count
                        await enqueueOrSaveDetails(mapped, crawlerLog);

                        const total = Number.isFinite(apiData.total) ? apiData.total : null;
                        let offset = Number.isFinite(apiData.offset) ? apiData.offset : startOffset;
                        let limit = Number.isFinite(apiData.limit) ? apiData.limit : pageSize;
                        let pageNum = startPage;

                        // Loop based on itemsEnqueued to ensure we queue enough detail pages
                        // But also check itemsSaved to stop early if we are in "scrapeDetails=false" mode or if we are satisfied.
                        while (
                            (scrapeDetails ? itemsEnqueued < MAX_ITEMS : itemsSaved < MAX_ITEMS) &&
                            pageNum < MAX_PAGES
                        ) {
                            if (total !== null && offset + limit >= total) break;
                            offset += limit;
                            pageNum += 1;

                            // Small delay to be polite to the API
                            await new Promise(r => setTimeout(r, 500));

                            const nextData = await tryProductSearchApi({
                                bootstrap,
                                offset,
                                limit,
                                session,
                                logger: crawlerLog,
                            });

                            if (!nextData?.hits?.length) break;
                            const mappedNext = nextData.hits.map(mapSearchHit).filter(Boolean);
                            await enqueueOrSaveDetails(mappedNext, crawlerLog);
                        }
                    }
                }

                // Preloaded data is now handled above within the API logic to enable pagination fallback

                if (!usedApi && itemsSaved < MAX_ITEMS) {
                    const jsonLdProducts = extractJsonLdProducts($);
                    if (jsonLdProducts.length) {
                        crawlerLog.info('Using JSON-LD products');
                        await enqueueOrSaveDetails(jsonLdProducts, crawlerLog);
                    }
                }

                if (!usedApi && itemsSaved < MAX_ITEMS) {
                    const htmlProducts = extractProductsFromHtml($);
                    if (htmlProducts.length) {
                        crawlerLog.info('Using HTML product tiles');
                        await enqueueOrSaveDetails(htmlProducts, crawlerLog);
                    }
                }

                // Pagination for fallback methods (only if API failed)
                if (!usedApi && itemsEnqueued < MAX_ITEMS && startPage < MAX_PAGES) {
                    const nextUrl = findNextPage($, request.url, pageSize);
                    if (nextUrl) {
                        await requestQueue.addRequest({
                            url: nextUrl,
                            userData: { label: 'LIST', pageNum: startPage + 1 },
                        });
                    }
                }

                // Final fallback check - only if we really found nothing
                if (!anyItems && itemsEnqueued === 0 && !usedApi) {
                    await enqueueSitemapFallback(session, crawlerLog);
                }
            },
            errorHandler({ request, log: crawlerLog }, error) {
                const message = error?.message || String(error);
                const errorMessages = Array.isArray(request?.errorMessages) ? request.errorMessages.join(' ') : '';
                const combined = `${message} ${errorMessages}`;
                if (isProxyAuthError(combined)) {
                    proxyState.authFailed = true;
                    disableProxy('Proxy authentication failed', crawlerLog);
                    crawlerLog.warning(
                        `Proxy authentication failed. Disable Apify Proxy or use an allowed proxy group. (${request.url})`
                    );
                } else {
                    crawlerLog.warning(`Request failed (retrying) ${request.url}: ${message}`);
                }
            },
            failedRequestHandler({ request, log: crawlerLog }, error) {
                const message = error?.message || String(error);
                const errorMessages = Array.isArray(request?.errorMessages) ? request.errorMessages.join(' ') : '';
                const combined = `${message} ${errorMessages}`;
                if (isProxyAuthError(combined)) {
                    proxyState.authFailed = true;
                    disableProxy('Proxy authentication failed', crawlerLog);
                    crawlerLog.error(
                        `Proxy authentication failed. Disable Apify Proxy or use an allowed proxy group. (${request.url})`
                    );
                } else {
                    crawlerLog.error(`Request failed ${request.url}: ${message}`);
                }
            },
        });

        const initialUrls = buildStartUrls();
        if (!initialUrls.length) {
            log.error('No start URLs provided or generated.');
            return;
        }

        for (const url of initialUrls) {
            await requestQueue.addRequest({ url, userData: { label: 'LIST', pageNum: 1 } });
        }

        log.info(`Starting crawl with ${initialUrls.length} URL(s)`);
        await crawler.run();
    };

    await runCrawler();

    if (proxyConfiguration && proxyState.authFailed) {
        log.warning('Proxy authentication failed. Retrying without proxy.');
        proxyState.authFailed = false;
        proxyState.disabled = true;
        proxyConfiguration = undefined;
        requestQueue = await Actor.openRequestQueue(`direct-${Date.now()}`);
        await runCrawler();
    }

    log.info(`Scraping completed. Total products saved: ${itemsSaved}`);
} catch (err) {
    log.exception(err, 'Fatal error');
    throw err;
} finally {
    await Actor.exit();
}
