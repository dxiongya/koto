/**
 * Built-in Collector Sync Adapters — Script templates for common data sources.
 */

export interface AdapterTemplate {
  id: string
  name: string
  description: string
  defaultConfig: Record<string, unknown>
  script: string
}

export const BUILTIN_ADAPTERS: AdapterTemplate[] = [
  {
    id: 'x-bookmarks',
    name: 'X/Twitter Bookmarks',
    description: 'Import bookmarks from fieldtheory-cli cache (~/.ft-bookmarks). Run "ft sync" first to fetch from X.',
    defaultConfig: {
      ftDataDir: '~/.ft-bookmarks',
    },
    script: `// X/Twitter Bookmarks Sync
// Reads bookmarks from fieldtheory-cli cache and imports to collector.
// Prerequisites: npm install -g fieldtheory && ft sync

async function sync(ctx) {
  const dataDir = ctx.adapterConfig.ftDataDir || '~/.ft-bookmarks'
  const cachePath = dataDir + '/bookmarks.jsonl'

  ctx.progress('Reading bookmarks cache...')
  let bookmarks
  try {
    bookmarks = await ctx.readJsonLines(cachePath)
  } catch (e) {
    ctx.error('Could not read bookmarks cache. Run "ft sync" first.')
    throw e
  }

  ctx.progress('Importing bookmarks...', 0, bookmarks.length)
  let added = 0, skipped = 0

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i]
    if (!bm.url) continue

    if (await ctx.checkDuplicate(bm.url)) {
      skipped++
      continue
    }

    const thumbnail = (bm.media && bm.media[0]) || bm.authorProfileImageUrl || null

    await ctx.addItem({
      type: 'link',
      title: '@' + (bm.authorHandle || 'unknown') + ': ' + (bm.text || '').slice(0, 120),
      url: bm.url,
      note: bm.text || '',
      meta: {
        authorHandle: bm.authorHandle,
        authorName: bm.authorName,
        authorProfileImageUrl: bm.authorProfileImageUrl,
        thumbnailUrl: thumbnail,
        mediaUrls: bm.media || [],
        postedAt: bm.postedAt,
        likeCount: bm.engagement?.likeCount,
        repostCount: bm.engagement?.repostCount,
        tweetId: bm.tweetId,
      },
    })
    added++

    if (i % 100 === 0) {
      ctx.progress('Importing...', i, bookmarks.length)
    }
  }

  ctx.progress('Done. ' + added + ' new, ' + skipped + ' skipped.')
}
`,
  },

  {
    id: 'rss',
    name: 'RSS Feed',
    description: 'Import items from an RSS/Atom feed URL.',
    defaultConfig: {
      feedUrl: '',
      maxItems: 50,
    },
    script: `// RSS Feed Sync
// Fetches an RSS/Atom feed and imports new items.

async function sync(ctx) {
  const feedUrl = ctx.adapterConfig.feedUrl
  if (!feedUrl) {
    ctx.error('No feed URL configured. Set feedUrl in adapter config.')
    return
  }

  ctx.progress('Fetching feed...')
  const res = await ctx.fetch(feedUrl)
  if (!res.ok) {
    ctx.error('Failed to fetch feed: HTTP ' + res.status)
    return
  }

  const xml = await res.text()

  // Simple XML parsing (extract <item> or <entry> elements)
  const items = []
  const itemRegex = /<(?:item|entry)[\\s>][\\s\\S]*?<\\/(?:item|entry)>/gi
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0]
    const title = (block.match(/<title[^>]*>(?:<!\\\\.CDATA\\\\[)?(.*?)(?:\\\\]\\\\]>)?<\\/title>/i) || [])[1] || 'Untitled'
    const link = (block.match(/<link[^>]*href="([^"]*)"/) || block.match(/<link[^>]*>(.*?)<\\/link>/i) || [])[1] || ''
    const desc = (block.match(/<(?:description|summary|content)[^>]*>(?:<!\\\\.CDATA\\\\[)?(.*?)(?:\\\\]\\\\]>)?<\\/(?:description|summary|content)>/i) || [])[1] || ''
    items.push({ title: title.replace(/<[^>]+>/g, '').trim(), link: link.trim(), desc: desc.replace(/<[^>]+>/g, '').slice(0, 300).trim() })
  }

  const maxItems = ctx.adapterConfig.maxItems || 50
  ctx.progress('Found ' + items.length + ' items, importing up to ' + maxItems)
  let added = 0

  for (let i = 0; i < Math.min(items.length, maxItems); i++) {
    const item = items[i]
    if (!item.link || await ctx.checkDuplicate(item.link)) continue

    await ctx.addItem({
      type: 'link',
      title: item.title,
      url: item.link,
      note: item.desc,
    })
    added++
  }

  ctx.progress('Done. ' + added + ' new items imported.')
}
`,
  },

  {
    id: 'custom',
    name: 'Custom Script',
    description: 'Write your own sync script with full SyncContext API.',
    defaultConfig: {},
    script: `// Custom Sync Script
// Available API: ctx.addItem(), ctx.checkDuplicate(), ctx.fetch(),
//   ctx.readFile(), ctx.readJsonLines(), ctx.progress(), ctx.log()

async function sync(ctx) {
  ctx.progress('Starting custom sync...')

  // Example: fetch a JSON API
  // const res = await ctx.fetch('https://api.example.com/items')
  // const data = await res.json()
  //
  // for (const item of data) {
  //   if (await ctx.checkDuplicate(item.url)) continue
  //   await ctx.addItem({
  //     type: 'link',
  //     title: item.title,
  //     url: item.url,
  //     note: item.description,
  //   })
  // }

  ctx.progress('Done.')
}
`,
  },
]

/** Get adapter template by ID */
export function getAdapterTemplate(id: string): AdapterTemplate | undefined {
  return BUILTIN_ADAPTERS.find(a => a.id === id)
}
