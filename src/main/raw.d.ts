// Vite `?raw` imports: the file's contents as a string (used to embed the bundled extensions).
declare module '*?raw' {
  const content: string
  export default content
}
