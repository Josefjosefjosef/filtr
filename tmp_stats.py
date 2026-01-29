import json,pathlib,urllib.parse
path=pathlib.Path('data/articles.json')
data=json.loads(path.read_text(encoding='utf-8'))
articles=data.get('articles', [])
print('ARTICLES_COUNT_RAW:', len(articles))
valid=[]
for item in articles:
    title=item.get('title') or item.get('name') or item.get('headline')
    link=item.get('link')
    url=item.get('url')
    candidate=url
    if not candidate:
        if isinstance(link, dict):
            candidate=link.get('href')
        elif isinstance(link, str):
            candidate=link
    if not candidate and isinstance(item.get('sources'), list):
        first_source = next((src for src in item['sources'] if src and src.get('url')), None)
        if first_source:
            candidate=first_source['url']
    if not candidate and item.get('canonicalUrl'):
        candidate=item.get('canonicalUrl')
    if candidate:
        try:
            candidate=urllib.parse.urljoin('https://info-uzel.cz', candidate)
        except:
            candidate=None
    if not title or not candidate:
        continue
    valid.append((title,candidate))
print('ARTICLES_COUNT_VALID:', len(valid))
print('FIRST_VALID_TITLE:', valid[0][0] if valid else '-')
print('FIRST_VALID_URL:', valid[0][1] if valid else '-')
