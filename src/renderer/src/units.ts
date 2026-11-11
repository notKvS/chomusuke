/**
 * A length written in pixels (16 per rem) as rem, so everything scales with the root font size and the zoom setting.
 * Sizes that come from numbers (icon sizes, a mascot's size, a theme's corner radius) go through this.
 */
export const rem = (px: number): string => `${Math.round((px / 16) * 10000) / 10000}rem`
