(function() {
  const errors = [];
  const rejections = [];
  
  const errorHandler = (e) => {
    errors.push({
      message: e.message || String(e),
      source: e.filename || e.sourceURL || 'unknown',
      line: e.lineno || e.line || 'unknown',
      col: e.colno || e.column || 'unknown',
      error: e.error ? String(e.error) : null
    });
  };
  
  const rejectionHandler = (e) => {
    rejections.push({
      reason: e.reason ? String(e.reason) : 'unknown',
      promise: e.promise ? 'present' : 'missing'
    });
  };
  
  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);
  
  setTimeout(() => {
    const sectionsBar = document.getElementById('sectionsBar');
    const sectionsBarButtons = sectionsBar ? sectionsBar.querySelectorAll('button, .chip, a') : [];
    const sectionsBarText = sectionsBar ? sectionsBar.textContent.trim().slice(0, 120) : '(null)';
    
    const feed = document.getElementById('feed');
    const feedChildren = feed ? feed.children.length : 0;
    const feedCards = document.querySelectorAll('#feed .news-card');
    const feedLinks = document.querySelectorAll('#feed .news-titleLink');
    const feedTitles = Array.from(feedLinks).slice(0, 5).map(link => ({
      text: link.textContent.trim().slice(0, 60),
      href: link.href || link.getAttribute('href') || '(no href)'
    }));
    
    const fallback = document.getElementById('iuNoJsFallback');
    const fallbackExists = !!fallback;
    const fallbackVisible = fallback ? fallback.offsetParent !== null : false;
    
    const readyState = document.readyState;
    
    const resources = performance.getEntriesByType('resource');
    const appJs = resources.find(r => r.name.includes('/assets/app.js'));
    const appCss = resources.find(r => r.name.includes('/assets/app.css'));
    const articlesJson = resources.find(r => r.name.includes('/projects/data/articles.json'));
    
    console.log('\n=== RUNTIME TEST REPORT ===\n');
    console.log('--- ERRORS ---');
    console.log('Total errors:', errors.length);
    if (errors.length > 0) {
      console.log('First 3 errors:');
      errors.slice(0, 3).forEach((e, i) => {
        console.log(`  ${i+1}. ${e.message} (${e.source}:${e.line}:${e.col})`);
      });
    } else {
      console.log('Console errors: NONE');
    }
    
    console.log('\n--- REJECTIONS ---');
    console.log('Total unhandled rejections:', rejections.length);
    if (rejections.length > 0) {
      console.log('First 3 rejections:');
      rejections.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i+1}. ${r.reason}`);
      });
    }
    
    console.log('\n--- SECTIONS BAR ---');
    console.log('sectionsBar count:', sectionsBarButtons.length);
    console.log('sectionsBar textContent (first 120):', sectionsBarText);
    
    console.log('\n--- FEED ---');
    console.log('feed children:', feedChildren);
    console.log('feed cards (.news-card):', feedCards.length);
    console.log('feed links (.news-titleLink):', feedLinks.length);
    if (feedTitles.length > 0) {
      console.log('First 5 titles + href:');
      feedTitles.forEach((t, i) => {
        console.log(`  ${i+1}. "${t.text}" → ${t.href}`);
      });
    }
    
    console.log('\n--- FALLBACK ---');
    console.log('iuNoJsFallback exists:', fallbackExists);
    console.log('iuNoJsFallback visible:', fallbackVisible);
    
    console.log('\n--- DOCUMENT STATE ---');
    console.log('document.readyState:', readyState);
    
    console.log('\n--- RESOURCES ---');
    if (appJs) {
      console.log('/assets/app.js duration:', Math.round(appJs.duration), 'ms');
    } else {
      console.log('/assets/app.js: NOT FOUND');
    }
    if (appCss) {
      console.log('/assets/app.css duration:', Math.round(appCss.duration), 'ms');
    } else {
      console.log('/assets/app.css: NOT FOUND');
    }
    if (articlesJson) {
      console.log('/projects/data/articles.json duration:', Math.round(articlesJson.duration), 'ms');
    } else {
      console.log('/projects/data/articles.json: NOT FOUND');
    }
    
    console.log('\n--- PERFORMANCE ---');
    const navTiming = performance.getEntriesByType('navigation')[0];
    if (navTiming) {
      console.log('loadEventEnd:', Math.round(navTiming.loadEventEnd), 'ms');
      console.log('domContentLoadedEventEnd:', Math.round(navTiming.domContentLoadedEventEnd), 'ms');
    }
    console.log('performance.now():', Math.round(performance.now()), 'ms');
    
    console.log('\n=== END REPORT ===\n');
    
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  }, 4000);
})();
