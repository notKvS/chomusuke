declare module '*.png' {
  const url: string
  export default url
}

declare module '*.jpg' {
  const url: string
  export default url
}

// import.meta.glob (used for the optional character stickers).
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options?: { eager?: boolean; import?: string }): Record<string, T>
}
