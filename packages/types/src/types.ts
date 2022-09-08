import type { SlidevConfig } from './config'

export interface SlideInfoBase {
  raw: string
  content: string
  note?: string
  frontmatter: Record<string, any>
  title?: string
  level?: number
}

export interface SlideInfo extends SlideInfoBase {
  index: number
  start: number
  end: number
  inline?: SlideInfoBase
  source?: SlideInfoWithPath
}

export interface SlideInfoWithPath extends SlideInfoBase {
  filepath: string
}

export interface SlideInfoExtended extends SlideInfo {
  notesHTML: string
}

/**
 * Metadata for "slidev" field in themes' package.json
 */
export interface SlidevThemeMeta {
  defaults?: Partial<SlidevConfig>
  colorSchema?: 'dark' | 'light' | 'both'
  highlighter?: 'prism' | 'shiki' | 'both'
}

export type SlidevThemeConfig = Record<string, string | number>

export interface SlidevFeatureFlags {
  katex: boolean
  monaco: boolean
  tweet: boolean
  mermaid: boolean
}

export interface SlidevMarkdown {
  slides: SlideInfo[]
  raw: string
  config: SlidevConfig
  features: SlidevFeatureFlags
  headmatter: Record<string, unknown>

  filepath?: string
  entries?: string[]
  themeMeta?: SlidevThemeMeta
}

// Preparser modes: listing the built-in ones but it is open to extensions
export type SlidevPreparserMode = 'content' | 'frontmatter' | 'content-or-frontmatter' | 'codeblock' | string

export interface SlidevPreparserState {
  lines: string[]
  slides: SlideInfo[]
  i: number
  start: number
  mode: SlidevPreparserMode
  modeStack: SlidevPreparserMode[]
}

export interface SlidevPreparserExtension {
  handle(state: SlidevPreparserState): boolean
}

export type PreparserExtensionLoader = (addons: string[], filepath?: string) => Promise<SlidevPreparserExtension[]>

export type PreparserExtensionFromHeadmatter = (headmatter: any, exts?: SlidevPreparserExtension[], filepath?: string) => Promise<SlidevPreparserExtension[]>

export type RenderContext = 'slide' | 'overview' | 'presenter' | 'previewNext'
