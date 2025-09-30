
## Building from Source

If you need to build the native addon from source:

```bash
# Clone the repository
git clone https://github.com/ai-coustics/aic-sdk-node
cd aic-sdk-node

# Install dependencies
npm install

# Build TypeScript and native addon
npm run build

# Run examples
npm test
```

## Running Examples

Check the `examples/` directory for comprehensive usage examples demonstrating various features.

### Set License Key

Make sure your license key is set:

```bash
export AIC_SDK_LICENSE="your-license-key"
```

### Run Examples

```bash
# Run basic test
npm test

# Run JavaScript example
npm run example:js

# Run TypeScript example
npm run example:ts

# Run all tests and examples
npm run test:full
```

### Direct Execution

```bash
# JavaScript (can run directly with node)
node examples/example.js

# TypeScript (requires ts-node)
npx ts-node examples/example.ts
```

**Note:** TypeScript files (`.ts`) cannot be run directly with `node`. Use `ts-node` or compile them first with `tsc`.
