(function() {
  const errors = [];
  const rejections = [];
  const startTime = performance.now();
  
  const errorHandler = (event) => {
    errors.push({
      message: event.message || String(event.error) || 'unknown',
      source: event.filename || event.sourceURL || 'unknown',
      line: event.lineno || event.line || 'unknown',
      col: event.colno || event.column || 'unknown',
      stack: event.error?.stack || null
    });
  };
  
  const rejectionHandler = (event) => {
    rejections.push({
      reason: event.reason?.stack || event.reason?.message || String(event.reason || 'unknown')
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
    const appJsResources = resources.filter(r => r.name.includes('/assets/app.js'));
    const appCssResources = resources.filter(r => r.name.includes('/assets/app.css'));
    const articlesJsonResources = resources.filter(r => r.name.includes('/projects/data/articles.json'));
    const videosJsonResources = resources.filter(r => r.name.includes('/projects/data/videos.json'));
    
    const formatResource = (r) => ({
      url: r.name,
      duration_ms: Math.round(r.duration),
      ttfb_ms: r.responseStart && r.requestStart ? Math.round(r.responseStart - r.requestStart) : null
    });
    
    const elapsed_ms = Math.round(performance.now() - startTime);
    
    const reportObject = {
      at: new Date().toISOString(),
      readyState: readyState,
      sectionsBar_count: sectionsBarButtons.length,
      sectionsBar_text120: sectionsBarText,
      feed_children: feedChildren,
      feed_cards: feedCards.length,
      feed_links: feedLinks.length,
      first_titles: feedTitles,
      fallback_exists: fallbackExists,
      fallback_visible: fallbackVisible,
      errors_first3: errors.slice(0, 3),
      rejections_first3: rejections.slice(0, 3),
      resources: {
        app_js: appJsResources.map(formatResource),
        app_css: appCssResources.map(formatResource),
        articles_json: articlesJsonResources.map(formatResource),
        videos_json: videosJsonResources.map(formatResource)
      },
      elapsed_ms: elapsed_ms
    };
    
    console.log('=== RUNTIME TEST REPORT ===');
    console.log(reportObject);
    console.log('=== END REPORT ===');
    
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  }, 4000);
})();
