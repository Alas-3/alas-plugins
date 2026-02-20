# Alas Nuvio Providers

Custom Nuvio plugin repository with a scraper adapted from `ashi` source logic.

## Included scraper

- `alas-animekai` (`providers/alas-animekai.js`)
- `alas-animepahe` (`providers/alas-animepahe.js`)
- `alas-animepahedub` (`providers/alas-animepahedub.js`)
- `alas-checkmate` (`providers/alas-checkmate.js`)
- `alas-checkmate-fast` (`providers/alas-checkmate-fast.js`)
- Uses Animekai extraction flow adapted from `ashi`
- Uses standalone Animepahe and Animepahe DUB source flows
- Uses Checkmate multi-resolver flow adapted from `downloads/sources 2/checkmate`
- Uses Checkmate fast alpha-first resolver variant

## Add to Nuvio

Plugin:

```text
https://raw.githubusercontent.com/Alas-3/alas-plugins/refs/heads/main/manifest.json
```

## Notes

- Manifest format follows current Nuvio `pluginService` contract (`{ name, version, scrapers: [] }`).
- Each scraper is listed separately in `manifest.json`, so each one is independently toggleable in Nuvio.

## License

This project is licensed under the GNU General Public License v3.0.

## Disclaimer

- No content is hosted by this repository.
- Providers fetch publicly available content from third-party websites.
- Users are responsible for compliance with local laws.
- For DMCA concerns, contact the actual content hosts.
