import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            startUrls = [],
            category = 'women',
            maxItems = 100,
            maxPages = 50,
            brand = '',
            minPrice,
            maxPrice,
            color = '',
            size = '',
            proxyConfiguration,
        } = input;

        const MAX_ITEMS = Number.isFinite(+maxItems) && maxItems > 0 ? maxItems : 100;
        const MAX_PAGES = Number.isFinite(+maxPages) && maxPages > 0 ? maxPages : 50;
        
        const baseUrl = 'https://www.brownsshoes.com';
        const toAbs = (href) => {
            try { return new URL(href, baseUrl).href; } catch { return null; }
        };

        const buildStartUrls = () => {
            if (startUrls && startUrls.length > 0) {
                return startUrls.map(item => typeof item === 'string' ? item : item.url).filter(Boolean);
            }
            
            const url = new URL(`${baseUrl}/en/${category}`);
            if (brand) url.searchParams.set('prefn1', 'brand');
            if (brand) url.searchParams.set('prefv1', brand);
            return [url.href];
        };

        const proxyConf = proxyConfiguration 
            ? await Actor.createProxyConfiguration(proxyConfiguration) 
            : undefined;

        let itemsSaved = 0;
        const seenUrls = new Set();

        async function tryJsonApiExtraction(url, crawlerLog) {
            try {
                const apiUrl = url.includes('?') ? `${url}&format=ajax` : `${url}?format=ajax`;
                crawlerLog.debug(`Attempting JSON API: ${apiUrl}`);
                
                const response = await gotScraping({
                    url: apiUrl,
                    proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                    responseType: 'json',
                    throwHttpErrors: false,
                    timeout: { request: 30000 },
                    retry: { limit: 2 },
                });

                if (response.statusCode === 200 && response.body) {
                    crawlerLog.info(`JSON API successful for ${url}`);
                    return response.body;
                }
            } catch (err) {
                crawlerLog.debug(`JSON API failed: ${err.message}`);
            }
            return null;
        }

        function extractProductsFromJson(jsonData, crawlerLog) {
            const products = [];
            
            try {
                if (jsonData.products && Array.isArray(jsonData.products)) {
                    return jsonData.products.map(p => ({
                        title: p.productName || p.name || null,
                        brand: p.brand || null,
                        price: p.price?.sales?.value || p.price?.list?.value || p.price || null,
                        originalPrice: p.price?.list?.value || null,
                        currency: p.price?.sales?.currency || p.price?.currency || 'CAD',
                        url: p.url ? toAbs(p.url) : null,
                        image: p.images?.[0]?.url || p.image || null,
                        colors: p.colors || [],
                        sizes: p.sizes || [],
                        inStock: p.available !== false,
                        productId: p.id || p.productId || null,
                    }));
                }

                if (jsonData.data && Array.isArray(jsonData.data)) {
                    return jsonData.data.map(p => ({
                        title: p.productName || p.name || null,
                        brand: p.brand || null,
                        price: p.price?.sales?.value || p.price || null,
                        originalPrice: p.price?.list?.value || null,
                        currency: p.price?.sales?.currency || 'CAD',
                        url: p.url ? toAbs(p.url) : null,
                        image: p.images?.[0]?.url || p.image || null,
                        colors: p.colors || [],
                        sizes: p.sizes || [],
                        inStock: p.available !== false,
                        productId: p.id || p.productId || null,
                    }));
                }
            } catch (err) {
                crawlerLog.error(`Error parsing JSON products: ${err.message}`);
            }
            
            return products;
        }

        function extractProductsFromHtml($, crawlerLog) {
            const products = [];
            
            try {
                $('.product, .product-tile, [class*="product-"]').each((_, element) => {
                    const $el = $(element);
                    
                    const titleEl = $el.find('.product-name, .product-title, [class*="product-name"], a[href*="/product/"]').first();
                    const title = titleEl.text().trim() || titleEl.attr('title') || null;
                    
                    const linkEl = $el.find('a[href*="/product/"]').first();
                    const url = linkEl.attr('href') ? toAbs(linkEl.attr('href')) : null;
                    
                    if (!url || seenUrls.has(url)) return;
                    
                    const brandEl = $el.find('.product-brand, [class*="brand"]').first();
                    const brand = brandEl.text().trim() || null;
                    
                    const priceEl = $el.find('.price-sales, .sales, [class*="price-sales"]').first();
                    const price = priceEl.text().replace(/[^0-9.]/g, '') || null;
                    
                    const originalPriceEl = $el.find('.price-standard, [class*="price-standard"]').first();
                    const originalPrice = originalPriceEl.text().replace(/[^0-9.]/g, '') || null;
                    
                    const imageEl = $el.find('img').first();
                    const image = imageEl.attr('src') || imageEl.attr('data-src') || null;
                    
                    const productIdMatch = url?.match(/\/(\d+)\.html/);
                    const productId = productIdMatch ? productIdMatch[1] : null;
                    
                    products.push({
                        title,
                        brand,
                        price: price ? parseFloat(price) : null,
                        originalPrice: originalPrice ? parseFloat(originalPrice) : null,
                        currency: 'CAD',
                        url,
                        image: image ? toAbs(image) : null,
                        colors: [],
                        sizes: [],
                        inStock: true,
                        productId,
                    });
                    
                    if (url) seenUrls.add(url);
                });
            } catch (err) {
                crawlerLog.error(`Error parsing HTML products: ${err.message}`);
            }
            
            return products;
        }

        function findNextPage($, currentUrl) {
            const nextLink = $('.pagination a[rel="next"], .pagination .next a, a.next').first();
            if (nextLink.length) {
                const href = nextLink.attr('href');
                return href ? toAbs(href) : null;
            }
            
            const pageLinks = $('.pagination a[href]');
            for (let i = 0; i < pageLinks.length; i++) {
                const $link = $(pageLinks[i]);
                const text = $link.text().trim();
                if (/next|›|»|>/i.test(text)) {
                    const href = $link.attr('href');
                    return href ? toAbs(href) : null;
                }
            }
            
            const currentUrlObj = new URL(currentUrl);
            const start = parseInt(currentUrlObj.searchParams.get('start') || '0');
            const sz = parseInt(currentUrlObj.searchParams.get('sz') || '24');
            
            if ($('.product, .product-tile').length >= sz) {
                currentUrlObj.searchParams.set('start', String(start + sz));
                return currentUrlObj.href;
            }
            
            return null;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const pageNum = request.userData?.pageNum || 1;
                
                crawlerLog.info(`Processing page ${pageNum}: ${request.url}`);
                
                if (itemsSaved >= MAX_ITEMS) {
                    crawlerLog.info(`Reached max items limit (${MAX_ITEMS})`);
                    return;
                }
                
                let products = [];
                
                const jsonData = await tryJsonApiExtraction(request.url, crawlerLog);
                if (jsonData) {
                    products = extractProductsFromJson(jsonData, crawlerLog);
                    crawlerLog.info(`Extracted ${products.length} products from JSON API`);
                }
                
                if (products.length === 0) {
                    crawlerLog.info('Falling back to HTML parsing');
                    products = extractProductsFromHtml($, crawlerLog);
                    crawlerLog.info(`Extracted ${products.length} products from HTML`);
                }
                
                const remaining = MAX_ITEMS - itemsSaved;
                const toSave = products.slice(0, remaining);
                
                if (toSave.length > 0) {
                    await Dataset.pushData(toSave);
                    itemsSaved += toSave.length;
                    crawlerLog.info(`Saved ${toSave.length} products (total: ${itemsSaved}/${MAX_ITEMS})`);
                }
                
                if (itemsSaved < MAX_ITEMS && pageNum < MAX_PAGES) {
                    const nextUrl = findNextPage($, request.url);
                    if (nextUrl) {
                        crawlerLog.info(`Enqueueing next page: ${nextUrl}`);
                        await enqueueLinks({
                            urls: [nextUrl],
                            userData: { pageNum: pageNum + 1 },
                        });
                    } else {
                        crawlerLog.info('No next page found');
                    }
                } else {
                    crawlerLog.info(`Stopping: items=${itemsSaved}, pages=${pageNum}`);
                }
            },
            
            failedRequestHandler({ request, error }, crawlerLog) {
                crawlerLog.error(`Request ${request.url} failed: ${error.message}`);
            },
        });

        const initialUrls = buildStartUrls();
        log.info(`Starting with URLs: ${initialUrls.join(', ')}`);
        
        await crawler.run(initialUrls.map(url => ({
            url,
            userData: { pageNum: 1 },
        })));
        
        log.info(`✓ Scraping completed. Total products saved: ${itemsSaved}`);
        
    } catch (error) {
        log.error(`Fatal error: ${error.message}`);
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
