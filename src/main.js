import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';

import log from '@apify/log';

const BASE_URL = 'https://www.brownsshoes.com';
const ORG_ID = 'f_ecom_bftx_prd';
const SITE_ID = 'BrownsShoes';
const SEARCH_EXPAND = 'promotions,variations,prices,images,custom_properties,availability,page_meta_tags';

// Removed DEFAULTS to ensure user input priority via Actor.getInput() destructuring.

const CATEGORY_TO_CGID = {
    women: '1',
    men: '2',
    kids: '4',
    sale: 'sale',
};

const headerGenerator = new HeaderGenerator({
    browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 132 }],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos', 'linux'],
    locales: ['en-US'],
});

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const normalized = String(value).replace(/[^\d.]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const uniqStrings = (values) => [...new Set((values || []).filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];

const toAbsoluteUrl = (url) => {
    if (!url) return null;
    try {
        return new URL(url, BASE_URL).href;
    } catch {
        return null;
    }
};

const normalizeProductUrl = (url) => {
    if (!url) return null;
    try {
        const absolute = new URL(url, BASE_URL);
        absolute.search = '';
        absolute.hash = '';
        return absolute.href;
    } catch {
        return null;
    }
};

const getVariationValues = (attributes, ids) => {
    const lookup = new Set(ids.map((id) => id.toLowerCase()));
    const values = [];

    for (const attribute of attributes || []) {
        const attrId = String(attribute?.id || '').toLowerCase();
        if (!lookup.has(attrId)) continue;

        for (const value of attribute?.values || []) {
            if (typeof value?.name === 'string') values.push(value.name);
            if (typeof value?.value === 'string') values.push(value.value);
            if (typeof value?.name?.en === 'string') values.push(value.name.en);
        }
    }

    return uniqStrings(values);
};

const mapSearchHit = (hit) => {
    if (!hit || typeof hit !== 'object') return null;

    const productUrl = normalizeProductUrl(hit.c_productUrl || hit.productUrl || hit.url || hit.link);
    const title = hit.productName || hit.name || null;
    if (!productUrl || !title) return null;

    const variationAttributes = hit.c_variationAttributes || hit.variationAttributes || [];
    const representedProduct = hit.representedProduct || {};

    const image = toAbsoluteUrl(
        hit?.image?.link
        || hit?.image?.src
        || hit?.imageGroups?.[0]?.images?.[0]?.link
        || hit?.imageGroups?.[0]?.images?.[0]?.src,
    );

    const images = uniqStrings(
        (hit.imageGroups || []).flatMap((group) => (group?.images || []).map((img) => img?.link || img?.src)),
    ).map((url) => toAbsoluteUrl(url));

    const price = toNumber(hit.price ?? hit.pricePerUnit ?? hit.priceMin ?? hit.pricePerUnitMin);
    const priceMax = toNumber(hit.priceMax ?? hit.pricePerUnitMax);

    return {
        title,
        brand: hit.c_brand || hit.brand?.name || hit.brand || null,
        price,
        originalPrice: priceMax && price && priceMax > price ? priceMax : null,
        currency: hit.currency || 'CAD',
        url: productUrl,
        image,
        images,
        colors: getVariationValues(variationAttributes, ['color', 'colour']),
        sizes: getVariationValues(variationAttributes, ['size']),
        inStock: hit.orderable ?? (representedProduct?.c_qtyInStock > 0),
        productId: hit.productId || representedProduct?.id || null,
        description: representedProduct?.c_productDescription || null,
    };
};

const normalizeBrandFilter = (brand) => {
    if (!brand || typeof brand !== 'string') return null;
    const value = brand.trim();
    if (!value) return null;
    return value.toUpperCase();
};

const parseStartUrlTarget = (startUrl) => {
    const rawUrl = startUrl?.url || startUrl;
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    try {
        const url = new URL(rawUrl);
        const segments = url.pathname.toLowerCase().split('/').filter(Boolean);

        const locale = segments[0] === 'fr' ? 'fr' : 'en';

        const cgidParam = url.searchParams.get('cgid');
        if (cgidParam) {
            return {
                label: rawUrl,
                cgid: cgidParam,
                locale,
            };
        }

        const hasAny = (...values) => values.some((value) => segments.includes(value));

        let cgid = null;
        if (hasAny('women', 'femmes')) cgid = '1';
        else if (hasAny('men', 'hommes')) cgid = '2';
        else if (hasAny('kids', 'enfants')) cgid = '4';
        else if (hasAny('sale', 'solde')) cgid = 'sale';

        if (!cgid) return null;

        return {
            label: rawUrl,
            cgid,
            locale,
        };
    } catch {
        return null;
    }
};

const buildTargets = (input) => {
    const startUrls = Array.isArray(input.startUrls) ? input.startUrls : [];

    if (startUrls.length > 0) {
        const targets = startUrls.map(parseStartUrlTarget).filter(Boolean);
        const deduped = [];
        const seen = new Set();

        for (const target of targets) {
            const key = `${target.locale}:${target.cgid}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(target);
        }

        return deduped;
    }

    const { category = 'women' } = input;
    const normalizedCategory = String(category).toLowerCase();
    const cgid = CATEGORY_TO_CGID[normalizedCategory] || CATEGORY_TO_CGID.women;

    return [{
        label: normalizedCategory,
        cgid,
        locale: 'en',
    }];
};

const resolveProxyUrl = async (proxyConfiguration) => {
    if (!proxyConfiguration) return undefined;

    try {
        return await proxyConfiguration.newUrl();
    } catch (error) {
        log.warning(`Proxy URL generation failed, continuing without proxy: ${error.message}`);
        return undefined;
    }
};

const fetchGuestToken = async ({ proxyConfiguration, baseHeaders }) => {
    const endpoint = `${BASE_URL}/mobify/slas/private/shopper/auth/v1/organizations/${ORG_ID}/oauth2/token`;
    const body = `grant_type=client_credentials&channel_id=${SITE_ID}`;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const proxyUrl = await resolveProxyUrl(proxyConfiguration);

        const response = await gotScraping({
            url: endpoint,
            method: 'POST',
            proxyUrl,
            throwHttpErrors: false,
            responseType: 'json',
            timeout: { request: 30000 },
            retry: { limit: 0 },
            headers: {
                ...baseHeaders,
                Accept: 'application/json,text/plain,*/*',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });

        if (response.statusCode === 200 && response.body?.access_token) {
            return response.body.access_token;
        }

        const isRetriable = response.statusCode >= 500 || response.statusCode === 429;
        if (!isRetriable || attempt === 3) {
            const detail = response.body?.detail || response.body?.message || `HTTP ${response.statusCode}`;
            throw new Error(`Failed to obtain guest token: ${detail}`);
        }

        await sleep(400 * attempt);
    }

    throw new Error('Failed to obtain guest token');
};

const fetchSearchPage = async ({ token, target, offset, limit, brand, proxyConfiguration, baseHeaders }) => {
    const searchParams = new URLSearchParams({
        siteId: SITE_ID,
        locale: target.locale,
        limit: String(limit),
        offset: String(offset),
        expand: SEARCH_EXPAND,
        allImages: 'true',
        perPricebook: 'true',
        allVariationProperties: 'true',
    });

    searchParams.append('refine', `cgid=${target.cgid}`);
    if (brand) searchParams.append('refine', `c_brand=${brand}`);

    const url = `${BASE_URL}/mobify/proxy/api/search/shopper-search/v1/organizations/${ORG_ID}/product-search?${searchParams.toString()}`;
    const proxyUrl = await resolveProxyUrl(proxyConfiguration);

    const response = await gotScraping({
        url,
        proxyUrl,
        throwHttpErrors: false,
        responseType: 'json',
        timeout: { request: 30000 },
        retry: { limit: 0 },
        headers: {
            ...baseHeaders,
            Accept: 'application/json,text/plain,*/*',
            Authorization: `Bearer ${token}`,
        },
    });

    if (response.statusCode === 401) {
        return { unauthorized: true };
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
        const detail = response.body?.detail || response.body?.message || `HTTP ${response.statusCode}`;
        throw new Error(`Search API request failed: ${detail}`);
    }

    return {
        unauthorized: false,
        data: response.body,
    };
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};

    const {
        // eslint-disable-next-line camelcase
        results_wanted = 20,
        maxPages = 5,
        pageSize = 20,
        brand,
    } = input;

    const maxItems = Math.max(1, results_wanted);
    const finalMaxPages = Math.max(1, maxPages);
    const finalPageSize = Math.max(1, Math.min(200, pageSize));
    const brandFilter = normalizeBrandFilter(brand);

    const targets = buildTargets(input);
    if (targets.length === 0) {
        throw new Error('No valid category targets found. Provide a supported category or valid Browns start URLs.');
    }

    let proxyConfiguration;
    try {
        proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
    } catch (error) {
        proxyConfiguration = undefined;
        log.warning(`Proxy configuration is invalid, continuing without proxy: ${error.message}`);
    }

    const baseHeaders = headerGenerator.getHeaders();

    log.info(`Starting API scrape for ${targets.length} target(s), maxItems=${maxItems}, maxPages=${finalMaxPages}, pageSize=${finalPageSize}`);

    let token = await fetchGuestToken({ proxyConfiguration, baseHeaders });

    let savedCount = 0;
    const seen = new Set();

    for (const target of targets) {
        if (savedCount >= maxItems) break;

        log.info(`Scraping target: cgid=${target.cgid}, locale=${target.locale}`);

        let offset = 0;

        for (let page = 1; page <= finalMaxPages && savedCount < maxItems; page += 1) {
            let pageResponse = await fetchSearchPage({
                token,
                target,
                offset,
                limit: finalPageSize,
                brand: brandFilter,
                proxyConfiguration,
                baseHeaders,
            });

            if (pageResponse.unauthorized) {
                token = await fetchGuestToken({ proxyConfiguration, baseHeaders });
                pageResponse = await fetchSearchPage({
                    token,
                    target,
                    offset,
                    limit: finalPageSize,
                    brand: brandFilter,
                    proxyConfiguration,
                    baseHeaders,
                });
            }

            if (pageResponse.unauthorized) {
                throw new Error('Search API remains unauthorized after token refresh.');
            }

            const payload = pageResponse.data;
            const hits = Array.isArray(payload?.hits) ? payload.hits : [];

            if (hits.length === 0) {
                log.info(`No more products for cgid=${target.cgid} at page ${page}`);
                break;
            }

            const mapped = [];
            for (const hit of hits) {
                const item = mapSearchHit(hit);
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

            log.info(`Target cgid=${target.cgid}, page=${page}, fetched=${hits.length}, saved=${mapped.length}, totalSaved=${savedCount}`);

            const total = Number(payload?.total);
            if (Number.isFinite(total) && offset + finalPageSize >= total) {
                break;
            }

            offset += finalPageSize;
            await sleep(300 + Math.floor(Math.random() * 350));
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
