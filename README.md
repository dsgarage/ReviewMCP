# review-mcp-min

Minimal MCP (Model Context Protocol) server for Re:VIEW document processing with JS/Ruby hybrid pipeline.

## Version

v0.1.0 - Initial release with hybrid pipeline support

## Features

### Core Functionality
- **Tag Enforcement**: Validates Re:VIEW markup tags against configurable allowlists
- **ID Management**: Automatically fixes empty/duplicate IDs in blocks and captions
- **Fast Linting**: Quick sanity checks via LaTeX compilation
- **Hybrid Pipeline**: JS preprocessing + Ruby (LaTeX Builder) for PDF generation

### Security (SSOT - Single Source of Truth)
- Dynamic security configuration loading from ReviewExtention
- Two-layer defense: MCP pre-sanitization + Ruby final validation
- Path traversal and absolute path blocking for mapfile macros
- File size and extension validation

### MCP Commands

#### Basic Commands
- `review.version` - Get Re:VIEW CLI version
- `review.tags.list` - List allowed tags
- `review.enforceTags.check` - Check for unknown tags
- `review.fixIds.plan` - Plan ID fixes for empty/duplicate IDs
- `review.fixIds.apply` - Apply ID fixes with backup
- `review.lint` - Run fast lint checks

#### Hybrid Pipeline Commands
- `review.preprocess` - JS preprocessing (currently passthrough)
- `review.build-pdf-hybrid` - Build PDF with hybrid pipeline
- `review.check-ruby-extensions` - Verify Ruby extensions
- `review.test-mapfile` - Test mapfile with security validation

#### Security Commands
- `review.security.config` - Get current security configuration
- `review.security.validate-mapfile` - Validate mapfile paths
- `review.security.compare` - Compare configs for SSOT compliance

## Installation

```bash
# Clone the repository
git clone https://github.com/dsgarage/ReviewMCP.git
cd review-mcp-min

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start MCP server
npm start
```

## Usage

### Project Root (cwd) Specification

All MCP tools require a `cwd` parameter pointing to your Re:VIEW project root:

```
mybook/              ← This is cwd
├── config.yml       ← Required
├── catalog.yml      ← Required
├── ch01.re
├── ch02.re
├── images/
└── ...
```

The `cwd` must be the directory containing `config.yml` and `catalog.yml`.

### With Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "review-mcp": {
      "command": "node",
      "args": [
        "/path/to/review-mcp-min/node_modules/.bin/tsx",
        "/path/to/review-mcp-min/src/index.ts"
      ]
    }
  }
}
```

### With ClaudeCode

```bash
cd ~/books/mybook
claude mcp add review-mcp -s project -- \
  node ./tools/review-mcp/node_modules/.bin/tsx ./src/index.ts
```

## Project Structure

```
review-mcp-min/
├── src/
│   ├── index.ts                 # MCP server main
│   ├── commands/
│   │   └── hybrid-pipeline.ts   # Hybrid pipeline commands
│   ├── config/
│   │   └── security.ts          # SSOT security configuration
│   └── utils/
│       └── runCommand.ts        # Command execution utilities
├── articles/                    # Re:VIEW test documents
│   ├── chapter01.re
│   └── chapter02.re
├── config.yml                   # Re:VIEW configuration
├── catalog.yml                  # Re:VIEW catalog
└── test-build.js               # Test script for hybrid pipeline
```

## Development

```bash
# Run in development mode
npm run dev

# Type checking
npm run typecheck

# Build
npm run build

# Test PDF generation
node test-build.js
```

## Testing

The repository includes test Re:VIEW documents demonstrating various features:
- Inline tags (strong, em, code, tt, kw)
- Block tags (list, emlist, note, memo, cmd, quote)
- Tables, source code blocks, footnotes
- Security and SSOT configuration examples

Run the test build:
```bash
review-pdfmaker config.yml
```

## CI/CD

GitHub Actions workflow included (`.github/workflows/mcp-hybrid.yml`) for:
- Multi-version testing (Node.js 18/20, Ruby 3.x)
- Security configuration validation
- PDF generation testing
- SSOT compliance checking

## Requirements

- Node.js 18+
- Ruby + Bundler
- Re:VIEW gem (5.x recommended)
- TeX Live (for PDF generation with uplatex)

## Recommended Workflow

1. **On save**: `review.enforceTags.check` - Block unknown tags
2. **Auto-fix**: `review.fixIds.plan` → `review.fixIds.apply` - Fix IDs
3. **Lint**: `review.lint` - Show warnings

## Configuration

Optional `review-mcp.json`:
```json
{
  "profile": "dual",
  "target": "latex",
  "blockOnUnknownTags": true,
  "autoFixIdsOnSave": true
}
```

## License

MIT

## Contributing

Issues and PRs welcome at [GitHub repository](https://github.com/dsgarage/ReviewMCP)

## Related Issues

- [#5](https://github.com/dsgarage/ReviewMCP/issues/5) - Ruby implementation integration
- [#6](https://github.com/dsgarage/ReviewMCP/issues/6) - Hybrid pipeline commands
- [#7](https://github.com/dsgarage/ReviewMCP/issues/7) - SSOT security configuration

## Author

@dsgarage

## Changelog

### v0.1.0 (2025-01-08)
- Initial release
- Hybrid JS/Ruby pipeline implementation
- SSOT security configuration
- Basic Re:VIEW tag validation and ID management
- Test documents and PDF generation support