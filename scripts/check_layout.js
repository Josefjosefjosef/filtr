const fs = require('fs');

const cssPath = 'assets/app.css';
const css = fs.readFileSync(cssPath, 'utf8');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// 1) Ensure the main wrapper is grid (feed left + right MindMenu).
if (!/\.layout\s*\{[\s\S]*?display\s*:\s*grid\b/i.test(css)) {
  fail('❌ Missing grid layout on .layout');
}
if (!/\.layout\s*\{[\s\S]*?grid-template-columns\s*:\s*[^;]+;/i.test(css)) {
  fail('❌ Missing grid-template-columns on .layout');
}

// 2) Ensure left wrapper is grid (rail + feed together).
if (!/#newsList\s*\{[\s\S]*?display\s*:\s*grid\b/i.test(css)) {
  fail('❌ Missing grid layout on #newsList (rail + feed wrapper)');
}
// Expect at least 2 columns with rail (136px or var(--iuLeftRailW)) + flexible middle.
if (!/#newsList\s*\{[\s\S]*?grid-template-columns\s*:\s*(?:136px|var\s*\(\s*--iuLeftRailW\s*\))\s+minmax\(0,\s*1fr\)/i.test(css)) {
  fail('❌ Missing expected rail + minmax(0,1fr) columns on #newsList');
}

// 3) Ensure rail is not forced fixed via ID selector (avoid overlay regressions).
// This intentionally does NOT flag unrelated fixed elements (e.g. topbar),
// and does not try to interpret comma-separated selectors.
const idBlockMatch = css.match(/#iuLeftRail\s*\{([^}]*)\}/i);
if (idBlockMatch && /position\s*:\s*fixed\b/i.test(idBlockMatch[1])) {
  fail('❌ Left rail fixed detected via #iuLeftRail{ position: fixed }');
}

console.log('✅ Layout guard OK');
