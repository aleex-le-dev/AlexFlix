# Alex Prime

Streaming personnel style Netflix pour les films et séries du disque interne de la Freebox Révolution.

```powershell
Copy-Item .env.example .env   # compléter MEDIA_PATH, TMDB_API_KEY, MASTER_PASSWORD, JWT_SECRET
npm run setup
npm run scan
npm run dev                   # http://localhost:5173
```

Production : `npm run build && npm start` → `http://<pc>:4000`.

Documentation complète : coffre Obsidian `Toolkit/Alex-Prime/` (point d'entrée « Alex Prime - Index IA »).
