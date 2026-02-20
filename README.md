# Alas Nuvio Providers

Custom Nuvio plugin repository with a scraper adapted from `ashi` source logic.

## Included scraper

- `Ashi 1Movies` (`providers/ashi1movies.js`)
- `ashianimekai` (`providers/ashianimekai.js`)
- Uses TMDB metadata lookup + 1Movies extraction flow adapted from `ashi`
- Uses Animekai extraction flow adapted from `ashi`

## Add to Nuvio

Use this repo root raw URL in Nuvio Plugins:

```text
https://raw.githubusercontent.com/<your-username>/<your-repo>/refs/heads/main/
```

Nuvio will auto-fetch:

```text
https://raw.githubusercontent.com/<your-username>/<your-repo>/refs/heads/main/manifest.json
```

## Notes

- Manifest format follows current Nuvio `pluginService` contract (`{ name, version, scrapers: [] }`).
- Each scraper is listed separately in `manifest.json`, so each one is independently toggleable in Nuvio.
