const puppeteer = require("puppeteer");

const scrapeGoogleMapsTitlesAndHref = async (query, limit = 0) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--single-process",
        "--no-zygote",
        "--disable-dev-shm-usage" // Added to help with memory issues
      ],
      executablePath:
        process.env.NODE_ENV === "production"
          ? process.env.PUPPETEER_EXECUTABLE_PATH
          : puppeteer.executablePath(),
    });

    const page = await browser.newPage();
    
    // Increase the navigation timeout
    page.setDefaultNavigationTimeout(60000); // 60 seconds
    
    // Set a user agent to make the request more like a regular browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.82 Safari/537.36');
    
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    
    // Use a try-catch block specifically for navigation
    try {
      await page.goto(url, { 
        waitUntil: "networkidle2", // Changed from networkidle0 to networkidle2 (less strict)
        timeout: 60000 // Explicit timeout here too
      });
    } catch (navigationError) {
      console.warn(`Navigation warning: ${navigationError.message}`);
      console.log("Continuing with scraping anyway...");
    }
    
    // Wait for any results to appear
    await page.waitForFunction(() => {
      return document.querySelector('.m6QErb[role="feed"]') || 
             document.querySelector('.Nv2PK') || 
             document.querySelector('.m6QErb.DxyBCb.kA9KIf') ||
             document.querySelector('.m6QErb');
    }, { timeout: 60000 });

    // Keep scrolling until we reach the end or timeout
    const startTime = Date.now();
    let previousHeight = 0;
    let consecutiveSameHeight = 0;
    let lastResultCount = 0;
    let noChangeCount = 0;

    // Maximum scroll time - continue until timeout or end of results
    while (true) {
      // Find the most appropriate container to scroll
      const currentHeight = await page.evaluate(() => {
        // Try to find the scrollable container
        const container = 
          document.querySelector('.m6QErb[role="feed"]') || 
          document.querySelector('.DxyBCb') ||
          document.querySelector('.m6QErb');
          
        if (!container) return 0;
        
        // Scroll down
        container.scrollBy(0, 400);
        return container.scrollHeight;
      });

      // Check both result types - this is KEY to fix the issue
      const resultCounts = await page.evaluate(() => {
        return {
          visibleResults: document.querySelectorAll('.Nv2PK').length,
          clickableLinks: document.querySelectorAll('.hfpxzc').length
        };
      });
            
      // Only consider checking the limit if we have a significant number of results
      // and links are being properly loaded (at least 80% of visible results have links)
      if (limit > 0 && 
          resultCounts.clickableLinks >= Math.min(limit, resultCounts.visibleResults * 0.8) &&
          resultCounts.clickableLinks >= lastResultCount) {
        // We have enough results with links, but keep scrolling for a few more iterations
        // to ensure we've loaded enough (Google Maps loads in batches)
        noChangeCount++;
        if (noChangeCount >= 3 && resultCounts.clickableLinks >= limit) {
          break;
        }
      } else {
        noChangeCount = 0;
      }
      
      // Update last result count
      if (resultCounts.clickableLinks > lastResultCount) {
        lastResultCount = resultCounts.clickableLinks;
      }

      // Break conditions
      if (Date.now() - startTime > 60000) {
        break;
      }

      if (currentHeight === previousHeight) {
        consecutiveSameHeight++;
        if (consecutiveSameHeight >= 3) {
          break;
        }
      } else {
        consecutiveSameHeight = 0;
      }

      // Wait for content to load - USING setTimeout INSTEAD OF waitForTimeout
      await new Promise(resolve => setTimeout(resolve, 1500));
      previousHeight = currentHeight;
      
    }

    // Extract data from elements
    let data = await page.evaluate(() => {
      const elements = document.getElementsByClassName("hfpxzc");
      return Array.from(elements).map((element) => ({
        title: element.getAttribute("aria-label"),
        href: element.getAttribute("href"),
      }));
    });

    // Filter out invalid results - doing this AFTER extraction to avoid premature limits
    data = data.filter((item) => item.title && item.href);
        
    // Apply the limit to the results if specified
    if (limit > 0 && data.length > limit) {
      data = data.slice(0, limit);
    }

    if (browser) await browser.close();
    return data;
  } catch (error) {
    console.error(`Error during scraping: ${error.message}`);
    
    // Close browser if it's open
    if (browser) {
      try {
        await browser.close();
      } catch (closingError) {
        console.error(`Error closing browser: ${closingError.message}`);
      }
    }
    
    const errorMessage = `Error scraping Google Maps data: ${error.message}`;
    throw new Error(errorMessage);
  }
};

module.exports = { scrapeGoogleMapsTitlesAndHref };

// // Test function to run the scraper
// async function testScraper() {
//   try {
//     const query = "Zahnarzt Bonn";
//     const limit = 50; // Set to your desired limit (0 for unlimited)
    
//     const results = await scrapeGoogleMapsTitlesAndHref(query, limit);
//     console.log(results)
//     console.log(`Retrieved ${results.length} results:`);

//     return results;
//   } catch (error) {
//     console.error("Test failed:", error);
//   }
// }

// // Run the test if this file is run directly
// if (require.main === module) {
//   testScraper();
// }
