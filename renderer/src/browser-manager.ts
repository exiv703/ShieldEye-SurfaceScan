import { chromium, Browser, BrowserContext, Page, Response } from 'playwright';
import { NetworkResource, DOMAnalysis } from '@shieldeye/shared';
import { logger } from './logger';

export class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();

  async initialize(): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      logger.info('Browser initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize browser', { error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async createContext(
    sessionId: string,
    opts: { userAgent?: string; javaScriptEnabled?: boolean } = {}
  ): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: opts.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ShieldEye/1.0',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: opts.javaScriptEnabled !== false
    });

    this.contexts.set(sessionId, context);
    return context;
  }

  async renderPage(
    url: string,
    sessionId: string,
    options: {
      timeout?: number;
      waitForNetworkIdle?: boolean;
      userAgent?: string;
      headers?: Record<string, string>;
      renderJavaScript?: boolean;
    } = {}
  ): Promise<DOMAnalysis> {
    const context = this.contexts.get(sessionId) || await this.createContext(sessionId, {
      userAgent: options.userAgent,
      javaScriptEnabled: options.renderJavaScript !== false
    });
    return this.analyzeSinglePage(context, url, options);
  }

  async crawlAndAnalyze(
    startUrl: string,
    sessionId: string,
    options: {
      depth?: number;
      timeout?: number;
      userAgent?: string;
      headers?: Record<string, string>;
      renderJavaScript?: boolean;
      maxPages?: number;
      sameOriginOnly?: boolean;
    } = {}
  ): Promise<DOMAnalysis> {
    const timeout = options.timeout || 30000;
    const depth = Math.max(0, options.depth ?? 1);
    const maxPages = Math.min(options.maxPages ?? 20, 100);
    const sameOriginOnly = options.sameOriginOnly !== false; // default true

    const context = this.contexts.get(sessionId) || await this.createContext(sessionId, {
      userAgent: options.userAgent,
      javaScriptEnabled: options.renderJavaScript !== false
    });

    const origin = new URL(startUrl).origin;
    const visited = new Set<string>();
    const queue: Array<{ url: string; d: number }> = [{ url: startUrl, d: 0 }];

    const aggScripts: DOMAnalysis['scripts'] = { inline: [], external: [] };
    const aggSourceMaps: DOMAnalysis['sourceMaps'] = [];
    const aggResources: NetworkResource[] = [];

    while (queue.length > 0 && visited.size < maxPages) {
      const { url, d } = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      try {
        const analysis = await this.analyzeSinglePage(context, url, {
          timeout,
          headers: options.headers,
          waitForNetworkIdle: true
        });
        aggScripts.inline.push(...analysis.scripts.inline);
        aggScripts.external.push(...analysis.scripts.external);
        aggSourceMaps.push(...analysis.sourceMaps);
        aggResources.push(...analysis.resources);

        if (d < depth) {
          // extract links on this page for BFS
          const page = await context.newPage();
          page.setDefaultTimeout(timeout);
          page.setDefaultNavigationTimeout(timeout);
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
            const links: string[] = await page.$$eval('a[href]', (elements) =>
              (elements as any[])
                .map((a: any) => a.getAttribute('href') || '')
                .filter((v: string) => !!v)
            );
            for (const href of links) {
              try {
                const resolved = new URL(href, url).href;
                if (sameOriginOnly && new URL(resolved).origin !== origin) continue;
                if (resolved.startsWith('http')) {
                  queue.push({ url: resolved, d: d + 1 });
                }
              } catch {}
            }
          } catch (e) {
            logger.warn('Failed to extract links during crawl', { url, error: e instanceof Error ? e.message : e });
          } finally {
            await page.close();
          }
        }
      } catch (e) {
        logger.warn('Failed to analyze page during crawl', { url, error: e instanceof Error ? e.message : e });
      }
    }

    return { scripts: aggScripts, sourceMaps: aggSourceMaps, resources: aggResources };
  }

  private async analyzeSinglePage(
    context: BrowserContext,
    url: string,
    options: { timeout?: number; waitForNetworkIdle?: boolean; headers?: Record<string, string> } = {}
  ): Promise<DOMAnalysis> {
    const page = await context.newPage();
    const timeout = options.timeout || 30000;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    const networkResources: NetworkResource[] = [];
    const scripts: DOMAnalysis['scripts'] = { inline: [], external: [] };
    const sourceMaps: DOMAnalysis['sourceMaps'] = [];

    try {
      if (options.headers) {
        await page.setExtraHTTPHeaders(options.headers);
      }

      page.on('response', async (response: Response) => {
        try {
          const request = response.request();
          const contentLengthHeader = response.headers()['content-length'];
          const size = contentLengthHeader ? parseInt(contentLengthHeader, 10) || 0 : 0;

          const resource: NetworkResource = {
            url: response.url(),
            type: request.resourceType(),
            method: request.method(),
            status: response.status(),
            size,
            responseHeaders: response.headers(),
            timing: { startTime: 0, endTime: 0, duration: 0 }
          };
          networkResources.push(resource);

          const headers = response.headers();
          const contentType = headers['content-type'] || '';
          if (contentType.includes('application/json') && response.url().includes('.map')) {
            try {
              const sourceMapContent = await response.text();
              sourceMaps.push({ url: response.url(), content: sourceMapContent });
            } catch (error) {
              logger.warn('Failed to read source map', { url: response.url(), error: error instanceof Error ? error.message : error });
            }
          }

          // Check X-SourceMap or SourceMap headers (absolute or relative)
          const headerSourceMap = headers['x-sourcemap'] || headers['sourcemap'];
          if (headerSourceMap) {
            try {
              const smUrl = new URL(headerSourceMap, response.url()).href;
              // Avoid duplicates
              if (!sourceMaps.find((sm: { url: string; content?: string }) => sm.url === smUrl)) {
                const smResp = await page.goto(smUrl);
                if (smResp && smResp.ok()) {
                  const smContent = await smResp.text();
                  sourceMaps.push({ url: smUrl, content: smContent });
                }
              }
            } catch (e) {
              logger.warn('Failed to resolve SourceMap header', { base: response.url(), header: headerSourceMap, error: e instanceof Error ? e.message : e });
            }
          }
        } catch (error) {
          logger.warn('Error processing response', { url: response.url(), error: error instanceof Error ? error.message : error });
        }
      });

      try {
        await page.goto(url, {
          waitUntil: options.waitForNetworkIdle ? 'networkidle' : 'domcontentloaded',
          timeout
        });
      } catch (navErr) {
        logger.warn('Primary navigation failed, retrying with waitUntil=load', { url, error: navErr instanceof Error ? navErr.message : navErr });
        await page.goto(url, { waitUntil: 'load', timeout });
      }

      await page.waitForTimeout(2000);

      const scriptElements = await page.$$eval('script', (elements) => {
        return (elements as any[]).map((script: any) => {
          const attributes: Record<string, string> = {};
          for (const attr of script.attributes) {
            attributes[attr.name] = attr.value;
          }
          return {
            src: script.src as string,
            content: (script.innerHTML || '') as string,
            attributes,
            isInline: !script.src
          };
        });
      });

      for (const script of scriptElements) {
        if (script.isInline) {
          scripts.inline.push({ content: script.content, attributes: script.attributes });
        } else {
          scripts.external.push({ src: script.src, attributes: script.attributes });
        }
      }

      for (const script of scripts.inline) {
        const sourceMapMatch = script.content.match(/\/\/\# sourceMappingURL=(.+)/);
        if (sourceMapMatch) {
          const sourceMapUrl = new URL(sourceMapMatch[1], url).href;
          if (!sourceMaps.find((sm: { url: string; content?: string }) => sm.url === sourceMapUrl)) {
            try {
              const response = await page.goto(sourceMapUrl);
              if (response && response.ok()) {
                const content = await response.text();
                sourceMaps.push({ url: sourceMapUrl, content });
              }
            } catch (error) {
              logger.warn('Failed to fetch source map from inline script', { sourceMapUrl, error: error instanceof Error ? error.message : error });
            }
          }
        }
      }

      return { scripts, sourceMaps, resources: networkResources };
    } finally {
      await page.close();
    }
  }

  async captureDOM(url: string, sessionId: string): Promise<string> {
    const context = this.contexts.get(sessionId) || await this.createContext(sessionId);
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      
      const domContent = await page.content();
      return domContent;
    } finally {
      await page.close();
    }
  }

  async takeScreenshot(url: string, sessionId: string): Promise<Buffer> {
    const context = this.contexts.get(sessionId) || await this.createContext(sessionId);
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      
      const screenshot = await page.screenshot({ 
        fullPage: true,
        type: 'png'
      });
      return screenshot;
    } finally {
      await page.close();
    }
  }

  async closeContext(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    if (context) {
      await context.close();
      this.contexts.delete(sessionId);
    }
  }

  async close(): Promise<void> {
    // Close all contexts
    for (const [sessionId, context] of this.contexts) {
      await context.close();
    }
    this.contexts.clear();

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    logger.info('Browser manager closed');
  }
}
