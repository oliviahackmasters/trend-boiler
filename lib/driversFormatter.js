/**
 * Format drivers data for 3-column display
 * @param {Object} driversData - The response from the drivers API endpoint
 * @returns {String} HTML formatted as 3 columns
 */
export function formatDriversAsHTML(driversData) {
  const { drivers, topic } = driversData;

  const primary = drivers.primary.items || [];
  const secondary = drivers.secondary.items || [];
  const wildcard = drivers.wildcard.items || [];

  // Get the max count to determine grid height
  const maxCount = Math.max(primary.length, secondary.length, wildcard.length);

  let html = `
<div class="drivers-container">
  <h2>Drivers for: ${escapeHtml(topic)}</h2>
  
  <div class="drivers-grid">
    <!-- PRIMARY COLUMN -->
    <div class="driver-column driver-primary">
      <h3>${drivers.primary.label}</h3>
      <p class="description">${drivers.primary.description}</p>
      <ul class="driver-list">
  `;

  primary.forEach(item => {
    html += `        <li>${escapeHtml(item)}</li>\n`;
  });

  html += `
      </ul>
    </div>

    <!-- SECONDARY COLUMN -->
    <div class="driver-column driver-secondary">
      <h3>${drivers.secondary.label}</h3>
      <p class="description">${drivers.secondary.description}</p>
      <ul class="driver-list">
  `;

  secondary.forEach(item => {
    html += `        <li>${escapeHtml(item)}</li>\n`;
  });

  html += `
      </ul>
    </div>

    <!-- WILDCARD COLUMN -->
    <div class="driver-column driver-wildcard">
      <h3>${drivers.wildcard.label}</h3>
      <p class="description">${drivers.wildcard.description}</p>
      <ul class="driver-list">
  `;

  wildcard.forEach(item => {
    html += `        <li>${escapeHtml(item)}</li>\n`;
  });

  html += `
      </ul>
    </div>
  </div>
</div>
  `;

  return html;
}

/**
 * Format drivers data as plain text with 3 columns
 * @param {Object} driversData - The response from the drivers API endpoint
 * @returns {String} Plain text formatted in columns
 */
export function formatDriversAsText(driversData) {
  const { drivers, topic } = driversData;

  const primary = drivers.primary.items || [];
  const secondary = drivers.secondary.items || [];
  const wildcard = drivers.wildcard.items || [];

  const colWidth = 35;
  const separator = ' | ';

  let text = `\nDRIVERS FOR: ${topic.toUpperCase()}\n`;
  text += '='.repeat(colWidth * 3 + separator.length * 2) + '\n';

  // Header
  text += padRight(drivers.primary.label, colWidth) + separator;
  text += padRight(drivers.secondary.label, colWidth) + separator;
  text += padRight(drivers.wildcard.label, colWidth) + '\n';

  text += padRight(drivers.primary.description, colWidth) + separator;
  text += padRight(drivers.secondary.description, colWidth) + separator;
  text += padRight(drivers.wildcard.description, colWidth) + '\n';

  text += '-'.repeat(colWidth * 3 + separator.length * 2) + '\n';

  // Rows
  const maxCount = Math.max(primary.length, secondary.length, wildcard.length);
  for (let i = 0; i < maxCount; i++) {
    const p = primary[i] || '';
    const s = secondary[i] || '';
    const w = wildcard[i] || '';

    text += padRight(p, colWidth) + separator;
    text += padRight(s, colWidth) + separator;
    text += padRight(w, colWidth) + '\n';
  }

  text += '='.repeat(colWidth * 3 + separator.length * 2) + '\n';
  return text;
}

/**
 * Format drivers data as a Markdown table
 * @param {Object} driversData - The response from the drivers API endpoint
 * @returns {String} Markdown table format
 */
export function formatDriversAsMarkdown(driversData) {
  const { drivers, topic } = driversData;

  const primary = drivers.primary.items || [];
  const secondary = drivers.secondary.items || [];
  const wildcard = drivers.wildcard.items || [];

  let md = `## Drivers for: ${topic}\n\n`;
  md += `| ${drivers.primary.label} | ${drivers.secondary.label} | ${drivers.wildcard.label} |\n`;
  md += `|---|---|---|\n`;
  md += `| ${drivers.primary.description} | ${drivers.secondary.description} | ${drivers.wildcard.description} |\n`;
  md += `|---|---|---|\n`;

  const maxCount = Math.max(primary.length, secondary.length, wildcard.length);
  for (let i = 0; i < maxCount; i++) {
    const p = primary[i] || '';
    const s = secondary[i] || '';
    const w = wildcard[i] || '';

    md += `| ${p} | ${s} | ${w} |\n`;
  }

  return md;
}

// Helper functions
function padRight(str, width) {
  str = String(str).substring(0, width);
  return str + ' '.repeat(Math.max(0, width - str.length));
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
