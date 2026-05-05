# Trend Drivers Generator

A feature to generate primary drivers, secondary drivers, and wildcard drivers for any trend or topic in the Trend Boiler platform.

## Overview

The drivers generator helps with strategic foresight analysis by categorizing future factors into three impact/likelihood categories:

- **Primary Drivers**: Highly likely to happen AND would have big impact
- **Secondary Drivers**: Less likely to happen BUT would still have relatively big impact  
- **Wildcard Drivers**: Unlikely to happen BUT would be absolutely massive if it does (e.g., regulatory shock, pandemic, tech breakthrough)

All drivers are displayed in a 3-column format for easy comparison.

## API Usage

### Endpoint

```
POST /api/drivers
```

### Request

```json
{
  "topic": "AI in Luxury Fashion",
  "sector": "luxury",
  "history": []
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | Yes | The topic to generate drivers for (e.g., "generate drivers for AI in Luxury Fashion") |
| `sector` | string | No | The sector context (default: "luxury"). Can be "luxury", "tech", "healthcare", "finance", etc. |
| `history` | array | No | Previous conversation history for context (advanced feature) |

### Response

```json
{
  "topic": "AI in Luxury Fashion",
  "drivers": {
    "primary": {
      "label": "Primary Drivers",
      "description": "Highly likely, big impact",
      "items": [
        "Personalisation via AI-driven styling recommendations",
        "Supply chain optimisation reducing production costs",
        "Real-time inventory management across global stores"
      ]
    },
    "secondary": {
      "label": "Secondary Drivers",
      "description": "Less likely, relatively big impact",
      "items": [
        "Generative design creating wholly new aesthetic categories",
        "AI-powered virtual try-on technology adoption"
      ]
    },
    "wildcard": {
      "label": "Wildcard Drivers",
      "description": "Unlikely, but big impact",
      "items": [
        "Legislation restricting AI in creative industries",
        "Major breakthrough in conscious AI materials sourcing"
      ]
    }
  },
  "raw_response": "..."
}
```

## Frontend Usage

### Basic HTML Setup

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="drivers.css">
</head>
<body>
  <input type="text" id="topic" placeholder="Enter topic">
  <button onclick="generateDrivers()">Generate</button>
  <div id="results"></div>

  <script>
    async function generateDrivers() {
      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer YOUR_DEMO_TOKEN'
        },
        body: JSON.stringify({
          topic: document.getElementById('topic').value,
          sector: 'luxury'
        })
      });

      const data = await response.json();
      // Format and display results
      document.getElementById('results').innerHTML = formatDrivers(data);
    }
  </script>
</body>
</html>
```

### Using the Formatter Utilities

#### JavaScript Module (formatDrivers.js)

Three formatting options are available:

**1. HTML Format (for browser display)**
```javascript
import { formatDriversAsHTML } from './lib/driversFormatter.js';

const html = formatDriversAsHTML(driversData);
document.getElementById('container').innerHTML = html;
```

**2. Plain Text Format (for console/export)**
```javascript
import { formatDriversAsText } from './lib/driversFormatter.js';

const text = formatDriversAsText(driversData);
console.log(text);
```

**3. Markdown Format (for documentation)**
```javascript
import { formatDriversAsMarkdown } from './lib/driversFormatter.js';

const markdown = formatDriversAsMarkdown(driversData);
// Use for exporting to markdown files
```

## CSS Styling

Include `drivers.css` for the 3-column display:

```html
<link rel="stylesheet" href="drivers.css">
```

**Features:**
- Responsive 3-column grid (2 columns on tablet, 1 on mobile)
- Color-coded columns: Green (Primary), Amber (Secondary), Red (Wildcard)
- Hover effects and visual hierarchy
- Icons and descriptions for clarity

## Example Files

### Complete Working Example

See `driversExample.html` for a complete working example with:
- Input form for topic and sector selection
- Real-time API integration
- 3-column display with styling
- Error handling
- Loading states
- Raw response inspection

### Integration with Existing System

The driver generator integrates with your existing infrastructure:

1. **Vector Store Integration**: Uses the same sector-based vector stores as the `ask.js` endpoint
2. **Authentication**: Uses the same `requireDemoToken` middleware
3. **Error Handling**: Consistent error responses with the rest of the API
4. **OpenAI Integration**: Uses the configured OpenAI model and file search

## Advanced Usage

### With Conversation History

Pass previous conversation context for multi-turn analysis:

```javascript
const response = await fetch('/api/drivers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer TOKEN'
  },
  body: JSON.stringify({
    topic: "Next-gen drivers for Web3 luxury",
    sector: "luxury",
    history: [
      { role: "user", content: "What are current trends in luxury tech?" },
      { role: "assistant", content: "..." }
    ]
  })
});
```

### Exporting Results

#### To CSV
```javascript
function driversToCSV(driversData) {
  const { drivers } = driversData;
  const rows = [];
  const maxLen = Math.max(
    drivers.primary.items.length,
    drivers.secondary.items.length,
    drivers.wildcard.items.length
  );
  
  rows.push(['Primary', 'Secondary', 'Wildcard']);
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      drivers.primary.items[i] || '',
      drivers.secondary.items[i] || '',
      drivers.wildcard.items[i] || ''
    ]);
  }
  
  return rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
}
```

#### To PowerPoint (using a library like PptxGenJS)
```javascript
import PptxGenJS from "pptxgenjs";

function driversToPresentation(driversData) {
  const prs = new PptxGenJS();
  const slide = prs.addSlide();
  
  // Add title
  slide.addText(`Drivers for: ${driversData.topic}`, {
    x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 32
  });
  
  // Add 3 columns as text boxes
  // ... (detailed implementation)
  
  prs.writeFile({ fileName: "drivers.pptx" });
}
```

## Environment Variables

The drivers endpoint uses the same environment variables as other API endpoints:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
R2_ACCOUNT_ID=...
R2_BUCKET_NAME=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=...
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing topic parameter" | No topic provided | Include `topic` in request body |
| "Missing vector store ID" | Sector not configured | Use valid sector: luxury, tech, healthcare, finance |
| "Missing demo token" | No authentication | Include valid `Authorization` header |
| "DRIVERS FAILED" | API error | Check OPENAI_API_KEY and model configuration |

## Performance Notes

- Response time typically 3-8 seconds (depends on OpenAI API latency)
- Results vary based on document quality in vector store for the sector
- Supports up to 2000 output tokens per response
- Request timeout: 60 seconds

## Integration Checklist

- [ ] Endpoint `/api/drivers.js` deployed
- [ ] `lib/driversFormatter.js` available
- [ ] `drivers.css` included in frontend
- [ ] Example HTML (`driversExample.html`) tested
- [ ] Authorization tokens configured
- [ ] Vector stores populated for relevant sectors
- [ ] OpenAI API key and model configured

## Support & Customization

### Customizing the System Prompt

Edit the `system` variable in `api/drivers.js` to adjust driver categories or add sector-specific guidance:

```javascript
const system = [
  "You are a strategic foresight specialist...",
  // ... modify guidance here
].join("\n");
```

### Changing Output Format

Modify the `parseDriversResponse()` function in `api/drivers.js` to parse different response formats from OpenAI.

### Adding New Sectors

1. Configure vector store ID in `lib/vs.js`
2. Add sector option to frontend
3. Upload trend documents to R2 bucket for that sector

---

**Version:** 1.0  
**Last Updated:** 2025-05-05
