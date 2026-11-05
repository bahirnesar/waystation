## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [npm](https://www.npmjs.com/) (or pnpm / yarn)

### Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/bahirnesar/waystation.git
   cd waystation
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:5555](http://localhost:5555) in your browser.

## Deployment

Waystation is configured to deploy directly to Cloudflare Workers using Wrangler:

```bash
npm run deploy
```

Ensure you have authenticated with the Cloudflare CLI prior to deployment (`npx wrangler login`).

---

## License

This project is licensed under the [MIT License](LICENSE).
