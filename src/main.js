import { Actor } from 'apify';
import { Impit } from 'impit';

import log from '@apify/log';

const BASE_URL = 'https://www.brownsshoes.com';
const CATEGORY_TO_COLLECTION = {
    women: 'women',
    men: 'men',
    kids: 'kids',
    sale: 'sale',
};
const LEGACY_CGID_TO_COLLECTION = {
    1: 'women',
    2: 'men',
    4: 'kids',
    sale: 'sale',
};
const CATEGORY_ALIASES = {
    femmes: 'women',
    hommes: 'men',
    enfants: 'kids',
    solde: 'sale',
    soldes: 'sale',
};
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_AFTER_MS = 10000;
const PAGE_SIZE = 20;

const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const uniqStrings = (values) => [
    ...new Set(
        (values || [])
            .filter((value) => value !== null && value !== undefined)
            .map((value) => String(value).trim())
            .filter(Boolean),
    ),
];

const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).replace(/[^\d.]/g, '');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const toAbsoluteUrl = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        return new URL(value, BASE_URL).href;
    } catch {
        return null;
    }
};

const normalizeBrandFilter = (brand) => {
    if (typeof brand !== 'string') return null;
    const normalized = brand.trim().toLocaleLowerCase('en-CA');
    return normalized || null;
};

const getTagValue = (tags, tagName) => {
    const prefix = `${tagName}:`.toLocaleLowerCase('en-CA');
    const match = (tags || []).find(
        (tag) => typeof tag === 'string' && tag.toLocaleLowerCase('en-CA').startsWith(prefix),
    );
    return match ? match.slice(match.indexOf(':') + 1).trim() || null : null;
};

const decodeHtmlEntities = (value) =>
    value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
        if (code.startsWith('#x') || code.startsWith('#X')) {
            const parsed = Number.parseInt(code.slice(2), 16);
            return parsed <= 0x10ffff ? String.fromCodePoint(parsed) : entity;
        }
        if (code.startsWith('#')) {
            const parsed = Number.parseInt(code.slice(1), 10);
            return parsed <= 0x10ffff ? String.fromCodePoint(parsed) : entity;
        }

        const entities = {
            amp: '&',
            apos: "'",
            gt: '>',
            lt: '<',
            nbsp: ' ',
            quot: '"',
        };
        return entities[code.toLowerCase()] || entity;
    });

const htmlToText = (html) => {
    if (typeof html !== 'string' || !html.trim()) return null;
    return (
        decodeHtmlEntities(
            html
                .replace(/<\s*br\s*\/?>/gi, ' ')
                .replace(/<\/(p|div|li|h[1-6])\s*>/gi, ' ')
                .replace(/<[^>]*>/g, ' '),
        )
            .replace(/\s+/g, ' ')
            .trim() || null
    );
};

const getOptionValues = (product, optionName) => {
    const option = (product.options || []).find(
        (item) => typeof item?.name === 'string' && item.name.toLocaleLowerCase('en-CA').includes(optionName),
    );
    return Array.isArray(option?.values) ? option.values : [];
};

const mapShopifyProduct = (product) => {
    if (!product || typeof product !== 'object' || !product.handle || !product.title) return null;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const prices = variants.map((variant) => toNumber(variant?.price)).filter((price) => price !== null);
    const price = prices.length > 0 ? Math.min(...prices) : null;
    const compareAtPrices = variants
        .map((variant) => toNumber(variant?.compare_at_price))
        .filter((compareAtPrice) => compareAtPrice !== null && (price === null || compareAtPrice > price));
    const originalPrice = compareAtPrices.length > 0 ? Math.max(...compareAtPrices) : null;

    const imageUrls = uniqStrings(
        (Array.isArray(product.images) ? product.images : []).map((image) => image?.src || image?.url),
    )
        .map(toAbsoluteUrl)
        .filter(Boolean);
    const primaryImage = toAbsoluteUrl(product.image?.src || product.image?.url);
    if (imageUrls.length === 0 && primaryImage) imageUrls.push(primaryImage);

    const tags = Array.isArray(product.tags) ? product.tags : [];
    const colorValues = [getTagValue(tags, 'Color'), ...getOptionValues(product, 'color')];
    const sizeValues = getOptionValues(product, 'size');
    const sizes =
        sizeValues.length > 0
            ? sizeValues
            : variants.map((variant) => (variant?.title === 'Default Title' ? null : variant?.title));
    const productPath = `/products/${encodeURIComponent(product.handle)}`;

    return {
        title: product.title,
        brand: product.vendor || null,
        price,
        originalPrice,
        currency: 'CAD',
        url: new URL(productPath, BASE_URL).href,
        image: imageUrls[0] || primaryImage || null,
        images: imageUrls,
        colors: uniqStrings(colorValues),
        sizes: uniqStrings(sizes),
        inStock: variants.some((variant) => variant?.available === true),
        productId: getTagValue(tags, 'Product ID') || (product.id ? String(product.id) : null),
        description: htmlToText(product.body_html),
    };
};

