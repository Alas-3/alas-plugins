# Alas Nuvio Providers

Custom Nuvio plugin repository with a scraper adapted from `ashi` source logic.

## Included scraper

- `alas-1movies` (`providers/alas-1movies.js`)
- `ashianimekai` (`providers/ashianimekai.js`)
- `alas-hianime` (`providers/alas-hianime.js`)
- `alas-animepahe` (`providers/alas-animepahe.js`)
- Uses TMDB metadata lookup + standalone 1movies extraction flow
- Uses Animekai extraction flow adapted from `ashi`
- Uses standalone HiAnime and Animepahe source flows

## Add to Nuvio

Plugin:

```text
https://raw.githubusercontent.com/Alas-3/alas-plugins/refs/heads/main/manifest.json
```

## Notes

- Manifest format follows current Nuvio `pluginService` contract (`{ name, version, scrapers: [] }`).
- Each scraper is listed separately in `manifest.json`, so each one is independently toggleable in Nuvio.
