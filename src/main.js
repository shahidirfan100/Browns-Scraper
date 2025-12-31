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

const normalizeProductUrl = (href) => {
    if (!href) return null;
    try {
        const url = new URL(href, BASE_URL);
        if (url.pathname.includes('/product/')) {
            url.search = '';
            url.hash = '';
        }
        return url.href;
    } catch {
        return null;
    }
};

const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(String(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(num) ? num : null;
};

const toBoolean = (value, defaultValue = false) => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['true', '1', 'yes', 'y'].includes(normalized);
    }
    return defaultValue;
};

const uniqStrings = (values) => [...new Set(values.filter(Boolean))];

const decodeHtmlEntities = (value) => {
    if (!value || typeof value !== 'string') return value;
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
};

const parseJsonAttribute = (value) => {
    if (!value) return null;
    const decoded = decodeHtmlEntities(value);
    try {
        return JSON.parse(decoded);
    } catch {
        return null;
    }
};

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

const extractProductDetailFromState = (state) => {
    const queries = state?.__reactQuery?.queries;
    if (!Array.isArray(queries)) return null;

    for (const query of queries) {
        const key = query?.queryKey;
        if (!Array.isArray(key)) continue;
        if (!key.some((part) => String(part).includes('/products/'))) continue;
        const data = query?.state?.data;
        if (data && typeof data === 'object') return data;
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

const fetchHtml = async ({ url, session, proxyConfiguration, logger }) => {
    try {
        const proxyUrl = await resolveProxyUrl({ proxyConfiguration, session, logger });
        const response = await gotScraping({
            url,
            proxyUrl,
            responseType: 'text',
            throwHttpErrors: false,
            timeout: { request: 30000 },
            retry: { limit: 2 },
            headers: {
                ...getSessionHeaders(session),
                Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            },
            cookieJar: session?.cookieJar,
        });

        if (response.statusCode >= 200 && response.statusCode < 300 && response.body) {
            return response.body;
        }

        logger?.debug?.(`HTML request failed (${response.statusCode}) ${url}`);
        return null;
    } catch (err) {
        const message = err?.message || String(err);
        if (isProxyAuthError(message)) {
            proxyState.authFailed = true;
            disableProxy('Proxy authentication failed', logger);
        }
        logger?.debug?.(`HTML request error: ${message}`);
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
        url: productUrl ? normalizeProductUrl(productUrl) : null,
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

const mapDetailProduct = (product) => {
    if (!product || typeof product !== 'object') return null;
    const variationAttributes = product.c_variationAttributes || product.variationAttributes || [];
    const colors = mapVariationValues(variationAttributes, ['color', 'colour']);
    const sizes = mapVariationValues(variationAttributes, ['size']);
    const images = Array.isArray(product.imageGroups)
        ? uniqStrings(
            product.imageGroups
                .flatMap((group) => group?.images || [])
                .map((img) => img?.link || img?.src)
                .filter(Boolean)
        )
        : [];
    const image = images[0] || product?.image?.link || product?.image?.src || null;
    const price = toNumber(product.price ?? product.pricePerUnit ?? product.priceMin ?? product.pricePerUnitMin);
    const priceMax = toNumber(product.priceMax ?? product.pricePerUnitMax);
    const originalPrice = priceMax && price && priceMax > price ? priceMax : null;

    const represented = product.representedProduct || product.master || {};
    const categories = uniqStrings([
        ...(Array.isArray(product.c_productCategories) ? product.c_productCategories : []),
        ...(Array.isArray(product.c_primaryCategories) ? product.c_primaryCategories : []),
        ...(Array.isArray(represented.c_primaryCategories) ? represented.c_primaryCategories : []),
    ]);

    return {
        title: product.name || product.productName || null,
        brand: product.brand?.name || product.brand || null,
        price,
        originalPrice,
        currency: product.currency || 'CAD',
        url: product.slugUrl || product.url || product.c_productUrl || null,
        image: image ? toAbs(image) : null,
        images: images.map((link) => toAbs(link)),
        colors,
        sizes,
        inStock:
            product.orderable ??
            product.inventory?.orderable ??
            (Number.isFinite(product.c_qtyInStock) ? product.c_qtyInStock > 0 : undefined),
        productId: product.id || product.productId || represented.id || null,
        description:
            product.c_productDescription ||
            product.longDescription ||
            product.shortDescription ||
            represented.c_productDescription ||
            null,
        features: Array.isArray(product.c_productFeatures)
            ? product.c_productFeatures
            : Array.isArray(represented.c_productFeatures)
                ? represented.c_productFeatures
                : [],
        attributes: Array.isArray(product.c_productAttributesDisplay)
            ? product.c_productAttributesDisplay
            : Array.isArray(represented.c_productAttributesDisplay)
                ? represented.c_productAttributesDisplay
                : [],
        categories,
        gender: Array.isArray(product.c_gender) ? product.c_gender : Array.isArray(represented.c_gender) ? represented.c_gender : [],
        materials: Array.isArray(product.c_material)
            ? product.c_material
            : Array.isArray(represented.c_material)
                ? represented.c_material
                : [],
        colorName: product.c_colorname || represented.c_colorname || null,
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
            url: product.url ? normalizeProductUrl(product.url) : null,
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
    const seenKeys = new Set();

    const pushProduct = (item) => {
        if (!item) return;
        const key = item.url || item.productId;
        if (!key || seenKeys.has(key)) return;
        seenKeys.add(key);
        products.push(item);
    };

    // Global data-segment fallback (covers grid responses where structure may differ)
    $('[data-segment]').each((_, el) => {
        const data = parseJsonAttribute($(el).attr('data-segment'));
        if (!data || typeof data !== 'object') return;
        const url = data.url ? normalizeProductUrl(data.url) : null;
        const image = data.image_url ? toAbs(data.image_url) : null;
        const colors = data.variant ? [String(data.variant)] : [];
        const sizes = data.size ? [String(data.size)] : [];
        pushProduct({
            title: data.name || null,
            brand: data.brand || null,
            price: toNumber(data.price),
            originalPrice: toNumber(data.retail_price),
            currency: data.currency || 'CAD',
            url,
            image,
            images: image ? [image] : [],
            colors,
            sizes,
            inStock: true,
            productId: data.product_id || data.stylenumber || data.sku || null,
        });
    });

    const getImageFromTag = (img) => {
        let src =
            img.attr('data-src') ||
            img.attr('data-lazy') ||
            img.attr('src') ||
            null;
        const srcset = img.attr('data-srcset') || img.attr('srcset');
        if (!src && srcset) {
            src = srcset.split(',')[0]?.trim().split(' ')[0] || null;
        }
        return src;
    };

    $('.product-tile').each((_, el) => {
        const tile = $(el);
        const segmentEl = tile.find('[data-segment]').first();
        const segment = parseJsonAttribute(segmentEl.attr('data-segment')) || null;
        const gtm = parseJsonAttribute(tile.attr('data-gtm')) || null;
        const impression = gtm?.ecommerce?.impressions || null;

        const link = tile.find('a[href*="/product/"]').first();
        const url = segment?.url ? normalizeProductUrl(segment.url) : link.length ? normalizeProductUrl(link.attr('href')) : null;
        const img = tile.find('img').first();
        const image = segment?.image_url ? segment.image_url : img.length ? getImageFromTag(img) : null;

        const title =
            segment?.name ||
            impression?.name ||
            impression?.dimension1 ||
            link.attr('aria-label') ||
            img.attr('alt') ||
            null;
        const brand = segment?.brand || impression?.brand || impression?.dimension6 || null;
        const price = toNumber(segment?.price ?? impression?.price ?? impression?.dimension12 ?? impression?.dimension7);
        const originalPrice = toNumber(segment?.retail_price ?? impression?.dimension11);
        const colors = segment?.variant ? [String(segment.variant)] : impression?.variant ? [String(impression.variant)] : [];
        const sizes = segment?.size ? [String(segment.size)] : [];
        const productId = segment?.product_id || impression?.id || impression?.dimension9 || null;
        const currency = segment?.currency || gtm?.ecommerce?.currencyCode || 'CAD';

        if (url) {
            pushProduct({
                title: title ? String(title).trim() : null,
                brand,
                price,
                originalPrice,
                currency,
                url,
                image: image ? toAbs(image) : null,
                images: image ? [toAbs(image)] : [],
                colors,
                sizes,
                inStock: true,
                productId,
            });
        }
    });

    $('a[href*="/product/"]').each((_, el) => {
        const href = $(el).attr('href');
        const url = href ? normalizeProductUrl(href) : null;
        if (!url || seenKeys.has(url)) return;

        const title = $(el).attr('aria-label') || $(el).find('img').attr('alt') || null;
        const card = $(el).closest('article, li, div');
        const priceText =
            card.find('[class*="price"], [data-testid*="price"], [class*="Price"]').first().text() || '';
        const price = toNumber(priceText);
        const image = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || null;

        pushProduct({
            title: title ? title.trim() : null,
            brand: null,
            price,
            originalPrice: null,
            currency: 'CAD',
            url,
            image: image ? toAbs(image) : null,
            images: image ? [toAbs(image)] : [],
            colors: [],
            sizes: [],
            inStock: true,
            productId: null,
        });
    });

    return products;
};

const getLocaleFromUrl = (url) => {
    try {
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        return parts[0] || null;
    } catch {
        return null;
    }
};

const getCgidFromRefine = (refine) => {
    if (!Array.isArray(refine)) return null;
    const entry = refine.find((item) => String(item).startsWith('cgid='));
    if (!entry) return null;
    const value = String(entry).split('=').slice(1).join('=');
    return value || null;
};

const getCgidFromUrl = (url) => {
    try {
        return new URL(url).searchParams.get('cgid');
    } catch {
        return null;
    }
};

const buildGridUrl = ({ requestUrl, siteId, locale, cgid, start, size }) => {
    if (!siteId || !locale || !cgid || !Number.isFinite(start)) return null;
    const base = new URL(`${BASE_URL}/on/demandware.store/Sites-${siteId}-Site/${locale}/Search-UpdateGrid`);
    try {
        const current = new URL(requestUrl);
        for (const [key, value] of current.searchParams.entries()) {
            if (key === 'start' || key === 'sz' || key === 'page') continue;
            base.searchParams.append(key, value);
        }
    } catch {
        // Ignore invalid URLs and continue with minimal params.
    }

    base.searchParams.set('cgid', cgid);
    base.searchParams.set('start', String(start));
    base.searchParams.set('sz', String(size || DEFAULT_PAGE_SIZE));
    return base.href;
};

// Sitemap fallback removed: the actor operates only on listing/API-style sources.

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

    const scrapeDetails = toBoolean(input.scrapeDetails, false);

    const MAX_ITEMS = maxItems > 0 ? maxItems : DEFAULT_MAX_ITEMS;
    const MAX_PAGES = maxPages > 0 ? maxPages : DEFAULT_MAX_PAGES;

    log.info(`Scrape details mode: ${scrapeDetails ? 'on' : 'off'}`);

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
    let maxLimitHit = false;
    let maxQueueHit = false;
    let anyItems = false;
    let crawlerInstance;
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

    const stopCrawler = async (logger) => {
        if (!maxLimitHit && itemsSaved >= MAX_ITEMS) {
            maxLimitHit = true;
            logger?.info?.(`Reached max items limit (${MAX_ITEMS}), stopping crawler.`);
        }
        if (itemsSaved < MAX_ITEMS) return;
        try {
            await crawlerInstance?.autoscaledPool?.abort?.();
        } catch (err) {
            logger?.debug?.(`Failed to abort crawler pool: ${err?.message || err}`);
        }
    };

    const getProgressCount = () => (scrapeDetails ? itemsEnqueued : itemsSaved);
    const hasReachedTarget = () => getProgressCount() >= MAX_ITEMS;

    const normalizeItem = (item) => {
        if (!item || typeof item !== 'object') return null;
        return {
            title: item.title || null,
            brand: item.brand || null,
            price: item.price !== undefined ? item.price : null,
            originalPrice: item.originalPrice !== undefined ? item.originalPrice : null,
            currency: item.currency || 'CAD',
            url: item.url ? normalizeProductUrl(item.url) : null,
            image: item.image || null,
            images: Array.isArray(item.images) ? item.images : [],
            colors: Array.isArray(item.colors) ? item.colors : [],
            sizes: Array.isArray(item.sizes) ? item.sizes : [],
            inStock: item.inStock ?? true,
            productId: item.productId || null,
            description: item.description || null,
            features: item.features || [],
            materials: item.materials || [],
            attributes: item.attributes || [],
            categories: item.categories || [],
            gender: item.gender || [],
            colorName: item.colorName || null,
        };
    };

    const shapeItem = (item) => {
        const normalized = normalizeItem(item);
        if (!normalized) return null;
        if (scrapeDetails) return normalized;

        return {
            title: normalized.title,
            brand: normalized.brand,
            price: normalized.price,
            originalPrice: normalized.originalPrice,
            currency: normalized.currency,
            url: normalized.url,
            image: normalized.image,
            images: normalized.images,
            colors: normalized.colors,
            sizes: normalized.sizes,
            inStock: normalized.inStock,
            productId: normalized.productId,
        };
    };

    const saveItems = async (items, logger) => {
        if (!Array.isArray(items) || !items.length) return;
        if (itemsSaved >= MAX_ITEMS) return;

        const filtered = [];
        for (const raw of items) {
            const item = shapeItem(raw);
            if (!item) continue;

            // Listing mode requires a canonical URL and a visible title.
            if (!item.url || !item.title) continue;

            // Deduplicate primarily by URL (product IDs can differ across tracking/variants).
            if (seenKeys.has(item.url)) continue;

            if (!passesFilters(item)) continue;

            filtered.push(item);
            seenKeys.add(item.url);
            if (item.productId) savedProductIds.add(item.productId);

            if (itemsSaved + filtered.length >= MAX_ITEMS) break;
        }

        if (filtered.length) {
            await Actor.pushData(filtered);
            itemsSaved += filtered.length;
            anyItems = true;
            logger?.info?.(`Saved ${filtered.length} items (total ${itemsSaved}/${MAX_ITEMS})`);
            await stopCrawler(logger);
        }
    };

    const enqueueOrSaveDetails = async (products, logger) => {
        if (!products || !products.length) return;

        if (!scrapeDetails) {
            await saveItems(products, logger);
            return;
        }

        for (const product of products) {
            if (itemsEnqueued >= MAX_ITEMS) break;
            const base = normalizeItem(product);
            const url = base?.url || (product?.url ? normalizeProductUrl(product.url) : null);
            if (!url || detailQueued.has(url)) continue;

            // Only queue if we really need to (optimization could go here, but user wants robustness)
            // If we already have description, we might skip, but let's follow user wish for "deep review"

            await requestQueue.addRequest({
                url,
                userData: { label: 'DETAIL', base: { ...base, url } },
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
        if (!endpoints.length) {
            logger?.debug?.('No API endpoints available');
            return null;
        }
        if (!apiParams.clientId || !apiParams.siteId) {
            logger?.debug?.(`Missing API credentials: clientId=${apiParams.clientId}, siteId=${apiParams.siteId}`);
            return null;
        }

        // Refine params are optional - they might not be present in preloaded data
        // If missing, we'll try anyway as the API might still work
        if (!Array.isArray(apiParams.refine) || apiParams.refine.length === 0) {
            logger?.debug?.('No refine parameters found, attempting API call anyway');
        }

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
            if (data && Array.isArray(data.hits)) {
                logger?.info?.(`Successfully fetched ${data.hits.length} products from API`);
                return data;
            }
            logger?.debug?.(`API endpoint ${base} returned no data`);
        }

        return null;
    };

    const runCrawler = async () => {
        crawlerInstance = new CheerioCrawler({
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
            maxRequestRetries: 2,
            preNavigationHooks: [
                async ({ request, session }) => {
                    request.headers = {
                        ...getSessionHeaders(session),
                        ...request.headers,
                    };
                },
            ],
            async requestHandler({ request, response, $, session, log: crawlerLog }) {
                if (itemsSaved >= MAX_ITEMS) {
                    await stopCrawler(crawlerLog);
                    return;
                }
                if (scrapeDetails && itemsEnqueued >= MAX_ITEMS && request.userData?.label !== 'DETAIL') {
                    if (!maxQueueHit) {
                        maxQueueHit = true;
                        crawlerLog.info(`Reached detail queue limit (${MAX_ITEMS}), skipping further listing pages.`);
                    }
                    return;
                }
                if (response && [403, 407, 429, 597].includes(response.statusCode)) {
                    if ([407, 597].includes(response.statusCode)) {
                        proxyState.authFailed = true;
                        disableProxy(`Proxy authentication failed (${response.statusCode})`, crawlerLog);
                    }
                    session?.markBad();
                    crawlerLog.warning(`Blocked (${response.statusCode}) ${request.url}`);
                    return;
                }

                if (request.userData?.label === 'DETAIL') {
                    const base = request.userData?.base || {};
                    const html = $.root().html() || '';
                    const preloadedState = extractPreloadedState(html);
                    const detailFromState = preloadedState
                        ? mapDetailProduct(extractProductDetailFromState(preloadedState))
                        : null;
                    const detailProducts = extractJsonLdProducts($);
                    const detail = detailFromState || (detailProducts.length ? detailProducts[0] : null);
                    let merged = {
                        ...base,
                        ...detail,
                        url: base.url || normalizeProductUrl(detail?.url || request.url),
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

                const isGridRequest = request.userData?.label === 'GRID';
                const html = $.root().html() || '';
                const bootstrap = isGridRequest ? {} : extractBootstrapConfig(html);

                let pageSize = DEFAULT_PAGE_SIZE;
                try {
                    const urlObj = new URL(request.url);
                    const sz = Number(urlObj.searchParams.get('sz'));
                    if (Number.isFinite(sz) && sz > 0) pageSize = sz;
                } catch {
                    // ignore
                }
                if (!isGridRequest && Number.isFinite(bootstrap.productSearch?.limit)) {
                    pageSize = bootstrap.productSearch.limit;
                }

                let startOffset = 0;
                try {
                    const urlObj = new URL(request.url);
                    const start = Number(urlObj.searchParams.get('start'));
                    if (Number.isFinite(start) && start >= 0) startOffset = start;
                } catch {
                    // ignore
                }
                if (Number.isFinite(request.userData?.offset)) {
                    startOffset = request.userData.offset;
                } else if (!isGridRequest && Number.isFinite(bootstrap.productSearch?.offset)) {
                    startOffset = bootstrap.productSearch.offset;
                }

                const startPage = request.userData?.pageNum ?? 1;

                let usedApi = false;
                let usedPreloaded = false;

                if (!isGridRequest && bootstrap.productSearch?.hits?.length) {
                    usedPreloaded = true;
                    crawlerLog.info('Using preloaded product-search data');
                    const mapped = bootstrap.productSearch.hits.map(mapSearchHit).filter(Boolean);
                    await enqueueOrSaveDetails(mapped, crawlerLog);
                }

                // Try Commerce Cloud API only if we have all required credentials.
                if (
                    !isGridRequest &&
                    !hasReachedTarget() &&
                    bootstrap.shortCode &&
                    bootstrap.clientId &&
                    bootstrap.organizationId &&
                    (bootstrap.siteId || bootstrap.productSearch?.params?.siteId)
                ) {
                    const bootstrapForApi = {
                        ...bootstrap,
                        siteId: bootstrap.siteId || bootstrap.productSearch?.params?.siteId,
                    };
                    let apiData = await tryProductSearchApi({
                        bootstrap: bootstrapForApi,
                        offset: startOffset,
                        limit: pageSize,
                        session,
                        logger: crawlerLog,
                    });

                    if (apiData?.hits?.length) {
                        usedApi = true;
                        const mapped = apiData.hits.map(mapSearchHit).filter(Boolean);
                        await enqueueOrSaveDetails(mapped, crawlerLog);

                        const total = Number.isFinite(apiData.total) ? apiData.total : null;
                        let offset = Number.isFinite(apiData.offset) ? apiData.offset : startOffset;
                        let limit = Number.isFinite(apiData.limit) ? apiData.limit : pageSize;
                        let pageNum = startPage;

                        while (!hasReachedTarget() && pageNum < MAX_PAGES) {
                            if (total !== null && offset + limit >= total) {
                                crawlerLog.info(`Reached end of results (offset ${offset}, total ${total})`);
                                break;
                            }
                            offset += limit;
                            pageNum += 1;

                            crawlerLog.info(`Fetching page ${pageNum} with offset ${offset}`);
                            await new Promise((r) => setTimeout(r, 500));

                            const nextData = await tryProductSearchApi({
                                bootstrap: bootstrapForApi,
                                offset,
                                limit,
                                session,
                                logger: crawlerLog,
                            });

                            if (!nextData?.hits?.length) {
                                crawlerLog.warning(`No more products found at offset ${offset}. API may have failed or reached end.`);
                                break;
                            }
                            const mappedNext = nextData.hits.map(mapSearchHit).filter(Boolean);
                            await enqueueOrSaveDetails(mappedNext, crawlerLog);
                        }
                    }
                }

                // Preloaded data is now handled above within the API logic to enable pagination fallback

                const usedListingData = usedApi || usedPreloaded;

                if (!isGridRequest && usedPreloaded && !usedApi && !hasReachedTarget()) {
                    const cgid =
                        getCgidFromRefine(bootstrap.productSearch?.params?.refine) ||
                        getCgidFromUrl(request.url);
                    const locale =
                        bootstrap.productSearch?.params?.locale ||
                        getLocaleFromUrl(request.url) ||
                        'en';
                    const siteId = bootstrap.siteId || bootstrap.productSearch?.params?.siteId;

                    if (!siteId || !cgid) {
                        crawlerLog.warning('Grid pagination unavailable: missing siteId or cgid.');
                    } else {
                        let offset = startOffset;
                        let pageNum = startPage;
                        while (!hasReachedTarget() && pageNum < MAX_PAGES) {
                            offset += pageSize;
                            pageNum += 1;
                            const gridUrl = buildGridUrl({
                                requestUrl: request.url,
                                siteId,
                                locale,
                                cgid,
                                start: offset,
                                size: pageSize,
                            });
                            if (!gridUrl) {
                                crawlerLog.warning('Grid pagination unavailable for this request.');
                                break;
                            }
                            crawlerLog.info(`Fetching grid page ${pageNum} with start ${offset}`);
                            const gridHtml = await fetchHtml({
                                url: gridUrl,
                                session,
                                proxyConfiguration,
                                logger: crawlerLog,
                            });
                            if (!gridHtml) {
                                crawlerLog.warning(`Grid request failed at start ${offset}`);
                                break;
                            }
                            const grid$ = load(gridHtml);
                            const gridProducts = extractProductsFromHtml(grid$);
                            if (!gridProducts.length) {
                                crawlerLog.warning(`No products found in grid at start ${offset}`);
                                break;
                            }
                            await enqueueOrSaveDetails(gridProducts, crawlerLog);
                            if (hasReachedTarget()) break;
                        }
                    }
                }

                // No sitemap fallback: we only use listing/API-style sources.
            },
            errorHandler({ request, log: crawlerLog }, error) {
                if (itemsSaved >= MAX_ITEMS) return;
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
                if (itemsSaved >= MAX_ITEMS) return;
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
        await crawlerInstance.run();
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
