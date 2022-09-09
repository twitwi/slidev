import YAML from 'js-yaml'
import { isObject, isTruthy, objectMap } from '@antfu/utils'
import type { PreparserExtensionFromHeadmatter, SlideInfoBase, SlidevFeatureFlags, SlidevMarkdown, SlidevPreparserExtension, SlidevPreparserState, SlidevThemeMeta } from '@slidev/types'
import { resolveConfig } from './config'

export function stringify(data: SlidevMarkdown) {
  return `${
    data.slides
      .filter(slide => slide.source === undefined || slide.inline !== undefined)
      .map((slide, idx) => stringifySlide(slide.inline || slide, idx))
      .join('\n')
      .trim()
  }\n`
}

export function filterDisabled(data: SlidevMarkdown) {
  data.slides = data.slides.filter(i => !i.frontmatter?.disabled)
  return data
}

export function stringifySlide(data: SlideInfoBase, idx = 0) {
  if (data.raw == null)
    prettifySlide(data)

  return (data.raw.startsWith('---') || idx === 0)
    ? data.raw
    : `---\n${data.raw.startsWith('\n') ? data.raw : `\n${data.raw}`}`
}

export function prettifySlide(data: SlideInfoBase) {
  data.content = `\n${data.content.trim()}\n`
  data.raw = Object.keys(data.frontmatter || {}).length
    ? `---\n${YAML.dump(data.frontmatter).trim()}\n---\n${data.content}`
    : data.content
  if (data.note)
    data.raw += `\n<!--\n${data.note.trim()}\n-->\n`
  else
    data.raw += '\n'
  return data
}

export function prettify(data: SlidevMarkdown) {
  data.slides.forEach(prettifySlide)
  return data
}

function matter(code: string) {
  let data: any = {}
  const content = code.replace(/^---.*\r?\n([\s\S]*?)---/,
    (_, d) => {
      data = YAML.load(d)
      if (!isObject(data))
        data = {}
      return ''
    })
  return { data, content }
}

