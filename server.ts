import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'LexNote', timestamp: new Date().toISOString() });
});

// Serve static assets from dist in production
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

// Also serve public files directly as fallback
app.use(express.static(path.resolve(__dirname, 'public')));

// SPA fallback: send index.html for all other routes
app.get('*', (req, res) => {
  const indexPath = path.resolve(distPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // If dist/index.html is not found, fallback to root index.html
      res.sendFile(path.resolve(__dirname, 'index.html'));
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LexNote server listening on http://0.0.0.0:${PORT}`);
});