const parseStartUrlTarget = (startUrl) => {
    const rawUrl = typeof startUrl === 'string' ? startUrl : startUrl?.url;
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

    try {
        const url = new URL(rawUrl, BASE_URL);
        if (url.protocol !== 'https:' || !['brownsshoes.com', 'www.brownsshoes.com'].includes(url.hostname))
            return null;

        const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
        const locale = segments[0] === 'fr' ? 'fr' : 'en';
        const cgid = url.searchParams.get('cgid');
        const cgidCollection = cgid ? LEGACY_CGID_TO_COLLECTION[cgid.toLowerCase()] : null;
        if (cgidCollection) return { collection: cgidCollection, locale };

        const collectionIndex = segments.indexOf('collections');
        if (collectionIndex >= 0 && segments[collectionIndex + 1]) {
            return { collection: segments[collectionIndex + 1], locale };
        }

        const categoryAliases = { ...CATEGORY_TO_COLLECTION, ...CATEGORY_ALIASES };
        const categorySegment = segments.find((segment) => categoryAliases[segment]);
        if (categorySegment) return { collection: categoryAliases[categorySegment], locale };
    } catch {
        return null;
    }

    return null;
};

const buildTargets = (input) => {
    const startUrls = Array.isArray(input.startUrls) ? input.startUrls : [];

    if (startUrls.length > 0) {
        const targets = startUrls.map(parseStartUrlTarget).filter(Boolean);
        if (targets.length !== startUrls.length) {
            log.warning(
                'One or more start URLs were ignored because they are not supported Browns Shoes collection URLs.',
            );
        }

        const seen = new Set();
        return targets.filter((target) => {
            const key = `${target.locale}:${target.collection}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    const category = String(input.category ?? 'women')
        .trim()
        .toLowerCase();
    const collection = CATEGORY_TO_COLLECTION[category];
    if (!collection) {
        throw new Error(`Unsupported category '${category}'. Choose women, men, kids, or sale.`);
    }

    return [{ collection, locale: 'en' }];
};

const retryAfterMs = (response) => {
    const value = response.headers.get('retry-after');
    if (!value) return null;

    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    if (!Number.isFinite(delay)) return null;
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, delay));
};

const retryDelayMs = (attempt) => 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);

const fetchCollectionPage = async ({ client, target, page }) => {
    const localePath = target.locale === 'fr' ? '/fr' : '';
    const endpoint = new URL(
        `${localePath}/collections/${encodeURIComponent(target.collection)}/products.json`,
        BASE_URL,
    );
    endpoint.searchParams.set('limit', String(PAGE_SIZE));
    endpoint.searchParams.set('page', String(page));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        let response;
        try {
            response = await client.fetch(endpoint.href, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            if (attempt === MAX_RETRIES) {
                throw new Error(`Shopify request failed for collection '${target.collection}': ${error.message}`);
            }
            const delay = retryDelayMs(attempt);
            log.warning(
                `Temporary request failure for collection '${target.collection}', retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms.`,
            );
            await sleep(delay);
            continue;
        }

        if (!response.ok) {
            const temporary = response.status === 429 || response.status >= 500;
            if (!temporary || attempt === MAX_RETRIES) {
                throw new Error(
                    `Shopify collection request failed for '${target.collection}': HTTP ${response.status}`,
                );
            }
            const delay = retryAfterMs(response) ?? retryDelayMs(attempt);
            log.warning(
                `Temporary HTTP ${response.status} for collection '${target.collection}', retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms.`,
            );
            await sleep(delay);
            continue;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('json')) {
            throw new Error(`Shopify collection '${target.collection}' returned a non-JSON response.`);
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw new Error(`Shopify collection '${target.collection}' returned invalid JSON.`);
        }
        if (!payload || !Array.isArray(payload.products)) {
            throw new Error(`Shopify collection '${target.collection}' returned an unexpected JSON structure.`);
        }

        return payload.products;
    }

    throw new Error(`Shopify request retries exhausted for collection '${target.collection}'.`);
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        results_wanted: resultsWantedInput = 20,
        maxPages: maxPagesInput = 5,

        brand,
    } = input;

    const normalizePositiveInteger = (value, name, maximum = Number.MAX_SAFE_INTEGER) => {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new Error(`'${name}' must be a positive integer.`);
        }
        return Math.min(parsed, maximum);
    };

    const maxItems = normalizePositiveInteger(resultsWantedInput, 'results_wanted');
    const maxPages = normalizePositiveInteger(maxPagesInput, 'maxPages');

    const brandFilter = normalizeBrandFilter(brand);
    const targets = buildTargets(input);
    if (targets.length === 0) {
        throw new Error('No valid Browns Shoes collection targets found. Use a supported category or collection URL.');
    }

    const proxyInput = input.proxyConfiguration || {};
    const shouldUseApifyProxy = Boolean(proxyInput.useApifyProxy);
    const hasCustomProxyUrls = Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0;
    let proxyConfiguration;
    if (hasCustomProxyUrls || (Actor.isAtHome() && shouldUseApifyProxy)) {
        try {
            proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);
        } catch (error) {
            log.warning(`Proxy configuration is invalid, continuing without proxy: ${error.message}`);
        }
    }

    let proxyUrl;
    if (proxyConfiguration) {
        try {
            proxyUrl = await proxyConfiguration.newUrl();
        } catch (error) {
            log.warning(`Proxy URL generation failed, continuing without proxy: ${error.message}`);
        }
    }

    const client = new Impit({
        browser: 'chrome',
        ...(proxyUrl ? { proxyUrl } : {}),
    });

    log.info(
        `Starting product scrape for ${targets.length} collection(s), maxItems=${maxItems}, maxPages=${maxPages}, batchSize=${PAGE_SIZE}`,
    );

    let savedCount = 0;
    const seen = new Set();

    for (const target of targets) {
        if (savedCount >= maxItems) break;

        log.info(`Scraping collection '${target.collection}'${target.locale === 'fr' ? ' (French)' : ''}`);

        for (let page = 1; page <= maxPages && savedCount < maxItems; page += 1) {
            const products = await fetchCollectionPage({ client, target, page });
            if (products.length === 0) {
                log.info(`No more products for collection '${target.collection}' at page ${page}`);
                break;
            }

            const mapped = [];
            for (const product of products) {
                if (brandFilter && normalizeBrandFilter(product?.vendor) !== brandFilter) continue;

                const item = mapShopifyProduct(product);
                if (!item) continue;

                const key = item.url || item.productId;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                mapped.push(item);

                if (savedCount + mapped.length >= maxItems) break;
            }

            if (mapped.length > 0) {
                await Actor.pushData(mapped);
                savedCount += mapped.length;
            }

            log.info(
                `Collection '${target.collection}', page=${page}, fetched=${products.length}, saved=${mapped.length}, totalSaved=${savedCount}`,
            );

            if (products.length < PAGE_SIZE) break;
            if (page < maxPages && savedCount < maxItems) {
                await sleep(300 + Math.floor(Math.random() * 350));
            }
        }
    }

    if (savedCount === 0) {
        log.warning('Run completed but no products matched the filters.');
    } else {
        log.info(`Run completed successfully. Total products saved: ${savedCount}`);
    }
} catch (error) {
    log.exception(error, 'Actor run failed');
    throw error;
} finally {
    await Actor.exit();
}