export function detectFeatures(code: string): SlidevFeatureFlags {
  return {
    katex: !!code.match(/\$.*?\$/) || !!code.match(/$\$\$/),
    monaco: !!code.match(/{monaco.*}/),
    tweet: !!code.match(/<Tweet\b/),
    mermaid: !!code.match(/^```mermaid/m),
  }
}

export function parseSlide(raw: string): SlideInfoBase {
  const result = matter(raw)
  let note: string | undefined
  const frontmatter = result.data || {}
  let content = result.content.trim()

  const comments = Array.from(content.matchAll(/<!--([\s\S]*?)-->/g))
  if (comments.length) {
    const last = comments[comments.length - 1]
    if (last.index !== undefined && last.index + last[0].length >= content.length) {
      note = last[1].trim()
      content = content.slice(0, last.index).trim()
    }
  }

  let title
  let level
  if (frontmatter.title || frontmatter.name) {
    title = frontmatter.title || frontmatter.name
    level = frontmatter.level || 1
  }
  else {
    const match = content.match(/^(#+) (.*)$/m)
    title = match?.[2]?.trim()
    level = match?.[1]?.length
  }

  return {
    raw,
    title,
    level,
    content,
    frontmatter,
    note,
  }
}

function checkDefined<T>(o: T | undefined, msg: () => string): T {
  if (o === undefined)
    throw new Error(msg())
  return o
}

export async function parse(
  markdown: string,
  filepath?: string,
  themeMeta?: SlidevThemeMeta,
  extensions?: SlidevPreparserExtension[],
  onHeadmatter?: PreparserExtensionFromHeadmatter,
): Promise<SlidevMarkdown> {
  const state: SlidevPreparserState = {
    lines: markdown.split(/\r?\n/g),
    slides: [],
    i: 0,
    start: 0,
    mode: 'content',
    modeStack: [],
    frontmatterPrepend: [],
    frontmatterAppend: [],
    contentPrepend: [],
    contentAppend: [],
    ext: {},
  }

  function slice(end: number) {
    if (state.start !== end) {
      let contentStart = 0
      const raw = state.lines.slice(state.start, end)
      if (state.frontmatterPrepend.length + state.frontmatterAppend.length > 0) {
        const hasFrontmatter = raw[0].match(/^---([^-].*)?$/)
        if (!hasFrontmatter)
          raw.splice(0, 0, '---', '---')
        let close = 1
        while (!raw[close].trimEnd().match(/^---$/))
          close++

        raw.splice(close, 0, ...state.frontmatterAppend)
        raw.splice(1, 0, ...state.frontmatterPrepend)
        contentStart = close + 1 + state.frontmatterPrepend.length + state.frontmatterAppend.length
      }
      raw.splice(contentStart, 0, ...state.contentPrepend)
      raw.push(...state.contentAppend)

      state.slides.push({
        ...parseSlide(raw.join('\n')),
        index: state.slides.length,
        start: state.start,
        end,
      })

      state.frontmatterPrepend = []
      state.frontmatterAppend = []
      state.contentPrepend = []
      state.contentAppend = []
    }
    state.start = end
  }

  function step({ by = 1, mode = '', push = false, pop = false } = {}) {
    state.i += by
    if (push)
      state.modeStack.push(state.mode)
    if (pop)
      state.mode = checkDefined(state.modeStack.pop(), () => `Preparser cannot pop empty modeStack, state is ${JSON.stringify(state)}`)
    if (mode !== '')
      state.mode = mode
  }

  while (state.i < state.lines.length) {
    if (extensions && extensions.length > 0) {
      let shouldContinue = false
      for (const e of extensions) {
        if (e.disabled)
          continue
        if (e.handle?.(state)) {
          shouldContinue = true
          break
        }
      }
      if (shouldContinue)
        continue
    }
    const line = state.lines[state.i].trimEnd()
    if (state.mode === ':frontmatter-or-content') {
      const next = state.lines[state.i + 1]
      let hasFrontmatter = false
      if (line.match(/^---([^-].*)?$/) && !next?.match(/^\s*$/))
        hasFrontmatter = true
      else
        state.start++
      step({ mode: hasFrontmatter ? 'frontmatter' : 'content' })
    }
    else if (state.mode === 'frontmatter') {
      if (line.trimEnd().match(/^---$/)) {
        if (state.slides.length === 0 && onHeadmatter) { // headmatter
          const o = YAML.load(state.lines.slice(state.start, state.i).join('\n'))
          // now that we have the list of addons, we can load the preparser-extensions they contain
          extensions = await onHeadmatter(o, extensions, filepath)
        }
        step({ mode: 'content' })
      }
      else { step() }
    }
    else if (state.mode === 'content') {
      if (line.startsWith('```')) {
        step({ mode: 'codeblock', push: true })
        continue
      }
      if (line.match(/^---+/)) {
        step({ by: 0, mode: ':slice' })
        continue
      }
      step()
    }
    else if (state.mode === 'codeblock') {
      if (line.startsWith('```'))
        step({ pop: true })
      else
        step()
    }
    else if (state.mode === ':slice') {
      slice(state.i)
      step({ by: 0, mode: ':sliced' })
    }
    else if (state.mode === ':sliced') {
      step({ by: 0, mode: ':frontmatter-or-content' })
    }
  }

  if (state.start <= state.lines.length - 1)
    slice(state.lines.length)

  const headmatter = state.slides[0]?.frontmatter || {}
  headmatter.title = headmatter.title || state.slides[0]?.title
  const config = resolveConfig(headmatter, themeMeta)
  const features = detectFeatures(markdown)

  return {
    raw: markdown,
    filepath,
    slides: state.slides,
    config,
    features,
    headmatter,
    themeMeta,
  }
}

export function mergeFeatureFlags(a: SlidevFeatureFlags, b: SlidevFeatureFlags): SlidevFeatureFlags {
  return objectMap(a, (k, v) => [k, v || b[k]])
}

// types auto discovery for TypeScript monaco
export function scanMonacoModules(md: string) {
  const typeModules = new Set<string>()

  md.replace(/^```(\w+?)\s*{monaco([\w:,-]*)}[\s\n]*([\s\S]+?)^```/mg, (full, lang = 'ts', options: string, code: string) => {
    options = options || ''
    lang = lang.trim()
    if (lang === 'ts' || lang === 'typescript') {
      Array.from(code.matchAll(/\s+from\s+(["'])([\/\w@-]+)\1/g))
        .map(i => i[2])
        .filter(isTruthy)
        .map(i => typeModules.add(i))
    }
    return ''
  })

  return Array.from(typeModules)
}

export * from './utils'
export * from './config'
